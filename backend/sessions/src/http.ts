/**
 * The owned-session module's request paths. They sit outside dsh's `/api`
 * prefix, like the identity paths, on the same `webServer` carrier and behind
 * the same Host/Origin fence. Every route derives the caller from the presented
 * credential.
 *
 * @module @ourfairy/dsh-sessions/src/http
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { postHandler } from '@ourfairy/dsh-http/http'
import { SessionScopeError, type OwnedSessionService, type SessionOwner } from './service.js'

/** Paths this module owns, in the order the carrier registers them. */
export const SESSION_PATHS = Object.freeze([
  '/sessions/create',
  '/sessions/list',
  '/sessions/select',
  '/sessions/primary',
  '/sessions/read',
])

/** One handler the carrier registers on the web server. */
export type SessionHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

/** Build one handler per path in {@link SESSION_PATHS}. */
export function sessionHandlers({ service, fence }: {
  service: OwnedSessionService
  fence: (request: IncomingMessage) => unknown
}): Map<string, SessionHandler> {
  const callerOf = (request: IncomingMessage): SessionOwner => {
    const user = service.authenticate(request)
    if (user === undefined) {
      throw new SessionScopeError(401, 'sessions/unauthorized', 'present a live session credential')
    }
    return user
  }
  const post = (handle: (body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>): SessionHandler => postHandler({
    fence,
    handle,
    HttpError: SessionScopeError,
    codePrefix: 'sessions',
    internalMessage: 'the owned-session module failed to handle this request',
  })
  /** One owned session, answered as `{ ok, session }`. Both read routes share it. */
  const oneSession = (resolve: (caller: SessionOwner, sessionId: unknown) => Promise<Parameters<OwnedSessionService['expose']>[0]>) => post(async (body, request) => {
    const caller = callerOf(request)
    return { ok: true, session: service.expose(await resolve(caller, body.sessionId), caller.shortId) }
  })

  return new Map([
    ['/sessions/create', post(async (_body, request) => {
      const caller = callerOf(request)
      return { ok: true, session: service.expose(await service.create(caller), caller.shortId) }
    })],
    ['/sessions/list', post(async (_body, request) => {
      const caller = callerOf(request)
      const listed = await service.list(caller)
      return {
        ok: true,
        sessions: listed.sessions.map(header => service.expose(header, caller.shortId)),
        primarySessionId: listed.primarySessionId,
      }
    })],
    ['/sessions/select', oneSession((caller, sessionId) => service.read(caller, sessionId))],
    ['/sessions/primary', post(async (_body, request) => {
      const caller = callerOf(request)
      return { ok: true, session: service.expose(await service.primary(caller), caller.shortId) }
    })],
    ['/sessions/read', oneSession((caller, sessionId) => service.read(caller, sessionId))],
  ])
}
