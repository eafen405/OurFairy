/**
 * Where one delivery lands.
 *
 * The landing is decided once, before the delivery row is prepared, and the row
 * records it: the receipt, the settled event and recovery all read that recorded
 * session instead of asking again. The rule reads only facts the call already
 * has, so this module has no imports at all:
 *
 * - a delivery to the sender lands in the origin session when there is one and
 *   it may host the delivery (it exists, belongs to the sender and is not
 *   archived);
 * - every other delivery lands in the recipient's primary session — another
 *   recipient has no origin session of their own here, and an origin that
 *   cannot host (archived, missing, foreign, or no origin at all) is not a
 *   place the recipient will find it.
 *
 * @module @ourfairy/dsh-delivery/src/target
 */

/** The session one delivery lands in. */
export type DeliveryTarget = 'origin' | 'primary'

/**
 * The facts the landing decision reads.
 *
 * `originCanHost` is the session service's answer (header exists, owner matches,
 * not archived), already resolved for the sender's own session; the decision
 * itself adds no reads and no dsh types.
 */
export interface DeliveryTargetFacts {
  readonly senderShortId: number
  readonly recipientShortId: number
  readonly originSessionId: string | undefined
  readonly originCanHost: boolean
}

/** Decide where one delivery lands, from the facts the call already holds. */
export function deliveryTargetOf(facts: DeliveryTargetFacts): DeliveryTarget {
  if (facts.recipientShortId !== facts.senderShortId) return 'primary'
  if (!facts.originSessionId) return 'primary'
  return facts.originCanHost ? 'origin' : 'primary'
}
