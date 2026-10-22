/**
 * The identity module's own request paths.
 *
 * They sit outside dsh's `/api` prefix, which is admitted as a whole before any
 * handler runs. Every route derives the caller from the presented credential.
 * The transport envelope around them lives in `@ourfairy/dsh-http/http`.
 *
 * @module @ourfairy/dsh-identity/src/routes
 */
import { postHandler } from '@ourfairy/dsh-http/http'
import { IdentityError } from './store.mjs'

/** Paths this module owns, in the order the carrier registers them. */
export const IDENTITY_PATHS = Object.freeze([
  '/identity/invite',
  '/identity/register',
  '/identity/sign-in',
  '/identity/session',
  '/identity/sign-out',
])

/**
 * Build one handler per path in {@link IDENTITY_PATHS}. The store is passed
 * alongside the service rather than read back from it: the service keeps the
 * store private, and the registration and sign-in routes have no identity rule
 * of their own.
 */
export function identityHandlers({ service, store, fence }) {
  const callerOf = (request) => {
    const user = service.authenticateRequest(request)
    if (user === undefined) {
      throw new IdentityError(401, 'identity/unauthorized', 'present a live session credential')
    }
    return user
  }
  const post = (handle) => postHandler({
    fence,
    handle,
    HttpError: IdentityError,
    codePrefix: 'identity',
    internalMessage: 'the identity module failed to handle this request',
  })

  return new Map([
    ['/identity/invite', post(async (body, request) => {
      const caller = callerOf(request)
      return { ok: true, invite: service.createInvite(caller) }
    })],
    ['/identity/register', post(async (body) => ({
      ok: true,
      ...store.register(body),
    }))],
    ['/identity/sign-in', post(async (body) => ({
      ok: true,
      ...store.signIn(body),
    }))],
    ['/identity/session', post(async (_body, request) => ({
      ok: true,
      user: callerOf(request),
    }))],
    ['/identity/sign-out', post(async (_body, request) => ({
      ok: true,
      ...await service.signOutRequest(request),
    }))],
  ])
}
