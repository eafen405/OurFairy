/** @covers backend/chat — authenticated command execution, history and actual model input. */
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, writeOverlay } from './helpers/backend.mjs'
import { startTitleAwareModel } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-session-commands-')
const password = 'session-command-password'
let model, port, admin, alice, bob
async function start(overlays = []) {
  port = startedPort(await runBackendAsync(startArgs(overlays), { OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password, MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: model.baseURL }))
}
async function stop() {
  const result = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(result.code, 0, describeRun('stop', result))
}
const call = (path, token, body = {}) => httpJson(port, path, { token, body })
async function raw(path, token, body = {}, timeout = 5000) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...token ? { authorization: `Bearer ${token}` } : {} },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) })
  return { status: response.status, body: await response.json() }
}
const create = async token => (await call('/sessions/create', token)).session.id
async function until(work, check) {
  const deadline = Date.now() + 20000
  let result
  do {
    result = await work()
    if (check(result)) return result
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  assert.fail(`condition not reached: ${JSON.stringify(result)}`)
}
const read = async (token, sessionId) => (await call('/chat/read', token, { sessionId, maxEvents: 256 })).projection
async function send(token, sessionId, requestId, text) {
  await call('/chat/send', token, { sessionId, requestId, text })
  return until(() => read(token, sessionId), p => p.replyStatus === 0 && p.messages.some(m => m.requestId === requestId))
}
async function command(token, sessionId, requestId, command) {
  const first = await call('/chat/commands/execute', token, { sessionId, requestId, command })
  assert.equal(first.ok, true, JSON.stringify(first))
  return until(async () => (await call('/chat/commands/status', token, { sessionId, requestId })).command, c => c?.status !== 1)
}
before(async () => {
  model = await startTitleAwareModel({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'COMMAND-REPLY' })
  await start()
  admin = await call('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'command-alice', password)
  bob = await registerUser(port, admin.token, 'command-bob', password)
})
after(async () => { await stop(); await model?.close(); removeHome(home) })

test('compact reports no useful history without invoking a model or clearing context', async () => {
  const sessionId = await create(alice.token)
  const callsBefore = model.requests.length
  const result = await command(alice.token, sessionId, 'compact-empty', 1)
  assert.equal(result.status, 3)
  assert.equal(model.requests.length, callsBefore)
  const projection = await read(alice.token, sessionId)
  assert.equal(projection.messages.find(m => m.requestId === 'compact-empty').text, '当前无需压缩')
  assert.ok(!projection.events.some(e => e.type === 'turn/start'))
})

test('concurrent and late clear retries keep one boundary and preserve subsequent conversation after restart', async () => {
  const sessionId = await create(alice.token)
  await send(alice.token, sessionId, 'retry-old', 'RETRY-OLD')
  const input = { sessionId, requestId: 'retry-clear', command: 2 }
  const retries = await Promise.all(Array.from({ length: 8 }, () => call('/chat/commands/execute', alice.token, input)))
  assert.equal(new Set(retries.map(r => r.command.commandId)).size, 1)
  const result = await until(async () => (await call('/chat/commands/status', alice.token, input)).command, r => r.status === 4)
  await send(alice.token, sessionId, 'retry-new', 'RETRY-NEW-SURVIVES')
  await stop()
  await start()
  assert.deepEqual((await call('/chat/commands/execute', alice.token, input)).command, result)
  const projection = await read(alice.token, sessionId)
  assert.equal(projection.messages.filter(m => m.requestId === 'retry-clear').length, 1)
  assert.equal(projection.events.filter(e => e.type === 'user/message' && e.data.source.kind === 'ourfairy-context-reset').length, 1)
  await send(alice.token, sessionId, 'retry-last', 'AFTER-LATE-RETRY')
  const inputAfterRetry = JSON.stringify(model.requests.at(-1).body)
  assert.ok(inputAfterRetry.includes('RETRY-NEW-SURVIVES'))
  assert.ok(!inputAfterRetry.includes('RETRY-OLD'))
})

function artifact(sessionId) {
  const root = join(home, 'dsh-home', 'sessions')
  const relative = readdirSync(root, { recursive: true }).find(name => name.includes(`${sessionId}/`) && /\.jsonl(\.zstd)?$/.test(name))
  assert.ok(relative)
  return join(root, relative)
}

// Simulate the crash window between a durable domain effect and command/done.
// Only a stopped test backend's temporary log is changed; real cold readers
// then reconstruct the effect without any replacement implementation double.
function loseCompletion(sessionId, commandId, acceptedOnly = false) {
  const file = artifact(sessionId)
  const raw = readFileSync(file)
  const lines = (file.endsWith('.zstd') ? zstdDecompressSync(raw) : raw).toString('utf8').trimEnd().split('\n')
  const completion = lines.findIndex(line => {
    const row = JSON.parse(line)
    return row.type === 'command/done' && row.data.commandId === commandId
  })
  assert.ok(completion > 0, 'the durable completion existed before the injected crash')
  const cut = acceptedOnly ? lines.findIndex(line => {
    const row = JSON.parse(line)
    return row.type === 'command/run' && row.data.commandId === commandId
  }) + 1 : completion
  assert.ok(cut > 0)
  const prefix = lines.slice(0, cut).map(line => Buffer.from(`${line}\n`))
  writeFileSync(file, Buffer.concat(file.endsWith('.zstd') ? prefix.map(line => zstdCompressSync(line)) : prefix))
}

test('native compaction keeps recent text and recovery fills a lost done without summarizing again', async () => {
  const sessionId = await create(alice.token)
  await send(alice.token, sessionId, 'compact-old', `COMPACT-OLD-SECRET ${'x'.repeat(48000)}`)
  await send(alice.token, sessionId, 'compact-recent', `COMPACT-RECENT ${'r'.repeat(48000)}`)
  const result = await command(alice.token, sessionId, 'compact-recover', 1)
  assert.equal(result.status, 2)
  const compacted = await read(alice.token, sessionId)
  const summary = compacted.events.find(e => e.type === 'compaction/summary')
  assert.ok(summary)
  const recentAnswer = compacted.events.filter(e => e.type === 'assistant/message').at(-1)
  assert.ok(!summary.data.shadowedSeqs.includes(recentAnswer.seq), 'native manual compaction retains its final safe assistant node')
  await stop()
  loseCompletion(sessionId, result.commandId)
  await start()
  await send(alice.token, sessionId, 'compact-after-crash', 'AFTER-COMPACT-CRASH')
  const beforeRetry = model.requests.length
  const recovered = await command(alice.token, sessionId, 'compact-recover', 1)
  assert.equal(recovered.status, 2)
  assert.equal(recovered.commandId, result.commandId)
  assert.equal(model.requests.length, beforeRetry, 'restoring a result never runs a second summary')
  const input = JSON.stringify(model.requests.at(-1).body)
  assert.ok(input.includes('COMMAND-REPLY'))
  assert.ok(!input.includes('COMPACT-OLD-SECRET'))
  const projection = await read(alice.token, sessionId)
  assert.equal(projection.events.filter(e => e.type === 'compaction/summary').length, 1)
})

test('native maintenance is busy despite public idle and refuses both commands before acceptance', async () => {
  const sessionId = await create(bob.token)
  await stop()
  const overlay = writeOverlay(home, [{ insert: [{ id: 'native-maintenance',
    name: fileURLToPath(new URL('../backend/chat/test-support/native-maintenance.ts', import.meta.url)), config: { sessionId } }] }], 'native-maintenance.patch.yml')
  await start([overlay])
  try {
    const opened = await read(bob.token, sessionId)
    assert.equal(opened.replyStatus, 0)
    await new Promise(resolve => setTimeout(resolve, 50))
    for (const operation of [1, 2]) {
      const refused = await raw('/chat/commands/execute', bob.token, { sessionId, requestId: `native-busy-${operation}`, command: operation })
      assert.equal(refused.status, 409, JSON.stringify(refused))
      assert.equal(refused.body.error.code, 'chat/session-busy')
    }
    const projection = await read(bob.token, sessionId)
    assert.equal(projection.events.filter(e => e.type === 'command/run').length, 0)
  } finally {
    await raw('/chat/stop', bob.token, { sessionId })
    await stop()
    await start()
  }
})

test('commands reject anonymous, foreign owners and admin before effects, and reject conflicting identities', async () => {
  const sessionId = await create(alice.token)
  const callsBefore = model.requests.length
  for (const path of ['/chat/commands/execute', '/chat/commands/status']) {
    const body = { sessionId, requestId: 'scope-command', command: 2 }
    assert.equal((await raw(path, undefined, body)).status, 401)
    for (const token of [bob.token, admin.token]) assert.equal((await raw(path, token, body)).status, 404)
  }
  assert.equal(model.requests.length, callsBefore)
  assert.equal((await read(alice.token, sessionId)).events.filter(e => e.type === 'command/run').length, 0)
  assert.equal((await call('/chat/commands/status', alice.token, { sessionId, requestId: 'missing' })).command, null)
  for (const command of [0, 3, 'clear', null]) {
    assert.equal((await raw('/chat/commands/execute', alice.token, { sessionId, requestId: 'invalid', command })).status, 400)
  }
  const clear = await command(alice.token, sessionId, 'stable-type', 2)
  assert.equal(clear.status, 4)
  const conflict = await raw('/chat/commands/execute', alice.token, { sessionId, requestId: 'stable-type', command: 1 })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'chat/request-conflict')
  // Clearing an unused session leaves room for native node-0 system assembly.
  await send(alice.token, sessionId, 'empty-clear-followup', 'AFTER-EMPTY-CLEAR')
  assert.match(JSON.stringify(model.requests.at(-1).body), /Ⅲ型总序式集成泛用人工智能/)
})

test('slow native compaction exposes durable progress, rejects distinct commands, and orders new input after it', async () => {
  await stop()
  await model.close()
  model = await startTitleAwareModel({ apiKey: 'mock-key', sequence: ['success', 'success', 'slow_success'],
    repeatLast: true, successText: 'SLOW-COMMAND-REPLY', chunkSize: 1, chunkDelayMs: 200 })
  await start()
  const sessionId = await create(alice.token)
  try {
    await send(alice.token, sessionId, 'slow-old', `SLOW-OLD ${'x'.repeat(48000)}`)
    await send(alice.token, sessionId, 'slow-recent', 'SLOW-RECENT')
    const accepted = await call('/chat/commands/execute', alice.token, { sessionId, requestId: 'slow-compact', command: 1 })
    assert.equal(accepted.command.status, 1)
    await until(async () => model.requests.length, count => count === 3)
    const status = await raw('/chat/commands/status', alice.token, { sessionId, requestId: 'slow-compact' }, 1000)
    assert.equal(status.status, 200)
    assert.equal(status.body.command.status, 1)
    const projection = await read(alice.token, sessionId)
    const progress = projection.messages.find(m => m.requestId === 'slow-compact')
    assert.equal(progress.commandStatus, 1)
    assert.ok(projection.durableThroughSeq >= progress.seq)
    assert.equal((await raw('/chat/commands/execute', alice.token, { sessionId, requestId: 'distinct-clear', command: 2 }, 1000)).status, 409)
    const next = call('/chat/send', alice.token, { sessionId, requestId: 'after-slow', text: 'AFTER-SLOW-COMPACT' })
    await until(async () => (await call('/chat/commands/status', alice.token, { sessionId, requestId: 'slow-compact' })).command, c => c.status === 2)
    await next
    await until(async () => model.requests.length, count => count === 4)
    assert.equal((await raw('/chat/commands/execute', alice.token, { sessionId, requestId: 'reply-busy', command: 2 }, 1000)).status, 409)
    await until(() => read(alice.token, sessionId), p => p.replyStatus === 0)
    const final = await read(alice.token, sessionId)
    const summarySeq = final.events.find(e => e.type === 'compaction/summary').seq
    const acceptedInput = final.events.find(e => e.type === 'agent/inbox/spliced' && e.data.inserted.some(m => m.source.rpcId === 'after-slow')).seq
    assert.ok(acceptedInput > summarySeq)
  } finally {
    await stop()
    await model.close()
    model = await startTitleAwareModel({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'COMMAND-REPLY' })
    await start()
  }
})

test('clear recovers a replacement without done and marks run-only as interrupted without changing new input', async () => {
  const sessionId = await create(alice.token)
  await send(alice.token, sessionId, 'clear-recovery-old', 'CLEAR-RECOVERY-OLD')
  const cleared = await command(alice.token, sessionId, 'clear-recovery', 2)
  await stop()
  loseCompletion(sessionId, cleared.commandId)
  await start()
  await send(alice.token, sessionId, 'clear-recovery-new', 'CLEAR-RECOVERY-NEW')
  const recovered = await command(alice.token, sessionId, 'clear-recovery', 2)
  assert.equal(recovered.status, 4)
  assert.equal(recovered.commandId, cleared.commandId)
  const interrupted = await command(alice.token, sessionId, 'run-only', 2)
  await stop()
  loseCompletion(sessionId, interrupted.commandId, true)
  await start()
  await send(alice.token, sessionId, 'clear-recovery-last', 'CLEAR-RECOVERY-LAST')
  const failed = await command(alice.token, sessionId, 'run-only', 2)
  assert.equal(failed.status, 5)
  assert.equal(failed.error.code, 1)
  await send(alice.token, sessionId, 'clear-recovery-check', 'CHECK-RECOVERED-CONTEXT')
  const input = JSON.stringify(model.requests.at(-1).body)
  assert.ok(input.includes('CLEAR-RECOVERY-NEW'))
  assert.ok(input.includes('CLEAR-RECOVERY-LAST'))
  assert.ok(!input.includes('CLEAR-RECOVERY-OLD'))
  assert.equal((await read(alice.token, sessionId)).events.filter(e => e.type === 'user/message' && e.data.source.kind === 'ourfairy-context-reset').length, 1)
})

test('clear keeps the session and old history while removing old input from the next model request', async () => {
  const sessionId = await create(alice.token)
  await send(alice.token, sessionId, 'before-clear', 'OLD-CONTEXT-SECRET')
  const requests = model.requests.length
  const result = await command(alice.token, sessionId, 'clear-once', 2)
  assert.equal(result.status, 4)
  assert.equal(result.sessionId, sessionId)
  assert.equal(model.requests.length, requests, 'clear does not invoke a model')
  const projection = await read(alice.token, sessionId)
  assert.ok(projection.durableThroughSeq >= result.completedSeq)
  assert.deepEqual(projection.messages.filter(m => m.role !== 3).map(m => m.text), ['OLD-CONTEXT-SECRET', 'COMMAND-REPLY'])
  const boundary = projection.messages.find(m => m.requestId === 'clear-once')
  assert.equal(boundary.role, 3)
  assert.equal(boundary.commandStatus, 4)
  assert.equal(boundary.text, '上下文已重置')
  await send(alice.token, sessionId, 'after-clear', 'NEW-CONTEXT-ONLY')
  const input = JSON.stringify(model.requests.at(-1).body)
  assert.ok(input.includes('NEW-CONTEXT-ONLY'))
  assert.ok(!input.includes('OLD-CONTEXT-SECRET'))
  assert.match(input, /Ⅲ型总序式集成泛用人工智能/)
})
