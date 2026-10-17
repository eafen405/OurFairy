/**
 * The `user:<shortId>` owner encoding: the one place that names an owner and
 * the one place that reads an owner back.
 *
 * `SessionHeader.owner` is the only ownership authority, so every consumer of
 * that string must agree with the producer byte for byte: a guard that shifts
 * here (a leading zero, another principal kind) is an authorization decision,
 * not a formatting one. Keeping the codec in its own module means a consumer
 * can encode or decode an owner without mounting the identity plugin.
 *
 * @module @ourfairy/dsh-identity/src/owner
 */

/** An owner is `user:` plus a positive short number, written without a leading zero. */
const OWNER_PATTERN = /^user:([1-9]\d*)$/

/**
 * The owner string one short number speaks for.
 * @param shortId - the identity's permanent short number.
 * @returns the `SessionHeader.owner` value naming that identity.
 */
export function ownerOf(shortId) {
  return `user:${shortId}`
}

/**
 * The short number one owner string names.
 *
 * Anything that is not exactly `ownerOf(<short number>)` — another principal
 * kind, a leading zero, a non-string header — answers `undefined`; refusing it
 * is the caller's decision, because the refusal a caller owes its own clients
 * is the caller's to define.
 *
 * @param owner - a candidate `SessionHeader.owner` value.
 * @returns the short number, or undefined when the value is not an owner.
 */
export function shortIdOf(owner) {
  if (typeof owner !== 'string') return undefined
  const match = OWNER_PATTERN.exec(owner)
  if (match === null) return undefined
  const shortId = Number(match[1])
  return Number.isSafeInteger(shortId) ? shortId : undefined
}
