/**
 * The OurFairy owned-session module: session ownership and the fixed primary
 * session, mounted as one dsh plugin.
 *
 * It mounts the product's own `/sessions/*` request paths on the same `webServer`
 * carrier the identity module uses, behind the same Host/Origin fence. It adds
 * no second ownership store: `SessionHeader.owner`, written by dsh's own
 * persistence, is the only authority for who a session belongs to.
 *
 * @module @ourfairy/dsh-sessions
 */
import { Service } from '@deepseek-ai/cordis'
import { OwnedSessionService } from './service.mjs'
import { SESSION_PATHS, sessionHandlers } from './http.mjs'

/** Stable Cordis plugin name. */
export const name = 'ourfairy-sessions'

/**
 * The carriers this module serves its request paths through, plus the dsh
 * services it reads. `identity` must be present because the credential is what
 * names the owner.
 */
export const inject = ['webServer', 'connection', 'identity', 'sessions', 'sessionPersistence']

/**
 * Mount the owned-session module.
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  const service = new OwnedSessionService(ctx, {
    sessions: ctx.sessions,
    persistence: ctx.sessionPersistence,
    identity: ctx.identity,
  })
  const handlers = sessionHandlers({ service, fence: request => ctx.connection.fence(request) })

  for (const path of SESSION_PATHS) {
    const handler = handlers.get(path)
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler }),
      `ourfairy-sessions: ${path}`,
    )
  }

  ctx.logger?.info?.('ourfairy-sessions: session ownership is SessionHeader.owner; no second ownership store')
}

export { OwnedSessionService, primarySessionIdOf, sessionIdOf, SessionScopeError } from './service.mjs'
export { SESSION_PATHS, sessionHandlers } from './http.mjs'
