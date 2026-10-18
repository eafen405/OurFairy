/**
 * The Phaethon-only shared-configuration gateway.
 *
 * It exposes the smallest set of operations the product decision assigns to the
 * phone entry: read the shared model selection, provider routes and ASR
 * connection, and write them through the native dsh profile settings. Secret
 * values never cross this module: provider routes carry a credential *reference*
 * that the native credential seam resolves per request, and the gateway reports
 * only whether that reference is configured.
 *
 * @module @ourfairy/dsh-gateway/src/service
 */
import { Service } from '@deepseek-ai/cordis'


/** One refusal with the HTTP status and product error code the route answers with. */
export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.code = code
  }
}

/** A provider route key is the same grammar the credential seam uses for its id half. */
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/

/** Fields a shared model entry may declare. */
const MODEL_FIELDS = new Set(['id', 'name', 'contextWindow', 'maxTokens', 'input'])

/** Input modalities this product declares; the adapter still owns the endpoint's truth. */
const MODALITIES = new Set(['text', 'image'])

/** Draft fields outside `models` reshape every model on the route. */
const ROUTE_WIDE_FIELDS = ['api', 'baseURL', 'apiKeyEnv']

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function invalid(message) {
  return new GatewayError(400, 'gateway/invalid-route', message)
}

/** Reject keys the gateway does not own before any profile reaches the settings layer. */
function onlyFields(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw invalid(`${label} does not accept field "${key}"`)
  }
}

/** Validate one model entry; unknown fields are refused rather than silently dropped. */
function modelEntry(entry, index) {
  if (!isPlainObject(entry)) throw invalid(`models[${index}] must be an object`)
  onlyFields(entry, MODEL_FIELDS, `models[${index}]`)
  if (typeof entry.id !== 'string' || entry.id.trim() === '') throw invalid(`models[${index}].id must be a non-empty string`)
  if (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.trim() === '')) throw invalid(`models[${index}].name must be a non-empty string`)
  for (const field of ['contextWindow', 'maxTokens']) {
    if (entry[field] !== undefined && (!Number.isSafeInteger(entry[field]) || entry[field] < 1)) {
      throw invalid(`models[${index}].${field} must be a positive integer`)
    }
  }
  if (entry.input !== undefined) {
    if (!Array.isArray(entry.input) || entry.input.length === 0) throw invalid(`models[${index}].input must be a non-empty array`)
    for (const modality of entry.input) {
      if (!MODALITIES.has(modality)) throw invalid(`models[${index}].input does not know modality "${String(modality)}"`)
    }
  }
  return { ...entry }
}

/** The fields one route draft may set; the same list read returns. */
const DRAFT_FIELDS = new Set(['provider', 'displayName', 'api', 'baseURL', 'apiKeyEnv', 'models'])

/** Validate one flat route draft and return the provider profile the settings row stores. */
function routeDraft(input) {
  if (!isPlainObject(input)) throw invalid('the route must be an object')
  onlyFields(input, DRAFT_FIELDS, 'the route')
  const profile = {}
  for (const field of ['displayName', 'api', 'baseURL', 'apiKeyEnv']) {
    if (input[field] === undefined) continue
    if (typeof input[field] !== 'string' || input[field].trim() === '') throw invalid(`${field} must be a non-empty string`)
    profile[field] = input[field]
  }
  if (profile.baseURL !== undefined && !/^https?:\/\/[^\s]+$/u.test(profile.baseURL)) {
    throw invalid('baseURL must be an http(s) URL')
  }
  if (input.models !== undefined) {
    if (!Array.isArray(input.models) || input.models.length === 0) throw invalid('models must be a non-empty array')
    profile.models = input.models.map(modelEntry)
  }
  return profile
}

/**
 * Which models of one route an edit changes. `null` means the whole route, the
 * shape used for endpoint/protocol changes and deletions. A model-only edit
 * names exactly the models whose definition differs, so an unrelated running
 * reply does not block it.
 */
export function affectedModels(previous, next) {
  if (previous === undefined || next === undefined) return null
  // The stored row carries adapter defaults the draft never sets, so compare
  // only the fields a draft owns; otherwise every edit would look route-wide.
  for (const field of ROUTE_WIDE_FIELDS) {
    if (previous[field] !== next[field]) return null
  }
  const project = model => JSON.stringify(Object.fromEntries(Object.entries(model).filter(([key]) => MODEL_FIELDS.has(key))))
  const changed = new Set()
  const before = new Map((previous.models ?? []).map(model => [model.id, model]))
  const after = new Map((next.models ?? []).map(model => [model.id, model]))
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (project(before.get(id) ?? {}) !== project(after.get(id) ?? {})) changed.add(id)
  }
  return changed
}

/**
 * Carry the deployment-owned model fields (thinking capability, wire compat)
 * from the stored profile onto a draft that no longer names them: the phone
 * edits ids, labels, windows and modalities, and saving must not silently strip
 * the thinking configuration the bundle declared.
 */
function keepDeploymentFields(previous, draft) {
  if (previous === undefined || !Array.isArray(draft.models)) return draft
  const before = new Map((previous.models ?? []).map(model => [model.id, model]))
  return {
    ...draft,
    models: draft.models.map(model => {
      const prior = before.get(model.id)
      if (prior === undefined) return model
      return {
        ...model,
        ...prior.reasoningEfforts === undefined ? {} : { reasoningEfforts: prior.reasoningEfforts },
        ...prior.compat === undefined ? {} : { compat: prior.compat },
      }
    }),
  }
}

/** The shared-configuration gateway service the composition reads as `ourfairyGateway`. */
export class GatewayService extends Service {
  constructor(ctx) {
    super(ctx, 'ourfairyGateway')
  }

  /** The native settings service, or a named refusal when the profile cannot be edited. */
  settings() {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new GatewayError(503, 'gateway/configuration-unavailable',
        'this deployment mounts no configuration editor; shared configuration cannot be read or saved here')
    }
    return settings
  }

  rows() {
    return this.settings().describe()
  }

  row(namespace) {
    return this.rows().find(row => row.ns === namespace)
  }

  /** The caller must be the administrator; the identity store is the authority for that flag. */
  requireAdmin(caller) {
    if (caller === undefined) throw new GatewayError(401, 'gateway/unauthorized', 'present a live session credential')
    if (caller.isAdmin !== true) throw new GatewayError(403, 'gateway/forbidden', 'only Phaethon manages the shared configuration')
  }

  /** Map a settings/validation failure to a client-actionable refusal without hiding its message. */
  async edit(work) {
    try {
      return await work()
    } catch (error) {
      if (error instanceof GatewayError) throw error
      throw new GatewayError(400, 'gateway/invalid-config', error?.message ?? String(error))
    }
  }

  /** Presence facts for one credential reference; the value never leaves the backend. */
  async credential(ref) {
    if (typeof ref !== 'string' || ref === '') return null
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return { ref, configured: false, writable: false }
    try {
      const info = await credentials.describe(ref)
      return { ref, configured: info.configured === true, writable: info.writable === true,
        ...(info.source === undefined ? {} : { source: info.source }) }
    } catch (error) {
      return { ref, configured: false, writable: false, error: error?.message ?? String(error) }
    }
  }

  /** The resolved provider dictionary; never the raw expression nodes. */
  providers() {
    return structuredClone(this.row('llm-pi-ai')?.value?.providers ?? {})
  }

  providerProfile(provider) {
    return this.providers()[provider]
  }

  routeProfile(provider) {
    const directory = this.ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)
    const editable = directory?.settingsNs === 'llm-pi-ai'
    return { editable, declared: directory?.declared === true }
  }

  async modelList(provider, profile, selection) {
    // A configured route answers with its own declaration, so the page edits
    // exactly what it will store. An adapter-owned route answers from the
    // adapter's live catalog.
    if (Array.isArray(profile?.models)) {
      return profile.models.map(model => ({ id: model.id, name: model.name ?? model.id,
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        ...(model.input === undefined ? {} : { input: [...model.input] }) }))
    }
    let models = []
    try { models = await this.ctx.llm.listModels(provider) } catch { models = [] }
    if (models.length === 0 && selection.provider === provider) models = [{ id: selection.model, name: selection.model }]
    return models.map(model => ({ id: model.id, name: model.name ?? model.id,
      ...(model.inputModalities === undefined ? {} : { input: [...model.inputModalities] }) }))
  }

  async routeView(provider, displayName, profile, editable, selection, inUse) {
    const { declared } = this.routeProfile(provider)
    const officialRef = provider === 'deepseek-official' ? this.row('llm-deepseek-api-key')?.value?.apiKeyEnv : undefined
    const configured = editable ? profile : undefined
    return {
      provider,
      displayName: configured?.displayName ?? displayName ?? provider,
      editable,
      declared: declared || configured !== undefined,
      ...(configured?.api === undefined ? {} : { api: configured.api }),
      ...(configured?.baseURL === undefined ? {} : { baseURL: configured.baseURL }),
      ...(configured?.apiKeyEnv === undefined ? {} : { apiKeyEnv: configured.apiKeyEnv }),
      models: await this.modelList(provider, configured, selection),
      credential: await this.credential(configured?.apiKeyEnv ?? officialRef),
      inUse: inUse.some(reply => reply.provider === provider),
    }
  }

  async asrView() {
    const row = this.row('speech')
    const value = row?.value ?? {}
    const ref = value.apiKeyEnv ?? 'VOICE_API_KEY'
    const credential = await this.credential(ref)
    // The speech route answers "available" from the resolved value, so the
    // gateway must ask the same seam the same way rather than describing a
    // second fact.
    const credentials = this.ctx.get('credentials')
    const resolved = credentials === undefined ? undefined : await credentials.resolve(ref).catch(() => undefined)
    return {
      editable: row !== undefined,
      model: value.model ?? null,
      endpoint: value.endpoint ?? null,
      apiKeyEnv: ref,
      maxDurationMs: value.maxDurationMs ?? null,
      maxAudioBytes: value.maxAudioBytes ?? null,
      timeoutMs: value.timeoutMs ?? null,
      maxGlobalInFlight: value.maxGlobalInFlight ?? null,
      maxUserInFlight: value.maxUserInFlight ?? null,
      available: resolved?.value?.trim() !== undefined && resolved.value.trim() !== '',
      credential,
    }
  }

  /** Read the shared configuration, live usage and the editability facts behind them. */
  async read() {
    // A deployment without the editor answers 503 from settings(); reaching here
    // means the editor is mounted, so only per-row presence can differ.
    const capability = { selection: this.row('agent-default-model') !== undefined,
      routes: this.row('llm-pi-ai') !== undefined, asr: this.row('speech') !== undefined }
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const inUse = this.ctx.ourfairyChat.activeReplies()
    const profiles = this.row('llm-pi-ai')?.value?.providers ?? {}
    const registered = new Map(this.ctx.llm.listProviders().map(provider => [provider.id, provider]))
    const routes = []
    for (const [provider, entry] of registered) {
      const profile = this.providerProfile(provider)
      const editable = this.routeProfile(provider).editable
      routes.push(await this.routeView(provider, entry.name, editable ? profile : undefined, editable, selection, inUse))
    }
    for (const [provider, profile] of Object.entries(profiles)) {
      if (registered.has(provider)) continue
      routes.push(await this.routeView(provider, profile.displayName, profile, true, selection, inUse))
    }
    const routesRow = this.row('llm-pi-ai')
    const selectionRow = this.row('agent-default-model')
    const asrRow = this.row('speech')
    return {
      gateway: {
      selection,
      selectionApplies: 'next-turn',
      routes,
      asr: await this.asrView(),
      inUse,
      editable: capability,
      saved: {
        selection: Object.keys(selectionRow?.user ?? {}).length > 0,
        routes: Object.keys(routesRow?.user?.providers ?? {}).length > 0,
        asr: Object.keys(asrRow?.user ?? {}).length > 0,
      },
      },
    }
  }

  /** Save the shared selection. It applies from each conversation's next reply, never to a running one. */
  async saveSelection(body) {
    const { provider, model, reasoningEffort } = body ?? {}
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      throw new GatewayError(400, 'gateway/invalid-selection', 'provider and model must both be non-empty strings')
    }
    if (!this.ctx.llm.listProviders().some(entry => entry.id === provider)) {
      throw new GatewayError(400, 'gateway/invalid-selection', `provider "${provider}" is not registered`)
    }
    try { await this.ctx.llm.resolveModelInfo(provider, model) } catch (error) {
      throw new GatewayError(400, 'gateway/invalid-selection', error?.message ?? String(error))
    }
    // A route that advertises a catalog answers membership itself; the adapter
    // would otherwise accept any id and silently invent capacities for it.
    const advertised = await this.ctx.llm.listModels(provider)
    if (advertised.length > 0 && !advertised.some(entry => entry.id === model)) {
      throw new GatewayError(400, 'gateway/invalid-selection',
        `model "${model}" is not one of provider "${provider}"'s models (${advertised.map(entry => entry.id).join(', ')})`)
    }
    if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || reasoningEffort === '')) {
      throw new GatewayError(400, 'gateway/invalid-selection', 'reasoningEffort must be a non-empty string when present')
    }
    await this.edit(() => this.settings().mutate('agent-default-model', [
      { op: 'set', path: ['provider'], value: provider },
      { op: 'set', path: ['model'], value: model },
      reasoningEffort === undefined ? { op: 'unset', path: ['reasoningEffort'] } : { op: 'set', path: ['reasoningEffort'], value: reasoningEffort },
    ]))
    return { selection: this.ctx.agentDefaultModel.currentSelection(), applies: 'next-turn' }
  }

  /** Refuse a change the replies below are still running against. */
  async guard(provider, affected, work) {
    const refusal = replies => {
      const hits = replies.filter(reply => reply.provider === provider && (affected === null || affected.has(reply.model)))
      if (hits.length === 0) return undefined
      return new GatewayError(409, 'chat/route-in-use',
        `provider route "${provider}" is still used by ${hits.length} running repl${hits.length === 1 ? 'y' : 'ies'}`
        + ` (${hits.map(reply => `${reply.sessionId}:${reply.model}`).join(', ')}); retry after it ends`)
    }
    return this.ctx.ourfairyChat.withReplyGuard(refusal, work)
  }

  /** Add or replace one provider route and return its new view. */
  async saveRoute(body) {
    const provider = body?.provider
    if (typeof provider !== 'string' || !PROVIDER_ID.test(provider)) {
      throw new GatewayError(400, 'gateway/invalid-route', 'provider must be a lowercase hyphenated identifier')
    }
    const directory = this.ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)
    if (directory !== undefined && directory.settingsNs !== 'llm-pi-ai') {
      throw new GatewayError(400, 'gateway/invalid-route', `provider "${provider}" is owned by another adapter and is not editable here`)
    }
    const previous = this.providerProfile(provider)
    const profile = keepDeploymentFields(previous, routeDraft(body))
    const affected = affectedModels(previous, profile)
    await this.guard(provider, affected, () => this.edit(() =>
      // The whole dictionary is written from the resolved values: a field path
      // write would merge into the raw row, which still holds the bundle's
      // environment expressions, and those must never reach the profile.
      this.settings().mutate('llm-pi-ai', [{
        op: 'set', path: ['providers'], value: { ...this.providers(), [provider]: profile },
      }])))
    const selection = this.ctx.agentDefaultModel.currentSelection()
    return { route: await this.routeView(provider, profile.displayName, profile, true, selection, this.ctx.ourfairyChat.activeReplies()) }
  }

  /** Remove one provider route; the route the shared selection names cannot be removed. */
  async deleteRoute(body) {
    const provider = body?.provider
    if (typeof provider !== 'string' || provider === '') throw new GatewayError(400, 'gateway/invalid-route', 'name the provider route to remove')
    if (this.providerProfile(provider) === undefined) {
      throw new GatewayError(404, 'gateway/unknown-route', `no editable provider route "${provider}" is configured`)
    }
    if (this.ctx.agentDefaultModel.currentSelection().provider === provider) {
      throw new GatewayError(409, 'gateway/route-selected',
        `provider route "${provider}" carries the shared model selection; select another route first`)
    }
    await this.guard(provider, null, () => this.edit(() => {
      const providers = this.providers()
      delete providers[provider]
      return this.settings().mutate('llm-pi-ai', [{ op: 'set', path: ['providers'], value: providers }])
    }))
    return { provider }
  }

  /** Save the ASR connection. A transcription already running keeps its request. */
  async saveAsr(body) {
    const input = body ?? {}
    const model = input.model
    const endpoint = input.endpoint
    if (typeof model !== 'string' || model.trim() === '') throw new GatewayError(400, 'gateway/invalid-asr', 'model must be a non-empty string')
    if (typeof endpoint !== 'string' || !/^https?:\/\/[^\s]+$/u.test(endpoint)) {
      throw new GatewayError(400, 'gateway/invalid-asr', 'endpoint must be an http(s) URL')
    }
    const fields = { model, endpoint }
    for (const field of ['maxDurationMs', 'maxAudioBytes', 'timeoutMs', 'maxGlobalInFlight', 'maxUserInFlight']) {
      if (input[field] === undefined) continue
      if (!Number.isSafeInteger(input[field]) || input[field] < 1) {
        throw new GatewayError(400, 'gateway/invalid-asr', `${field} must be a positive integer`)
      }
      fields[field] = input[field]
    }
    if (input.apiKeyEnv !== undefined) {
      if (typeof input.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(input.apiKeyEnv)) {
        throw new GatewayError(400, 'gateway/invalid-asr', 'apiKeyEnv must be an environment-variable name')
      }
      fields.apiKeyEnv = input.apiKeyEnv
    }
    await this.edit(() => this.settings().update('speech', fields))
    return { asr: await this.asrView() }
  }
}
