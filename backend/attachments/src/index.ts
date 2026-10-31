/**
 * Authenticated upload/download routes and session-scoped native model/file
 * integration.
 *
 * @module @ourfairy/dsh-attachments
 */
import z from '@deepseek-ai/schemastery'
import { freezeSurface, mountRoutes, postHandler, sendJson, type RouteHandler } from '@ourfairy/dsh-http/http'
import { AttachmentService, AttachmentError, MAX_CHUNK_BYTES } from './service.js'
import { installPdf } from './pdf.js'
import { createDownloadResponder } from './download.js'
import { MAINTENANCE_PRESET } from '@ourfairy/dsh-memory/preset'
import { SessionScopeError, OwnedSessionService } from '@ourfairy/dsh-sessions'
import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
// The dsh context's own seams: the carrier's trust fence and the web server's
// route registry. The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'

/** The owner facts the owned-session service names a caller by. */
type SessionOwner = NonNullable<ReturnType<OwnedSessionService['authenticate']>>
export { MAX_ATTACHMENTS, MAX_MESSAGE_BYTES, uploadIdsOf } from './service.js'
export { createDownloadResponder } from './download.js'

/**
 * The addresses this row publishes, in registration order.
 *
 * Three read a JSON object and answer JSON. `/attachments/chunk` reads raw
 * `application/octet-stream` bytes and answers JSON; `/attachments/download`
 * reads a JSON object and answers the original bytes.
 */
export const SURFACE = freezeSurface([
  { path: '/attachments/propose', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'attachments' },
  { path: '/attachments/complete', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'attachments' },
  { path: '/attachments/chunk', method: 'POST', auth: 'ownership', body: 'binary', response: 'json', prefix: 'attachments' },
  { path: '/attachments/download', method: 'POST', auth: 'ownership', body: 'json', response: 'binary', prefix: 'attachments' },
])

export const name = 'ourfairy-attachments'
export const inject = ['webServer', 'connection', 'identity', 'ourfairySessions', 'attachments', 'sessionQuery', 'ourfairySpaces', 'llm', 'agentDefaultModel', 'fs', 'workingDirectory', 'tools', 'subprocess', 'sessions']

/** The loader validates the row config before `apply`; the service only reads the root. */
export const Config = z.object({
  root: z.string().required(),
})

/**
 * Mount the attachment routes and the native model/file integration.
 *
 * @param ctx - the context the routes and the tools run in.
 * @param config - the row config the loader validated.
 */
export function apply(ctx: Context, config: { readonly root: string }): void {
  const service = new AttachmentService(ctx, config)
  installPdf(ctx, service)
  const json = (handle: (owner: SessionOwner, body: Record<string, unknown>) => Promise<unknown>, respond?: (response: ServerResponse, result: unknown) => void) =>
    postHandler({ fence: req => ctx.connection.fence(req), HttpError: SessionScopeError,
      codePrefix: 'attachments', internalMessage: 'attachment request failed', handle: (body, req) => handle(service.caller(req), body),
      ...respond !== undefined ? { respond } : {} })
  // The raw-chunk address keeps its own admission and body reading; it is not
  // wrapped in the JSON envelope the other three share.
  const handlers = new Map<string, RouteHandler>([
    ['/attachments/propose', json(async (owner, body) => ({ ok: true, upload: await service.propose(owner, body) }))],
    ['/attachments/complete', json(async (owner, body) => ({ ok: true, upload: await service.complete(owner, body) }))],
    ['/attachments/chunk', async (req, res) => {
      try {
        if (ctx.connection.fence(req) !== undefined) throw new AttachmentError(403, 'attachments/forbidden-authority', 'untrusted Host or Origin')
        if (req.method !== 'POST') throw new AttachmentError(405, 'attachments/method-not-allowed', 'use POST')
        const owner = service.caller(req)
        if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new AttachmentError(415, 'attachments/unsupported-media-type', 'send original binary bytes')
        const offset = req.headers['x-upload-offset']
        if (typeof offset !== 'string' || !/^(0|[1-9]\d*)$/.test(offset)) throw new AttachmentError(400, 'attachments/invalid-request', 'provide a byte offset')
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) {
          size += chunk.length
          if (size > MAX_CHUNK_BYTES) throw new AttachmentError(413, 'attachments/too-large', 'chunk exceeds 256 KiB')
          chunks.push(chunk)
        }
        sendJson(res, 200, { ok: true, upload: await service.chunk(owner, req.headers['x-upload-id'], Number(offset), Buffer.concat(chunks)) })
      } catch (error) {
        sendJson(res, error instanceof SessionScopeError ? error.status : 500, { ok: false, error: {
          code: error instanceof SessionScopeError ? error.code : 'attachments/internal',
          message: error instanceof SessionScopeError ? error.message : 'attachment upload failed' } })
      }
    }],
    // The download route's handler returns the attachment input the responder
    // writes; the transport envelope types every route result as unknown.
    ['/attachments/download', json((owner, body) => service.download(owner, body),
      createDownloadResponder(ctx) as (response: ServerResponse, result: unknown) => void)],
  ])
  mountRoutes(ctx, { label: 'ourfairy-attachments', surface: SURFACE, handlers })
  ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(session => service.readonlyFiles(session)),
    'ourfairy-attachments: read-only files')
  // Each iterator pull must inherit the session: merely constructing the async
  // generator inside AsyncLocalStorage does not scope provider serialization.
  ctx.on('llm/stream', async function* (options, next) {
    // A maintenance child is ownerless and has no attachments; the native
    // stream still reaches this hook for every request, so leave its scoped
    // refresh out instead of demanding an owner it never has.
    const child = options.sessionId === undefined ? undefined : ctx.sessions.get(options.sessionId)
    if (child?.header?.agentPreset === MAINTENANCE_PRESET) {
      yield* next()
      return
    }
    const session = ctx.ourfairySpaces.session(options.sessionId)
    await service.refresh(session)
    const iterator = next()[Symbol.asyncIterator]()
    try {
      while (true) {
        const step = await ctx.ourfairySpaces.run(session, () => iterator.next())
        if (step.done) return
        yield step.value
      }
    } finally { await iterator.return?.() }
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent && exec.agent.session.header?.agentPreset !== MAINTENANCE_PRESET) await service.refresh(exec.agent.session)
    return next()
  }, { global: true })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The product's attachment service, as this package provides it. */
    ourfairyAttachments: AttachmentService
  }
}
