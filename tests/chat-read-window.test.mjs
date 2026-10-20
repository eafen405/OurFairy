/**
 * The live read face (ticket #90): one durable projection state per session,
 * one event window seeded once and then advanced by committed events, and one
 * per-observer slice plus a live overlay.
 *
 * This drives `SessionRuntime` directly over a fake native Agent context. The
 * fake records every `observeSession` read, so the behavior under test is
 * observable at the seam the endpoints use: a streaming fragment must not read
 * the log, and a second observer must not pay for its own seed. The unit
 * definitions are the real ones from `units.mjs`; the fake registry applies
 * them eagerly on append, exactly where the native registry drives them. The
 * end-to-end wire behavior is asserted separately by the real-launcher suites.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'

const units = await import('../backend/chat/src/units.mjs')
const { SessionRuntime } = await import('../backend/chat/src/runtime.mjs')

const OWNER = { shortId: 1 }
const SESSION = 'session-1'

const userMessage = (id, text, rpcId) => ({ id, role: 'user', content: [{ type: 'text', text }],
  source: { kind: 'user', rpcId } })
const assistantMessage = (id, text) => ({ id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } })
const job = (overrides = {}) => ({ id: 'job-1', owner: SESSION, kind: 'task', label: 'work', status: 'running',
  startedAt: 10, output: { earliest: 0, total: 0 }, ...overrides })

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred() {
  let resolve
  const promise = new Promise(settle => { resolve = settle })
  return { promise, resolve }
}

/** The native Agent's scoped context, with only the surfaces the runtime uses. */
function makeChannel() {
  const handlers = new Map()
  const api = {
    systemPrompt: { section() {} },
    on(name, handler) {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
      return () => handlers.set(name, list.filter(item => item !== handler))
    },
    emit(name, ...args) { for (const handler of handlers.get(name) ?? []) handler(...args) },
  }
  return { api }
}

/**
 * A fake host: one Session per id, a registry that applies the real units
 * eagerly, and a counted `observeSession` read.
 */
function makeWorld() {
  const sessions = new Map()
  const channels = new Map()
  const reads = []
  let liveJobs = []
  let gate = null

  function sessionOf(id = SESSION) {
    let session = sessions.get(id)
    if (session === undefined) {
      session = {
        id, seq: 0, events: [], header: { id, version: 4, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, states: {},
        append(type, data, extra = {}) {
          const event = { seq: this.seq, type, time: this.seq, data, ...extra }
          this.seq += 1
          this.events.push(event)
          for (const definition of [units.transcriptDefinition, units.workDefinition]) {
            this.states[definition.key] = definition.apply(this.states[definition.key], event)
          }
          channels.get(this.id)?.api.emit('session/event', this, event)
          return event
        },
      }
      session.states[units.transcriptDefinition.key] = units.transcriptDefinition.init(session.header, 0)
      session.states[units.workDefinition.key] = units.workDefinition.init(session.header, 0)
      sessions.set(id, session)
    }
    return session
  }

  const ctx = {
    ourfairySessions: { async read() {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
    agents: {
      async resume({ resumeSessionId, setup }) {
        const session = sessionOf(resumeSessionId)
        const channel = makeChannel()
        const agent = { id: resumeSessionId, session, status: 'idle', followups: [], cancelled: false,
          followup(message) { this.followups.push(message) },
          cancel() { this.cancelled = true } }
        setup(channel.api, agent)
        channels.set(resumeSessionId, channel)
        return agent
      },
    },
    sessionQuery: {
      async observeSession(id) {
        reads.push(id)
        const session = sessionOf(id)
        // Snapshot after a delayed gate so the seed can see an event that also
        // reached the buffer; the merge must drop that duplicate.
        if (gate !== null) await gate.promise
        gate = null
        const cut = session.seq
        const events = session.events.slice(0, cut)
        return { events, cursor: cut - 1, [Symbol.dispose]() {} }
      },
    },
    sessions: { async flush() {} },
    sessionProjections: { stateOf: (session, key) => session.states[key] },
    jobs: { generation: 'g1', list: () => liveJobs },
  }

  return {
    ctx, session: sessionOf, reads,
    channel: id => channels.get(id),
    setLiveJobs(jobs) { liveJobs = jobs },
    /** Make the next observation read wait until `releaseRead`, exposing the seed race. */
    delayNextRead() { gate = deferred() },
    releaseRead() { gate?.resolve() },
  }
}

/** Open the runtime on a world that already holds `events` in its log. */
async function openWorld(world, sessionId = SESSION) {
  const runtime = new SessionRuntime(world.ctx)
  const state = await runtime.open(OWNER, sessionId)
  return { runtime, state }
}

function startStream(world, attemptId = 'attempt-1') {
  world.channel(SESSION).api.emit('agent/assistant-stream', { frame: { type: 'start', attemptId, revision: 1, turn: 1, step: 1 } })
}
function chunkStream(world, text, attemptId = 'attempt-1') {
  world.channel(SESSION).api.emit('agent/assistant-stream', { frame: { type: 'chunk', attemptId, revision: 2, index: 0, time: 0,
    chunk: { type: 'text-delta', index: 0, text } } })
}
function endStream(world, seq, attemptId = 'attempt-1') {
  world.channel(SESSION).api.emit('agent/assistant-stream', { frame: { type: 'end', attemptId, revision: 3, index: 0,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq } } })
}

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
