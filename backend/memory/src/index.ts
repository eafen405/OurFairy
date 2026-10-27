/**
 * The long-term memory row.
 *
 * It owns one SQLite file and the `memory_*` tools every live Agent gets on its
 * own tool registry. Impressions (per user) and the session maintenance state
 * live in the same file, but this row exposes neither yet: their tickets add
 * the behaviour, not a second migration.
 *
 * @module @ourfairy/dsh-memory
 */
import z from '@deepseek-ai/schemastery'
import { MemoryService } from './service.js'
import { MemoryStore } from './store.js'
import { registerMemoryTools } from './tools.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// The dsh seams this row reads: the agent registry and per-agent tool
// registry, and the session persistence handle that answers a source session's
// immutable owner. The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'ourfairy-memory'
export const inject = ['tools', 'agents', 'sessionPersistence']

/** The row's configuration: the database file the memory store owns. */
export const Config = z.object({
  path: z.string().min(1).required(),
})

export function apply(ctx: Context, config: { path: string }): void {
  const store = new MemoryStore({ path: config.path })
  ctx.effect(() => () => store.close(), 'ourfairy-memory: memory store')
  const service = new MemoryService(ctx, store)

  /** The tool names already registered on each live agent. */
  const registrations = new Map<Agent, Set<string>>()
  const register = (agent: Agent): undefined => {
    const names = registrations.get(agent) ?? new Set<string>()
    registrations.set(agent, names)
    registerMemoryTools(agent, service, names)
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
}
