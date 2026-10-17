/**
 * Ticket #51: the chat package's live-session runtime is the named seam
 * between service.mjs and its delivery/jobs modules.
 *
 * The runtime itself imports the pinned dsh peers, which only resolve inside
 * the installed product profile, so its ordered-writer policy is tested on the
 * dependency-free object that owns it (`queues.mjs`). The rest of the seam is
 * exercised end to end by the existing chat, delivery and jobs suites, and
 * pinned to the named collaborators by the source assertions below.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SessionQueues } from '../backend/chat/src/queues.mjs'

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

test('delivery and jobs reach live sessions through the runtime, not RemoteChat privates', () => {
  const source = name => readFileSync(new URL(`../backend/chat/src/${name}`, import.meta.url), 'utf8')
  for (const name of ['delivery.mjs', 'jobs.mjs']) {
    assert.doesNotMatch(source(name), /\bchat\._/, `${name} must depend on the named runtime interface`)
    assert.match(source(name), /\bruntime\./, `${name} must receive the runtime as its collaborator`)
  }
  assert.match(source('runtime.mjs'), /export class SessionRuntime/, 'the live-session seam must be a named runtime object')
  assert.match(source('runtime.mjs'), /new SessionQueues\(/, 'the runtime must delegate ordering to the tested key policy')
})

test('the runtime is the only writer of a live session version', () => {
  const source = name => readFileSync(new URL(`../backend/chat/src/${name}`, import.meta.url), 'utf8')
  for (const name of ['service.mjs', 'delivery.mjs', 'jobs.mjs']) {
    assert.doesNotMatch(source(name), /\.version\s*\+\+/, `${name} must not bump the projection version itself`)
  }
  assert.match(source('runtime.mjs'), /state\.version\+\+/, 'the runtime owns the one version change')
})
