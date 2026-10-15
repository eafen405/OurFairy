/** Authenticated upload/download routes and session-scoped native model/file integration. */
import { postHandler, sendJson } from '@ourfairy/dsh-identity/http'
import { AttachmentService, AttachmentError, MAX_CHUNK_BYTES } from './service.mjs'
import { once } from 'node:events'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
export const name = 'ourfairy-attachments'
export const inject = ['webServer', 'connection', 'identity', 'ourfairySessions', 'attachments', 'sessionQuery', 'ourfairySpaces', 'llm', 'agentDefaultModel']
export function apply(ctx, config) {
  const service = new AttachmentService(ctx, config)
  const register = (path, handler) => ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `ourfairy-attachments: ${path}`)
  const json = (handle, respond) => postHandler({ fence: req => ctx.connection.fence(req), HttpError: SessionScopeError,
    codePrefix: 'attachments', internalMessage: 'attachment request failed', handle: (body, req) => handle(service.caller(req), body), respond })
  register('/attachments/propose', json(async (owner, body) => ({ ok: true, upload: await service.propose(owner, body) })))
  register('/attachments/complete', json(async (owner, body) => ({ ok: true, upload: await service.complete(owner, body) })))
  register('/attachments/chunk', async (req, res) => {
    try {
      if (ctx.connection.fence(req) !== undefined) throw new AttachmentError(403, 'attachments/forbidden-authority', 'untrusted Host or Origin')
      if (req.method !== 'POST') throw new AttachmentError(405, 'attachments/method-not-allowed', 'use POST')
      const owner = service.caller(req)
      if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new AttachmentError(415, 'attachments/unsupported-media-type', 'send original binary bytes')
      const offset = req.headers['x-upload-offset']
      if (typeof offset !== 'string' || !/^(0|[1-9]\d*)$/.test(offset)) throw new AttachmentError(400, 'attachments/invalid-request', 'provide a byte offset')
      const chunks = []; let size = 0
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
  })
  register('/attachments/download', json((owner, body) => service.download(owner, body), async (res, input) => {
    // Open/verify the immutable original before headers, then stream with backpressure.
    const iterator = ctx.attachments.readFileStream(input.original)[Symbol.asyncIterator]()
    const first = await iterator.next()
    res.writeHead(200, { 'cache-control': 'no-store', 'content-type': input.mime,
      'content-length': input.original.bytes, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(input.name)}` })
    try {
      let step = first
      while (!step.done) {
        if (!res.write(step.value)) await once(res, 'drain')
        step = await iterator.next()
      }
      res.end()
    } catch (error) { res.destroy(error) } finally { await iterator.return?.() }
  }))
  ctx.ourfairySpaces.readonlyFiles = session => service.readonlyFiles(session)
  // Each iterator pull must inherit the session: merely constructing the async
  // generator inside AsyncLocalStorage does not scope provider serialization.
  ctx.on('llm/stream', async function* (options, next) {
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
    if (exec.agent) await service.refresh(exec.agent.session)
    return next()
  }, { global: true })
}
