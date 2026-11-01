/**
 * The delivery landing decision, as its own dependency-free object.
 *
 * The delivery row imports pinned dsh peers, which only resolve inside the
 * installed product profile, so the rule lives on a module with no dsh imports
 * (`backend/delivery/src/target.ts`) and is driven here directly. The archived
 * origin is covered end to end by the text-delivery suite; the missing and
 * foreign origins are not reachable through the tool today — they are the
 * inputs the decision reserves for future background delivery.
 *
 * @covers backend/delivery
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliveryTargetOf } from '../backend/delivery/dist/target.js'

/** One decision's facts: a self delivery from a live origin session unless overridden. */
function facts(overrides = {}) {
  return {
    senderShortId: 7,
    recipientShortId: 7,
    originSessionId: 'ourfairy-user-7-origin',
    originCanHost: true,
    ...overrides,
  }
}

test('a self delivery whose origin session may host lands in that origin session', () => {
  assert.equal(deliveryTargetOf(facts()), 'origin')
})

test('a self delivery with no origin session falls back to the primary session', () => {
  assert.equal(deliveryTargetOf(facts({ originSessionId: undefined })), 'primary')
  assert.equal(deliveryTargetOf(facts({ originSessionId: '' })), 'primary')
})

test('a self delivery whose origin session cannot host falls back to the primary session', () => {
  // Missing, foreign and archived origins all reach the rule as the same
  // refusal from the session service; the decision needs no further facts.
  assert.equal(deliveryTargetOf(facts({ originCanHost: false })), 'primary')
})

test('a delivery to another user lands in that user’s primary even when the origin could host', () => {
  assert.equal(deliveryTargetOf(facts({ recipientShortId: 8, originCanHost: true })), 'primary')
})
