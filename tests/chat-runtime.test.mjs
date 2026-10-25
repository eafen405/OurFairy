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
