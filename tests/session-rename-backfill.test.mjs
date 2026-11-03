/**
 * The title backfill's second source check (ticket #252).
 *
 * `SessionRuntime` backfills a historical session's model title once, and the
 * work runs detached from the request that opened the session. Between the check
 * that schedules it and the refresh that does it sits an asynchronous log read —
 * and a rename can land in exactly that window. An explicit refresh re-derives
 * over a user title by design (that is the documented unpin), so without the
 * second check the backfill would erase a title the user had just written.
 *
 * This drives the runtime directly over a fake native context so the window is
 * deterministic: the world holds the log read open, the rename lands, and the
 * read is released afterwards. The end-to-end rename path is asserted by
 * `tests/session-rename.test.mjs` over the real launcher; what is asserted here
 * is only the ordering that no HTTP test can pin down.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'

const { SessionRuntime } = await import('../backend/chat/dist/runtime.js')

const OWNER = { shortId: 1 }
const SESSION = 'session-1'
const MESSAGE = { id: 'u1', role: 'user', content: [{ type: 'text', text: '历史会话的一句话' }],
  source: { kind: 'user', rpcId: 'r1' } }

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred() {
  let resolve
  const promise = new Promise(settle => { resolve = settle })
  return { promise, resolve }
}

/** The fake title service: one current snapshot, plus the refresh calls it saw. */
function makeTitles() {
  return {
    current: undefined,
    refreshes: 0,
    renames: [],
    get() { return this.current },
    async refresh() {
      this.refreshes += 1
      this.current = { title: '模型标题', source: { kind: 'provider', provider: 'p' } }
      return this.current
    },
    rename(_session, title) {
      this.renames.push(title)
      this.current = { title, source: { kind: 'user' } }
      return this.current
    },
  }
}

/** A fake host: one session with a seeded human message, and a gate on its log read. */
function makeWorld() {
  const titles = makeTitles()
  const events = [
    { seq: 0, type: 'turn/start', time: 0, data: { turn: 1 } },
    { seq: 1, type: 'user/message', time: 1, data: MESSAGE, surfaceOp: 'append' },
  ]
  let gate = null
  const handlers = new Map()
  const session = {
    id: SESSION, seq: events.length, header: { id: SESSION, version: 4, createdAt: 1, isSeeded: false },
    append() { throw new Error('the backfill must never write a title itself') },
    snapshotEvents() { return events },
  }
  const ctx = {
    logger: { warn() {} },
    on(name, handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
      return () => handlers.set(name, (handlers.get(name) ?? []).filter(item => item !== handler))
    },
    effect(execute) { return execute() },
    // Optional services are read through `ctx.get`; this world mounts the title
    // row, because the backfill is the whole subject.
    get(name) { return this[name] },
    sessionTitle: titles,
    ourfairySessions: { async read() {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
    agents: {
      async resume({ resumeSessionId, setup }) {
        const channel = { systemPrompt: { section() {} }, on() { return () => {} } }
        const agent = { id: resumeSessionId, session, status: 'idle',
          followup() {}, cancel() {} }
        setup(channel, agent)
        return agent
      },
    },
    sessionQuery: {
      async observeSession() {
        if (gate !== null) await gate.promise
        gate = null
        return { events, cursor: events.length - 1, [Symbol.dispose]() {} }
      },
    },
    sessions: { async flush() {} },
  }
  return {
    ctx, titles, session,
    /** Make the next log read wait until `releaseRead`, so a rename can land first. */
    delayNextRead() { gate = deferred() },
    releaseRead() { gate?.resolve() },
  }
}

test('a rename landing during the backfill log read is not overwritten by the refresh', async () => {
  const world = makeWorld()
  world.delayNextRead()
  const runtime = new SessionRuntime(world.ctx)
  const state = await runtime.open(OWNER, SESSION)
  // The opening scheduled the backfill; its log read is still held, so this is
  // exactly the window a user rename can occupy.
  assert.equal(world.titles.current, undefined, 'the backfill has not accepted a title yet')

  const renamed = runtime.renameTitle(state, '用户写的标题')
  assert.equal(renamed.title, '用户写的标题')
  assert.deepEqual(renamed.source, { kind: 'user' })

  world.releaseRead()
  for (let turn = 0; turn < 4; turn += 1) await tick()
  assert.equal(world.titles.refreshes, 0,
    'the backfill must re-read the source and skip the refresh once the title is the user\'s')
  assert.deepEqual(world.titles.current, { title: '用户写的标题', source: { kind: 'user' } },
    'the title the user wrote is the one that stands')
})

test('an open for a rename schedules no backfill at all', async () => {
  const world = makeWorld()
  const runtime = new SessionRuntime(world.ctx)
  await runtime.open(OWNER, SESSION, { titleBackfill: false })
  for (let turn = 0; turn < 4; turn += 1) await tick()
  assert.equal(world.titles.refreshes, 0, 'a rename open must not spend the model title request')
  assert.deepEqual(world.titles.renames, [], 'opening alone renames nothing')
})

test('an ordinary open still backfills a title that is absent or only the fallback', async () => {
  const world = makeWorld()
  const runtime = new SessionRuntime(world.ctx)
  const state = await runtime.open(OWNER, SESSION)
  for (let turn = 0; turn < 4; turn += 1) await tick()
  assert.equal(world.titles.refreshes, 1, 'the historical session gets its one model title')

  // A user title is not eligible for any later backfill in this process.
  runtime.renameTitle(state, '用户标题')
  runtime.backfillTitle(state)
  for (let turn = 0; turn < 4; turn += 1) await tick()
  assert.equal(world.titles.refreshes, 1, 'a user title is never refreshed by housekeeping')
})
