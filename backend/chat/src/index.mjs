/** Narrow product routes over native Agent/SessionQuery, without the upstream controller. */
import { postHandler } from '@ourfairy/dsh-identity/http'
import { RemoteChat } from './service.mjs'
import { SessionRuntime } from './runtime.mjs'
import { ChatRuntimeFacade } from './runtime-facade.mjs'
import { installJobs } from './jobs.mjs'
import { registerProjectionUnits } from './units.mjs'
import { installSpillRead } from './spill-read.mjs'
import { SessionScopeError } from '@ourfairy/dsh-sessions'

export const name = 'ourfairy-chat'
export const inject = ['webServer', 'connection', 'ourfairySessions', 'ourfairySpaces', 'agents', 'agentLoop', 'agentDefaultModel', 'sessions', 'sessionQuery', 'systemPrompt', 'ourfairyAttachments', 'identity', 'tools', 'sessionPersistence', 'jobs', 'sessionProjections']
export function apply(ctx) {
  // Every registered unit folds on the native event drive, once per session and
  // shared by every observer; `register` installs its own effect on this fiber.
  registerProjectionUnits(ctx)
  const runtime = new SessionRuntime(ctx)
  new ChatRuntimeFacade(ctx, runtime)
  const chat = new RemoteChat(ctx, runtime)
  const { jobOutput, jobStop } = installJobs(ctx, runtime)
  installSpillRead(ctx)
  const register = (path, handle, respond) => ctx.effect(() => ctx.webServer.register({ kind: 'exact', path,
    handler: postHandler({ fence: request => ctx.connection.fence(request), HttpError: SessionScopeError,
      codePrefix: 'chat', internalMessage: 'remote chat request failed',
      handle: async (body, request) => handle(chat.caller(request), body), respond }),
  }), `ourfairy-chat: ${path}`)
  register('/chat/send', async (owner, body) => ({ ok: true, receipt: await chat.send(owner, body) }))
  register('/chat/receipt', async (owner, body) => ({ ok: true, receipt: await chat.receipt(owner, body) }))
  register('/chat/read', async (owner, body) => ({ ok: true, projection: await chat.read(owner, body) }))
  register('/chat/page', async (owner, body) => ({ ok: true, page: await chat.page(owner, body) }))
  register('/chat/checkpoint', async (owner, body) => ({ ok: true, ...await chat.checkpoint(owner, body) }))
  register('/chat/stop', async (owner, body) => { await chat.stop(owner, body); return { ok: true } })
  register('/chat/jobs/output', async (owner, body) => ({ ok: true, output: await jobOutput(owner, body) }))
  register('/chat/jobs/stop', async (owner, body) => ({ ok: true, outcome: await jobStop(owner, body) }))
  register('/chat/observe', (owner, body) => chat.observe(owner, body), (response, subscribe) => {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    response.flushHeaders()
    const unsubscribe = subscribe((projection, error) => {
      if (error) { response.destroy(error); return }
      response.write(`event: projection\ndata: ${JSON.stringify(projection)}\n\n`)
    })
    const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000)
    response.once('close', () => { clearInterval(heartbeat); unsubscribe() })
  })
}
