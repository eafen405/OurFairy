#!/usr/bin/env node
/**
 * Projection benchmark for the chat read/observe path (#88).
 *
 * Boots the real product launcher against the pinned combination and an
 * EXTERNAL model double, seeds a fixed long history through the product
 * HTTP/SSE surface, then streams one fixed-chunk reply while measuring:
 *
 *   - "backend time per fragment". No product code is changed to instrument the
 *     publish loop, so the script uses two delay-free proxies instead:
 *     `/chat/read` round-trip latency sampled while the stream runs (that route
 *     executes the same projection pass a frame publication executes), and the
 *     backend's own process CPU time across the stream window;
 *   - SSE frame bytes, and the per-publish arrival spread between two observers
 *     of the same session — the marginal cost of the second observer;
 *   - the backend process's sampled RSS and per-run peak (VmHWM);
 *   - `/chat/read` latency on the seeded history with no stream running.
 *
 * The seeded history is measured at two sizes so the output shows whether the
 * per-fragment cost and memory grow with history, which one size cannot show.
 *
 * Every workload parameter lives in {@link PARAMS} and is echoed in the output
 * document. The script writes one JSON document to stdout (or `--out <path>`)
 * and progress to stderr. It is not part of `npm test`.
 *
 * Usage:
 *   node scripts/bench-projection.mjs [--out <path>] [--label <text>]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, loadavg, release, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

/**
 * The fixed workload. Change it only by a commit that also updates the
 * evidence directory, so a recorded baseline names the exact load it measured.
 *
 * Two history sizes are measured because the question this baseline answers is
 * whether per-fragment cost grows with history: comparing 40 and 160 turns at
 * the same stream shows the slope, while one size alone cannot.
 */
export const PARAMS = Object.freeze({
  /** User turns pushed into the history before the measured stream, per size. */
  historyTurnCounts: [40, 160],
  /** Reply characters the double returns for every turn (history and stream). */
  replyChars: 2048,
  /** Unicode code points per text delta the double emits. */
  chunkSize: 16,
  /** Inter-delta delay for the measured stream (`slow_success` only). */
  streamChunkDelayMs: 15,
  /** Deliberate observer counts; each is measured `repetitions` times. */
  observerCounts: [1, 2],
  /** Times each observer count is measured, on a freshly seeded session. */
  repetitions: 2,
  /**
   * `/chat/read` samples taken per window (quiescent and during the stream).
   * During the stream the samples are spread over the expected stream length;
   * `readSampleIntervalMs` is the floor between them.
   */
  readSamples: 32,
  /** Minimum delay after one sample completes before the next starts, ms. */
  readSampleIntervalMs: 10,
  /** Backend RSS sampling interval during the stream, ms. */
  rssSampleIntervalMs: 25,
  /** Per-phase timeout for the streamed reply to settle, ms. */
  streamTimeoutMs: 60_000,
})

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const backendScript = join(repoRoot, 'scripts', 'ourfairy-backend.mjs')
const PASSWORD = 'bench-projection-password'
const scriptStartedAt = performance.now()
const options = parseArgs(process.argv.slice(2))
const outputPath = options.out
const runLabel = options.label ?? 'unspecified'

function parseArgs(argv) {
  let out
  let label
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' || argv[index] === '--label') {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) fail(`${argv[index]} requires a value`)
      if (argv[index] === '--out') out = next
      else label = next
      index += 1
    } else if (argv[index] === '--help') {
      process.stderr.write('usage: node scripts/bench-projection.mjs [--out <path>] [--label <text>]\n')
      process.exit(0)
    } else fail(`unknown argument ${argv[index]}`)
  }
  return { out, label }
}

function fail(message) {
  process.stderr.write(`bench-projection: ${message}\n`)
  process.exit(1)
}

function note(message) {
  process.stderr.write(`bench-projection: ${message}\n`)
}

const now = () => performance.now()
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Deterministic reply text of an exact character length, so the load is reproducible. */
function benchText(length) {
  const unit = 'OurFairy 投影基准：固定长度的回复正文，用于制造稳定的事件与帧负载。\n'
  let text = ''
  while (text.length < length) text += unit
  return text.slice(0, length)
}

/** Nearest-rank percentile; the same rule the recorded baseline used. */
function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return round(sorted[Math.min(sorted.length - 1, rank - 1)])
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

function distribution(values) {
  if (values.length === 0) return { count: 0 }
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    count: values.length,
    min: round(Math.min(...values)),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: round(Math.max(...values)),
    mean: round(sum / values.length),
  }
}

/** One POST/JSON call against the running backend, timing the whole round trip. */
function postJson(port, path, { token, body } = {}) {
  const payload = Buffer.from(JSON.stringify(body ?? {}))
  const headers = {
    host: `127.0.0.1:${port}`,
    'content-type': 'application/json',
    'content-length': String(payload.byteLength),
  }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return new Promise((resolve, reject) => {
    const started = now()
    const call = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const rttMs = now() - started
        let json
        try { json = JSON.parse(text) } catch {
          reject(new Error(`${path}: ${response.statusCode} ${text.slice(0, 200)}`))
          return
        }
        resolve({ status: response.statusCode, body: json, rttMs, bytes: Buffer.byteLength(text) })
      })
    })
    call.on('error', reject)
    call.end(payload)
  })
}

/** A `/chat/observe` SSE client that records one summary per `data:` frame. */
function observeSession(port, token, sessionId) {
  const frames = []
  const waiters = []
  let buffer = ''
  let response
  let failure
  let phase = 'opening'
  let firstResolve
  let firstReject
  const ready = new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject })

  function deliver(frame) {
    frames.push(frame)
    firstResolve()
    for (const waiter of [...waiters]) {
      if (!waiter.check(frame)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(frame)
    }
  }

  const payload = Buffer.from(JSON.stringify({ sessionId }))
  const call = http.request({
    host: '127.0.0.1', port, path: '/chat/observe', method: 'POST', agent: false,
    headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}`,
      'content-type': 'application/json', 'content-length': String(payload.byteLength) },
  }, incoming => {
    response = incoming
    if (incoming.statusCode !== 200) {
      incoming.resume()
      firstReject(new Error(`/chat/observe answered ${incoming.statusCode}`))
      return
    }
    incoming.setEncoding('utf8')
    incoming.on('data', chunk => {
      buffer += chunk
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const item = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const dataLine = item.split('\n').find(line => line.startsWith('data: '))
        if (dataLine === undefined) continue // `: keepalive` comment
        let projection
        try { projection = JSON.parse(dataLine.slice(6)) } catch (error) {
          failure = error
          continue
        }
        const last = projection.messages?.at(-1)
        deliver({
          phase,
          atMs: round(now()),
          // The whole `data: {...}` line, excluding its terminating newline.
          bytes: Buffer.byteLength(dataLine, 'utf8'),
          cursor: projection.cursor,
          version: projection.version,
          replyStatus: projection.replyStatus,
          lastSeq: last?.seq ?? null,
          lastRole: last?.role ?? null,
          lastStatus: last?.status ?? null,
        })
      }
    }).on('error', error => { failure = error })
  })
  call.on('error', error => { failure = error; firstReject(error) })
  call.end(payload)

  return {
    ready,
    frames,
    /** Count frames from now on as stream-phase frames. */
    mark() { phase = 'stream' },
    waitFor(check, timeoutMs, label) {
      return new Promise((resolve, reject) => {
        const existing = frames.find(check)
        if (existing !== undefined) { resolve(existing); return }
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          reject(new Error(`${label} timed out after ${timeoutMs}ms; last frame ${JSON.stringify(frames.at(-1))}`
            + (failure === undefined ? '' : `; stream error ${failure.message}`)))
        }, timeoutMs)
        const waiter = { check, resolve: frame => { clearTimeout(timer); resolve(frame) } }
        waiters.push(waiter)
      })
    },
    close() {
      try { response?.destroy() } catch { /* already closed */ }
      try { call.destroy() } catch { /* already closed */ }
    },
  }
}

/** Read the backend's memory counters from `/proc/<pid>/status`. */
function readMemory(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const rss = /VmRSS:\s+(\d+) kB/.exec(status)
    const peak = /VmHWM:\s+(\d+) kB/.exec(status)
    return {
      rssKb: rss === null ? null : Number(rss[1]),
      peakKb: peak === null ? null : Number(peak[1]),
    }
  } catch {
    return { rssKb: null, peakKb: null }
  }
}

/**
 * The backend process's CPU time so far, in milliseconds.
 *
 * `/proc/<pid>/schedstat` carries nanosecond precision; `/proc/<pid>/stat`'s
 * utime+stime fields are the fallback at the kernel's 10 ms clock tick. Both
 * count every thread of the process, so worker-thread work is included.
 */
function readCpuMs(pid) {
  try {
    const [runtimeNs] = readFileSync(`/proc/${pid}/schedstat`, 'utf8').trim().split(' ')
    const nanoseconds = Number(runtimeNs)
    if (Number.isFinite(nanoseconds)) return nanoseconds / 1e6
  } catch { /* schedstat is absent on some kernels */ }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const ticks = Number(fields[11]) + Number(fields[12]) // utime, stime
    return Number.isFinite(ticks) ? ticks * 10 : null
  } catch {
    return null
  }
}

function runLauncher(args, env) {
  const result = spawnSync(process.execPath, [backendScript, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  return { code: result.status === null ? -1 : result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Bytes of this session's durable log under an isolated home, or null while absent. */
function sessionLogBytes(home, sessionId) {
  try {
    const root = join(home, 'dsh-home', 'sessions')
    for (const name of readdirSync(root, { recursive: true })) {
      if (!name.includes(sessionId)) continue
      if (!/\.jsonl(\.zstd)?$/.test(name)) continue
      return statSync(join(root, name)).size
    }
  } catch { /* not written yet */ }
  return null
}

async function main() {
  const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
  const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
  const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))

  const text = benchText(PARAMS.replyChars)
  // Alternate the observer counts instead of measuring all of one and then all of
  // the other, so a host that slows down partway through a run does not make one
  // observer count look systematically worse.
  const measuredRuns = PARAMS.historyTurnCounts.flatMap(historyTurns =>
    Array.from({ length: PARAMS.repetitions }, (_, repetition) =>
      PARAMS.observerCounts.map((_, position) => PARAMS.observerCounts[(repetition + position) % PARAMS.observerCounts.length]))
      .flat()
      .map(observers => ({ historyTurns, observers })))
  for (const plan of measuredRuns) {
    if (!Number.isInteger(plan.historyTurns) || plan.historyTurns < 1 || !Number.isInteger(plan.observers) || plan.observers < 1) {
      throw new Error(`the run plan is malformed: ${JSON.stringify(plan)}`)
    }
  }
  // One behavior per request, in the exact order the workload issues them: each
  // measured run first seeds `historyTurns` quick replies, then streams one slow
  // reply. Exhaustion is a hard failure, so a shifted script cannot silently
  // measure a different load.
  const sequence = measuredRuns.flatMap(run => [...Array(run.historyTurns).fill('success'), 'slow_success'])

  const home = mkdtempSync(join(tmpdir(), 'ourfairy-bench-projection-'))
  const launchEnv = {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: PASSWORD,
    OURFAIRY_PORT: '0',
    MINIMAX_CN_API_KEY: 'mock-key',
  }
  const startArgs = ['start', '--json']
  if (process.env.OURFAIRY_DSH_DIR !== undefined && process.env.OURFAIRY_DSH_DIR !== '') startArgs.push('--allow-drift')

  let model
  let backend
  const document = {
    schemaVersion: 1,
    ticket: 72,
    benchmark: 'chat projection read/observe benchmark',
    label: runLabel,
    startedAt: new Date().toISOString(),
    params: PARAMS,
    machine: machineFacts(combo),
    backend: undefined,
    mock: undefined,
    runs: [],
    summary: undefined,
  }

  /** Boot the real launcher into `home` and return its summary plus bound port. */
  async function startBackend() {
    const started = now()
    const result = runLauncher(startArgs, { ...launchEnv, OURFAIRY_MINIMAX_BASE_URL: model.baseURL })
    if (result.code !== 0) throw new Error(`launcher start failed (exit ${result.code})\n${result.stdout}\n${result.stderr}`)
    const summary = JSON.parse(result.stdout)
    const port = summary.listeningPorts?.[0]
    if (!Number.isInteger(port)) throw new Error(`launcher reported no listening port: ${result.stdout}`)
    return { summary, port, startMs: round(now() - started) }
  }

  function stopBackend() {
    const stopped = runLauncher(['stop', '--json'], { OURFAIRY_HOME: home })
    if (stopped.code !== 0) note(`stop exited ${stopped.code}: ${stopped.stdout}${stopped.stderr}`)
  }

  try {
    model = await startMockLlmServer({ host: '127.0.0.1', port: 0, apiKey: 'mock-key', sequence,
      successText: text, chunkSize: PARAMS.chunkSize, chunkDelayMs: PARAMS.streamChunkDelayMs })
    note(`model double at ${model.baseURL} (${sequence.length} scripted requests)`)
    document.mock = { baseURL: model.baseURL, successTextChars: text.length, chunkSize: PARAMS.chunkSize,
      chunkDelayMs: PARAMS.streamChunkDelayMs }

    // Register once; every measured run signs in to the same identity, so a
    // restart between runs does not need another invite.
    backend = await startBackend()
    const admin = await postJson(backend.port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
    if (admin.status !== 200) throw new Error(`administrator sign-in failed: ${admin.status} ${JSON.stringify(admin.body)}`)
    const invite = await postJson(backend.port, '/identity/invite', { token: admin.body.token })
    if (invite.status !== 200) throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`)
    const registered = await postJson(backend.port, '/identity/register',
      { body: { inviteCode: invite.body.invite.code, name: 'bench-alice', password: PASSWORD } })
    if (registered.status !== 200) throw new Error(`registration failed: ${registered.status} ${JSON.stringify(registered.body)}`)
    document.backend = { dshHead: backend.summary.dshHead, installMode: backend.summary.installMode,
      isolatedHome: backend.summary.isolatedHome, firstStartMs: backend.startMs,
      memoryAtFirstStart: readMemory(backend.summary.pid) }
    note(`backend pid ${backend.summary.pid} on port ${backend.port} (start ${backend.startMs}ms)`)
    stopBackend()
    backend = undefined

    for (const [index, plan] of measuredRuns.entries()) {
      // A fresh backend per run keeps VmHWM a peak for this run's workload rather
      // than a lifetime high-water mark that the previous run already set.
      backend = await startBackend()
      try {
        const token = await signIn(backend.port, 'bench-alice', PASSWORD)
        const measured = await measureRun({ port: backend.port, token, model, backend: backend.summary,
          home, index, historyTurns: plan.historyTurns, observers: plan.observers })
        measured.backendStartMs = backend.startMs
        document.runs.push(measured)
        note(`run ${index + 1}/${measuredRuns.length} (${plan.historyTurns} turns, observers=${plan.observers}): `
          + `stream /chat/read p50/p95=${measured.stream.reads.p50}/${measured.stream.reads.p95}ms, `
          + `frames=${measured.stream.frames.count}, ${measured.stream.frames.bytesTotal}B, `
          + `cpu=${measured.stream.cpuMs}ms, VmHWM=${measured.memory.peakVmHwmKb}kB`)
      } finally {
        const pid = backend.summary.pid
        stopBackend()
        backend = undefined
        if (isAlive(pid)) throw new Error(`backend pid ${pid} survived stop`)
      }
    }
    document.summary = summarize(document.runs)
  } catch (error) {
    document.error = error.message
    note(`failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    if (backend !== undefined) stopBackend()
    if (model !== undefined) await model.close().catch(() => {})
    rmSync(home, { recursive: true, force: true })
    document.finishedAt = new Date().toISOString()
    document.durationMs = round(now() - scriptStartedAt)
    document.machine.loadedAtEnd = loadavg()
  }

  const json = `${JSON.stringify(document, undefined, 2)}\n`
  if (outputPath === undefined) process.stdout.write(json)
  else {
    writeFileSync(outputPath, json)
    note(`wrote ${outputPath}`)
  }
}

/** Sign one registered identity in and return its live credential. */
async function signIn(port, name, password) {
  const response = await postJson(port, '/identity/sign-in', { body: { name, password } })
  if (response.status !== 200) throw new Error(`sign-in failed: ${response.status} ${JSON.stringify(response.body)}`)
  return response.body.token
}

/** One measured run: fresh session, fixed history, fixed stream, observer count. */
async function measureRun({ port, token, model, backend, home, index, historyTurns, observers }) {
  const run = { index, historyTurns, observers, startedAt: new Date().toISOString() }
  const created = await postJson(port, '/sessions/create', { token })
  if (created.status !== 200) throw new Error(`/sessions/create failed: ${created.status} ${JSON.stringify(created.body)}`)
  run.sessionId = created.body.session.id

  const read = async () => {
    const response = await postJson(port, '/chat/read', { token, body: { sessionId: run.sessionId } })
    if (response.status !== 200) throw new Error(`/chat/read failed: ${response.status} ${JSON.stringify(response.body)}`)
    return response
  }

  const seedStarted = now()
  for (let turn = 1; turn <= historyTurns; turn += 1) {
    const sent = await postJson(port, '/chat/send', { token,
      body: { sessionId: run.sessionId, requestId: `bench-${index}-history-${turn}`, text: `基准历史第 ${turn} 轮。` } })
    if (sent.status !== 200) throw new Error(`/chat/send failed: ${sent.status} ${JSON.stringify(sent.body)}`)
    // A read window holds only the newest `maxEvents` events, so settlement is
    // judged by seq: the formal reply must be newer than this turn's user event.
    const acceptedSeq = sent.body.receipt.acceptedSeq
    await waitFor(async () => (await read()).body.projection,
      projection => projection.replyStatus === 0 && isSettledReply(projection, acceptedSeq),
      30_000, `history turn ${turn}`)
  }
  const seededProjection = (await read()).body.projection
  run.seeding = {
    turns: historyTurns,
    elapsedMs: round(now() - seedStarted),
    eventCount: seededProjection.cursor + 1,
    cursor: seededProjection.cursor,
    messages: seededProjection.messages.length,
    sessionLogBytes: sessionLogBytes(home, run.sessionId),
  }
  note(`run ${index + 1}: seeded ${historyTurns} turns, ${run.seeding.eventCount} events, `
    + `${run.seeding.sessionLogBytes ?? '?'}B session log in ${run.seeding.elapsedMs}ms`)

  // Quiescent reference: the same route on the seeded history with no stream and
  // no observer connected. Its CPU cost per call is what the stream-window CPU
  // reading subtracts as the probe's own share (an approximation, labelled as
  // such); its latency is the no-stream floor the stream window is compared to.
  const quiescentCpuBefore = readCpuMs(backend.pid)
  const quiescent = []
  for (let sample = 0; sample < PARAMS.readSamples; sample += 1) {
    if (sample > 0) await sleep(PARAMS.readSampleIntervalMs)
    quiescent.push((await read()).rttMs)
  }
  const quiescentCpuAfter = readCpuMs(backend.pid)
  run.quiescentReads = distribution(quiescent)
  run.quiescentCpuMsPerRead = quiescentCpuBefore === null || quiescentCpuAfter === null
    ? null : round((quiescentCpuAfter - quiescentCpuBefore) / quiescent.length)

  const streams = Array.from({ length: observers }, () => observeSession(port, token, run.sessionId))
  if (streams.length !== observers || observers < 1) throw new Error(`observers=${observers} produced ${streams.length} streams`)
  try {
    await Promise.all(streams.map(stream => stream.ready))
    const checkFinal = frame => frame.replyStatus === 0 && frame.lastRole === 2
      && frame.lastStatus === 2 && frame.lastSeq > streamAcceptedSeq

    const rssSamples = []
    const rssTimer = setInterval(() => {
      const memory = readMemory(backend.pid)
      if (memory.rssKb !== null) rssSamples.push(memory.rssKb)
    }, PARAMS.rssSampleIntervalMs)
    const memoryBefore = readMemory(backend.pid)

    for (const stream of streams) stream.mark()
    const cpuBeforeMs = readCpuMs(backend.pid)
    const requestsBefore = model.requests.length
    const streamStarted = now()
    const sent = await postJson(port, '/chat/send', { token,
      body: { sessionId: run.sessionId, requestId: `bench-${index}-stream`, text: '触发本次基准的长回复。' } })
    if (sent.status !== 200) throw new Error(`streaming /chat/send failed: ${sent.status} ${JSON.stringify(sent.body)}`)
    const streamAcceptedSeq = sent.body.receipt.acceptedSeq
    // `/chat/send` returns before the Agent issues its model request; the double
    // records a request when its headers arrive.
    await waitFor(() => model.requests.length, count => count > requestsBefore, 30_000, 'measured model request')
    const mockRecord = model.requests.at(-1)

    // Spread the samples across the whole stream: the double paces the reply, so
    // its expected length is known from the parameters.
    const expectedStreamMs = (Math.ceil(PARAMS.replyChars / PARAMS.chunkSize) - 1) * PARAMS.streamChunkDelayMs
    const sampleIntervalMs = Math.max(PARAMS.readSampleIntervalMs, Math.floor(expectedStreamMs / PARAMS.readSamples))
    let settled = false
    const settlement = Promise.all(streams.map(stream => stream.waitFor(checkFinal, PARAMS.streamTimeoutMs, 'stream settlement')))
      .finally(() => { settled = true })
    const samples = []
    while (samples.length < PARAMS.readSamples && !settled) {
      if (samples.length > 0) await sleep(sampleIntervalMs)
      if (settled) break
      const atMs = round(now() - streamStarted)
      const response = await read()
      const projection = response.body.projection
      samples.push({ atMs, rttMs: round(response.rttMs), replyStatus: projection.replyStatus,
        attemptChars: projection.attempt?.text.length ?? 0, messages: projection.messages.length })
    }
    await settlement
    clearInterval(rssTimer)
    const streamEnded = now()
    const cpuAfterMs = readCpuMs(backend.pid)
    const finalRead = await read()
    const finalProjection = finalRead.body.projection
    if (!isSettledReply(finalProjection, streamAcceptedSeq)) {
      const tail = streams.map(stream => stream.frames.slice(-2))
      throw new Error(`stream did not settle as expected: acceptedSeq=${streamAcceptedSeq}`
        + ` cursor=${finalProjection.cursor} replyStatus=${finalProjection.replyStatus}`
        + ` messages=${JSON.stringify(finalProjection.messages.map(message => [message.seq, message.role, message.status]))}`
        + ` lastFrames=${JSON.stringify(tail)}`)
    }
    if (mockRecord?.behavior !== 'slow_success') {
      throw new Error(`the measured request consumed mock behavior ${mockRecord?.behavior ?? '<none>'}, not slow_success`)
    }
    const memoryAfter = readMemory(backend.pid)

    const phases = streams.map(stream => {
      const streamFrames = stream.frames.filter(frame => frame.phase === 'stream')
      const intervals = streamFrames.slice(1).map((frame, position) => round(frame.atMs - streamFrames[position].atMs))
      return {
        count: streamFrames.length,
        bytesTotal: streamFrames.reduce((total, frame) => total + frame.bytes, 0),
        bytes: distribution(streamFrames.map(frame => frame.bytes)),
        intervalMs: distribution(intervals),
        /** Frame arrival delta minus the double's pacing; an upper bound on backend work. */
        abovePacingMs: distribution(intervals.map(interval => Math.max(0, interval - PARAMS.streamChunkDelayMs))),
        openingBytes: stream.frames.filter(frame => frame.phase === 'opening')
          .reduce((total, frame) => total + frame.bytes, 0),
      }
    })
    // One published `version` is formatted once per observer, in listener order.
    // The time between the first and last observer receiving it is therefore the
    // marginal cost of the extra observer for that one fragment — the quantity a
    // shared projection is meant to drive toward zero. It is client-observed, so
    // it includes loopback delivery, which is small but not zero.
    const versionSpreadMs = commonVersionSpread(streams, observers)
    const lastFrames = streams.map(stream => stream.frames.at(-1))
    run.stream = {
      /** Text deltas the declared workload asks for; the divisor of every per-fragment figure. */
      fragments: Math.ceil(PARAMS.replyChars / PARAMS.chunkSize),
      /** SSE events the double wrote, including its five framing events. */
      mockChunksSent: mockRecord?.chunksSent ?? null,
      durationMs: round(streamEnded - streamStarted),
      sendRttMs: round(sent.rttMs),
      /**
       * Process CPU time spent between the trigger and settlement, and the same
       * divided by the accepted fragments. It is delay-free — a slow fragment
       * costs CPU whether or not the double paces the next one — but it also
       * includes seeding-adjacent JIT and the final settlement pass.
       */
      cpuMs: cpuBeforeMs === null || cpuAfterMs === null ? null : round(cpuAfterMs - cpuBeforeMs),
      cpuMsPerFragment: cpuBeforeMs === null || cpuAfterMs === null
        ? null : round((cpuAfterMs - cpuBeforeMs) / PARAMS.replyChars * PARAMS.chunkSize),
      cpuMsPerFragmentPerObserver: cpuBeforeMs === null || cpuAfterMs === null
        ? null : round((cpuAfterMs - cpuBeforeMs) / PARAMS.replyChars * PARAMS.chunkSize / observers),
      /**
       * The stream window also contains this script's own `/chat/read` probes; a
       * browser client sends none. This approximation charges each probe the
       * quiescent per-call cost, so the remainder is closer to what the reply
       * alone cost. It is an estimate, not a second measurement.
       */
      probeCpuMsApprox: run.quiescentCpuMsPerRead === null
        ? null : round(run.quiescentCpuMsPerRead * samples.length),
      cpuMsExcludingProbeApprox: run.quiescentCpuMsPerRead === null || cpuBeforeMs === null || cpuAfterMs === null
        ? null : round(cpuAfterMs - cpuBeforeMs - run.quiescentCpuMsPerRead * samples.length),
      cpuMsPerFragmentExcludingProbeApprox: run.quiescentCpuMsPerRead === null || cpuBeforeMs === null
        || cpuAfterMs === null ? null
        : round((cpuAfterMs - cpuBeforeMs - run.quiescentCpuMsPerRead * samples.length)
          / PARAMS.replyChars * PARAMS.chunkSize),
      reads: distribution(samples.map(sample => sample.rttMs)),
      samplesDuringReply: samples.filter(sample => sample.replyStatus !== 0).length,
      sampleIntervalMs,
      readSamples: samples,
      frames: {
        count: phases.reduce((total, phase) => total + phase.count, 0),
        bytesTotal: phases.reduce((total, phase) => total + phase.bytesTotal, 0),
        perObserver: phases,
        /** Per-version first-to-last observer arrival delta; null below two observers. */
        observerSpreadMs: versionSpreadMs,
      },
      finalProjection: { cursor: finalProjection.cursor, messages: finalProjection.messages.length,
        lastRole: finalProjection.messages.at(-1).role, lastStatus: finalProjection.messages.at(-1).status,
        lastSeq: finalProjection.messages.at(-1).seq },
      observersAgree: lastFrames.every(frame => frame.cursor === finalProjection.cursor
        && frame.lastSeq === finalProjection.messages.at(-1).seq
        && frame.lastRole === finalProjection.messages.at(-1).role
        && frame.lastStatus === finalProjection.messages.at(-1).status),
    }
    run.memory = {
      beforeKb: memoryBefore.rssKb,
      samples: rssSamples,
      sampledPeakKb: rssSamples.length === 0 ? null : Math.max(...rssSamples),
      streamEndRssKb: memoryAfter.rssKb,
      peakVmHwmKb: memoryAfter.peakKb,
    }
  } finally {
    for (const stream of streams) stream.close()
  }
  run.endedAt = new Date().toISOString()
  return run
}

/** Per-version spread between observers of the same publish, as a distribution. */
function commonVersionSpread(streams, observers) {
  if (observers < 2) return null
  const arrivals = new Map()
  for (const stream of streams) {
    for (const frame of stream.frames) {
      if (frame.phase !== 'stream') continue
      const seen = arrivals.get(frame.version)
      if (seen === undefined) arrivals.set(frame.version, [frame.atMs])
      else seen.push(frame.atMs)
    }
  }
  const spreads = [...arrivals.values()].filter(times => times.length === observers)
    .map(times => round(Math.max(...times) - Math.min(...times)))
  return distribution(spreads)
}

/**
 * Whether a projection shows the turn accepted at `acceptedSeq` settled.
 *
 * The projection's `messages` window is bounded by `maxEvents`, so counting
 * messages across turns would stop being observable in a long history. The
 * last message's seq and status are the same evidence the SSE frames carry.
 */
function isSettledReply(projection, acceptedSeq) {
  const last = projection.messages?.at(-1)
  return projection.replyStatus === 0 && last !== undefined && last.role === 2
    && last.status === 2 && last.seq > acceptedSeq
}

/** Poll `work` until `check` accepts its value. */
async function waitFor(work, check, timeoutMs, label) {
  const deadline = now() + timeoutMs
  let value
  do {
    value = await work()
    if (check(value)) return value
    await sleep(10)
  } while (now() < deadline)
  throw new Error(`${label} did not settle within ${timeoutMs}ms: ${JSON.stringify(value).slice(0, 400)}`)
}

function machineFacts(combo) {
  const uname = spawnSync('uname', ['-a'], { encoding: 'utf8' }).stdout?.trim() ?? null
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout?.trim() ?? null
  return {
    uname,
    kernel: release(),
    arch: arch(),
    node: process.version,
    cpuModel: cpus()[0]?.model ?? null,
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    productHead: head,
    combination: {
      dsh: combo.repos.dsh.productCommit,
      rikkahub: combo.repos.rikkahub.productCommit,
    },
    loadAverageAtStart: loadavg(),
  }
}

/** Whether a pid still exists, used to prove `stop` released the backend. */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function summarize(runs) {
  const byHistory = {}
  for (const run of runs) {
    const key = `${run.historyTurns}turns/${run.observers}observers`
    byHistory[key] ??= []
    byHistory[key].push({
      repetition: byHistory[key].length + 1,
      eventCount: run.seeding.eventCount,
      sessionLogBytes: run.seeding.sessionLogBytes,
      readP50Ms: run.stream.reads.p50,
      readP95Ms: run.stream.reads.p95,
      readCount: run.stream.reads.count,
      quiescentP95Ms: run.quiescentReads.p95,
      quiescentCpuMsPerRead: run.quiescentCpuMsPerRead,
      frames: run.stream.frames.count,
      bytesTotal: run.stream.frames.bytesTotal,
      intervalP50Ms: run.stream.frames.perObserver[0]?.intervalMs.p50 ?? null,
      intervalP95Ms: run.stream.frames.perObserver[0]?.intervalMs.p95 ?? null,
      observerSpreadP50Ms: run.stream.frames.observerSpreadMs?.p50 ?? null,
      observerSpreadP95Ms: run.stream.frames.observerSpreadMs?.p95 ?? null,
      cpuMs: run.stream.cpuMs,
      cpuMsExcludingProbeApprox: run.stream.cpuMsExcludingProbeApprox,
      cpuMsPerFragmentPerObserver: run.stream.cpuMsPerFragmentPerObserver,
      cpuMsPerFragmentExcludingProbeApprox: run.stream.cpuMsPerFragmentExcludingProbeApprox,
      sampledPeakKb: run.memory.sampledPeakKb,
      peakVmHwmKb: run.memory.peakVmHwmKb,
      streamDurationMs: run.stream.durationMs,
    })
  }
  return { byHistory }
}

await main()
