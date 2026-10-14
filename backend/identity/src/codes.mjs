/**
 * Credential primitives for the OurFairy identity module.
 *
 * Nothing here touches the network or the database: it mints and verifies the
 * three opaque values the module hands out — passwords, invite codes, and
 * session tokens — so each rule has one home and is testable on its own.
 *
 * @module @ourfairy/dsh-identity/src/codes
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

/** Password hash parameters; the stored record carries them so they can move. */
const SCRYPT_KEY_BYTES = 64
const SALT_BYTES = 16
const SESSION_TOKEN_BYTES = 32

/**
 * Invite alphabet: digits and upper-case letters without the four glyphs a
 * human misreads when copying a code by hand (`I`, `O`, `0`, `1`).
 */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_LENGTH = 12

/**
 * Hash one password with a fresh salt.
 * @param password - plaintext password.
 * @returns the storable `scrypt$<salt>$<hash>` record.
 */
export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES)
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

/**
 * Verify one password against a stored record without leaking which part failed.
 * @param password - plaintext candidate.
 * @param record - record produced by {@link hashPassword}.
 * @returns whether the candidate reproduces the stored hash.
 */
export function verifyPassword(password, record) {
  const parts = typeof record === 'string' ? record.split('$') : []
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  let salt
  let expected
  try {
    salt = Buffer.from(parts[1], 'base64url')
    expected = Buffer.from(parts[2], 'base64url')
  } catch {
    return false
  }
  if (salt.byteLength === 0 || expected.byteLength !== SCRYPT_KEY_BYTES) return false
  const derived = scryptSync(password, salt, expected.byteLength)
  return timingSafeEqual(derived, expected)
}

/**
 * Mint one invite code.
 * @returns a 12-character code over the unambiguous alphabet.
 */
export function mintInviteCode() {
  let code = ''
  for (let index = 0; index < INVITE_LENGTH; index += 1) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
  }
  return code
}

/** Canonicalize a user-supplied invite code: case- and separator-insensitive. */
export function canonicalInviteCode(value) {
  return String(value ?? '').toUpperCase().replaceAll(/[^A-Z0-9]/gu, '')
}

/**
 * Mint one session token. Only its digest is stored, so a database read cannot
 * replay a live session.
 * @returns the bearer value handed to the client.
 */
export function mintSessionToken() {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
}

/**
 * Digest one session token for storage and lookup.
 * @param token - bearer value presented by a client.
 * @returns the hex digest stored as the session key.
 */
export function sessionTokenDigest(token) {
  return createHash('sha256').update(token).digest('hex')
}
