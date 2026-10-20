/**
 * Multi-observer sharing and multi-session isolation on the public wire (#93).
 *
 * Two `/chat/observe` connections on the same session are opened while a real
 * streamed reply is in flight; for every projection version both must report
 * the same `version`, `messages` and `attempt` (and the durable fields that
 * belong to the same publish). One observer then disconnects and reconnects
 * mid-stream, and the newcomer still agrees with the observer that stayed.
 * A second test streams two sessions at the same time through the model double
 * with a fixed chunk count and size, then samples `/chat/read` on both while
 * they run: every read must be a valid projection of its own session that
 * only grows, and the observed read latencies are printed (never asserted).
 *
 * Only the documented HTTP/SSE surface is used: no internal counter and no
 * private field is read or asserted. The launcher and the model double are the
 * real ones used by the other chat suites.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, repoRoot, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
// Registers Node resolution for the pinned dsh checkout before the product
// modules below are loaded (they are dynamic imports for that reason).
import './helpers/dsh-peers.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))

// One fixed reply: 2048 ASCII characters split into 256 fragments of 8.
const REPLY = 'The same reply reaches every observer of this session. '.repeat(48).slice(0, 2048)
const CHUNK_SIZE = 8
const CHUNK_DELAY_MS = 10
const FRAGMENT_COUNT = REPLY.length / CHUNK_SIZE
assert.equal(REPLY.length, 2048)
assert.equal(FRAGMENT_COUNT, 256)

const home = makeHome('ourfairy-chat-multi-observer-')
const password = 'multi-observer-password'
let model, port, admin, alice, bob

/** One product POST, asserting the HTTP status the existing suites expect. */
async function post(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`)
  return value
}

async function until(read, accept, label, timeout = 30_000) {
  const end = Date.now() + timeout
  let value
  while (Date.now() < end) {
    value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`)
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function send(token, sessionId, requestId, text) {
  const sent = await post('/chat/send', token, { sessionId, requestId, text })
  assert.ok(sent.receipt.messageId)
  return sent.receipt
}

async function newSession(token) {
  return (await post('/sessions/create', token)).session.id
}

/**
 * One SSE observer over the public endpoint. Frames are decoded as they
 * arrive; `close` aborts the connection and waits for its reader to finish.
 */
async function observe(token, sessionId) {
  const controller = new AbortController()
  const frames = []
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId }) })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const done = (async () => {
    let buffer = ''
    try {
      while (true) {
        const { done: end, value } = await reader.read()
        if (end) return
        buffer += decoder.decode(value, { stream: true })
        let split
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, split)
          buffer = buffer.slice(split + 2)
          const line = event.split('\n').find(item => item.startsWith('data: '))
          if (line) frames.push(JSON.parse(line.slice(6)))
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  })()
  return { frames, async close() { controller.abort(); await done } }
}

/** The first frame (from now) that satisfies `predicate`. */
async function waitFrame(observation, predicate, label) {
  return until(() => observation.frames.find(predicate), Boolean, label)
}

/**
 * Frames both observers received for the same published version. A version is
 * bumped by the publisher on every input change, so equal versions are the
 * same projection and must compare equal across observers.
 */
async function sharedVersions(left, right, count, label) {
  return until(() => {
    const byVersion = new Map(right.frames.map(frame => [frame.version, frame]))
    const pairs = left.frames.map(frame => [frame, byVersion.get(frame.version)])
      .filter(([, other]) => other !== undefined)
    return pairs.length >= count ? pairs : undefined
  }, value => value !== undefined, label)
}

/**
 * The projection fields two observers of one session must agree on at the same
 * version. Each observer freezes its own opening cut (`throughSeq`/`fromSeq`)
 * and retains a per-observer slice, so those range fields are not compared;
 * the shared durable state and the live overlay must match.
 */
function assertSameProjection(left, right, label) {
  for (const key of ['sessionId', 'version', 'cursor', 'messages', 'attempt', 'settledAttempt', 'replyStatus', 'error']) {
    assert.deepEqual(left[key], right[key], `${label}: ${key}`)
  }
}

/** No private or underscored field is exposed on the public projection. */
function assertPublicShape(frame, label) {
  for (const key of Object.keys(frame)) {
    assert.match(key, /^[a-z][A-Za-z]*$/, `${label}: projection key ${JSON.stringify(key)} is not a public identifier`)
  }
}

before(async () => {
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['slow_success'], repeatLast: true,
    successText: REPLY, chunkSize: CHUNK_SIZE, chunkDelayMs: CHUNK_DELAY_MS })
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: model.baseURL })
  port = startedPort(run)
  admin = await post('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'multi-alice', password)
  bob = await registerUser(port, admin.token, 'multi-bob', password)
})
after(async () => {
  try {
    const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
    assert.equal(run.code, 0, describeRun('stop', run))
  } finally {
    await model?.close()
    removeHome(home)
  }
})

test('two observers of one session agree through one streamed reply, including after a reconnect', async () => {
  const sessionId = await newSession(alice.token)
  const first = await observe(alice.token, sessionId)
  let second, reconnected
  try {
    await send(alice.token, sessionId, 'share-1', '请在同一会话里流式回答。')
    const early = await waitFrame(first, frame => frame.replyStatus === 1 && frame.attempt !== null
      && frame.attempt.text.length > 0, 'first observer mid-stream')
    assertPublicShape(early, 'first observer')
    assert.equal(early.messages.filter(message => message.role === 1).length, 1)

    // Opened while the reply is in flight: the newcomer is a second reader of
    // the same durable state, not a second copy of it.
    second = await observe(alice.token, sessionId)
    const late = await waitFrame(second, frame => frame.replyStatus === 1 && frame.attempt !== null
      && frame.attempt.text.length > 0, 'second observer mid-stream')
    assertPublicShape(late, 'second observer')

    const pairs = await sharedVersions(first, second, 4, 'shared in-flight versions')
    for (const [left, right] of pairs) assertSameProjection(left, right, `in-flight v${left.version}`)
    const [pairStart, pairEnd] = [pairs[0][0], pairs.at(-1)[0]]
    assert.ok(pairEnd.version > pairStart.version, 'versions must advance while the reply streams')
    assert.ok(pairEnd.attempt.text.length > pairStart.attempt.text.length,
      `attempt text must grow while the reply streams: ${pairStart.attempt.text.length} -> ${pairEnd.attempt.text.length}`)

    // One observer drops mid-stream and opens again; the stayed observer and
    // the newcomer still share every version they both saw.
    await first.close()
    reconnected = await observe(alice.token, sessionId)
    const resumed = await waitFrame(reconnected, frame => frame.replyStatus === 1 && frame.attempt !== null
      && frame.attempt.text.length > 0, 'reconnected observer mid-stream')
    assertPublicShape(resumed, 'reconnected observer')
    const rejoined = await sharedVersions(reconnected, second, 3, 'shared versions after reconnect')
    for (const [left, right] of rejoined) assertSameProjection(left, right, `reconnected v${left.version}`)
    assert.ok(pairs.every(([frame]) => resumed.version >= frame.version), 'the reconnected observer resumes after the stayer')

    // Both settle on the same committed reply; give the publication one quiet
    // window so the final frames are the last word before the read below.
    const settled = frame => frame.replyStatus === 0 && frame.attempt === null
      && frame.messages.some(message => message.role === 2 && message.status === 2)
    await waitFrame(second, settled, 'stayed observer settled')
    await waitFrame(reconnected, settled, 'reconnected observer settled')
    await delay(300)
    assertSameProjection(reconnected.frames.at(-1), second.frames.at(-1), 'settled projection')
    const read = await post('/chat/read', alice.token, { sessionId })
    assert.deepEqual(read.projection.messages, second.frames.at(-1).messages, 'read and observe agree on the settled transcript')
    assert.deepEqual(read.projection.attempt, null)
    assert.equal(read.projection.replyStatus, 0)
    assert.equal(read.projection.messages.filter(message => message.role === 2 && message.status === 2).length, 1)
  } finally {
    await first.close().catch(() => {})
    await second?.close().catch(() => {})
    await reconnected?.close().catch(() => {})
  }
})

test('two sessions stream at once and each read grows only its own projection', async () => {
  const sides = [
    { label: 'alice', token: alice.token, sessionId: await newSession(alice.token), text: 'first-session-only' },
    { label: 'bob', token: bob.token, sessionId: await newSession(bob.token), text: 'second-session-only' },
  ]
  for (const side of sides) {
    side.latencies = []
    side.cursors = []
    side.versions = []
    side.messageCounts = []
    side.attemptLengths = []
  }

  // Both replies start before either finishes: the model double is fixed to
  // 2048 characters in 256 fragments of 8 with a 10 ms gap.
  await Promise.all(sides.map(side => send(side.token, side.sessionId, `iso-${side.label}`, side.text)))

  const settled = projection => projection.replyStatus === 0
    && projection.messages.some(message => message.role === 2 && message.status === 2)
  let overlapped = false
  const deadline = Date.now() + 60_000
  for (;;) {
    for (const side of sides) {
      const startedAt = performance.now()
      const { projection } = await post('/chat/read', side.token, { sessionId: side.sessionId })
      side.latencies.push(performance.now() - startedAt)
      assert.equal(projection.sessionId, side.sessionId, `${side.label}: read must belong to its session`)
      assert.ok(Array.isArray(projection.messages) && projection.messages.length >= 1)
      assert.deepEqual(projection.messages.filter(message => message.role === 1).map(message => message.text),
        [side.text], `${side.label}: only its own user message`)
      const previousCursor = side.cursors.at(-1)
      const previousVersion = side.versions.at(-1)
      const previousMessages = side.messageCounts.at(-1)
      assert.ok(previousCursor === undefined || projection.cursor >= previousCursor,
        `${side.label}: cursor must not go backwards`)
      assert.ok(previousVersion === undefined || projection.version >= previousVersion,
        `${side.label}: version must not go backwards`)
      assert.ok(previousMessages === undefined || projection.messages.length >= previousMessages,
        `${side.label}: messages must not shrink`)
      if (projection.attempt !== null) {
        const previousAttempt = side.attemptLengths.at(-1)
        assert.ok(previousAttempt === undefined || projection.attempt.text.length >= previousAttempt,
          `${side.label}: attempt text must not shrink while streaming`)
        side.attemptLengths.push(projection.attempt.text.length)
      }
      side.cursors.push(projection.cursor)
      side.versions.push(projection.version)
      side.messageCounts.push(projection.messages.length)
      side.last = projection
    }
    if (sides.every(side => settled(side.last) && side.attemptLengths.length > 0)) break
    overlapped ||= sides.every(side => side.last.replyStatus === 1 && side.last.attempt !== null)
    assert.ok(Date.now() < deadline, 'both sessions must settle')
    await delay(20)
  }
  assert.ok(overlapped, 'both replies must be in flight during the same read pass')

  // Each final log contains its own user message and none of the other side's.
  for (const side of sides) {
    assert.equal(side.last.messages.filter(message => message.role === 2 && message.status === 2).length, 1)
    for (const other of sides.filter(item => item !== side)) {
      assert.ok(!side.last.messages.some(message => message.text === other.text),
        `${side.label}: must not see ${other.label}'s message`)
      assert.ok(!JSON.stringify(side.last.events).includes(other.text),
        `${side.label}: its event window must not contain ${other.label}'s text`)
      assert.deepEqual(side.last.messages.map(message => message.messageId).filter(id =>
        other.last.messages.some(message => message.messageId === id)), [], `${side.label}: no shared message ids`)
    }
    const settledText = side.last.messages.find(message => message.role === 2 && message.status === 2).text
    assert.equal(settledText, REPLY)
  }

  // The observed read latency is evidence, not a threshold: report it.
  for (const side of sides) {
    const sorted = [...side.latencies].sort((left, right) => left - right)
    const at = fraction => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(2)
    console.log(`[#93 isolation] ${side.label}: ${sorted.length} /chat/read samples during a ${FRAGMENT_COUNT}-fragment stream,`
      + ` p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${sorted.at(-1).toFixed(2)} ms, cursor ${side.last.cursor}`)
  }
  assert.ok(sides.every(side => side.latencies.length >= 2), 'both sessions must have been sampled repeatedly')
})
