/**
 * The identity module's own request paths.
 *
 * They sit outside dsh's `/api` prefix, which is admitted as a whole before any
 * handler runs. Every route derives the caller from the presented credential.
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

function headerOf(request, name) {
  const value = request.headers?.[name]
  return typeof value === 'string' ? value : undefined
}

/** The bearer credential of one request, or undefined. */
export function bearerToken(request) {
  const value = headerOf(request, 'authorization')
  if (value === undefined) return undefined
  const match = /^Bearer[ ]+(\S+)$/u.exec(value.trim())
  return match === null ? undefined : match[1]
}

/**
 * Whether this request carries a payload at all. `/identity/invite`,
 * `/identity/session` and `/identity/sign-out` act on the credential alone and
 * are posted with no body and therefore no `content-type`.
 */
function carriesBody(request) {
  const declared = headerOf(request, 'content-length')
  if (declared !== undefined) return Number(declared) > 0
  return headerOf(request, 'transfer-encoding') !== undefined
}

/**
 * Read a bounded JSON body; a wrong content type or an oversized body is a 4xx.
 * @returns the parsed JSON object, or `{}` for a bodyless POST.
 */
async function readJsonBody(request, HttpError = IdentityError, codePrefix = 'identity') {
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
 * The `post` wrapper every product-owned JSON route shares: fence, method check,
 * body parsing and the error envelope. `respond` lets a streaming sibling write
 * its own response after the same admission checks.
 */
export function postHandler({ fence, handle, HttpError = IdentityError, codePrefix = 'identity', internalMessage, respond = (response, result) => sendJson(response, 200, result) }) {
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
      await respond(response, await handle(body, request))
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
