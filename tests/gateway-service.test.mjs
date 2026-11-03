/**
 * Unit seam for the shared-configuration gateway (#135 review fixes).
 *
 * The booted HTTP suite can show that two awaited saves leave the last value
 * effective, but it cannot tell the native save entry apart from a direct
 * `settings().mutate`: both write in the order the client awaited them. These
 * cases pin the *call path* itself at the narrow service seam — no backend boot,
 * a plain cordis context, and spies for the native default-model entry and the
 * settings row.
 *
 * The native catalog load is a second claim in the same README: a missing
 * package/subpath must fail loudly instead of falling back to a local list.
 * Exercising it here avoids booting a deployment with the peer removed.
 *
 * Ticket #273 adds the ASR seam: the gateway's view and save must report and
 * accept exactly the speech policy's fields and rules, so the cases below
 * derive their bodies from `@ourfairy/dsh-speech/policy` rather than keeping a
 * second copy of the field list or the grammars.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before the native
// modules below are loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'

const { Context } = await import('@deepseek-ai/cordis')
const { GatewayError, GatewayService, loadNativeModalities } = await import('../backend/gateway/dist/service.js')
const {
  DEFAULT_API_KEY_ENV, isPositiveInteger, SPEECH_ENDPOINT_PATTERN, SPEECH_ENV_NAME_PATTERN, SPEECH_FIELDS, SPEECH_LIMIT_FIELDS,
} = await import('@ourfairy/dsh-speech/policy')

const PROVIDER = 'minimax-cn'
const MODEL = 'MiniMax-M3.1-Flash'

/**
 * One service over a plain context. `editable: false` models a deployment
 * without the configuration editor; otherwise the fake row reports the
 * composition's inherited effort and records any direct write.
 * @param {{editable?: boolean}} options
 */
function harness({ editable = true } = {}) {
  const ctx = new Context()
  const saved = []
  const mutations = []
  const row = editable ? {
    describe: () => [{ ns: 'agent-default-model', base: { reasoningEffort: 'max' } }],
    mutate: (...args) => { mutations.push(args) },
  } : undefined
  const originalGet = ctx.get.bind(ctx)
  ctx.get = name => name === 'settings' ? row : originalGet(name)
  ctx.llm = {
    listProviders: () => [{ id: PROVIDER }],
    resolveModelInfo: async () => ({}),
    listModels: async () => [{ id: MODEL }],
  }
  let current = { provider: PROVIDER, model: MODEL, reasoningEffort: 'max' }
  ctx.agentDefaultModel = {
    saveSelection: async next => { saved.push(next); current = { ...next } },
    currentSelection: () => ({ ...current }),
  }
  return { service: new GatewayService(ctx), saved, mutations }
}

test('a selection save goes through the native default-model entry', async () => {
  const { service, saved, mutations } = harness()

  const inherited = await service.saveSelection({ provider: PROVIDER, model: MODEL })
  // Omitting the effort resolves the composition default and submits a complete
  // selection; the native entry stores the whole value.
  assert.deepEqual(saved, [{ provider: PROVIDER, model: MODEL, reasoningEffort: 'max' }],
    'the save must reach the native default-model entry with the complete selection')
  assert.deepEqual(inherited, {
    selection: { provider: PROVIDER, model: MODEL, reasoningEffort: 'max' }, applies: 'next-turn',
  })

  await service.saveSelection({ provider: PROVIDER, model: MODEL, reasoningEffort: 'low' })
  assert.deepEqual(saved.at(-1), { provider: PROVIDER, model: MODEL, reasoningEffort: 'low' },
    'an explicit effort is submitted as given')
  assert.deepEqual(mutations, [],
    'the gateway must not write the agent-default-model row through settings().mutate; reverting to a direct write fails here')
})

test('a selection save refuses when the profile cannot be edited', async () => {
  const { service, saved } = harness({ editable: false })

  // An explicit effort skips the row lookup that would otherwise also fail, so
  // only the configuration-editor guard can refuse this save.
  await assert.rejects(service.saveSelection({ provider: PROVIDER, model: MODEL, reasoningEffort: 'low' }), error => {
    assert.ok(error instanceof GatewayError, `expected a GatewayError; got ${error}`)
    assert.equal(error.status, 503)
    assert.equal(error.code, 'gateway/configuration-unavailable')
    return true
  })
  assert.deepEqual(saved, [], 'the native save must not run when no configuration editor is mounted')
})

test('a missing native catalog fails naming the peer and the module specifier', async () => {
  const missing = '@deepseek-ai/dsh-llm-pi-ai/src/no-such-catalog.ts'
  await assert.rejects(loadNativeModalities(missing), error => {
    assert.match(error.message, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')),
      `the failure must name the missing subpath; got ${error.message}`)
    assert.match(error.message, /install the @deepseek-ai\/dsh-llm-pi-ai peer/,
      `the failure must name the peer to install; got ${error.message}`)
    return true
  })

  // The default specifier is the same module the gateway imports, so the
  // fallback-free load is pinned to the pinned dsh catalog.
  const { MODALITIES } = await import('@deepseek-ai/dsh-llm-pi-ai/src/catalog.ts')
  assert.deepEqual(await loadNativeModalities(), MODALITIES)
})

/**
 * One service over a plain context whose `speech` row lives in memory.
 *
 * `row` is the stored row value; `undefined` models a deployment that mounts no
 * speech row at all. `update` records the save path and applies the write, so a
 * save's echoed view reads what the settings service would report.
 * @param {{row?: Record<string, unknown>}} [options]
 */
function asrHarness({ row } = {}) {
  const ctx = new Context()
  const updates = []
  let value = row
  const settings = row === undefined ? undefined : {
    describe: () => [{ ns: 'speech', ...(value === undefined ? {} : { value }) }],
    update: async (ns, fields) => {
      updates.push({ ns, fields: { ...fields } })
      value = { ...value, ...fields }
    },
  }
  const originalGet = ctx.get.bind(ctx)
  ctx.get = name => name === 'settings' ? settings : originalGet(name)
  return { service: new GatewayService(ctx), updates }
}

test('the ASR view reports exactly the policy fields and the policy default reference', async () => {
  const { service } = asrHarness({ row: {} })
  const view = await service.asrView()

  assert.deepEqual(
    Object.keys(view).sort(),
    ['available', 'credential', 'editable', ...SPEECH_FIELDS].sort(),
    'the view must carry the policy fields and no field the policy does not name',
  )
  assert.equal(view.editable, true, 'a mounted speech row is editable')
  assert.equal(view.apiKeyEnv, DEFAULT_API_KEY_ENV, 'an unnamed reference falls back to the policy default')
  for (const field of SPEECH_FIELDS) {
    if (field === 'apiKeyEnv') continue
    assert.equal(view[field], null, `an unsaved ${field} reads as unset`)
  }
  assert.equal(view.available, false, 'a context without the credential seam cannot resolve a reference')
  assert.deepEqual(view.credential, { ref: DEFAULT_API_KEY_ENV, configured: false, writable: false })
})

test('the ASR view projects every policy field from the saved row', async () => {
  const saved = {
    model: 'FunAudioLLM/SenseVoiceSmall',
    endpoint: 'https://asr.example/v1/transcriptions',
    apiKeyEnv: 'ASR_KEY',
    ...Object.fromEntries(SPEECH_LIMIT_FIELDS.map((field, index) => [field, index + 1])),
  }
  const { service } = asrHarness({ row: saved })
  const view = await service.asrView()
  assert.deepEqual(
    Object.fromEntries(SPEECH_FIELDS.map(field => [field, view[field]])),
    saved,
    'every saved policy field must reach the view unchanged',
  )
})

test('the ASR save accepts the policy boundary and records only the submitted fields', async () => {
  const { service, updates } = asrHarness({ row: {} })
  const endpoint = 'http://127.0.0.1:8123/transcribe'
  const reference = 'VOICE_KEY_2'
  // The premises are the policy's, not this test's: a value it refuses would
  // make the acceptance case prove the wrong thing.
  assert.ok(SPEECH_ENDPOINT_PATTERN.test(endpoint))
  assert.ok(SPEECH_ENV_NAME_PATTERN.test(reference))
  const body = {
    model: 'FunAudioLLM/SenseVoiceSmall',
    endpoint,
    apiKeyEnv: reference,
    ...Object.fromEntries(SPEECH_LIMIT_FIELDS.map(field => [field, 1])),
  }

  const result = await service.saveAsr(body)
  assert.deepEqual(updates, [{ ns: 'speech', fields: body }],
    'the save must write the submitted fields to the speech row and no others')
  for (const field of SPEECH_FIELDS) {
    assert.equal(result.asr[field], body[field], `the echoed view must report the saved ${field}`)
  }
  assert.equal(result.asr.available, false, 'the echo reports availability from the credential seam, not from the save')
})

test('the ASR save refuses the values the policy refuses, keeping the wire code and text', async () => {
  const { service, updates } = asrHarness({ row: {} })
  const base = { model: 'FunAudioLLM/SenseVoiceSmall', endpoint: 'https://asr.example/v1' }
  const refused = async (body, message) => {
    await assert.rejects(service.saveAsr(body), error => {
      assert.ok(error instanceof GatewayError, `expected a GatewayError; got ${error}`)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'gateway/invalid-asr', 'the client contract names this code')
      assert.equal(error.message, message, 'the client contract keeps this text')
      return true
    })
  }

  for (const field of SPEECH_LIMIT_FIELDS) {
    assert.equal(isPositiveInteger(0), false, 'the premise: the policy refuses 0')
    await refused({ ...base, [field]: 0 }, `${field} must be a positive integer`)
  }
  const endpointWithoutHost = 'https://'
  assert.equal(SPEECH_ENDPOINT_PATTERN.test(endpointWithoutHost), false, 'the premise: the policy refuses a bare scheme')
  await refused({ ...base, endpoint: endpointWithoutHost }, 'endpoint must be an http(s) URL')
  const numericReference = '1VOICE'
  assert.equal(SPEECH_ENV_NAME_PATTERN.test(numericReference), false, 'the premise: the policy refuses a leading digit')
  await refused({ ...base, apiKeyEnv: numericReference }, 'apiKeyEnv must be an environment-variable name')

  assert.deepEqual(updates, [], 'a refused save must write nothing')
})
