/**
 * The owned-session module's request paths.
 *
 * These routes live outside dsh's shared `/api` prefix on purpose, exactly as
 * the identity paths do: `/api` is admitted as a whole before any handler runs.
 * Mounted on the same `webServer` carrier and behind the same Host/Origin fence,
 * they are the product's session surface — and every one of them derives the
 * caller from the credential it presents, never from a user field in the body.
 *
 * The fence, method check, body parsing, and error envelope come from the
 * identity module's shared POST helper; only this module's error class, code
 * namespace, and handlers are its own.
 *
 * @module @ourfairy/dsh-sessions/src/http
 */
import { postHandler } from '@ourfairy/dsh-identity/http'
import { SessionScopeError } from './service.mjs'

/** Paths this module owns, in the order the carrier registers them. */
export const SESSION_PATHS = Object.freeze([
  '/sessions/create',
  '/sessions/list',
  '/sessions/select',
  '/sessions/primary',
  '/sessions/read',
])

/**
 * Build the owned-session request handlers.
 *
 * @param options - the owned-session service plus the fence every path applies first.
 * @param options.service - live owned-session service.
 * @param options.fence - Connection's Host/Origin fence; product-owned routes
 * authenticate themselves but must never skip this.
 * @returns one handler per path in {@link SESSION_PATHS}.
 */
export function sessionHandlers({ service, fence }) {
  /** Resolve the caller from the presented credential, refusing an anonymous one. */
  const callerOf = (request) => {
    const user = service.authenticate(request)
    if (user === undefined) {
      throw new SessionScopeError(401, 'sessions/unauthorized', 'present a live session credential')
    }
    return user
  }
  const post = (handle) => postHandler({
    fence,
    handle,
    HttpError: SessionScopeError,
    codePrefix: 'sessions',
    internalMessage: 'the owned-session module failed to handle this request',
  })
  /**
   * One owned session, answered as `{ ok, session }`.
   *
   * `/sessions/read` and `/sessions/select` take the same body and answer the
   * same document: selecting is a client-side choice that persists nothing, so
   * both routes run this one handler. The paths stay separate because they are
   * the client contract; a select that later persists a binding gets its own
   * handler here, not a second copy of this one.
   */
  const oneSession = (resolve) => post(async (body, request) => {
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
    ['/sessions/select', oneSession((caller, sessionId) => service.select(caller, sessionId))],
    ['/sessions/primary', post(async (_body, request) => {
      const caller = callerOf(request)
      return { ok: true, session: service.expose(await service.primary(caller), caller.shortId) }
    })],
    ['/sessions/read', oneSession((caller, sessionId) => service.read(caller, sessionId))],
  ])
}
