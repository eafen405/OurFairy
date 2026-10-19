/**
 * Ticket #82: the native model-retry and tool-result spill rows.
 *
 * Every case drives the shipped launcher and speaks HTTP to the listener it
 * bound, so the rows under test are the ones `backend/v1-bundle/cordis.patch.yml`
 * mounts — not an overlay assembled by the test. The model is the external
 * loopback Messages double, selected through the same deployment surface a real
 * endpoint uses.
 *
 * The assertions are caller-visible: the projection the phone reads, the durable
 * events a cold restart replays, the request history the model receives, and the
 * files a spilled result leaves on disk.
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { after, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, removeHome, repoRoot, runBackendAsync, startArgs, startedPort, writeOverlay,
} from './helpers/backend.mjs'

const PHAETHON_PASSWORD = 'native-rows-password'
const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))

const servers = []
const homes = []
after(async () => {
  for (const server of servers) await server.close()
  for (const home of homes) removeHome(home)
})

/** One isolated home per case: a session's spill files and log belong to one deployment. */
function freshHome() {
  const home = makeHome('ourfairy-native-rows-')
  homes.push(home)
  return home
}

/** Start one loopback Messages double and return it with the env that selects it. */
async function modelDouble(options = {}) {
  const server = await startMockLlmServer({ host: '127.0.0.1', port: 0, apiKey: 'mock-key', sequence: ['success'], ...options })
  servers.push(server)
  return { server, env: { OURFAIRY_MINIMAX_BASE_URL: `${server.baseURL}`, MINIMAX_CN_API_KEY: 'mock-key' } }
}

async function boot(home, env = {}) {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD, ...env })
  return { run, port: startedPort(run) }
}

async function stop(home) {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

async function signIn(port) {
  return (await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PHAETHON_PASSWORD } })).token
}

/** Wait for one caller-visible condition, polling the projection the phone reads. */
async function until(port, token, sessionId, check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let projection
  do {
    projection = (await httpJson(port, '/chat/read', { token, body: { sessionId } })).projection
    if (check(projection)) return projection
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  assert.fail(`condition not reached; projection was ${JSON.stringify({
    replyStatus: projection?.replyStatus, error: projection?.error,
    messages: projection?.messages?.map(message => [message.role, message.status, message.text.slice(0, 40)]),
    types: projection?.events?.map(event => event.type),
  })}`)
}

/** Every content block of one wire message, in order. */
function blocksOf(message) {
  return typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : (message?.content ?? [])
}

/** The model-facing text of one wire message. */
function textOf(message) {
  return blocksOf(message).filter(block => block.type === 'text').map(block => block.text).join('')
}

test('a rate-limited step retries once at the durable boundary without a second user message', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['rate_limit', 'success'], successText: 'recovered' })
  const { port } = await boot(home, double.env)
  const admin = await signIn(port)
  const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
  try {
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'retry-one', text: 'hello retry' } })
    const projection = await until(port, admin, session.id, p => p.replyStatus === 0 && p.messages.some(m => m.role === 2 && m.status === 2))

    assert.deepEqual(double.server.requests.map(request => request.behavior), ['rate_limit', 'success'],
      'the first request is refused with 429 and the retry re-runs the same step')

    // One user message for the request id, one final assistant settlement.
    const userMessages = projection.messages.filter(message => message.role === 1)
    assert.equal(userMessages.length, 1, `one send must produce exactly one user message; got ${JSON.stringify(userMessages)}`)
    assert.equal(userMessages[0].requestId, 'retry-one')
    const completed = projection.messages.filter(message => message.role === 2 && message.status === 2)
    assert.deepEqual(completed.map(message => message.text), ['recovered'],
      'exactly one assistant settlement completes, with the retry\'s text')
    assert.equal(projection.settledAttempt?.seq, completed[0].seq,
      'the native settlement names the completed message, not the failed attempt')
    assert.equal(projection.error, null, 'a recovered request is not an error')

    // The retry is durable: scheduled before the wait, started after it.
    const retries = projection.events.filter(event => event.type === 'llm/retry')
    const started = projection.events.filter(event => event.type === 'llm/retry-started')
    assert.equal(retries.length, 1, `one retry was scheduled; events were ${JSON.stringify(projection.events.map(event => event.type))}`)
    assert.equal(started.length, 1, 'the scheduled retry started')
    assert.equal(retries[0].data.retryId, started[0].data.retryId, 'the started event names the scheduled retry')
    assert.equal(retries[0].data.failure.code, 'RATE_LIMIT')
    assert.deepEqual([retries[0].data.turn, retries[0].data.step], [started[0].data.turn, started[0].data.step],
      'the retry re-runs the same turn step')
    assert.ok(projection.durableThroughSeq >= started[0].seq,
      `the writer confirmed the retry events durable (durableThroughSeq=${projection.durableThroughSeq}, started seq=${started[0].seq})`)

    // Nothing about the retry is model-visible: the retried request carries the
    // same single user turn and no failure, delay, or event payload.
    const second = double.server.requests.at(-1)
    assert.deepEqual(second.body.messages.filter(message => message.role === 'user').map(textOf).filter(text => text === 'hello retry'),
      ['hello retry'], 'the retried request carries the user turn exactly once')
    const wire = JSON.stringify(second.body)
    for (const artefact of ['llm/retry', 'rate limit', 'RATE_LIMIT', '429', retries[0].data.retryId]) {
      assert.equal(wire.includes(artefact), false, `the model-visible request must not contain ${JSON.stringify(artefact)}`)
    }
  } finally {
    await stop(home)
  }

  // A cold restart replays the same events from the durable session log: the
  // session is resumed from disk, not from the process that produced it.
  const restarted = await modelDouble({ sequence: ['success'] })
  const cold = await boot(home, restarted.env)
  try {
    const admin = await signIn(cold.port)
    const projection = (await httpJson(cold.port, '/chat/read', { token: admin, body: { sessionId: session.id } })).projection
    const replayed = projection.events.filter(event => event.type.startsWith('llm/retry'))
    assert.deepEqual(replayed.map(event => [event.type, event.data.retryId]), [
      ['llm/retry', projection.events.find(event => event.type === 'llm/retry').data.retryId],
      ['llm/retry-started', projection.events.find(event => event.type === 'llm/retry').data.retryId],
    ], `the durable log replays both retry events; got ${JSON.stringify(projection.events.map(event => event.type))}`)
    assert.deepEqual(projection.messages.filter(message => message.role === 1).map(message => message.requestId), ['retry-one'])
    assert.deepEqual(projection.messages.filter(message => message.role === 2 && message.status === 2).map(message => message.text), ['recovered'])
    assert.equal(restarted.server.requests.length, 0, 'a cold read replays history without calling the model')
  } finally {
    await stop(home)
  }
})

test('stopping while a retry backoff is pending ends the turn promptly and never starts it', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['server_error'], repeatLast: true, successText: 'never reached' })
  const { port } = await boot(home, double.env)
  const admin = await signIn(port)
  const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
  try {
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'stop-in-backoff', text: 'keep failing' } })

    // The double records the refused request the instant it answers, which is
    // the start of the native backoff (500 ms nominal, bounded below 600 ms).
    // Acting here puts the stop inside that wait rather than after it.
    const deadline = Date.now() + 30000
    while (double.server.requests.length < 1 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(double.server.requests.length, 1, 'the first request reached the double')

    const stoppedAt = Date.now()
    await httpJson(port, '/chat/stop', { token: admin, body: { sessionId: session.id } })
    const settled = await until(port, admin, session.id, p => p.replyStatus === 0, 5000)
    const elapsed = Date.now() - stoppedAt
    assert.ok(elapsed < 2000, `a stop during backoff must end the turn promptly; it took ${elapsed}ms`)

    // Outlast the cancelled wait plus the next one: a backoff that ignored the
    // stop would have issued another request by now.
    await new Promise(resolve => setTimeout(resolve, 1600))
    const after = (await httpJson(port, '/chat/read', { token: admin, body: { sessionId: session.id } })).projection
    assert.equal(double.server.requests.length, 1, 'a cancelled backoff makes no further model request')
    assert.equal(after.replyStatus, 0)
    assert.equal(after.error, null, 'the user stop is not reported as a model failure')
    assert.equal(after.attempt, null)

    // The scheduled retry stays visible as scheduled-only: the durable log
    // records the wait that was cancelled, never a start that did not happen.
    const scheduled = after.events.filter(event => event.type === 'llm/retry')
    const started = after.events.filter(event => event.type === 'llm/retry-started')
    assert.ok(scheduled.length >= 1, `the failed step must schedule a durable retry; events were ${JSON.stringify(after.events.map(event => event.type))}`)
    assert.equal(started.length, scheduled.length - 1, 'exactly the retry waiting at the stop never started')
    const startedIds = new Set(started.map(event => event.data.retryId))
    assert.equal(startedIds.has(scheduled.at(-1).data.retryId), false, 'the cancelled retry is the last one scheduled')

    // History stays consistent: one user turn, no completed reply.
    assert.deepEqual(after.messages.filter(message => message.role === 1).map(message => message.requestId), ['stop-in-backoff'],
      'the stopped turn keeps exactly its one user message')
    assert.equal(after.messages.some(message => message.role === 2 && message.status === 2), false,
      'no assistant reply completes after the stop')
    assert.equal(settled.messages.filter(message => message.role === 1).length, 1)

    // A later turn is unaffected by the cancelled wait: it reaches the model
    // on its own, so the cancelled timer left no stale recovery behind.
    const requestsBefore = double.server.requests.length
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'after-stop', text: 'start again' } })
    const reDeadline = Date.now() + 15000
    while (double.server.requests.length === requestsBefore && Date.now() < reDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(double.server.requests.length > requestsBefore, 'the turn after a cancelled backoff issues its own request')
    await httpJson(port, '/chat/stop', { token: admin, body: { sessionId: session.id } })
  } finally {
    await stop(home)
  }
})

test('an oversized bash result reaches the model as a bounded preview and a complete spill file', async () => {
  const home = freshHome()
  // 170,000 bytes of output: the bash tool keeps its own 64,000-byte tail, and
  // the middle marker sits inside the region the spill preview omits.
  const command = "head -c 140000 /dev/zero | tr '\\0' x; printf 'SPILL-MIDDLE-MARKER\\n'; head -c 30000 /dev/zero | tr '\\0' a; printf 'SPILL-END-MARKER\\n'"
  const double = await modelDouble({
    sequence: ['tool_call_success', 'success'], successText: 'saw the preview',
    toolName: 'bash', toolArguments: JSON.stringify({ command, description: 'print a large result' }),
  })
  const { port } = await boot(home, double.env)
  const admin = await signIn(port)
  const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
  try {
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'spill-one', text: 'run it' } })
    const projection = await until(port, admin, session.id, p => p.replyStatus === 0 && p.messages.some(m => m.role === 2 && m.status === 2))
    assert.equal(double.server.requests.length, 2, 'the tool result returns to the same turn')

    const result = double.server.requests.at(-1).body.messages.flatMap(blocksOf).filter(block => block.type === 'tool_result').at(-1)
    assert.ok(result !== undefined, 'the continuation request carries the tool result')
    assert.equal(result.is_error ?? false, false, 'a spilled result is not a failed tool call')
    const preview = textOf({ content: result.content })

    const locator = /Full formatted result stored at: (\S+?)\. Use read/u.exec(preview)?.[1]
    assert.ok(locator !== undefined, `the model must receive a locator; preview tail was ${JSON.stringify(preview.slice(-400))}`)
    const spillRoot = join(home, 'dsh-home', 'spill')
    assert.ok(locator.startsWith(`${spillRoot}${sep}`), `the spill file must live under the isolated DSH_HOME spill root ${spillRoot}; got ${locator}`)

    // Bounded: the preview is a small fraction of what the command produced and
    // omits the middle the locator keeps.
    assert.ok(preview.length < 48000, `the preview must be bounded; it was ${preview.length} characters`)
    assert.ok(preview.includes('SPILL-END-MARKER'), 'the preview keeps the tail')
    assert.equal(preview.includes('SPILL-MIDDLE-MARKER'), false, 'the preview omits the middle')
    const omitted = Number(/Omitted (\d+) bytes/u.exec(preview)?.[1])
    assert.ok(Number.isSafeInteger(omitted) && omitted > 20000, `the notice must report the omitted bytes; preview was ${JSON.stringify(preview.slice(-400))}`)

    // Complete: the locator holds the whole formatted result, including the
    // region the preview dropped.
    const file = readFileSync(locator)
    assert.ok(statSync(locator).isFile())
    assert.ok(file.includes('SPILL-MIDDLE-MARKER'), 'the spill file keeps the omitted middle')
    assert.ok(file.includes('SPILL-END-MARKER'), 'the spill file keeps the retained tail')
    assert.ok(file.length >= omitted, `the spill file holds at least the omitted bytes (${file.length} < ${omitted})`)
    assert.ok(file.length > preview.length, `the spill file is larger than the preview (${file.length} vs ${preview.length})`)

    // The turn completed normally: the reply the model produced after the tool
    // result is the only assistant settlement.
    const replies = projection.messages.filter(message => message.role === 2 && message.status === 2)
    assert.equal(replies.at(-1).text, 'saw the preview', 'the reply after the tool result completes')
    assert.deepEqual(replies.filter(message => message.text !== '').map(message => message.text), ['saw the preview'])
  } finally {
    await stop(home)
  }
})

test('the recovery is the mounted row: without it the same failure ends the turn', async () => {
  // The complement of the first case. A recovery loop written in product code
  // would retry here too; the rows under test are the only source of recovery,
  // so disabling the native row must remove it and change nothing else.
  const home = freshHome()
  const double = await modelDouble({ sequence: ['rate_limit', 'success'], successText: 'unreachable' })
  const overlay = writeOverlay(home, [{ id: 'llm-retry', disabled: true }], 'no-retry.patch.yml')
  const run = await runBackendAsync(startArgs([overlay]),
    { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD, ...double.env })
  const port = startedPort(run)
  const admin = await signIn(port)
  const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
  try {
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'no-retry', text: 'hello' } })
    const projection = await until(port, admin, session.id, p => p.replyStatus === 0 && p.messages.some(m => m.status !== 1))
    assert.deepEqual(double.server.requests.map(request => request.behavior), ['rate_limit'],
      'without the native row the failed step is not re-run')
    assert.equal(projection.events.some(event => event.type.startsWith('llm/retry')), false)
    assert.equal(projection.messages.filter(message => message.role === 1).length, 1,
      'the user message is unchanged by the failure')
    assert.match(projection.error ?? '', /429|rate/iu, `the failure is still reported to the caller; got ${JSON.stringify(projection.error)}`)
  } finally {
    await stop(home)
  }
})
