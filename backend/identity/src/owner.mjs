/**
 * The `user:<shortId>` owner codec: the one place that writes a
 * `SessionHeader.owner` and the one place that reads one back. It is its own
 * module so a consumer can use the codec without mounting the identity plugin.
 *
 * @module @ourfairy/dsh-identity/src/owner
 */

/** An owner is `user:` plus a positive short number, written without a leading zero. */
const OWNER_PATTERN = /^user:([1-9]\d*)$/

/** The `SessionHeader.owner` value one short number speaks for. */
export function ownerOf(shortId) {
  return `user:${shortId}`
}

/** The short number one owner string names, or undefined when it is not an owner. */
export function shortIdOf(owner) {
  if (typeof owner !== 'string') return undefined
  const match = OWNER_PATTERN.exec(owner)
  if (match === null) return undefined
  const shortId = Number(match[1])
  return Number.isSafeInteger(shortId) ? shortId : undefined
}
