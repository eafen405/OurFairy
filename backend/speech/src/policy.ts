/**
 * The speech row's one field vocabulary and legality rules.
 *
 * This is the product's decision about the `speech` profile row: which
 * connection fields exist, which of them are limits, the credential reference
 * the row falls back to, the endpoint and environment-name grammars, and what
 * makes a limit value legal. The row's own Config, the runtime's per-request
 * read and the gateway's phone-facing view and save take the names and rules
 * from here, so a new field or a changed rule is one edit.
 *
 * Two things cannot import this module and are pinned by tests instead:
 * `backend/v1-bundle/cordis.patch.yml` seeds the row (YAML cannot import TS),
 * and `speech/src/index.ts` declares one schemastery schema per field (a schema
 * cannot be built from a name list without also declaring its type). Both are
 * checked against this module by `tests/speech-policy.test.mjs`.
 *
 * The module imports nothing: the gateway reads it without loading the speech
 * row's runtime graph.
 *
 * @module @ourfairy/dsh-speech/src/policy
 */

/** Every field of the speech row, in the order the gateway's view reports them. */
export const SPEECH_FIELDS = Object.freeze([
  'model',
  'endpoint',
  'apiKeyEnv',
  'maxDurationMs',
  'maxAudioBytes',
  'timeoutMs',
  'maxGlobalInFlight',
  'maxUserInFlight',
] as const)

/** The limit fields: each is a positive safe integer. */
export const SPEECH_LIMIT_FIELDS = Object.freeze([
  'maxDurationMs',
  'maxAudioBytes',
  'timeoutMs',
  'maxGlobalInFlight',
  'maxUserInFlight',
] as const)

/** The credential reference the row falls back to when it names none. */
export const DEFAULT_API_KEY_ENV = 'VOICE_API_KEY'

/** The `endpoint` grammar: an absolute http(s) URL with no whitespace. */
export const SPEECH_ENDPOINT_PATTERN = /^https?:\/\/[^\s]+$/u

/** The `apiKeyEnv` grammar: one environment-variable name. */
export const SPEECH_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

/**
 * Whether one limit value is legal.
 *
 * `Number.isSafeInteger` plus `> 0` is the check itself; it is written as a type
 * guard so the value that passes it can be used as a number. The row's Config
 * encodes the same floor as `.min(1)`, because schemastery validates one bound
 * rather than calling a predicate; the policy test keeps the two answers equal.
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
