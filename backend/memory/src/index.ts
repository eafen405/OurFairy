/**
 * The long-term memory row.
 *
 * It owns one SQLite file, the `memory_*` tools every live Agent gets on its
 * own tool registry, and the per-source-session maintenance engine. Impressions
 * (per user) live in the same file but another ticket owns their behaviour.
 *
 * The maintenance settings are volatile plugin config: the loader hands over a
 * live reference per field, and the engine reads every field again on each
 * evaluation, so a settings write applies to the next judgement rather than the
 * next construction.
 *
 * @module @ourfairy/dsh-memory
 */
import z from '@deepseek-ai/schemastery'
import { MaintenanceEngine, readMaintenanceSettings, type MaintenanceField } from './maintenance.js'
import { MemoryService } from './service.js'
import { MemoryStore } from './store.js'
import { registerMemoryTools } from './tools.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// The dsh seams this row reads: the agent registry and per-agent tool
// registry, the session persistence handle that answers a source session's
// immutable owner, and the query service the engine observes source logs with.
// The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'ourfairy-memory'
export const inject = ['tools', 'agents', 'sessionPersistence', 'sessionQuery']

/**
 * The row's configuration.
 *
 * `path` is the memory database. The four maintenance fields are the settings
 * #247 will bind to the gateway's “记忆 → 维护” tree; they are declared here
 * with their defaults, ranges and `volatile()` so a saved value is read on the
 * next maintenance evaluation without remounting the row. The default light
 * model route is MiniMax-M3.1-Flash; changing the main session's model never
 * changes these values.
 */
export const Config = z.object({
  path: z.string().min(1).required(),
  maintenanceTurns: z.natural().min(5).max(50).default(15).volatile(),
  maintenanceDecayHours: z.natural().min(3).max(24).default(6).volatile(),
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
  const engine = new MaintenanceEngine(ctx, store, settings)
  // The engine may hold a child and a run; close it before the store it writes.
  ctx.effect(() => () => (async () => {
    await engine.close()
    store.close()
  })(), 'ourfairy-memory: store and maintenance engine')

  /** The tool names already registered on each live agent. */
  const registrations = new Map<Agent, Set<string>>()
  const register = (agent: Agent): undefined => {
    const names = registrations.get(agent) ?? new Set<string>()
    registrations.set(agent, names)
    registerMemoryTools(agent, service, names)
    engine.watch(agent)
    return undefined
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  ctx.on('agent/disposed', ({ agent }) => {
    registrations.delete(agent)
    // The query gate is keyed by session; a disposed agent's record is dropped
    // so a later agent of the same session must search again.
    service.forget(agent.session.id)
  }, { global: true })
  for (const agent of ctx.agents.list()) register(agent)
  engine.start()
}
