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
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before the native
// modules below are loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'

const { Context } = await import('@deepseek-ai/cordis')
const { GatewayError, GatewayService, loadNativeModalities } = await import('../backend/gateway/dist/service.js')

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
