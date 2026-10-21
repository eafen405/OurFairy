/**
 * Interface contract for the identity module's business store (ticket #52).
 *
 * The store keeps users, groups, uploads and delivery coordination in one
 * SQLite file behind one migration ladder; that concentration is deliberate.
 * What the rest of the product sees is narrower: four domain faces, each naming
 * only the operations its consumer calls. These tests pin that surface and its
 * delegation. The behaviour of the four consumer packages is already covered
 * end to end through the running backend, so this file does not repeat it.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { identityInterfaces } from '../backend/identity/src/interfaces.mjs'
import { IdentityStore } from '../backend/identity/src/store.mjs'

const NOW = 1_700_000_000_000
const dir = mkdtempSync(join(tmpdir(), 'ourfairy-identity-interfaces-'))
const store = new IdentityStore({ path: join(dir, 'business.sqlite'), now: () => NOW })
store.seedPhaethon({ name: 'phaethon', password: 'phaethon-password' })
after(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})
const identity = identityInterfaces(store)

test('the store stays inside the package: four domain faces and nothing else', () => {
  assert.deepEqual(Object.keys(identity).sort(), ['deliveries', 'groups', 'uploads', 'users'])
  assert.equal(identity.store, undefined, 'the bare store must not be republished')
  assert.deepEqual(Object.keys(identity.users), ['byShortId'])
  assert.deepEqual(Object.keys(identity.groups).sort(), ['changeMember', 'create', 'forMember', 'owns'])
  assert.deepEqual(Object.keys(identity.uploads).sort(), ['insert', 'read', 'update'])
  assert.deepEqual(Object.keys(identity.deliveries).sort(), ['complete', 'pending', 'prepare', 'prepareFile'])

  // The width a consumer used to receive: no store member outside its domain
  // may leak through any face.
  const leaked = ['authenticate', 'close', 'createInvite', 'now',
    'register', 'seedPhaethon', 'signIn', 'signOut']
  for (const [domain, face] of Object.entries(identity)) {
    for (const name of leaked) {
      assert.equal(face[name], undefined, `${domain} must not publish ${name}`)
    }
  }
})

test('the store publishes exactly the nineteen methods spec 132 named', () => {
  const published = Object.getOwnPropertyNames(IdentityStore.prototype)
    .filter(name => name !== 'constructor')
    .sort()
  assert.deepEqual(published, [
    'authenticate', 'changeGroupMember', 'close', 'completeDelivery', 'createGroup', 'createInvite',
    'groupsForMember', 'insertUpload', 'ownsGroup', 'pendingDeliveries', 'prepareDelivery',
    'prepareDeliveryFile', 'readUpload', 'register', 'seedPhaethon', 'signIn', 'signOut',
    'updateUpload', 'userByShortId',
  ], 'a method with no production caller must not stay on the store')
})

test('the delivery read stays inside the package', () => {
  assert.equal(store.readDelivery, undefined, 'the delivery read is module private')
})

test('users and groups answer under their own domain', () => {
  assert.equal(identity.users.byShortId(1).name, 'phaethon')
  assert.equal(identity.users.byShortId(999), undefined)

  const group = identity.groups.create(1, { name: 'Reading', ownerShortId: 1 })
  assert.deepEqual(group.memberShortIds, [1])
  assert.equal(identity.groups.owns(1), true)
  assert.deepEqual(identity.groups.forMember(1).map(member => member.id), [group.id])
  assert.throws(
    () => identity.groups.changeMember(1, { groupId: group.id, userShortId: 1, action: 2 }),
    /owner must remain a member/,
  )
})

test('uploads and deliveries answer under their own domain', () => {
  const uploadId = 'a'.repeat(32)
  identity.uploads.insert({ uploadId, owner: 1, sessionId: 'session-1', name: 'notes.txt', mime: 'text/plain',
    size: 3, sha256: 'b'.repeat(64), status: 0, offset: 0, expiresAt: NOW + 1000, createdAt: NOW, updatedAt: NOW })
  assert.equal(identity.uploads.read(uploadId).offset, 0)
  identity.uploads.update(uploadId, { offset: 3 })
  assert.equal(identity.uploads.read(uploadId).offset, 3)

  identity.deliveries.prepare({ deliveryId: 'delivery-1', senderShortId: 1, senderSessionId: 'session-1',
    recipientShortId: 1, sessionId: 'session-2', text: 'hello', files: [] })
  assert.deepEqual(identity.deliveries.pending().map(row => row.deliveryId), ['delivery-1'])
  identity.deliveries.complete('delivery-1', { messageId: 'message-1', acceptedSeq: 4 })
  assert.deepEqual(identity.deliveries.pending(), [])

  identity.deliveries.prepare({ deliveryId: 'delivery-2', senderShortId: 1, senderSessionId: 'session-1',
    recipientShortId: 1, sessionId: 'session-2', text: 'with a file',
    files: [{ selector: { path: 'notes.txt' }, prepared: null }] })
  const prepared = identity.deliveries.prepareFile('delivery-2', 0, { name: 'notes.txt', mime: 'text/plain',
    original: { path: '/files/notes.txt', bytes: 3 } })
  assert.equal(prepared.files[0].prepared.name, 'notes.txt')
  assert.equal(prepared.status, 0)
})

test('the service and its consumers reach identity through the domain faces, never the store', () => {
  const read = path => readFileSync(new URL(`../backend/${path}`, import.meta.url), 'utf8')
  const service = read('identity/src/index.mjs')
  assert.doesNotMatch(service, /this\.store\s*=/u, 'IdentityService must not republish the store')
  assert.match(service, /identityInterfaces\(/u, 'IdentityService must build the domain faces')

  for (const consumer of ['delivery/src/index.mjs', 'groups/src/index.mjs', 'attachments/src/service.mjs', 'search/src/index.mjs']) {
    assert.doesNotMatch(read(consumer), /identity\s*\.\s*store\b/u, `${consumer} must not read the bare store`)
  }
})
