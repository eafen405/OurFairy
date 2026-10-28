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
  '/sessions/archive',
])

/**
 * The rename path. Its subject is one session, so it belongs to this family's
 * addresses — but this module cannot serve it: a rename is accepted only on a
 * live session, and opening one is the chat module's job (persona, identity
 * section, model selection), which this module must not depend on. The chat row
 * registers the handler for this exact path; the string lives here so the
 * family has one source for the addresses it publishes.
 */
export const SESSION_RENAME_PATH = '/sessions/rename'

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
  /** One owned session, answered as `{ ok, session }`. The one-session routes share it. */
  const oneSession = (resolve: (caller: SessionOwner, sessionId: unknown) => Promise<Parameters<OwnedSessionService['expose']>[0]>) => post(async (body, request) => {
    const caller = callerOf(request)
    const header = await resolve(caller, body.sessionId)
    return { ok: true, session: service.expose(header, caller.shortId, await service.titleOf(header.id)) }
  })

  return new Map([
    ['/sessions/create', post(async (_body, request) => {
      const caller = callerOf(request)
      const header = await service.create(caller)
      return { ok: true, session: service.expose(header, caller.shortId, await service.titleOf(header.id)) }
    })],
    ['/sessions/list', post(async (body, request) => {
      const caller = callerOf(request)
      // The archived view is the same path and the same credential; only the
      // question changes. Reading the flag here keeps one filter point in the
      // service, so every caller that does not ask for the archive sees the
      // active sessions and nothing else.
      const listed = await service.list(caller, { archived: body.archived === true })
      // One batch fold for the whole list: a title read per row would repeat
      // the persistence listing and could disagree with the one the batch saw.
      const titles = await service.titlesOf(listed.sessions.map(header => header.id))
      return {
        ok: true,
        sessions: listed.sessions.map(header => service.expose(header, caller.shortId, titles.get(header.id))),
        primarySessionId: listed.primarySessionId,
      }
    })],
    ['/sessions/select', oneSession((caller, sessionId) => service.read(caller, sessionId))],
    ['/sessions/primary', post(async (_body, request) => {
      const caller = callerOf(request)
      const header = await service.primary(caller)
      return { ok: true, session: service.expose(header, caller.shortId, await service.titleOf(header.id)) }
    })],
    ['/sessions/read', oneSession((caller, sessionId) => service.read(caller, sessionId))],
    ['/sessions/archive', oneSession((caller, sessionId) => service.archive(caller, sessionId))],
  ])
}
