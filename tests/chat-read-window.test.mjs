/**
 * The live read face (ticket #90): one durable projection state per session,
 * one event window seeded once and then advanced by committed events, and one
 * per-observer slice plus a live overlay.
 *
 * This drives the real chat read path — `backend/chat/dist/units.js` and
 * `backend/chat/dist/runtime.js` — over the shared fake native world in
 * `./helpers/chat-world.mjs`. That world records every `observeSession` read,
 * so the behavior under test is observable at the seam the endpoints use: a
 * streaming fragment must not read the log, and a second observer must not pay
 * for its own seed. The unit definitions are the real ones from `units.mjs`;
 * the fake registry applies them eagerly on append, exactly where the native
 * registry drives them. The end-to-end wire behavior is asserted separately by
 * the real-launcher suites.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'
import { SESSION, assistantMessage, chunkStream, endStream, job, makeWorld, openWorld, startStream, tick, userMessage } from './helpers/chat-world.mjs'

test('one seed serves every observer and streaming fragments never reread the log', async () => {
  const world = makeWorld()
  const session = world.session()
  session.append('turn/start', { turn: 1 })
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'hello', 'r1')] })
  session.append('user/message', userMessage('u1', 'hello', 'r1'), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'hi'), stream: [] }, { surfaceOp: 'append' })

  const { runtime, state } = await openWorld(world)
  const small = []
  const large = []
  const unsubscribeSmall = runtime.subscribe(state, 2, frame => small.push(frame))
  const unsubscribeLarge = runtime.subscribe(state, 64, frame => large.push(frame))
  try {
    await tick()
    assert.equal(world.reads.length, 1, 'two observers must share one seed read')
    assert.equal(small.length, 1)
    assert.equal(large.length, 1)
    assert.deepEqual(small[0].events.map(event => event.seq), [2, 3])
    assert.equal(small[0].fromSeq, 2)
    assert.equal(small[0].hasMore, true)
    assert.equal(small[0].beforeSeq, 2)
    assert.deepEqual(large[0].events.map(event => event.seq), [0, 1, 2, 3])
    assert.equal(large[0].fromSeq, 0)
    assert.equal(large[0].hasMore, false)

    world.reads.length = 0
    startStream(world)
    for (const text of ['你', '好', '世界']) {
      chunkStream(world, text)
      await tick()
      assert.equal(world.reads.length, 0, 'a streaming fragment must not read the log')
    }
    assert.equal(small.at(-1).attempt.text, '你好世界')
    assert.equal(small.at(-1).cursor, 3, 'a transient fragment does not advance the native cursor')
    assert.deepEqual(small.at(-1).events.map(event => event.seq), [2, 3], 'the frozen opening cut keeps its event window')

    // The committed assistant message advances the cursor; both observers keep
    // their opening C/L and include their own L through the current cursor.
    session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('a2', '你好世界'), stream: [] }, { surfaceOp: 'append' })
    await tick()
    assert.equal(world.reads.length, 0)
    assert.equal(small.at(-1).cursor, 4)
    assert.equal(small.at(-1).throughSeq, 3, 'the opening cut stays frozen')
    assert.deepEqual(small.at(-1).events.map(event => event.seq), [2, 3, 4])
    assert.ok(small.at(-1).messages.some(message => message.messageId === 'a2'))
    assert.deepEqual(large.at(-1).events.map(event => event.seq), [0, 1, 2, 3, 4])

    endStream(world, 4)
    await tick()
    assert.equal(small.at(-1).attempt, null)
    assert.deepEqual(small.at(-1).settledAttempt, { attemptId: 'attempt-1', seq: 4 })
  } finally {
    unsubscribeSmall()
    unsubscribeLarge()
  }
})

test('an observer opening mid-stream gets the complete attempt text and the same durable state', async () => {
  const world = makeWorld()
  const session = world.session()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', userMessage('u1', 'hello', 'r1'), { surfaceOp: 'append' })
  const { runtime, state } = await openWorld(world)
  startStream(world)
  for (const text of ['前半', '后半']) chunkStream(world, text)
  await tick()

  const frames = []
  const unsubscribe = runtime.subscribe(state, 1, frame => frames.push(frame))
  try {
    await tick()
    assert.equal(world.reads.length, 1, 'the second observer reuses the seeded window')
    const [frame] = frames
    assert.equal(frame.attempt.text, '前半后半', 'attempt text is complete even though its start precedes fromSeq')
    assert.equal(frame.fromSeq, 1)
    assert.deepEqual(frame.events.map(event => event.seq), [1])
    assert.deepEqual(frame.messages.map(message => message.messageId), ['u1'], 'a live attempt is not a committed message')
  } finally { unsubscribe() }
})

test('a direct read at the current cut does not read the log again', async () => {
  const world = makeWorld()
  const session = world.session()
  session.append('turn/start', { turn: 1 })
  const { runtime, state } = await openWorld(world)
  const first = await runtime.projection(state, { maxEvents: 1 })
  assert.equal(world.reads.length, 1)
  session.append('user/message', userMessage('u1', 'later', 'r1'), { surfaceOp: 'append' })
  const second = await runtime.projection(state, { maxEvents: 1 })
  assert.equal(world.reads.length, 1, 'a read after the seed formats the window it already has')
  assert.equal(first.throughSeq, 0)
  assert.equal(second.throughSeq, 1)
  assert.deepEqual(second.events.map(event => event.seq), [1])
  // The one-shot reader stays available for delivery's independent lookup.
  const { events } = await runtime.events(SESSION)
  assert.equal(events.length, 2)
})

test('an event committed while the seed read was in flight is neither lost nor duplicated', async () => {
  const world = makeWorld()
  const session = world.session()
  session.append('turn/start', { turn: 1 })
  const { runtime, state } = await openWorld(world)
  world.delayNextRead()
  const pending = runtime.projection(state, { maxEvents: 64 })
  session.append('user/message', userMessage('u1', 'raced', 'r1'), { surfaceOp: 'append' })
  world.releaseRead()
  const frame = await pending
  assert.equal(world.reads.length, 1)
  assert.deepEqual(frame.events.map(event => event.seq), [0, 1], 'the buffered event is appended once, not duplicated')
  assert.equal(frame.cursor, 1)
})

test('live values are overlaid at read time and never written into durable state', async () => {
  const world = makeWorld()
  const session = world.session()
  session.append('turn/start', { turn: 1 })
  session.append('jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() })
  world.setLiveJobs([job()])
  const durable = JSON.parse(JSON.stringify(session.states))
  const { runtime, state } = await openWorld(world)
  const idle = await runtime.projection(state, { maxEvents: 64 })
  assert.equal(idle.tasks[0].availability, 1)
  assert.equal(idle.tasks[0].status, 1)
  assert.equal(idle.replyStatus, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(session.states)), durable, 'a read does not write live facts into a unit')

  state.agent.status = 'running'
  startStream(world)
  // A new attempt clears the previous error; this one arrives while it runs.
  world.channel(SESSION).api.emit('agent/error', { error: new Error('boom') })
  chunkStream(world, '部分')
  const live = await runtime.projection(state, { maxEvents: 64 })
  assert.equal(live.replyStatus, 1)
  assert.equal(live.error, 'boom')
  assert.equal(live.attempt.text, '部分')
  runtime.stop(state)
  const stopping = await runtime.projection(state, { maxEvents: 64 })
  assert.equal(stopping.replyStatus, 2)
  assert.equal(state.agent.cancelled, true)
  assert.deepEqual(JSON.parse(JSON.stringify(session.states)), durable, 'live transitions stay outside every unit')
})
