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

/** Largest JSON body any product route accepts; a request document is tiny. */
const MAX_BODY_BYTES = 64 * 1024

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
 * Whether this request carries a payload at all. Several product routes act on
 * the credential alone and are posted with no body and therefore no
 * `content-type`.
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
async function readJsonBody(request, HttpError, codePrefix) {
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
 *
 * `HttpError` and `codePrefix` are the owning route's error class and code
 * prefix, passed by the caller rather than defaulted here: the catch below must
 * see exactly one error type, so a module's own errors are answered as 4xx and
 * nothing else is mistaken for them.
 */
export function postHandler({ fence, handle, HttpError, codePrefix, internalMessage, respond = (response, result) => sendJson(response, 200, result) }) {
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
