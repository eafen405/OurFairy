/**
 * The `user:<shortId>` owner codec: the one place that writes a
 * `SessionHeader.owner` and the one place that reads one back. It is its own
 * module so a consumer can use the codec without mounting the identity plugin.
 *
 * @module @ourfairy/dsh-identity/src/owner
 */
import type { SessionOwnerId } from '@deepseek-ai/dsh-session'

/** An owner is `user:` plus a positive short number, written without a leading zero. */
const OWNER_PATTERN = /^user:([1-9]\d*)$/

/**
 * The `SessionHeader.owner` value one short number speaks for. Anything
 * `shortIdOf` would not read back — zero, a fraction, a numeric string, an
 * unsafe integer — is a caller error.
 * @throws {TypeError} when `shortId` is not a positive safe integer.
 */
export function ownerOf(shortId: number): SessionOwnerId {
  if (!Number.isSafeInteger(shortId) || shortId <= 0) {
    throw new TypeError(`ownerOf expects a positive safe integer short id; got ${String(shortId)}`)
  }
  // dsh brands the owner string so a session header's owner cannot be confused
  // with any other string. This codec is the one place that writes that
  // string, and the brand marks exactly this value.
  return `user:${shortId}` as SessionOwnerId
}

/** The short number one owner string names, or undefined when it is not an owner. */
export function shortIdOf(owner: unknown): number | undefined {
  if (typeof owner !== 'string') return undefined
  const match = OWNER_PATTERN.exec(owner)
  if (match === null) return undefined
  const digits = match[1]
  if (digits === undefined) return undefined
  const shortId = Number(digits)
  return Number.isSafeInteger(shortId) ? shortId : undefined
}
