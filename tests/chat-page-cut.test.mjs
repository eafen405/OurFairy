/**
 * `/chat/page` is one complete runtime page operation (ticket #225).
 *
 * Every case opens a real `LiveSession` through `SessionRuntime.open` in
 * `backend/chat` and calls `runtime.page` with the same already-validated
 * numbers `/chat/page` passes; no `LiveSession` shape is built by hand and no
 * internal window field is inspected. The shared fake world records the native
 * reads, so a page's cost is observed at the seam the runtime actually uses:
 * `sessionPersistence` for a cold page, the seeded window for a warm one.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'
import { SESSION, assistantMessage, makeWorld, openWorld, userMessage } from './helpers/chat-world.mjs'

/** The seqs of a page's events, the one thing the wire ordering exposes. */
const seqs = events => events.map(event => event.seq)
/** Every seq in `[from, to)`. */
const range = (from, to) => Array.from({ length: to - from }, (_, offset) => from + offset)

/** Commit `count` generic events; the transcript unit ignores this type. */
function appendEvents(session, count) {
  for (let index = 0; index < count; index++) session.append('test/event', { index })
}

/** The four-event turn the message tests page over. */
function appendConversation(session) {
  session.append('turn/start', { turn: 1 })
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'hello', 'r1')] })
  session.append('user/message', userMessage('u1', 'hello', 'r1'), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'hi'), stream: [] }, { surfaceOp: 'append' })
}

test('an uninitialized window asks the native handle for exactly this page range', async () => {
  const world = makeWorld()
  appendEvents(world.session(), 100)
  const { runtime, state } = await openWorld(world)

  const page = await runtime.page(state, 63, 64, 24)
  assert.ok(page !== null)
  assert.deepEqual(seqs(page.events), range(40, 64))
  assert.deepEqual(world.pageReads, [{ offset: 40, length: 24 }], 'only the page range is read')
  assert.deepEqual(world.pageOpens, [{ sessionId: SESSION, access: 'read' }])
  assert.deepEqual(world.reads, [], 'a cold page never seeds the observed window')
  assert.equal(page.sessionId, SESSION)
  assert.equal(page.throughSeq, 63)
  assert.equal(page.fromSeq, 40)
  assert.equal(page.beforeSeq, 40)
  assert.equal(page.hasMore, true)
})

test('the page ends at the smaller of throughSeq + 1 and beforeSeq', async () => {
  const world = makeWorld()
  appendEvents(world.session(), 100)
  const { runtime, state } = await openWorld(world)

  const page = await runtime.page(state, 63, 50, 24)
  assert.ok(page !== null)
  assert.deepEqual(seqs(page.events), range(26, 50), 'beforeSeq is the exclusive lower bound, so it ends the page')
  assert.equal(page.fromSeq, 26)
  assert.equal(page.beforeSeq, 26)
  assert.equal(page.hasMore, true)
  assert.deepEqual(world.pageReads, [{ offset: 26, length: 24 }])
})

test('a page over an initialized window slices it and reads no log again', async () => {
  const world = makeWorld()
  appendEvents(world.session(), 100)
  const { runtime, state } = await openWorld(world)
  await runtime.projection(state, { maxEvents: 100 })
  assert.equal(world.reads.length, 1, 'the projection seeds the window once')

  const page = await runtime.page(state, 63, 64, 24)
  assert.ok(page !== null)
  assert.deepEqual(seqs(page.events), range(40, 64))
  assert.deepEqual(world.pageReads, [], 'a seeded window needs no persistence read')
  assert.equal(world.reads.length, 1, 'and no extra observation read')
})

test('a valid empty page is a normal page object', async () => {
  const emptyWorld = makeWorld()
  const empty = await openWorld(emptyWorld)
  assert.deepEqual(await empty.runtime.page(empty.state, -1, 0, 64),
    { sessionId: SESSION, throughSeq: -1, fromSeq: 0, beforeSeq: null, hasMore: false, events: [], messages: [] },
    'an empty session pages normally at its cut of -1')

  const world = makeWorld()
  appendConversation(world.session())
  const { runtime, state } = await openWorld(world)
  assert.deepEqual(await runtime.page(state, 3, 0, 64),
    { sessionId: SESSION, throughSeq: 3, fromSeq: 0, beforeSeq: null, hasMore: false, events: [], messages: [] },
    'paging before the first event ends at beforeSeq instead of failing')
})

test('page messages carry the seqs of the page event range at the fixed cut', async () => {
  const world = makeWorld()
  appendConversation(world.session())
  const { runtime, state } = await openWorld(world)

  const page = await runtime.page(state, 3, 4, 2)
  assert.ok(page !== null)
  assert.deepEqual(seqs(page.events), [2, 3])
  assert.deepEqual(page.messages.map(message => [message.messageId, message.seq, message.role]),
    [['u1', 2, 1], ['a1', 3, 2]])
  for (const message of page.messages) {
    assert.ok(message.seq >= page.fromSeq && message.seq < 4,
      `message ${message.messageId} at seq ${message.seq} lies outside [${page.fromSeq}, 4)`)
  }
})

test('a repeated page at a fixed cut returns identical content after events append', async () => {
  const world = makeWorld()
  const session = world.session()
  appendConversation(session)
  const { runtime, state } = await openWorld(world)
  const first = await runtime.page(state, 3, 4, 2)
  assert.ok(first !== null)
  assert.deepEqual(seqs(first.events), [2, 3])

  session.append('user/message', userMessage('u2', 'later', 'r2'), { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: assistantMessage('a2', 'later reply'), stream: [] }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const repeated = await runtime.page(state, 3, 4, 2)
  assert.deepEqual(repeated, first, 'the fixed cut keeps its events and messages after new commits')
})

test('only a throughSeq beyond the current cursor returns null', async () => {
  const world = makeWorld()
  const session = world.session()
  appendEvents(session, 10)
  const { runtime, state } = await openWorld(world)

  assert.equal(await runtime.page(state, 10, 11, 64), null, 'throughSeq 10 is beyond cursor 9')
  assert.deepEqual(world.pageReads, [], 'the dynamic cut check runs before any log read')

  await runtime.projection(state, { maxEvents: 64 })
  assert.equal(await runtime.page(state, 10, 11, 64), null, 'a seeded window is the same authority for the cut')
  const boundary = await runtime.page(state, 9, 10, 64)
  assert.ok(boundary !== null)
  assert.deepEqual(seqs(boundary.events), range(0, 10), 'the current cursor is a valid inclusive bound, clamped to the log start')
})
