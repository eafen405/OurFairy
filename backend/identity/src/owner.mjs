/**
 * The `user:<shortId>` owner codec: the one place that writes a
 * `SessionHeader.owner` and the one place that reads one back. It is its own
 * module so a consumer can use the codec without mounting the identity plugin.
 *
 * @module @ourfairy/dsh-identity/src/owner
 */

/** An owner is `user:` plus a positive short number, written without a leading zero. */
const OWNER_PATTERN = /^user:([1-9]\d*)$/

/**
 * The `SessionHeader.owner` value one short number speaks for. Anything
 * `shortIdOf` would not read back — zero, a fraction, a numeric string, an
 * unsafe integer — is a caller error.
 * @throws {TypeError} when `shortId` is not a positive safe integer.
 */
export function ownerOf(shortId) {
  if (!Number.isSafeInteger(shortId) || shortId <= 0) {
    throw new TypeError(`ownerOf expects a positive safe integer short id; got ${String(shortId)}`)
  }
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
