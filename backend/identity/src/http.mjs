/**
 * The identity module's own request paths.
 *
 * These routes live outside dsh's shared `/api` prefix on purpose: `/api` is
 * admitted as a whole before any handler runs, so an unauthenticated sign-in
 * endpoint cannot exist under it. Mounted on the same `webServer` carrier and
 * behind the same Host/Origin fence, they are the product's public surface —
 * and every one of them derives the caller from the credential it presents,
 * never from a user field in the request body.
 *
 * @module @ourfairy/dsh-identity/src/http
 */
import { IdentityError } from './store.mjs'

/** Largest JSON body these endpoints accept; a credential document is tiny. */
const MAX_BODY_BYTES = 64 * 1024

/** Paths this module owns, in the order the carrier registers them. */
export const IDENTITY_PATHS = Object.freeze([
  '/identity/invite',
  '/identity/register',
  '/identity/sign-in',
  '/identity/session',
  '/identity/sign-out',
])

/** Read one header from a node:http request. */
function headerOf(request, name) {
  const value = request.headers?.[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Read the bearer credential of one request.
 * @param request - node:http request or anything with headers.
 * @returns the token, or undefined when no bearer credential is present.
 */
export function bearerToken(request) {
  const value = headerOf(request, 'authorization')
  if (value === undefined) return undefined
  const match = /^Bearer[ ]+(\S+)$/u.exec(value.trim())
  return match === null ? undefined : match[1]
}

/**
 * Whether this request carries a payload at all.
 *
 * Three of these paths (`/identity/invite`, `/identity/session`,
 * `/identity/sign-out`) act purely on the presented credential and have no
 * document to send. A bodyless POST carries no `content-type`, and demanding
 * one would answer `415 Unsupported Media Type` to a request that has no media
 * type to be unsupported — a real client posting an empty body must be served.
 */
function carriesBody(request) {
  const declared = headerOf(request, 'content-length')
  if (declared !== undefined) return Number(declared) > 0
  return headerOf(request, 'transfer-encoding') !== undefined
}

/**
 * Read a bounded JSON body; a wrong content type or oversized body is a 4xx, not a hang.
 *
 * Exported for the sibling product route modules (see `backend/sessions`), which
 * serve the same shape of JSON POST and must not keep a second copy of it.
 *
 * @param request - node:http request.
 * @param HttpError - the calling module's error class carrying status and code.
 * @param codePrefix - the calling module's error-code namespace, e.g. `identity`.
 * @returns the parsed JSON object, or `{}` for a bodyless POST.
 */
export async function readJsonBody(request, HttpError = IdentityError, codePrefix = 'identity') {
  if (!carriesBody(request)) return {}
  const mediaType = headerOf(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new HttpError(415, `${codePrefix}/unsupported-media-type`, 'send the body as application/json')
  }
  const chunks = []
  let received = 0
  for await (const chunk of request) {
    received += chunk.length
    if (received > MAX_BODY_BYTES) {
      throw new HttpError(413, `${codePrefix}/body-too-large`, `request bodies are limited to ${MAX_BODY_BYTES} bytes`)
    }
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, `${codePrefix}/invalid-body`, 'the body must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, `${codePrefix}/invalid-body`, 'the body is not valid JSON')
  }
}

/** Write one JSON response with the product's no-store headers. */
export function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * Build the `post` wrapper every product-owned JSON route shares.
 *
 * The fence, the method check, body parsing, and the error envelope are the same
 * for `/identity/*` and `/sessions/*`; only the error class, the code namespace,
 * and the handler differ. Keeping this here is the reason the sibling route
 * module has no second copy of it.
 *
 * @param options - `handle(body, request)` plus how to name this module's errors.
 * @returns an async `(request, response)` handler.
 */
export function postHandler({ fence, handle, HttpError = IdentityError, codePrefix = 'identity', internalMessage }) {
  return async (request, response) => {
    try {
      if (fence(request) !== undefined) {
        sendJson(response, 403, { ok: false, error: { code: `${codePrefix}/forbidden-authority`, message: 'untrusted Host or Origin' } })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: { code: `${codePrefix}/method-not-allowed`, message: 'use POST' } })
        return
      }
      const body = await readJsonBody(request, HttpError, codePrefix)
      sendJson(response, 200, await handle(body, request))
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const code = error instanceof HttpError ? error.code : `${codePrefix}/internal`
      sendJson(response, status, {
        ok: false,
        error: { code, message: error instanceof HttpError ? error.message : internalMessage },
      })
    }
  }
}

/**
 * Build the identity request handlers.
 *
 * @param options - the identity service plus the fence every path applies first.
 * @param options.service - live identity service.
 * @param options.fence - Connection's Host/Origin fence; product-owned routes
 * authenticate themselves but must never skip this.
 * @returns one handler per path in {@link IDENTITY_PATHS}.
 */
export function identityHandlers({ service, fence }) {
  /** Resolve the caller from the presented credential, refusing an anonymous one. */
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
      ...service.register(body),
    }))],
    ['/identity/sign-in', post(async (body) => ({
      ok: true,
      ...service.signIn(body),
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
