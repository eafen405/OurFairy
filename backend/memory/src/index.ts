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
import { ImpressionService, IMPRESSION_PATHS, impressionHandlers, registerImpressions } from './impression.js'
import { MemoryService } from './service.js'
import { MemoryStore } from './store.js'
import { registerMemoryTools } from './tools.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// The dsh seams this row reads: the agent registry and per-agent tool
// registry, the session persistence handle that answers a source session's
// immutable owner, the carrier's route registry and trust fence, the identity
// service that authenticates an impression request, and the system prompt the
// impression section is written to. The imports are type-only, so they add no
// runtime dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@ourfairy/dsh-identity'

export const name = 'ourfairy-memory'
export const inject = ['tools', 'agents', 'sessionPersistence', 'identity', 'webServer', 'connection', 'systemPrompt']

/** The row's configuration: the database file the memory store owns. */
export const Config = z.object({
  path: z.string().min(1).required(),
})

export function apply(ctx: Context, config: { path: string }): void {
  const store = new MemoryStore({ path: config.path })
  ctx.effect(() => () => store.close(), 'ourfairy-memory: memory store')
  const service = new MemoryService(ctx, store)
  const impressions = new ImpressionService({ store })

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
    // An owned session gets the impression section and tools; an ownerless one
    // (the later maintenance child) gets neither, so memory work cannot read or
    // rewrite an impression.
    registerImpressions(agent, impressions, names)
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
}
