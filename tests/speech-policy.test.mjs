/**
 * Ticket #273: the speech row's field vocabulary and rules have one authority.
 *
 * `backend/speech/src/policy.ts` declares the eight fields, the five limits,
 * the default credential reference, the two grammars and the positive-integer
 * rule. Three consumers cannot derive everything from it — the row's
 * schemastery Config (a field needs a type and a default, not just a name), the
 * bundle patch (YAML cannot import TS), and the gateway's view/save (checked by
 * `tests/gateway-service.test.mjs`) — so this file pins the first two to it:
 *
 * - Config's keys are exactly `SPEECH_FIELDS`, and its `.min(1)` floor rejects
 *   what `isPositiveInteger` rejects.
 * - The composed bundle row names exactly `SPEECH_FIELDS`, and each `!!js`
 *   seed's fallback (evaluated with an empty environment, the fresh-deployment
 *   case) is legal under the policy.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
// Registers Node resolution for the pinned dsh checkout and the product
// packages before the modules below are imported; it must stay the first
// helper import of this file.
import './helpers/dsh-peers.mjs'
import { repoRoot } from './helpers/backend.mjs'

const {
  DEFAULT_API_KEY_ENV, isPositiveInteger, SPEECH_ENDPOINT_PATTERN, SPEECH_ENV_NAME_PATTERN, SPEECH_FIELDS, SPEECH_LIMIT_FIELDS,
} = await import('@ourfairy/dsh-speech/policy')
const { Config } = await import('@ourfairy/dsh-speech')
const { composeEntries, loadOverlayPatches } = await import('@deepseek-ai/dsh-app-boot')

/** One complete, policy-legal row value; individual cases override one field. */
const VALID = Object.freeze({
  model: 'FunAudioLLM/SenseVoiceSmall',
  endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
  maxDurationMs: 60_000,
  maxAudioBytes: 1_920_044,
  timeoutMs: 45_000,
  maxGlobalInFlight: 2,
  maxUserInFlight: 1,
})

test('the policy names eight fields and five limits', () => {
  assert.equal(SPEECH_FIELDS.length, 8, `the speech row has eight fields; it declared ${SPEECH_FIELDS.length}`)
  assert.equal(new Set(SPEECH_FIELDS).size, 8, 'the policy must not repeat a field')
  assert.equal(SPEECH_LIMIT_FIELDS.length, 5, `the speech row has five limits; it declared ${SPEECH_LIMIT_FIELDS.length}`)
  for (const field of SPEECH_LIMIT_FIELDS) {
    assert.ok(SPEECH_FIELDS.includes(field), `limit field ${field} must be one of the row's fields`)
  }
  // The three non-limit fields are the connection settings; pinning them keeps
  // a new limit from being slipped into the credential/endpoint trio.
  assert.deepEqual(
    SPEECH_FIELDS.filter(field => !SPEECH_LIMIT_FIELDS.includes(field)),
    ['model', 'endpoint', 'apiKeyEnv'],
    'the non-limit fields are the model, the endpoint and the credential reference',
  )
})

test('the policy rules accept exactly the documented values', () => {
  assert.equal(DEFAULT_API_KEY_ENV, 'VOICE_API_KEY', 'the product default reference is part of the deployment contract')
  assert.match(DEFAULT_API_KEY_ENV, SPEECH_ENV_NAME_PATTERN, 'the default reference must itself be a legal reference')

  for (const endpoint of ['https://api.siliconflow.cn/v1/audio/transcriptions', 'http://127.0.0.1:8080/transcribe']) {
    assert.ok(SPEECH_ENDPOINT_PATTERN.test(endpoint), `the policy must accept the endpoint ${endpoint}`)
  }
  for (const endpoint of ['ftp://asr.example/v1', 'https://', 'https://asr example/v1', '']) {
    assert.equal(SPEECH_ENDPOINT_PATTERN.test(endpoint), false, `the policy must refuse the endpoint ${JSON.stringify(endpoint)}`)
  }

  for (const reference of ['VOICE_API_KEY', '_ASR2']) {
    assert.ok(SPEECH_ENV_NAME_PATTERN.test(reference), `the policy must accept the reference ${reference}`)
  }
  for (const reference of ['', '1VOICE', 'VOICE-KEY', 'VOICE KEY']) {
    assert.equal(SPEECH_ENV_NAME_PATTERN.test(reference), false, `the policy must refuse the reference ${JSON.stringify(reference)}`)
  }

  for (const value of [1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.ok(isPositiveInteger(value), `the policy must accept the limit ${value}`)
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isPositiveInteger(value), false, `the policy must refuse the limit ${String(value)}`)
  }
})

test('the row Config declares exactly the policy fields and the same positive floor', () => {
  assert.deepEqual(Object.keys(Config.dict), [...SPEECH_FIELDS],
    'the row schema must declare exactly the policy fields; a field added to one list only is a drift')

  const resolved = Config({ ...VALID })
  assert.equal(resolved.apiKeyEnv.get(), DEFAULT_API_KEY_ENV,
    'an unset apiKeyEnv must resolve to the policy default, not a second literal')

  for (const field of SPEECH_LIMIT_FIELDS) {
    // The policy answers "> 0" through its predicate; the schema can only
    // encode a bound, so this proves both answers agree at the boundary.
    assert.equal(isPositiveInteger(0), false, 'the premise: the policy refuses 0')
    assert.throws(() => Config({ ...VALID, [field]: 0 }), new RegExp(field, 'u'),
      `the row schema must refuse the 0 that ${field}'s policy refuses`)
    assert.doesNotThrow(() => Config({ ...VALID, [field]: 1 }),
      `the row schema must accept the 1 that ${field}'s policy accepts`)
  }
})

/** Evaluate one composed config value with an empty environment: a seed's fallback. */
function seedValue(field, value) {
  if (value === null || typeof value !== 'object' || !('__jsExpr' in value)) return value
  try {
    return runInNewContext(`(${value.__jsExpr})`, { process: { env: {} } }, { timeout: 1_000 })
  } catch (error) {
    assert.fail(`the bundle's ${field} seed expression did not evaluate with an empty environment: ${error.message}`)
  }
}

test('the bundle seeds every policy field with a policy-legal value', () => {
  const composed = composeEntries([
    loadOverlayPatches('dsh', join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml')),
  ])
  const flatten = entries => entries.flatMap(entry => Array.isArray(entry.config) ? flatten(entry.config) : [entry])
  const row = flatten(composed).find(entry => entry.id === 'speech')
  assert.ok(row, `the composition must mount the speech row; it mounts ${JSON.stringify(flatten(composed).map(entry => entry.id))}`)

  assert.deepEqual(
    Object.keys(row.config).sort(),
    [...SPEECH_FIELDS].sort(),
    'the seeded row must name exactly the policy fields; a field added to one list only is a drift',
  )
  const seed = Object.fromEntries(Object.entries(row.config).map(([field, value]) => [field, seedValue(field, value)]))

  assert.equal(seed.apiKeyEnv, DEFAULT_API_KEY_ENV,
    'the seed must fall back to the policy default reference, not a second copy of the name')
  assert.match(seed.endpoint, SPEECH_ENDPOINT_PATTERN, 'the seed endpoint must pass the policy grammar')
  assert.match(seed.apiKeyEnv, SPEECH_ENV_NAME_PATTERN, 'the seed reference must pass the policy grammar')
  assert.ok(typeof seed.model === 'string' && seed.model.trim() !== '', 'the seed model must be a non-empty string')
  for (const field of SPEECH_LIMIT_FIELDS) {
    assert.ok(isPositiveInteger(seed[field]),
      `the seed ${field} (${JSON.stringify(seed[field])}) must be a positive integer under the policy`)
  }
  assert.doesNotThrow(() => Config(seed), 'the whole seed must pass the row schema')
})
