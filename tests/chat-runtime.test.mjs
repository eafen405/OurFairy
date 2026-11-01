/**
 * The ordered-writer policy that orders work inside one chat session.
 *
 * The runtime imports the pinned dsh peers, which only resolve inside the
 * installed product profile, so the policy lives on a dependency-free object
 * (`queues.mjs`) and is driven here directly. The rest of the seam is covered
 * end to end by the chat, delivery and jobs suites.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionQueues } from '../backend/chat/dist/queues.js'

function deferred() {
  let resolve
  const promise = new Promise(settle => { resolve = settle })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('a session queue and a delivery queue with the same id never wait on each other', async () => {
  const queues = new SessionQueues()
  const release = deferred()
  let sessionDone = false
  let deliveryDone = false
  const session = queues.runSession('colliding-id', async () => { await release.promise; sessionDone = true })
  await queues.runDelivery('colliding-id', async () => { deliveryDone = true })
  assert.equal(deliveryDone, true, 'preparing a delivery must not queue behind a session write')
  assert.equal(sessionDone, false, 'the held session write cannot have finished yet')
  release.resolve()
  await session
  assert.equal(sessionDone, true)
})

test('work on one queue runs one at a time in call order', async () => {
  const queues = new SessionQueues()
  const order = []
  const release = deferred()
  const first = queues.runSession('one-session', async () => {
    order.push('first started')
    await release.promise
    order.push('first ended')
  })
  const second = queues.runSession('one-session', async () => {
    order.push('second started')
    order.push('second ended')
  })
  await tick()
  assert.deepEqual(order, ['first started'])
  release.resolve()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first started', 'first ended', 'second started', 'second ended'])
})

test('a delivery writes its target session, but nesting one queue fails instead of hanging', async () => {
  const queues = new SessionQueues()
  const order = []
  await queues.runDelivery('delivery-1', async () => {
    await queues.runSession('session-1', async () => { order.push('delivery wrote its session') })
  })
  assert.deepEqual(order, ['delivery wrote its session'], 'the real delivery then session composition must be allowed')

  await assert.rejects(queues.runSession('same', () => queues.runSession('same', async () => {})),
    /already held/, 'reusing a held session queue is a defect, not a wait')
  await assert.rejects(queues.runDelivery('same', () => queues.runDelivery('same', async () => {})),
    /already held/, 'reusing a held delivery queue is a defect, not a wait')
})

test('a continuation of settled queue work may re-enter that queue', async () => {
  // The chat row starts a turn inside the session queue and then lets the queue
  // entry settle; the turn keeps running and may later ask for the same session
  // (a self delivery landing in the session it was issued from). That entry is
  // no longer awaiting the queue's tail, so entering it cannot wait on itself.
  const queues = new SessionQueues()
  const order = []
  let background
  await queues.runSession('self-delivery-session', async () => {
    background = (async () => {
      await tick()
      await queues.runSession('self-delivery-session', async () => { order.push('re-entered') })
    })()
  })
  await background
  assert.deepEqual(order, ['re-entered'])
})

test('a re-entering continuation queues behind newer running work, and a live nested entry still fails fast', async () => {
  const queues = new SessionQueues()
  const order = []
  const releaseNewer = deferred()
  const reenter = deferred()
  let continuation
  await queues.runSession('re-entry-session', async () => {
    // The turn started here outlives the queue entry; this is what it later does
    // when a self delivery asks for the same session.
    continuation = (async () => {
      await reenter.promise
      await queues.runSession('re-entry-session', async () => { order.push('continuation re-entered') })
    })()
  })
  const newer = queues.runSession('re-entry-session', async () => {
    order.push('newer started')
    // A nested entry of the work now running is the old defect: it would wait
    // on itself, so the queue refuses it immediately.
    assert.throws(() => queues.runSession('re-entry-session', async () => {}), /already held/)
    await releaseNewer.promise
    order.push('newer ended')
  })
  await tick()
  assert.deepEqual(order, ['newer started'])
  reenter.resolve()
  await tick()
  assert.deepEqual(order, ['newer started'], 'the continuation must not overtake the newer running entry')
  releaseNewer.resolve()
  await Promise.all([newer, continuation])
  assert.deepEqual(order, ['newer started', 'newer ended', 'continuation re-entered'],
    'the continuation enters only after the newer entry settles')
})
