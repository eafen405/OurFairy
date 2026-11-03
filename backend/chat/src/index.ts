/** Narrow product routes over native Agent/SessionQuery, without the upstream controller. */
import { freezeSurface, mountRoutes, postHandler, type RouteHandler } from '@ourfairy/dsh-http/http'
import { RemoteChat } from './service.js'
import { SessionRuntime } from './runtime.js'
import { ChatRuntimeFacade } from './runtime-facade.js'
import { installJobs } from './jobs.js'
import { registerProjectionUnits } from './units.js'
import { installSpillRead } from './spill-read.js'
import { respondToChatObserver } from './observe.js'
import { SESSION_RENAME_PATH, SessionScopeError } from '@ourfairy/dsh-sessions'
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

/**
 * The addresses this row publishes, in registration order.
 *
 * Nine answer in the `chat` family and one — a rename accepted only on a live
 * session — belongs to the session family, so it uses that family's path
 * constant and error prefix. `observe` is the row's only SSE response; every
 * other address reads a JSON object and writes JSON.
 */
export const SURFACE = freezeSurface([
  { path: '/chat/send', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/receipt', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/read', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/page', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/checkpoint', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/stop', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: SESSION_RENAME_PATH, method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'sessions' },
  { path: '/chat/jobs/output', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/jobs/stop', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'chat' },
  { path: '/chat/observe', method: 'POST', auth: 'ownership', body: 'json', response: 'sse', prefix: 'chat' },
])

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
  // `family` is the code prefix a route answers with. Every chat path answers
  // as `chat/*`; the one session path served here answers in the session
  // family's own vocabulary, because that is the family the caller is reading.
  const post = (family: string, handle: (owner: SessionOwner, body: ChatRequest) => Promise<unknown>, respond?: (response: ServerResponse, result: unknown) => void) => postHandler({
    fence: request => ctx.connection.fence(request), HttpError: SessionScopeError,
    codePrefix: family, internalMessage: 'remote chat request failed',
    handle: async (body, request) => handle(chat.caller(request, `${family}/unauthorized`), body),
    ...respond !== undefined ? { respond } : {},
  })
  const handlers = new Map<string, RouteHandler>([
    ['/chat/send', post('chat', async (owner, body) => ({ ok: true, receipt: await chat.send(owner, body) }))],
    ['/chat/receipt', post('chat', async (owner, body) => ({ ok: true, receipt: await chat.receipt(owner, body) }))],
    ['/chat/read', post('chat', async (owner, body) => ({ ok: true, projection: await chat.read(owner, body) }))],
    ['/chat/page', post('chat', async (owner, body) => ({ ok: true, page: await chat.page(owner, body) }))],
    ['/chat/checkpoint', post('chat', async (owner, body) => ({ ok: true, ...await chat.checkpoint(owner, body) }))],
    ['/chat/stop', post('chat', async (owner, body) => { await chat.stop(owner, body); return { ok: true } })],
    // Serving one address of the session family: a rename is accepted only on a
    // live session, and opening one is this module's job. The path constant stays
    // single-sourced in `@ourfairy/dsh-sessions`.
    [SESSION_RENAME_PATH, post('sessions', async (owner, body) => ({ ok: true, session: await chat.rename(owner, body) }))],
    ['/chat/jobs/output', post('chat', async (owner, body) => ({ ok: true, output: await jobOutput(owner, body) }))],
    ['/chat/jobs/stop', post('chat', async (owner, body) => ({ ok: true, outcome: await jobStop(owner, body) }))],
    ['/chat/observe', post('chat', (owner, body) => chat.observe(owner, body), (response, result) => {
      // The route's handler returns the observer; the transport envelope types
      // every route result as unknown.
      respondToChatObserver(response, result as ChatObserver)
    })],
  ])
  mountRoutes(ctx, { label: 'ourfairy-chat', surface: SURFACE, handlers })
}
