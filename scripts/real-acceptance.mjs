#!/usr/bin/env node
/**
 * First-version real-service acceptance (#44).
 *
 * Boots the product backend with the deployment's real credentials, then makes
 * the smallest calls the acceptance matrix requires of external services:
 *
 *   1. one official DeepSeek Flash text turn through the product chat route;
 *   2. the PDF scan-page path, where the model asks for a page render and the
 *      resulting tool result carries a real image (`scripts/pdf-flash-smoke.mjs`);
 *   3. one real SiliconFlow ASR transcription, on speech synthesized with the
 *      same account's TTS model and resampled to the product's 16 kHz PCM WAV
 *      contract — a synthetic sample, not a human recording;
 *   4. an optional MiniMax call, only when `MINIMAX_API_KEY` is present. Its
 *      absence is reported as not executed, never inferred from a template.
 *
 * The script prints one JSON document with the actual outcome of every step. It
 * does not upgrade an absent credential or a refused call into a pass.
 *
 * Usage:
 *   set -a; . ./DEEPSEEK_API_KEY.env; . ./VOICE_API_KEY.env; set +a
 *   node scripts/real-acceptance.mjs [--home <dir>] [--skip-pdf] [--minimax]
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import { repoRoot } from './combo.mjs'

const PHAETHON_PASSWORD = 'real-acceptance-password'
const options = parse(process.argv.slice(2))

function parse(argv) {
  const parsed = { home: undefined, skipPdf: false, minimax: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--home') { parsed.home = resolve(argv[index + 1]); index += 1 }
    else if (arg === '--skip-pdf') parsed.skipPdf = true
    else if (arg === '--minimax') parsed.minimax = true
    else throw new Error(`unknown argument ${arg}`)
  }
  return parsed
}

function readEnvFile(name) {
  try {
    for (const line of readFileSync(join(repoRoot, name), 'utf8').split('\n')) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
      if (match !== null && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
    }
  } catch {
    // The operator may export the variables directly instead of keeping files.
  }
}

function fail(message) {
  process.stderr.write(`real-acceptance: ${message}\n`)
  process.exit(1)
}

function request(port, path, { token, body, method = 'POST', headers = {} } = {}) {
  const payload = body === undefined || Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  const requestHeaders = { host: `127.0.0.1:${port}`, ...headers }
  if (token !== undefined) requestHeaders.authorization = `Bearer ${token}`
  if (payload !== undefined && !Buffer.isBuffer(body)) {
    requestHeaders['content-type'] = 'application/json'
    requestHeaders['content-length'] = String(payload.byteLength)
  }
  return new Promise((resolvePromise, reject) => {
    const call = http.request({ host: '127.0.0.1', port, path, method, headers: requestHeaders, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const bytes = Buffer.concat(chunks)
        let json
        try { json = JSON.parse(bytes.toString('utf8')) } catch { json = undefined }
        resolvePromise({ status: response.statusCode, bytes, json })
      })
    })
    call.on('error', reject)
    if (payload !== undefined) call.write(payload)
    call.end()
  })
}

async function waitForReply(port, token, sessionId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { json } = await request(port, '/chat/read', { token, body: { sessionId } })
    if (json?.projection?.replyStatus === 0) return json.projection
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  }
  throw new Error(`session ${sessionId} did not settle within ${timeoutMs}ms`)
}

/** Read one RIFF chunk walk; returns the fmt fields and the data payload. */
function parseWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV document')
  let offset = 12
  let format
  let data
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const body = bytes.subarray(offset + 8, offset + 8 + size)
    if (id === 'fmt ') {
      format = { channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }
    } else if (id === 'data') {
      data = body
    }
    offset += 8 + size + (size % 2)
  }
  if (format === undefined || data === undefined) throw new Error('WAV has no fmt/data chunk')
  return { format, data }
}

/** Resample 16-bit mono PCM linearly to 16 kHz (the product's recording container). */
function resampleTo16k(buffer) {
  const { format, data } = parseWav(buffer)
  if (format.bits !== 16 || format.channels !== 1) throw new Error(`unexpected TTS format ${JSON.stringify(format)}`)
  const source = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const ratio = format.sampleRate / 16000
  const length = Math.floor(source.length / ratio)
  const output = Buffer.alloc(44 + length * 2)
  const resampled = new Int16Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const before = Math.floor(position)
    const after = Math.min(before + 1, source.length - 1)
    const fraction = position - before
    resampled[index] = Math.round(source[before] * (1 - fraction) + source[after] * fraction)
  }
  output.write('RIFF', 0)
  output.writeUInt32LE(36 + length * 2, 4)
  output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(16000, 24)
  output.writeUInt32LE(32000, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(length * 2, 40)
  Buffer.from(resampled.buffer).copy(output, 44)
  return output
}

async function synthesizeSpeech(text) {
  const key = process.env.VOICE_API_KEY
  const response = await fetch('https://api.siliconflow.cn/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'FunAudioLLM/CosyVoice2-0.5B', input: text, voice: 'FunAudioLLM/CosyVoice2-0.5B:anna', response_format: 'wav' }),
  })
  if (!response.ok) throw new Error(`TTS answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return resampleTo16k(Buffer.from(await response.arrayBuffer()))
}

function start(home) {
  const started = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ourfairy-backend.mjs'), 'start', '--json'], {
    cwd: repoRoot,
    env: { ...process.env, OURFAIRY_HOME: home, OURFAIRY_PORT: '0', OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD },
    encoding: 'utf8',
    timeout: 300000,
  })
  if (started.status !== 0) throw new Error(`backend start failed (${started.status}):\n${started.stdout}\n${started.stderr}`)
  const summary = JSON.parse(started.stdout)
  return { port: summary.listeningPorts[0], logFile: summary.logFile }
}

function stop(home) {
  spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ourfairy-backend.mjs'), 'stop', '--json'], {
    cwd: repoRoot, env: { ...process.env, OURFAIRY_HOME: home }, encoding: 'utf8', timeout: 120000,
  })
}

async function main() {
  readEnvFile('DEEPSEEK_API_KEY.env')
  readEnvFile('VOICE_API_KEY.env')
  if (!process.env.DEEPSEEK_API_KEY) fail('DEEPSEEK_API_KEY is not set and DEEPSEEK_API_KEY.env is unreadable')
  if (!process.env.VOICE_API_KEY) fail('VOICE_API_KEY is not set and VOICE_API_KEY.env is unreadable')
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'ourfairy-real-'))
  mkdirSync(home, { recursive: true })
  const report = {
    startedAt: new Date().toISOString(), dshHome: join(home, 'dsh-home'), steps: {},
    unexecuted: [], failures: [],
  }
  let backend
  try {
    backend = start(home)
    report.steps.backend = { port: backend.port, logFile: backend.logFile }

    const signed = await request(backend.port, '/identity/sign-in', { body: { name: 'phaethon', password: PHAETHON_PASSWORD } })
    if (signed.status !== 200) throw new Error(`Phaethon sign-in failed: ${signed.status} ${signed.bytes.toString('utf8')}`)
    const admin = signed.json.token
    const invite = await request(backend.port, '/identity/invite', { token: admin })
    const registered = await request(backend.port, '/identity/register', {
      body: { inviteCode: invite.json.invite.code, name: 'real-agent', password: 'real-agent-password' },
    })
    if (registered.status !== 200) throw new Error(`agent registration failed: ${registered.status} ${registered.bytes.toString('utf8')}`)
    const agent = registered.json.token

    /** 1. Official Flash text through the product chat runtime. */
    const { json: created } = await request(backend.port, '/sessions/create', { token: admin, body: {} })
    const sessionId = created.session.id
    const prompt = '请用一句话确认你已收到这条真实链路验收消息，并在句子里包含 OurFairy。'
    const sent = await request(backend.port, '/chat/send', { token: admin, body: { sessionId, requestId: `real-text-${Date.now()}`, text: prompt } })
    if (sent.status !== 200) throw new Error(`chat send failed: ${sent.status} ${sent.bytes.toString('utf8')}`)
    const projection = await waitForReply(backend.port, admin, sessionId)
    const reply = projection.messages.filter(message => message.role === 2 && message.status === 2)
    const text = reply.map(message => message.text).join('\n')
    if (text.trim() === '') throw new Error('the official Flash turn produced no final text')
    report.steps.text = { requestedModel: 'deepseek-official/deepseek-flash', reply: text, error: projection.error ?? null }
    if (projection.error !== null) report.failures.push(`text turn reported an error: ${JSON.stringify(projection.error)}`)

    /** 2. The PDF scan-page path: a real render becomes an official image tool result. */
    if (options.skipPdf) {
      report.unexecuted.push('PDF scan page smoke (--skip-pdf)')
    } else {
      const smoke = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'pdf-flash-smoke.mjs'), 'scan'], {
        cwd: repoRoot,
        env: { ...process.env, OURFAIRY_URL: `http://127.0.0.1:${backend.port}`, OURFAIRY_TOKEN: admin },
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
      })
      const stdout = smoke.stdout ?? ''
      const start = stdout.indexOf('{')
      let parsed
      try { parsed = start < 0 ? undefined : JSON.parse(stdout.slice(start)) } catch { parsed = undefined }
      report.steps.scanPage = { exit: smoke.status, sessionId: parsed?.sessionId ?? null, originalUnchanged: parsed?.originalUnchanged ?? null,
        reply: parsed?.projection?.messages?.filter(message => message.role === 2).map(message => message.text).join('\n') ?? null }
      if (smoke.status !== 0) report.failures.push(`PDF scan smoke exited ${smoke.status}: ${(smoke.stderr ?? '').slice(-800)}`)
    }

    /** 3. Real ASR on synthesized speech, through the product's recording route. */
    const spoken = '主人，首版真实链路验收已经完成，语音转写返回了这段文字。'
    const wav = await synthesizeSpeech(spoken)
    const transcribed = await request(backend.port, '/speech/transcriptions', {
      token: agent, body: wav, headers: { 'content-type': 'audio/wav' },
    })
    report.steps.asr = { status: transcribed.status, synthesized: spoken, text: transcribed.json?.text ?? null,
      error: transcribed.json?.error ?? null, bytes: wav.length }
    if (transcribed.status !== 200) report.failures.push(`ASR answered ${transcribed.status}: ${transcribed.bytes.toString('utf8').slice(0, 500)}`)

    /** 4. MiniMax is only claimed when its credential exists and the call succeeds. */
    if (!options.minimax || !process.env.MINIMAX_API_KEY) {
      report.unexecuted.push('MiniMax plan/credential verification (MINIMAX_API_KEY not set; no call made)')
    } else {
      const saved = await request(backend.port, '/gateway/route', { token: admin, body: {
        provider: 'minimax-cn', displayName: 'MiniMax（中国站）', api: 'anthropic-messages',
        baseURL: 'https://api.minimax.cn/anthropic', apiKeyEnv: 'MINIMAX_API_KEY',
        models: [{ id: 'MiniMax-M3.1-Flash-Preview', name: 'MiniMax M3.1 Flash Preview', input: ['text', 'image'] }],
      } })
      const selected = await request(backend.port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' } })
      const minimaxSession = (await request(backend.port, '/sessions/create', { token: admin, body: {} })).json.session.id
      await request(backend.port, '/chat/send', { token: admin, body: { sessionId: minimaxSession, requestId: 'real-minimax', text: '请用一句话确认你是 MiniMax 模型。' } })
      const minimaxProjection = await waitForReply(backend.port, admin, minimaxSession)
      report.steps.minimax = { routeSaved: saved.status, selectionSaved: selected.status,
        reply: minimaxProjection.messages.filter(message => message.role === 2).map(message => message.text).join('\n'),
        error: minimaxProjection.error ?? null }
      if (saved.status !== 200 || selected.status !== 200 || minimaxProjection.error !== null) {
        report.failures.push(`MiniMax call failed: route ${saved.status}, selection ${selected.status}, error ${JSON.stringify(minimaxProjection.error)}`)
      }
    }
  } catch (error) {
    report.failures.push(error?.stack ?? String(error))
  } finally {
    if (backend !== undefined) stop(home)
    report.finishedAt = new Date().toISOString()
    const reportPath = join(home, 'real-acceptance.json')
    writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
    process.stdout.write(`report written to ${reportPath}\n`)
    if (report.failures.length > 0) process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
