#!/usr/bin/env node
// Real product HTTP/SSE and Android receive/render path; only the external model is a double.
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Transform } from 'node:stream'
import { parseArgs } from 'node:util'
import { createGunzip } from 'node:zlib'
import { dshDir, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from '../../../../tests/helpers/backend.mjs'

const { values } = parseArgs({ options: {
  adb: { type: 'string' }, serial: { type: 'string' }, out: { type: 'string' },
  label: { type: 'string', default: 'unspecified' }, 'host-only': { type: 'boolean', default: false },
  'reply-chars': { type: 'string', default: '2048' }, 'download-kib': { type: 'string', default: '0' },
} })
assert.ok(values.out, '--out is required')
assert.ok(values['host-only'] || values.adb, '--adb is required unless --host-only')
const params = { historyTurns: 40, replyChars: Number(values['reply-chars']), chunkChars: 1,
  intervalMs: 10, downloadBytesPerSecond: Number(values['download-kib']) * 1024 }
assert.ok(Number.isInteger(params.replyChars) && params.replyChars > 0)
assert.ok(Number.isFinite(params.downloadBytesPerSecond) && params.downloadBytesPerSecond >= 0)
const unit = 'Fairy stream measurement. '
const reply = unit.repeat(Math.ceil(params.replyChars / unit.length)).slice(0, params.replyChars)
const modelChunks = []
const frames = []
const deviceFrames = []
let generated = 0
let measuring = false
let deviceContentEncoding
let deviceTransportBytes = 0
let deviceResult
let ready
let finish
const deviceReady = new Promise(resolve => { ready = resolve })
const deviceFinished = new Promise(resolve => { finish = resolve })
const { startMockLlmServer } = await import(join(dshDir, 'packages/test-support/llm-mock-server/lib/index.js'))
const model = await startMockLlmServer({
  host: '127.0.0.1', port: 0, apiKey: 'mock-key',
  sequence: [...Array(params.historyTurns).fill('success'), 'slow_success'],
  successText: reply, chunkSize: params.chunkChars, chunkDelayMs: params.intervalMs,
})

// Observe the model's actual text delta boundary, forwarding its bytes unchanged to the backend.
// /ready and /result are measurement-only callbacks, separate from the product HTTP surface.
const proxy = http.createServer(async (request, response) => {
  if (request.url === '/ready' || request.url === '/result') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    if (request.url === '/ready') ready()
    else {
      deviceResult = JSON.parse(Buffer.concat(chunks).toString())
      finish()
    }
    response.writeHead(200).end('{}')
    return
  }
  const product = request.url.startsWith('/chat/')
  const upstream = http.request(new URL(request.url, product ? `http://127.0.0.1:${backendPort}` : model.baseURL), {
    method: request.method, headers: request.headers,
  }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers)
    if (product) {
      let delivery = incoming
      if (request.url === '/chat/observe' && params.downloadBytesPerSecond > 0) {
        const limit = new Transform({ transform(chunk, encoding, callback) {
          setTimeout(() => callback(null, chunk), 1000 * chunk.length / params.downloadBytesPerSecond)
        } })
        delivery = incoming.pipe(limit)
        response.once('close', () => limit.destroy())
      }
      if (request.url === '/chat/observe') {
        deviceContentEncoding = incoming.headers['content-encoding'] ?? 'identity'
        delivery.on('data', chunk => { if (measuring) deviceTransportBytes += chunk.length })
        const monitor = deviceContentEncoding === 'gzip' ? delivery.pipe(createGunzip()) : delivery
        let pending = ''
        monitor.on('error', error => response.destroy(error))
        monitor.on('data', chunk => {
          pending += chunk.toString('utf8')
          let boundary
          while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, boundary)
            pending = pending.slice(boundary + 2)
            const data = frame.split('\n').find(line => line.startsWith('data: '))
            if (data && measuring) {
              const projection = JSON.parse(data.slice(6))
              deviceFrames.push({ atMs: performance.now(), version: projection.version,
                revision: projection.attempt?.revision, chars: projection.attempt?.text.length ?? 0,
                replyStatus: projection.replyStatus })
            }
          }
        })
      }
      delivery.pipe(response)
      response.once('close', () => upstream.destroy())
      return
    }
    let pending = ''
    incoming.on('data', chunk => {
      if (measuring) {
        pending += chunk.toString('utf8')
        let boundary
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const event = pending.slice(0, boundary)
          pending = pending.slice(boundary + 2)
          const data = event.split('\n').find(line => line.startsWith('data: '))
          if (data) {
            const payload = JSON.parse(data.slice(6))
            if (payload.type === 'content_block_delta' && payload.delta.type === 'text_delta') {
              generated += payload.delta.text.length
              modelChunks.push({ atMs: performance.now(), chars: generated })
            }
          }
        }
      }
      response.write(chunk)
    })
    incoming.on('end', () => response.end())
    incoming.on('error', error => response.destroy(error))
  })
  upstream.on('error', error => response.destroy(error))
  request.pipe(upstream)
})
proxy.listen(0, '127.0.0.1')
await once(proxy, 'listening')
const proxyPort = proxy.address().port
const home = makeHome('ourfairy-214-')
const password = 'isolated-stream-measurement'
const env = { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
  MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${proxyPort}` }
const controller = new AbortController()
let streamDone
let backendPort

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function until(read, predicate, timeoutMs = 90_000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await sleep(10)
  }
  throw new Error('stream measurement timed out')
}
async function post(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  assert.equal(response.status, 200, `${path} refused`)
  return response.json()
}
async function adb(...args) {
  const child = spawn(values.adb, [...(values.serial ? ['-s', values.serial] : []), ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  // Do not echo activity arguments: its token belongs to this isolated run.
  child.stderr.resume()
  const [code] = await once(child, 'close')
  assert.equal(code, 0, `ADB ${args[0]} failed`)
  return stdout.trim()
}
function rate(samples) {
  const unique = samples.filter((item, index) => item.chars > 0 && (index === 0 || item.chars > samples[index - 1].chars))
  if (unique.length < 2) return { advancingSamples: unique.length, charsPerSecond: null }
  const first = unique[0], last = unique.at(-1)
  return { advancingSamples: unique.length, charsPerSecond: 1000 * (last.chars - first.chars) / (last.atMs - first.atMs),
    durationMs: last.atMs - first.atMs, firstChars: first.chars, finalChars: last.chars }
}

try {
  backendPort = startedPort(await runBackendAsync(startArgs(), env))
  process.stderr.write('stream-rate: isolated backend started; seeding history\n')
  const admin = await post('/identity/sign-in', undefined, { name: 'phaethon', password })
  const user = await registerUser(backendPort, admin.token, 'stream-bench')
  const { session } = await post('/sessions/create', user.token)
  for (let index = 0; index < params.historyTurns; index++) {
    const { receipt } = await post('/chat/send', user.token, {
      sessionId: session.id, requestId: `seed-${index}`, text: `seed ${index}`,
    })
    await until(() => post('/chat/read', user.token, { sessionId: session.id }), value => value.projection.replyStatus === 0
      && value.projection.messages.some(message => message.role === 2 && message.seq > receipt.acceptedSeq))
  }
  const response = await fetch(`http://127.0.0.1:${backendPort}/chat/observe`, {
    method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` },
    body: JSON.stringify({ sessionId: session.id }),
  })
  assert.equal(response.status, 200)
  streamDone = (async () => {
    let pending = ''
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      pending += chunk
      let boundary
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        const data = frame.split('\n').find(line => line.startsWith('data: '))
        if (data && measuring) {
          const projection = JSON.parse(data.slice(6))
          frames.push({ atMs: performance.now(), version: projection.version, revision: projection.attempt?.revision,
            chars: projection.attempt?.text.length ?? (projection.replyStatus === 0 ? reply.length : 0),
            replyStatus: projection.replyStatus, bytes: Buffer.byteLength(frame) })
        }
      }
    }
  })()
  let device
  if (!values['host-only']) {
    for (const port of [backendPort, proxyPort]) await adb('reverse', `tcp:${port}`, `tcp:${port}`)
    device = { model: await adb('shell', 'getprop', 'ro.product.model'), sdk: await adb('shell', 'getprop', 'ro.build.version.sdk') }
    await adb('shell', 'am', 'start', '-W', '-n', 'me.rerere.rikkahub.streambench/me.rerere.rikkahub.ui.identity.StreamingRateActivity',
      '--es', 'endpoint', `http://127.0.0.1:${proxyPort}`, '--es', 'token', user.token,
      '--es', 'sessionId', session.id, '--es', 'resultEndpoint', `http://127.0.0.1:${proxyPort}`)
    await until(() => Promise.race([deviceReady.then(() => true), sleep(10).then(() => false)]), Boolean, 30_000)
  }
  measuring = true
  process.stderr.write('stream-rate: observers ready; measured reply started\n')
  await post('/chat/send', user.token, { sessionId: session.id, requestId: 'measure', text: 'stream rate measurement' })
  await until(() => frames.at(-1), frame => frame?.replyStatus === 0 && modelChunks.at(-1)?.chars === reply.length)
  if (!values['host-only']) await until(() => Promise.race([deviceFinished.then(() => true), sleep(10).then(() => false)]), Boolean)
  const advancingFrames = frames.filter(frame => frame.revision !== undefined)
  const summary = { model: rate(modelChunks), sse: rate(advancingFrames),
    deviceSse: rate(deviceFrames.filter(frame => frame.revision !== undefined)),
    applied: deviceResult ? rate(deviceResult.applied.filter(frame => frame.revision !== undefined)) : null,
    presented: deviceResult ? rate(deviceResult.presented.filter(frame => frame.revision !== undefined)) : null }
  const report = { ticket: 214, label: values.label, measuredAt: new Date().toISOString(), params,
    units: 'UTF-16 characters and milliseconds; model boundary uses a deterministic external model double, not model tokens',
    device, deviceContentEncoding, deviceTransportBytes, summary, modelChunks, frames, deviceFrames, deviceResult }
  writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ label: values.label, device, summary, error: deviceResult?.error }))
  assert.equal(deviceResult?.error, undefined)
  if (deviceResult) {
    assert.equal(deviceResult.failure ?? null, null)
    for (const stage of ['applied', 'presented']) {
      assert.equal(deviceResult[stage].at(-1)?.replyStatus, 0, `${stage} did not reach the terminal reply`)
      assert.equal(deviceResult[stage].at(-1)?.chars, reply.length, `${stage} did not retain the complete reply`)
    }
  }
} finally {
  controller.abort()
  await streamDone?.catch(error => { if (error.name !== 'AbortError') throw error })
  if (values.adb && backendPort) {
    for (const port of [backendPort, proxyPort]) await adb('reverse', '--remove', `tcp:${port}`).catch(() => {})
  }
  await runBackendAsync(['stop', '--json'], env)
  proxy.closeAllConnections()
  await new Promise(resolve => proxy.close(resolve))
  await model.close()
  removeHome(home)
}
