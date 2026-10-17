/**
 * The OurFairy owned-session module: session ownership and the fixed primary
 * session, mounted as one dsh plugin. `SessionHeader.owner` is the ownership
 * authority; this module stores nothing of its own.
 *
 * @module @ourfairy/dsh-sessions
 */
import { OwnedSessionService } from './service.mjs'
import { SESSION_PATHS, sessionHandlers } from './http.mjs'

export const name = 'ourfairy-sessions'

/** `identity` is required because the presented credential is what names the owner. */
export const inject = ['webServer', 'connection', 'identity', 'sessions', 'sessionPersistence']

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
}

export { OwnedSessionService, primarySessionIdOf, sessionIdOf, SessionScopeError } from './service.mjs'
export { SESSION_PATHS, sessionHandlers } from './http.mjs'
