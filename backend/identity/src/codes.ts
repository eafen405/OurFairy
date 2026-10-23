/**
 * Credential primitives: passwords, invite codes and session tokens. Nothing
 * here touches the network or the database.
 *
 * @module @ourfairy/dsh-identity/src/codes
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

/** Password hash parameters; the stored record carries them so they can move. */
const SCRYPT_KEY_BYTES = 64
const SALT_BYTES = 16
const SESSION_TOKEN_BYTES = 32

/** Invite alphabet: digits and upper-case letters without `I`, `O`, `0`, `1`. */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const INVITE_LENGTH = 12

/** Hash one password with a fresh salt into a `scrypt$<salt>$<hash>` record. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const derived = scryptSync(password, salt, SCRYPT_KEY_BYTES)
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

/**
 * Verify one password against a {@link hashPassword} record in constant time.
 * A malformed record answers false; `Buffer.from` never throws on bad base64url.
 */
export function verifyPassword(password: string, record: unknown): boolean {
  const parts = typeof record === 'string' ? record.split('$') : []
  if (parts.length !== 3) return false
  const [algorithm, saltText, hashText] = parts
  if (algorithm !== 'scrypt' || saltText === undefined || hashText === undefined) return false
  const salt = Buffer.from(saltText, 'base64url')
  const expected = Buffer.from(hashText, 'base64url')
  if (salt.byteLength === 0 || expected.byteLength !== SCRYPT_KEY_BYTES) return false
  return timingSafeEqual(scryptSync(password, salt, expected.byteLength), expected)
}

/** Mint one 12-character invite code over the unambiguous alphabet. */
export function mintInviteCode(): string {
  let code = ''
  for (let index = 0; index < INVITE_LENGTH; index += 1) {
    code += INVITE_ALPHABET.charAt(randomInt(INVITE_ALPHABET.length))
  }
  return code
}

/** Canonicalize a user-supplied invite code: case- and separator-insensitive. */
export function canonicalInviteCode(value: unknown): string {
  return String(value ?? '').toUpperCase().replaceAll(/[^A-Z0-9]/gu, '')
}

/** Mint one session token. Only its digest is stored, so a database read cannot replay it. */
export function mintSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
}

/** The hex digest of one session token, stored as the session key. */
export function sessionTokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
