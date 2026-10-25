/**
 * The `user:<shortId>` owner codec's two directions must agree.
 *
 * `SessionHeader.owner` is the only ownership authority, and both sides of it
 * are written by this one codec. `shortIdOf` always refused `user:0` and
 * `user:abc`; `ownerOf` used to mint them anyway, so the encoder and the
 * decoder disagreed about what an owner is. That disagreement is an
 * authorization decision, not a formatting one, so it is pinned here.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('the codec\'s two directions round-trip exactly the short numbers it accepts', async () => {
  const { ownerOf, shortIdOf } = await import('../backend/identity/dist/owner.js')

  assert.equal(ownerOf(1), 'user:1')
  for (const shortId of [1, 2, 42, Number.MAX_SAFE_INTEGER]) {
    assert.equal(shortIdOf(ownerOf(shortId)), shortId, `ownerOf/shortIdOf must round-trip ${shortId}`)
  }
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '1', null, undefined]) {
    assert.throws(
      () => ownerOf(invalid),
      TypeError,
      `ownerOf(${String(invalid)}) must refuse a value shortIdOf would never read back`,
    )
  }
  for (const foreign of ['user:0', 'user:01', 'user:abc', 'team:1', '', 1]) {
    assert.equal(shortIdOf(foreign), undefined, `shortIdOf must refuse ${JSON.stringify(foreign)}`)
  }
})
