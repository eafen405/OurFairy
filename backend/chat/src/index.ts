/** Narrow product routes over native Agent/SessionQuery, without the upstream controller. */
import { postHandler } from '@ourfairy/dsh-http/http'
import { RemoteChat } from './service.js'
import { SessionRuntime } from './runtime.js'
import { ChatRuntimeFacade } from './runtime-facade.js'
import { installJobs } from './jobs.js'
import { registerProjectionUnits } from './units.js'
import { installSpillRead } from './spill-read.js'
import { respondToChatObserver } from './observe.js'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import type { ChatObserver, ChatRequest } from './service.js'
import type { SessionOwner } from './runtime.js'
// Type-only: the dsh context's own seams — the web server's route registry and
// the carrier's trust fence.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'

/**
 * The seams the other product rows consume: the chat service and the narrow
 * runtime facade. They are type-only re-exports, so the package's runtime
 * surface is unchanged while the context augmentations they declare reach the
 * rows that read them.
 */
export type { RemoteChat } from './service.js'
export type { ChatRuntimeFacade } from './runtime-facade.js'

export const name = 'ourfairy-chat'
/**
 * Services this row waits for before it accepts work. The ordering-only entry is
 * annotated here; the optional `spillStore` is read with `ctx.get` and its
 * absence semantics are annotated at the read site.
 */
export const inject = ['webServer', 'connection', 'ourfairySessions', 'ourfairySpaces', 'agents',
  // Declared for ordering/side effect, not for a call: `agentLoop` registers
  // the Agent factory that `agents.resume` needs, so this row must not take
  // work before that factory is available. Chat never reads `ctx.agentLoop`.
  'agentLoop',
  'agentDefaultModel', 'sessions', 'sessionQuery', 'systemPrompt', 'ourfairyAttachments', 'llm', 'sessionPersistence', 'jobs', 'sessionProjections']
export function apply(ctx: Context): void {
  // Every registered unit folds on the native event drive, once per session and
  // shared by every observer; `register` installs its own effect on this fiber.
  registerProjectionUnits(ctx)
  const runtime = new SessionRuntime(ctx)
  new ChatRuntimeFacade(ctx, runtime)
  const chat = new RemoteChat(ctx, runtime)
  const { jobOutput, jobStop } = installJobs(ctx, runtime)
  installSpillRead(ctx)
  const register = (path: string, handle: (owner: SessionOwner, body: ChatRequest) => Promise<unknown>, respond?: (response: ServerResponse, result: unknown) => void) => ctx.effect(() => ctx.webServer.register({ kind: 'exact', path,
    handler: postHandler({ fence: request => ctx.connection.fence(request), HttpError: SessionScopeError,
      codePrefix: 'chat', internalMessage: 'remote chat request failed',
      handle: async (body, request) => handle(chat.caller(request), body),
      ...respond !== undefined ? { respond } : {} }),
  }), `ourfairy-chat: ${path}`)
  register('/chat/send', async (owner, body) => ({ ok: true, receipt: await chat.send(owner, body) }))
  register('/chat/receipt', async (owner, body) => ({ ok: true, receipt: await chat.receipt(owner, body) }))
  register('/chat/read', async (owner, body) => ({ ok: true, projection: await chat.read(owner, body) }))
  register('/chat/page', async (owner, body) => ({ ok: true, page: await chat.page(owner, body) }))
  register('/chat/checkpoint', async (owner, body) => ({ ok: true, ...await chat.checkpoint(owner, body) }))
  register('/chat/stop', async (owner, body) => { await chat.stop(owner, body); return { ok: true } })
  register('/chat/jobs/output', async (owner, body) => ({ ok: true, output: await jobOutput(owner, body) }))
  register('/chat/jobs/stop', async (owner, body) => ({ ok: true, outcome: await jobStop(owner, body) }))
  register('/chat/observe', (owner, body) => chat.observe(owner, body), (response, result) => {
    // The route's handler returns the observer; the transport envelope types
    // every route result as unknown.
    respondToChatObserver(response, result as ChatObserver)
  })
}
