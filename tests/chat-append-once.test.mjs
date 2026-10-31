/**
 * `appendOnce`: the at-most-once, resolve-means-durable session write (#275).
 *
 * The delivery row used to carry its own copy of this protocol: a live session
 * appended on the live Session and was flushed through the chat barrier; a cold
 * session claimed `sessionPersistence.open(id, 'write')`, restored a throwaway
 * Session with `sessions.prepare`, appended the event plus the constructor's
 * `session/end-seed`, and flushed. That protocol now lives in
 * `SessionRuntime.appendOnce`, so this suite drives it directly over a fake
 * host and asserts the two properties the caller relies on:
 *
 * - live: a barrier failure after the append leaves one committed event; the
 *   retry finds it through the live-preferred read instead of appending twice
 *   (a persistence read would miss the unflushed event);
 * - cold: the stored log and its duplicate read round-trip produce one
 *   `delivery/message`, the restored Session is never entered, the header is
 *   handed to `prepare` as a clone, and the durable suffix starts at the stored
 *   prefix length (which is what makes `session/end-seed` durable).
 *
 * The Session objects are the real pinned dsh `Session` (restored through the
 * same `Session.fromRestore` the native store uses), so `end-seed` appending,
 * event envelopes and surface validation are native behavior, not a mock.
 *
 * @covers backend/chat — the subject is chat's runtime write protocol.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before the product
// modules below are loaded (they are dynamic imports for that reason).
import './helpers/dsh-peers.mjs'

const { Session } = await import('@deepseek-ai/dsh-session')
const { createAssistantMessage } = await import('@deepseek-ai/dsh-llm')
const { SessionRuntime } = await import('../backend/chat/dist/runtime.js')

const OWNER = { shortId: 1 }
const LIVE = 'append-once-live'
const COLD = 'append-once-cold'

/** Deep-freeze one value in place, the way native `prepare` freezes its header. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

/** One delivery event on a Session, shaped like the delivery row builds it. */
function deliver(session, deliveryId) {
  return session.append('delivery/message', {
    deliveryId,
    origin: { sessionId: 'sender-session' },
    message: createAssistantMessage({ content: [{ type: 'text', text: `delivery ${deliveryId}` }],
      source: { deliveryId, senderSessionId: 'sender-session' } }),
  }, { surfaceOp: 'append' })
}

/** The duplicate check the delivery row supplies. */
const findDelivery = deliveryId => events => events.find(event =>
  event.type === 'delivery/message' && event.data.deliveryId === deliveryId)

/**
 * A fake host with just the seams `appendOnce` reads.
 *
 * Live sessions are real detached `Session`s created by the fake resume; the
 * fake `observeSession` serves them first, because that is the live-preferred
 * read production uses. Cold storage is one in-memory log per id behind a
 * write handle, and the fake `sessions.prepare` restores through the real
 * `Session.fromRestore`. It freezes the header it receives in place, so a
 * caller that handed over the handle's own header instead of a clone would
 * leave that header frozen and the test would see it.
 */
function makeWorld({ failLiveFlush = false } = {}) {
  const live = new Map()
  const stored = new Map()
  const handles = []
  const prepared = []
  const appended = []
  const steps = []
  const flushes = []
  const observations = []
  const opens = []
  let liveFlushes = 0
  const ctx = {
    on() { return () => {} },
    effect(execute) { return execute() },
    get() { return undefined },
    ourfairySessions: { async read() {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
    agents: {
      async resume({ resumeSessionId, setup }) {
        const session = Session.create(resumeSessionId)
        const agentCtx = {
          systemPrompt: { section() {} },
          on() { return () => {} },
        }
        const agent = { id: resumeSessionId, session, status: 'idle', followup() {}, cancel() {} }
        setup(agentCtx, agent)
        live.set(resumeSessionId, session)
        return agent
      },
    },
    sessionQuery: {
      async observeSession(sessionId) {
        observations.push(sessionId)
        const session = live.get(sessionId)
        if (session === undefined) throw new Error(`no live session "${sessionId}"; appendOnce must dedupe a cold write from its handle`)
        return { events: session.snapshotEvents(), cursor: session.seq - 1, [Symbol.dispose]() {} }
      },
    },
    sessions: {
      async flush(session) {
        flushes.push(session.id)
        if (session.id === LIVE && failLiveFlush && liveFlushes++ === 0) throw new Error('injected live flush failure')
      },
      prepare(id, options) {
        prepared.push({ id, seedLength: options.seed.length, eventState: options.eventState })
        deepFreeze(options.meta)
        return Session.fromRestore(id, options.seed, options.meta, options.inheritedEventCount, options.eventState)
      },
      // A cold write is never entered into the store: entering it would make
      // the next native resume of the same id fail with `already exists`.
      enter() { throw new Error('appendOnce must not enter a restored Session') },
      announce() { throw new Error('appendOnce must not announce a restored Session') },
    },
    sessionPersistence: {
      async open(id, access) {
        opens.push({ id, access })
        let record = stored.get(id)
        if (record === undefined) {
          record = { header: { id, version: 4, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, events: [] }
          stored.set(id, record)
        }
        const handle = {
          id, access,
          header: structuredClone(record.header),
          inheritedEventCount: record.inheritedEventCount,
          async read() { return { events: record.events.slice(), eventState: 'detached' } },
          async append(events) {
            appended.push(events.map(event => event.type))
            steps.push('append')
            record.events.push(...events)
          },
          async flush() { steps.push('flush'); flushes.push(id) },
          async close() { steps.push('close') },
        }
        handles.push(handle)
        return handle
      },
    },
    sessionProjections: { stateOf: () => undefined },
  }
  return { ctx, live, stored, handles, prepared, appended, steps, flushes, observations, opens }
}

test('appendOnce appends a live session once across a failed barrier and its retry', async () => {
  const world = makeWorld({ failLiveFlush: true })
  const runtime = new SessionRuntime(world.ctx)
  const state = await runtime.open(OWNER, LIVE)
  let builds = 0
  const build = session => { builds++; return deliver(session, 'live-delivery') }
  await assert.rejects(runtime.appendOnce(LIVE, findDelivery('live-delivery'), build), /injected live flush failure/)
  const event = await runtime.appendOnce(LIVE, findDelivery('live-delivery'), build)
  assert.equal(event.type, 'delivery/message')
  assert.equal(builds, 1, 'the retry found the committed event instead of building a second')
  const deliveries = state.session.snapshotEvents().filter(candidate => candidate.type === 'delivery/message')
  assert.equal(deliveries.length, 1, 'the live log holds exactly one delivery')
  assert.equal(deliveries[0], event)
  assert.equal(world.opens.length, 0, 'a live session is never settled through the cold handle')
  assert.deepEqual(world.observations, [LIVE, LIVE], 'dedupe read the live-preferred log both times')
  assert.deepEqual(world.flushes, [LIVE, LIVE], 'both attempts reached the durability barrier')
  assert.equal(world.steps.length, 0, 'the live path runs no persistence-handle operation')
})

test('appendOnce appends a cold session once, restores without entering it and clones the header', async () => {
  const world = makeWorld()
  const runtime = new SessionRuntime(world.ctx)
  let builds = 0
  const build = session => { builds++; return deliver(session, 'cold-delivery') }
  const event = await runtime.appendOnce(COLD, findDelivery('cold-delivery'), build)
  const retried = await runtime.appendOnce(COLD, findDelivery('cold-delivery'), build)
  assert.equal(retried, event, 'the duplicate read returns the stored event')
  assert.equal(builds, 1, 'the duplicate read never rebuilds the event')
  assert.equal(world.prepared.length, 1, 'the throwaway Session is restored once')
  assert.equal(world.appended.length, 1, 'one durable append batch')
  assert.deepEqual(world.appended[0], ['session/end-seed', 'delivery/message'],
    'the suffix starts at the stored prefix and carries the constructor marker')
  assert.deepEqual(world.stored.get(COLD).events.map(candidate => candidate.type),
    ['session/end-seed', 'delivery/message'], 'the durable log holds the marker and the one delivery')
  assert.deepEqual(world.steps, ['append', 'flush', 'close', 'flush', 'close'],
    'append/flush/close per attempt, and no second append')
  assert.equal(world.handles.length, 2, 'one write handle per attempt, each closed')
  assert.equal(Object.isFrozen(world.handles[0].header), false,
    'prepare froze a clone, not the handle header')
  assert.equal(Object.isFrozen(world.handles[1].header), false)
  assert.equal(world.observations.length, 0, 'the cold branch dedupes from its stored prefix, not a live read')
  assert.equal(world.opens.every(open => open.id === COLD && open.access === 'write'), true)
})
