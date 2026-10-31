/**
 * The long-term memory row.
 *
 * It owns one SQLite file, the `memory_*` tools every live Agent gets on its
 * own tool registry, the per-user impression endpoints and section, and the
 * per-source-session maintenance engine.
 *
 * The maintenance settings are volatile plugin config: the loader hands over a
 * live reference per field, and the engine reads every field again on each
 * evaluation, so a settings write applies to the next judgement rather than the
 * next construction.
 *
 * @module @ourfairy/dsh-memory
 */
import z from '@deepseek-ai/schemastery'
import { ImpressionService, IMPRESSION_PATHS, impressionHandlers, registerImpressions } from './impression.js'
import { MAINTENANCE_DECAY_HOURS, MAINTENANCE_TURNS } from './maintenance-policy.js'
import { MaintenanceEngine, readMaintenanceSettings, type MaintenanceField } from './maintenance.js'
import { MemoryService } from './service.js'
import { MemoryStore } from './store.js'
import { registerMemoryPolicy, registerMemoryTools } from './tools.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// The dsh seams this row reads: the agent registry and per-agent tool
// registry, the session persistence handle that answers a source session's
// immutable owner, the query service the maintenance engine observes source
// logs with, the carrier's route registry and trust fence, the identity
// service that authenticates an impression request, and the system prompt the
// impression section is written to. The imports are type-only, so they add no
// runtime dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@ourfairy/dsh-identity'

export const name = 'ourfairy-memory'
export const inject = ['tools', 'agents', 'sessionPersistence', 'sessionQuery',
  'identity', 'webServer', 'connection', 'systemPrompt']

/**
 * The row's configuration.
 *
 * `path` is the memory database. The four maintenance fields are the settings
 * the gateway's “记忆 → 维护” tree reads and writes; they are declared here
 * with their defaults, ranges and `volatile()` so a saved value is read on the
 * next maintenance evaluation without remounting the row. The two numbers and
 * their ranges are the memory package's maintenance policy, not local copies.
 * The default light model route is MiniMax-M3.1-Flash; changing the main
 * session's model never changes these values.
 */
export const Config = z.object({
  path: z.string().min(1).required(),
  maintenanceTurns: z.natural().min(MAINTENANCE_TURNS.min).max(MAINTENANCE_TURNS.max)
    .default(MAINTENANCE_TURNS.default).volatile(),
  maintenanceDecayHours: z.natural().min(MAINTENANCE_DECAY_HOURS.min).max(MAINTENANCE_DECAY_HOURS.max)
    .default(MAINTENANCE_DECAY_HOURS.default).volatile(),
  maintenanceModel: z.string().min(1).default('MiniMax-M3.1-Flash').volatile(),
  maintenanceProvider: z.string().min(1).default('minimax-cn').volatile(),
})

/** The row config as the loader hands it over; volatile fields are live refs. */
export type MemoryConfig = {
  readonly path: string
  readonly maintenanceTurns?: MaintenanceField
  readonly maintenanceDecayHours?: MaintenanceField
  readonly maintenanceModel?: MaintenanceField
  readonly maintenanceProvider?: MaintenanceField
}

export function apply(ctx: Context, config: MemoryConfig): void {
  /** The settings this evaluation uses: every read goes through the live refs. */
  const settings = () => readMaintenanceSettings({
    maintenanceTurns: config.maintenanceTurns,
    maintenanceDecayHours: config.maintenanceDecayHours,
    maintenanceModel: config.maintenanceModel,
    maintenanceProvider: config.maintenanceProvider,
  })
  // Refuse an out-of-range row at load time, before any source is observed.
  settings()

  const store = new MemoryStore({ path: config.path })
  const service = new MemoryService(ctx, store)
  const impressions = new ImpressionService({ store })
  const engine = new MaintenanceEngine(ctx, store, settings)
  // The engine may hold a child and a run; close it before the store it writes.
  ctx.effect(() => () => (async () => {
    await engine.close()
    store.close()
  })(), 'ourfairy-memory: store and maintenance engine')

  // The user's own impression endpoints: the authenticated identity names the
  // row, and the read gate is keyed by the credential that read it. They sit on
  // the same carrier as the identity paths and never pass through the gateway.
  const handlers = impressionHandlers({
    service: impressions,
    authenticate: request => ctx.identity.authenticateRequest(request),
    fence: request => ctx.connection.fence(request),
  })
  for (const path of IMPRESSION_PATHS) {
    const handler = handlers.get(path)
    if (handler === undefined) {
      throw new Error(`ourfairy-memory: no impression handler is registered for ${path}`)
    }
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler }),
      `ourfairy-memory: ${path}`,
    )
  }

  /** The tool names and prompt sections already registered on each live agent. */
  const registrations = new Map<Agent, Set<string>>()
  const register = (agent: Agent): undefined => {
    const names = registrations.get(agent) ?? new Set<string>()
    registrations.set(agent, names)
    registerMemoryTools(agent, service, names)
    // The owned Fairy gets the write/no-write policy. The maintenance child is
    // ownerless and carries its own policy instead.
    registerMemoryPolicy(agent, names)
    // An owned session gets the impression section and tools; an ownerless one
    // (the maintenance child) gets neither, so memory work cannot read or
    // rewrite an impression.
    registerImpressions(agent, impressions, names)
    engine.watch(agent)
    return undefined
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  ctx.on('agent/disposed', ({ agent }) => {
    registrations.delete(agent)
    // Both gates are keyed by session; a disposed agent's records are dropped
    // so a later agent of the same session must read again.
    service.forget(agent.session.id)
    impressions.forget(agent.session.id)
  }, { global: true })
  for (const agent of ctx.agents.list()) register(agent)
  engine.start()
}

export { IMPRESSION_PATHS, SURFACE } from './impression.js'
