/**
 * The product transport envelope every product-owned route shares: the bounded
 * JSON request reader, the bearer credential parser, the JSON response writer,
 * and the `post` wrapper around them.
 *
 * The routes themselves, and the error class each one throws, belong to the
 * package that owns the domain: `postHandler` and `readJsonBody` are given that
 * class and the error-code prefix by the caller, so this module imports no
 * product package and catches only the one error type it was handed.
 *
 * @module @ourfairy/dsh-http/src/http
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Largest JSON body any product route accepts; a request document is tiny. */
const MAX_BODY_BYTES = 64 * 1024

/** The error shape the owning route's class must expose to this module. */
export interface HttpErrorInstance extends Error {
  status: number
  code: string
}

/**
 * The caller's error class, passed in rather than imported.
 *
 * It extends `Function` because the module narrows a caught value with
 * `instanceof`, and the compiler requires the right-hand side of an
 * `instanceof` to be assignable to `Function`.
 */
export interface HttpErrorClass extends Function {
  new (status: number, code: string, message: string): HttpErrorInstance
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

/** The bearer credential of one request, or undefined. */
export function bearerToken(request: IncomingMessage): string | undefined {
  const value = headerOf(request, 'authorization')
  if (value === undefined) return undefined
  const match = /^Bearer[ ]+(\S+)$/u.exec(value.trim())
  return match === null ? undefined : match[1]
}

/**
 * Whether this request carries a payload at all. Several product routes act on
 * the credential alone and are posted with no body and therefore no
 * `content-type`.
 */
function carriesBody(request: IncomingMessage): boolean {
  const declared = headerOf(request, 'content-length')
  if (declared !== undefined) return Number(declared) > 0
  return headerOf(request, 'transfer-encoding') !== undefined
}

/** Whether a parsed JSON body is an object rather than an array or a scalar. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read a bounded JSON body; a wrong content type or an oversized body is a 4xx.
 * @returns the parsed JSON object, or `{}` for a bodyless POST.
 */
async function readJsonBody(request: IncomingMessage, HttpError: HttpErrorClass, codePrefix: string): Promise<Record<string, unknown>> {
  if (!carriesBody(request)) return {}
  const mediaType = headerOf(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new HttpError(415, `${codePrefix}/unsupported-media-type`, 'send the body as application/json')
  }
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    received += buffer.length
    if (received > MAX_BODY_BYTES) {
      throw new HttpError(413, `${codePrefix}/body-too-large`, `request bodies are limited to ${MAX_BODY_BYTES} bytes`)
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!isJsonObject(parsed)) {
      throw new HttpError(400, `${codePrefix}/invalid-body`, 'the body must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, `${codePrefix}/invalid-body`, 'the body is not valid JSON')
  }
}

/** Write one JSON response with the product's no-store headers. */
export function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload)}\n`
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * The admission one product address performs after the shared Host/Origin
 * fence: nothing more (`fence`), a live credential (`authentication`), a
 * credential that owns the named resource (`ownership`), or the administrator
 * role (`role`).
 */
export type SurfaceAuth = 'fence' | 'authentication' | 'ownership' | 'role'

/** The request body one product address reads: a JSON object, raw bytes, or none. */
export type SurfaceBody = 'json' | 'binary' | 'none'

/** The response one product address writes: JSON, an SSE stream, or raw bytes. */
export type SurfaceResponse = 'json' | 'sse' | 'binary'

/**
 * One product HTTP address, as the row that serves it publishes it.
 *
 * The row exports these entries so the mounted surface has one readable list
 * instead of a literal repeated in every registration, test and document.
 * `prefix` is the error-code prefix the address answers with; it is usually the
 * row's own name, but `/sessions/rename` is registered by the chat row and
 * answers in the session family's vocabulary.
 */
export interface SurfaceEntry {
  readonly path: string
  readonly method: 'GET' | 'POST'
  readonly auth: SurfaceAuth
  readonly body: SurfaceBody
  readonly response: SurfaceResponse
  readonly prefix: string
}

/**
 * Freeze one row's published surface: the array and every entry.
 * @param entries - the row's addresses, in registration order.
 * @returns the same entries, read-only.
 */
export function freezeSurface(entries: readonly SurfaceEntry[]): readonly SurfaceEntry[] {
  return Object.freeze(entries.map(entry => Object.freeze(entry)))
}

/** The inputs one product route hands to `postHandler`. */
export interface PostHandlerOptions {
  fence: (request: IncomingMessage) => unknown
  handle: (body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>
  HttpError: HttpErrorClass
  codePrefix: string
  internalMessage: string
  respond?: (response: ServerResponse, result: unknown) => void
}

/**
 * The `post` wrapper every product-owned JSON route shares: fence, method check,
 * body parsing and the error envelope. `respond` lets a streaming sibling write
 * its own response after the same admission checks.
 *
 * `HttpError` and `codePrefix` are the owning route's error class and code
 * prefix, passed by the caller rather than defaulted here: the catch below must
 * see exactly one error type, so a module's own errors are answered as 4xx and
 * nothing else is mistaken for them.
 */
export function postHandler({ fence, handle, HttpError, codePrefix, internalMessage, respond = (response, result) => sendJson(response, 200, result) }: PostHandlerOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
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
      const known = error instanceof HttpError
      const status = known ? error.status : 500
      const code = known ? error.code : `${codePrefix}/internal`
      sendJson(response, status, {
        ok: false,
        error: { code, message: known ? error.message : internalMessage },
      })
    }
  }
}
