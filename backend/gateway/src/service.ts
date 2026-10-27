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
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { IdentityService } from '@ourfairy/dsh-identity'
// The dsh context's own seams and the product's own context rows: the model
// registry, the shared model selection, the credential seam, the settings
// service and the chat row's reply view. The imports are type-only, so they add
// no runtime dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@ourfairy/dsh-chat'
import type {} from '@ourfairy/dsh-identity'

/**
 * The native catalog owns the modality vocabulary. Importing the runtime value
 * instead of keeping a local set means an upstream modality is accepted here
 * without a product edit.
 *
 * There is deliberately no fallback list. The load is a separate function so a
 * test can exercise the failure without a full boot: it names both the module
 * specifier and the peer whose absence caused it.
 */
const NATIVE_CATALOG_MODULE = '@deepseek-ai/dsh-llm-pi-ai/src/catalog.ts'

/**
 * Load the native modality list from the catalog module.
 * @param specifier - the catalog module specifier to import.
 * @returns the native modality list.
 */
export async function loadNativeModalities(specifier: string = NATIVE_CATALOG_MODULE): Promise<string[]> {
  try {
    const { MODALITIES } = await import(specifier) as { MODALITIES?: unknown }
    if (!Array.isArray(MODALITIES) || MODALITIES.length === 0) {
      throw new Error(`"${specifier}" exports no MODALITIES list`)
    }
    return MODALITIES as string[]
  } catch (error) {
    const peer = specifier.split('/').slice(0, 2).join('/')
    throw new Error(`cannot load the native input modality list from "${specifier}";`
      + ` install the ${peer} peer at the pinned dsh version (${(error as Error | undefined)?.message ?? String(error)})`,
    { cause: error })
  }
}

// The import is caught so the failure can be thrown from the service
// constructor: a module-scope throw is reported by the loader only as "failed
// to import", while a construction failure carries this message into the boot
// diagnostic.
let MODALITIES: string[] | undefined
let catalogFailure: unknown
try {
  MODALITIES = await loadNativeModalities()
} catch (error) {
  catalogFailure = error
}


/** One refusal with the HTTP status and product error code the route answers with. */
export class GatewayError extends Error {
  declare readonly status: number
  declare readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.code = code
  }
}

/** A provider route key is the same grammar the credential seam uses for its id half. */
const PROVIDER_ID = /^[a-z][a-z0-9-]*$/

/**
 * Model fields the phone may edit. This is the one authority for the allowlist:
 * the route validator, the change projection and the previous-entry overlay all
 * read it, and the test that derives the deployment-owned fields imports it.
 */
export const PHONE_EDITABLE_MODEL_FIELDS = new Set(['id', 'name', 'contextWindow', 'maxTokens', 'input'])

/** Draft fields outside `models` reshape every model on the route. */
const ROUTE_WIDE_FIELDS = ['api', 'baseURL', 'apiKeyEnv'] as const

/**
 * The automatic-compaction threshold's owning row and product policy range.
 *
 * The row is the native `compaction-basic` entry the shipped bundle mounts; its
 * `thresholdTokens` field is volatile, so a save applies to the next pressure
 * check without remounting the row. The range is the product decision from
 * `docs/specs/fairy-memory.md` §6, enforced here because the native row only
 * declares a positive integer.
 */
const COMPACTION_ROW = 'compaction-basic'
const COMPACTION_FIELD = 'thresholdTokens'
const COMPACTION_MIN_TOKENS = 100_000
const COMPACTION_MAX_TOKENS = 900_000
const COMPACTION_DEFAULT_TOKENS = 500_000

/**
 * The memory row's two maintenance numbers and their product policy range.
 *
 * The `memory` row is the one the shipped bundle mounts; `maintenanceTurns` and
 * `maintenanceDecayHours` are volatile fields, so a save applies to the next
 * maintenance evaluation without remounting the engine. The ranges are the
 * product decision from `docs/specs/fairy-memory.md` §5/§6, enforced here
 * because the row's own schema is the same bound but the wire contract names
 * the error code and spelling the phone sees.
 *
 * The gateway view names them `triggerTurns` and `decayHours`; the profile keeps
 * the row's own field names.
 */
const MAINTENANCE_ROW = 'memory'
const MAINTENANCE_TURNS_FIELD = 'maintenanceTurns'
const MAINTENANCE_DECAY_FIELD = 'maintenanceDecayHours'
const MAINTENANCE_MIN_TURNS = 5
const MAINTENANCE_MAX_TURNS = 50
const MAINTENANCE_MIN_DECAY_HOURS = 3
const MAINTENANCE_MAX_DECAY_HOURS = 24
const MAINTENANCE_DEFAULT_TURNS = 15
const MAINTENANCE_DEFAULT_DECAY_HOURS = 6

/**
 * One model entry of a provider route, as the settings row and the phone draft
 * carry it.
 *
 * The stored row carries adapter defaults the draft never sets, so the entry
 * keeps an open shape: the gateway reads and writes the phone-editable fields
 * and leaves every other field the deployment declared alone.
 */
interface RouteModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: readonly string[]
  [field: string]: unknown
}

/** One provider route profile, as the `llm-pi-ai` settings row carries it. */
interface RouteProfile {
  displayName?: string
  api?: string
  baseURL?: string
  apiKeyEnv?: string
  models?: RouteModel[]
}

/**
 * The value of one settings row, as the gateway reads it.
 *
 * The native row's value column is opaque JSON; the gateway reads the
 * deployment-owned fields out of it, so this view type is the gateway's own
 * reading of that column. Every field is optional: a row carries only the
 * fields its own namespace declares.
 */
interface GatewayRowValue {
  providers?: Record<string, RouteProfile>
  apiKeyEnv?: string
  model?: string
  endpoint?: string
  reasoningEffort?: string
  maxDurationMs?: number
  maxAudioBytes?: number
  timeoutMs?: number
  maxGlobalInFlight?: number
  maxUserInFlight?: number
  thresholdTokens?: number
  maintenanceTurns?: number
  maintenanceDecayHours?: number
  [field: string]: unknown
}

/** One settings row, as the gateway reads it. */
interface GatewayRow {
  readonly ns: string
  readonly value?: GatewayRowValue
  readonly base?: GatewayRowValue
  readonly user?: GatewayRowValue
}

/** Presence facts for one credential reference; the value never leaves the backend. */
interface CredentialFacts {
  readonly ref: unknown
  readonly configured: boolean
  readonly writable: boolean
  readonly source?: string
  readonly error?: string
}

/** One running reply, as the chat row reports it. */
interface ActiveReply {
  readonly sessionId: SessionId
  readonly provider: string
  readonly model: string
}

/**
 * Whether one value is a plain object.
 *
 * The check is the prototype test itself; it is written as a type guard so the
 * value that passes it can be read field by field.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function invalid(message: string): GatewayError {
  return new GatewayError(400, 'gateway/invalid-route', message)
}

/** Reject keys the gateway does not own before any profile reaches the settings layer. */
function onlyFields(object: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw invalid(`${label} does not accept field "${key}"`)
  }
}

/**
 * Whether one value is a safe integer.
 *
 * `Number.isSafeInteger` is the check itself; it is written as a type guard so
 * the value that passes it can be used as a number.
 */
function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

/** Validate one model entry; unknown fields are refused rather than silently dropped. */
function modelEntry(entry: unknown, index: number): RouteModel {
  if (!isPlainObject(entry)) throw invalid(`models[${index}] must be an object`)
  onlyFields(entry, PHONE_EDITABLE_MODEL_FIELDS, `models[${index}]`)
  if (typeof entry.id !== 'string' || entry.id.trim() === '') throw invalid(`models[${index}].id must be a non-empty string`)
  if (entry.name !== undefined && (typeof entry.name !== 'string' || entry.name.trim() === '')) throw invalid(`models[${index}].name must be a non-empty string`)
  for (const field of ['contextWindow', 'maxTokens'] as const) {
    if (entry[field] !== undefined && (!isSafeInteger(entry[field]) || entry[field] < 1)) {
      throw invalid(`models[${index}].${field} must be a positive integer`)
    }
  }
  if (entry.input !== undefined) {
    if (!Array.isArray(entry.input) || entry.input.length === 0) throw invalid(`models[${index}].input must be a non-empty array`)
    for (const modality of entry.input) {
      // The service constructor refuses a deployment whose native catalog did
      // not load, so the modality list is there.
      if (!MODALITIES!.includes(modality)) throw invalid(`models[${index}].input does not know modality "${String(modality)}"`)
    }
  }
  return { ...entry } as RouteModel
}

/** The fields one route draft may set; the same list read returns. */
const DRAFT_FIELDS = new Set(['provider', 'displayName', 'api', 'baseURL', 'apiKeyEnv', 'models'])

/** Validate one flat route draft and return the provider profile the settings row stores. */
function routeDraft(input: unknown): RouteProfile {
  if (!isPlainObject(input)) throw invalid('the route must be an object')
  onlyFields(input, DRAFT_FIELDS, 'the route')
  const profile: RouteProfile = {}
  for (const field of ['displayName', 'api', 'baseURL', 'apiKeyEnv'] as const) {
    if (input[field] === undefined) continue
    if (typeof input[field] !== 'string' || input[field].trim() === '') throw invalid(`${field} must be a non-empty string`)
    profile[field] = input[field] as string
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
export function affectedModels(previous: RouteProfile | undefined, next: RouteProfile | undefined): Set<string> | null {
  if (previous === undefined || next === undefined) return null
  // The stored row carries adapter defaults the draft never sets, so compare
  // only the fields a draft owns; otherwise every edit would look route-wide.
  for (const field of ROUTE_WIDE_FIELDS) {
    if (previous[field] !== next[field]) return null
  }
  const project = (model: Record<string, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(model).filter(([key]) => PHONE_EDITABLE_MODEL_FIELDS.has(key))))
  const changed = new Set<string>()
  const before = new Map((previous.models ?? []).map(model => [model.id, model] as const))
  const after = new Map((next.models ?? []).map(model => [model.id, model] as const))
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (project(before.get(id) ?? {}) !== project(after.get(id) ?? {})) changed.add(id)
  }
  return changed
}

/**
 * Overlay the phone-editable fields of a draft model onto the previous entry of
 * the same id. Every other field the previous entry carries — thinking
 * capability, wire compat, and any field upstream adds later — stays as the
 * deployment declared it, so a save cannot silently drop a field the phone has
 * no way to send. A draft that omits an editable field clears it, matching the
 * phone's "blank means unset" drafts; a model id with no previous entry is
 * stored exactly as the draft declares it.
 */
function overlayPhoneEditableModelFields(previous: RouteProfile | undefined, draft: RouteProfile): RouteProfile {
  if (previous === undefined || !Array.isArray(draft.models)) return draft
  const before = new Map((previous.models ?? []).map(model => [model.id, model] as const))
  return {
    ...draft,
    models: draft.models.map(model => {
      const prior = before.get(model.id)
      if (prior === undefined) return model
      const merged: RouteModel = { ...prior }
      for (const field of PHONE_EDITABLE_MODEL_FIELDS) {
        if (model[field] === undefined) delete merged[field]
        else merged[field] = model[field]
      }
      return merged
    }),
  }
}

/** The shared-configuration gateway service the composition reads as `ourfairyGateway`. */
export class GatewayService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'ourfairyGateway')
    if (catalogFailure !== undefined) throw catalogFailure
  }

  /** The native settings service; refuses when this deployment mounts no configuration editor. */
  requireConfigurationEditor(): SettingsForms {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new GatewayError(503, 'gateway/configuration-unavailable',
        'this deployment mounts no configuration editor; shared configuration cannot be read or saved here')
    }
    return settings
  }

  rows(): SettingsForms['describe'] extends () => infer R ? R : never {
    return this.requireConfigurationEditor().describe()
  }

  row(namespace: string): GatewayRow | undefined {
    // The native row's columns are opaque JSON; the gateway reads the
    // deployment-owned fields out of them, so the row is read at this boundary.
    return this.rows().find(row => row.ns === namespace) as unknown as GatewayRow | undefined
  }

  /** The caller must be the administrator; the identity store is the authority for that flag. */
  requireAdmin(caller: ReturnType<IdentityService['authenticateRequest']>): void {
    if (caller === undefined) throw new GatewayError(401, 'gateway/unauthorized', 'present a live session credential')
    if (caller.isAdmin !== true) throw new GatewayError(403, 'gateway/forbidden', 'only Phaethon manages the shared configuration')
  }

  /** Map a settings/validation failure to a client-actionable refusal without hiding its message. */
  async edit(work: () => Promise<unknown>): Promise<unknown> {
    try {
      return await work()
    } catch (error) {
      if (error instanceof GatewayError) throw error
      throw new GatewayError(400, 'gateway/invalid-config', (error as Error | undefined)?.message ?? String(error))
    }
  }

  /** Presence facts for one credential reference; the value never leaves the backend. */
  async credential(ref: unknown): Promise<CredentialFacts | null> {
    if (typeof ref !== 'string' || ref === '') return null
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return { ref, configured: false, writable: false }
    try {
      const info = await credentials.describe(ref as CredentialRef)
      return { ref, configured: info.configured === true, writable: info.writable === true,
        ...(info.source === undefined ? {} : { source: info.source }) }
    } catch (error) {
      return { ref, configured: false, writable: false, error: (error as Error | undefined)?.message ?? String(error) }
    }
  }

  /** The resolved provider dictionary; never the raw expression nodes. */
  providers(): Record<string, RouteProfile> {
    return structuredClone(this.row('llm-pi-ai')?.value?.providers ?? {}) as Record<string, RouteProfile>
  }

  providerProfile(provider: string): RouteProfile | undefined {
    return this.providers()[provider]
  }

  routeProfile(provider: string): { editable: boolean; declared: boolean } {
    const directory = this.ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)
    const editable = directory?.settingsNs === 'llm-pi-ai'
    return { editable, declared: directory?.declared === true }
  }

  async modelList(provider: string, profile: RouteProfile | undefined, selection: ModelSelection) {
    // A configured route answers with its own declaration, so the page edits
    // exactly what it will store. An adapter-owned route answers from the
    // adapter's live catalog.
    if (Array.isArray(profile?.models)) {
      return profile.models.map(model => ({ id: model.id, name: model.name ?? model.id,
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        ...(model.input === undefined ? {} : { input: [...model.input] }) }))
    }
    let models: { id: string; name: string; inputModalities?: readonly string[] }[] = []
    try { models = await this.ctx.llm.listModels(provider) } catch { models = [] }
    if (models.length === 0 && selection.provider === provider) models = [{ id: selection.model, name: selection.model }]
    return models.map(model => ({ id: model.id, name: model.name ?? model.id,
      ...(model.inputModalities === undefined ? {} : { input: [...model.inputModalities] }) }))
  }

  async routeView(provider: string, displayName: string | undefined, profile: RouteProfile | undefined, editable: boolean, selection: ModelSelection, inUse: ActiveReply[]) {
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
    const resolved = credentials === undefined ? undefined : await credentials.resolve(ref as CredentialRef).catch(() => undefined)
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

  /** The live automatic-compaction threshold the native pressure check reads. */
  compactionView() {
    const value = this.row(COMPACTION_ROW)?.value?.[COMPACTION_FIELD]
    return { [COMPACTION_FIELD]: isSafeInteger(value) ? value : COMPACTION_DEFAULT_TOKENS }
  }

  /** The live maintenance numbers the next maintenance evaluation reads. */
  maintenanceView() {
    const value = this.row(MAINTENANCE_ROW)?.value
    const turns = value?.[MAINTENANCE_TURNS_FIELD]
    const decayHours = value?.[MAINTENANCE_DECAY_FIELD]
    return {
      triggerTurns: isSafeInteger(turns) ? turns : MAINTENANCE_DEFAULT_TURNS,
      decayHours: isSafeInteger(decayHours) ? decayHours : MAINTENANCE_DEFAULT_DECAY_HOURS,
    }
  }

  /** Read the shared configuration, live usage and the editability facts behind them. */
  async read() {
    // A deployment without the editor answers 503 from requireConfigurationEditor(); reaching here
    // means the editor is mounted, so only per-row presence can differ.
    const capability = { selection: this.row('agent-default-model') !== undefined,
      routes: this.row('llm-pi-ai') !== undefined, asr: this.row('speech') !== undefined,
      compaction: this.row(COMPACTION_ROW) !== undefined,
      maintenance: this.row(MAINTENANCE_ROW) !== undefined }
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const inUse = this.ctx.ourfairyChat.activeReplies()
    const profiles = this.row('llm-pi-ai')?.value?.providers ?? {}
    const registered = new Map(this.ctx.llm.listProviders().map(provider => [provider.id, provider] as const))
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
    const compactionRow = this.row(COMPACTION_ROW)
    const maintenanceRow = this.row(MAINTENANCE_ROW)
    return {
      gateway: {
      selection,
      selectionApplies: 'next-turn',
      routes,
      asr: await this.asrView(),
      compaction: this.compactionView(),
      maintenance: this.maintenanceView(),
      inUse,
      editable: capability,
      saved: {
        selection: Object.keys(selectionRow?.user ?? {}).length > 0,
        routes: Object.keys(routesRow?.user?.providers ?? {}).length > 0,
        asr: Object.keys(asrRow?.user ?? {}).length > 0,
        compaction: isSafeInteger(compactionRow?.user?.[COMPACTION_FIELD]),
        maintenance: isSafeInteger(maintenanceRow?.user?.[MAINTENANCE_TURNS_FIELD])
          || isSafeInteger(maintenanceRow?.user?.[MAINTENANCE_DECAY_FIELD]),
      },
      },
    }
  }

  /** Save the shared selection. It applies from each conversation's next reply, never to a running one. */
  async saveSelection(body: Record<string, unknown>) {
    const { provider, model, reasoningEffort } = body ?? ({} as Record<string, unknown>)
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      throw new GatewayError(400, 'gateway/invalid-selection', 'provider and model must both be non-empty strings')
    }
    if (!this.ctx.llm.listProviders().some(entry => entry.id === provider)) {
      throw new GatewayError(400, 'gateway/invalid-selection', `provider "${provider}" is not registered`)
    }
    try { await this.ctx.llm.resolveModelInfo(provider, model) } catch (error) {
      throw new GatewayError(400, 'gateway/invalid-selection', (error as Error | undefined)?.message ?? String(error))
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
    // The native entry serializes saves in submission order and keeps the
    // composition entry when no configuration editor is mounted. That silent
    // no-op must not become a successful save here: the settings service itself
    // injects configEditor, so its absence is the editor's absence.
    this.requireConfigurationEditor()
    // Omitting the effort follows the composition default, the value the old
    // field-level unset resolved to. The native entry stores a complete
    // selection, so resolve that default from the same settings row instead of
    // dropping the field; a selection equal to the composition still removes
    // the profile row, which is what clears the override.
    const effort = reasoningEffort ?? this.row('agent-default-model')?.base?.reasoningEffort
    await this.edit(() => this.ctx.agentDefaultModel.saveSelection({
      provider,
      model,
      // The shared selection's effort is the adapter-owned id; the settings
      // row holds that id, and the value is passed on unchanged.
      ...(effort === undefined ? {} : { reasoningEffort: effort as ReasoningEffortId }),
    }))
    return { selection: this.ctx.agentDefaultModel.currentSelection(), applies: 'next-turn' }
  }

  /** Refuse a change the replies below are still running against. */
  async guard(provider: string, affected: Set<string> | null, work: () => Promise<unknown>): Promise<unknown> {
    const refusal = (replies: ActiveReply[]) => {
      const hits = replies.filter(reply => reply.provider === provider && (affected === null || affected.has(reply.model)))
      if (hits.length === 0) return undefined
      return new GatewayError(409, 'chat/route-in-use',
        `provider route "${provider}" is still used by ${hits.length} running repl${hits.length === 1 ? 'y' : 'ies'}`
        + ` (${hits.map(reply => `${reply.sessionId}:${reply.model}`).join(', ')}); retry after it ends`)
    }
    return this.ctx.ourfairyChat.withReplyGuard(refusal, work)
  }

  /** Add or replace one provider route and return its new view. */
  async saveRoute(body: Record<string, unknown>) {
    const provider = body?.provider
    if (typeof provider !== 'string' || !PROVIDER_ID.test(provider)) {
      throw new GatewayError(400, 'gateway/invalid-route', 'provider must be a lowercase hyphenated identifier')
    }
    const directory = this.ctx.llm.listConfigurableProviders().find(entry => entry.provider === provider)
    if (directory !== undefined && directory.settingsNs !== 'llm-pi-ai') {
      throw new GatewayError(400, 'gateway/invalid-route', `provider "${provider}" is owned by another adapter and is not editable here`)
    }
    const previous = this.providerProfile(provider)
    const profile = overlayPhoneEditableModelFields(previous, routeDraft(body))
    const affected = affectedModels(previous, profile)
    await this.guard(provider, affected, () => this.edit(() =>
      // The whole dictionary is written from the resolved values: a field path
      // write would merge into the raw row, which still holds the bundle's
      // environment expressions, and those must never reach the profile.
      this.requireConfigurationEditor().mutate('llm-pi-ai', [{
        op: 'set', path: ['providers'], value: { ...this.providers(), [provider]: profile },
      }])))
    const selection = this.ctx.agentDefaultModel.currentSelection()
    return { route: await this.routeView(provider, profile.displayName, profile, true, selection, this.ctx.ourfairyChat.activeReplies()) }
  }

  /** Remove one provider route; the route the shared selection names cannot be removed. */
  async deleteRoute(body: Record<string, unknown>) {
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
      return this.requireConfigurationEditor().mutate('llm-pi-ai', [{ op: 'set', path: ['providers'], value: providers }])
    }))
    return { provider }
  }

  /** Save the ASR connection. A transcription already running keeps its request. */
  async saveAsr(body: Record<string, unknown>) {
    const input = body ?? ({} as Record<string, unknown>)
    const model = input.model
    const endpoint = input.endpoint
    if (typeof model !== 'string' || model.trim() === '') throw new GatewayError(400, 'gateway/invalid-asr', 'model must be a non-empty string')
    if (typeof endpoint !== 'string' || !/^https?:\/\/[^\s]+$/u.test(endpoint)) {
      throw new GatewayError(400, 'gateway/invalid-asr', 'endpoint must be an http(s) URL')
    }
    const fields: Record<string, unknown> = { model, endpoint }
    for (const field of ['maxDurationMs', 'maxAudioBytes', 'timeoutMs', 'maxGlobalInFlight', 'maxUserInFlight'] as const) {
      if (input[field] === undefined) continue
      if (!isSafeInteger(input[field]) || input[field] < 1) {
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
    await this.edit(() => this.requireConfigurationEditor().update('speech', fields))
    return { asr: await this.asrView() }
  }

  /**
   * Save the automatic-compaction threshold. The native `compaction-basic` row
   * carries it as a volatile field, so the next pressure check reads the new
   * value and a running reply is not interrupted.
   */
  async saveCompaction(body: Record<string, unknown>) {
    const input = body ?? ({} as Record<string, unknown>)
    for (const key of Object.keys(input)) {
      if (key !== COMPACTION_FIELD) {
        throw new GatewayError(400, 'gateway/invalid-compaction',
          `the compaction threshold does not accept field "${key}"`)
      }
    }
    const thresholdTokens = input[COMPACTION_FIELD]
    if (!isSafeInteger(thresholdTokens)
      || thresholdTokens < COMPACTION_MIN_TOKENS || thresholdTokens > COMPACTION_MAX_TOKENS) {
      const got = thresholdTokens === undefined ? 'no value' : JSON.stringify(thresholdTokens)
      throw new GatewayError(400, 'gateway/invalid-compaction',
        `${COMPACTION_FIELD} must be a whole number of tokens from ${COMPACTION_MIN_TOKENS} to ${COMPACTION_MAX_TOKENS},`
        + ` inclusive; got ${got}`)
    }
    if (this.row(COMPACTION_ROW) === undefined) {
      throw new GatewayError(503, 'gateway/configuration-unavailable',
        `this deployment mounts no "${COMPACTION_ROW}" row; the compaction threshold cannot be saved here`)
    }
    await this.edit(() => this.requireConfigurationEditor().update(COMPACTION_ROW, { thresholdTokens }))
    return { compaction: this.compactionView() }
  }

  /**
   * Save the maintenance trigger turn count and decay interval. The memory row
   * carries both as volatile fields, so the next maintenance evaluation reads
   * the new values; a parked interval is re-evaluated under them and no
   * persisted watermark is touched by this write.
   */
  async saveMaintenance(body: Record<string, unknown>) {
    const input = body ?? ({} as Record<string, unknown>)
    for (const key of Object.keys(input)) {
      if (key !== 'triggerTurns' && key !== 'decayHours') {
        throw new GatewayError(400, 'gateway/invalid-maintenance',
          `the maintenance settings do not accept field "${key}"`)
      }
    }
    const triggerTurns = input.triggerTurns
    if (!isSafeInteger(triggerTurns)
      || triggerTurns < MAINTENANCE_MIN_TURNS || triggerTurns > MAINTENANCE_MAX_TURNS) {
      const got = triggerTurns === undefined ? 'no value' : JSON.stringify(triggerTurns)
      throw new GatewayError(400, 'gateway/invalid-maintenance',
        `triggerTurns must be a whole number of closed turns from ${MAINTENANCE_MIN_TURNS} to ${MAINTENANCE_MAX_TURNS},`
        + ` inclusive; got ${got}`)
    }
    const decayHours = input.decayHours
    if (!isSafeInteger(decayHours)
      || decayHours < MAINTENANCE_MIN_DECAY_HOURS || decayHours > MAINTENANCE_MAX_DECAY_HOURS) {
      const got = decayHours === undefined ? 'no value' : JSON.stringify(decayHours)
      throw new GatewayError(400, 'gateway/invalid-maintenance',
        `decayHours must be a whole number of hours from ${MAINTENANCE_MIN_DECAY_HOURS} to ${MAINTENANCE_MAX_DECAY_HOURS},`
        + ` inclusive; got ${got}`)
    }
    if (this.row(MAINTENANCE_ROW) === undefined) {
      throw new GatewayError(503, 'gateway/configuration-unavailable',
        `this deployment mounts no "${MAINTENANCE_ROW}" row; the maintenance settings cannot be saved here`)
    }
    await this.edit(() => this.requireConfigurationEditor().update(MAINTENANCE_ROW, {
      [MAINTENANCE_TURNS_FIELD]: triggerTurns,
      [MAINTENANCE_DECAY_FIELD]: decayHours,
    }))
    return { maintenance: this.maintenanceView() }
  }
}
