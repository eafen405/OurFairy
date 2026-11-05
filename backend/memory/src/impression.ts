/**
 * Per-user impressions: the persistent overall understanding Fairy has of one
 * user, injected into that user's system prompt, read-only for the user and replaceable through the Fairy's tools.
 *
 * This module owns the whole impression rule set so the memory service and the
 * row wiring stay about memories:
 *
 * - the owner is always the authenticated caller (the login credential for a
 *   route, the calling session's immutable header for a tool); no request or
 *   tool argument can select another user's impression;
 * - a write is only accepted after a successful tool read by that same session, and a whole replacement is the only write shape;
 * - 8000 Unicode characters is a hard limit: longer text is refused, never
 *   truncated, and an accepted body is stored exactly as sent;
 * - nothing expires or is rewritten on a timer.
 *
 * The system prompt reads the row through a function evaluated at every
 * assembly, so an edit applies to the next turn without rebuilding the Agent.
 *
 * @module @ourfairy/dsh-memory/src/impression
 */
import { freezeSurface, postHandler } from '@ourfairy/dsh-http/http'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { ImpressionError, toolRegistrar } from './tool-kit.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from './store.js'
// The system prompt seam this row writes one scoped section to. The seam also
// reads the memory service's context augmentation; both imports are type-only.
import type {} from '@deepseek-ai/dsh-system-prompt'

/** The most Unicode characters one impression may hold. */
export const IMPRESSION_MAX_CHARACTERS = 8000

/** The scoped system prompt section carrying one user's impression. */
const IMPRESSION_SECTION = 'ourfairy:impression'

/** The compact frame introducing the persistent overall understanding. */
const PROMPT_HEADER = '当前用户印象（每次互动所需的整体认识，独立于长期记忆）：'

/** One user's impression, as both the page and the model read it. */
export type ImpressionView = {
  readonly content: string
  /** The last write, or null when the row does not exist yet. */
  readonly updatedAt: number | null
}

/** Who a read/write speaks for, and which successful read authorizes it. */
type Caller = {
  readonly shortId: number
  readonly sessionId: string
}

export class ImpressionService {
  #store: MemoryStore
  /** Successful tool reads, keyed by the calling session. */
  #reads = new Set<string>()

  constructor({ store }: { readonly store: MemoryStore }) {
    this.#store = store
  }

  /** Read without granting edit permission; a missing row is an empty impression. */
  read(caller: { readonly shortId: number }): ImpressionView {
    const row = this.#store.impression({ shortId: caller.shortId })
    return row === undefined ? { content: '', updatedAt: null } : { content: row.content, updatedAt: row.updated_at }
  }

  /** Only a successful tool read authorizes a subsequent edit in this session. */
  readForEdit(caller: Caller): ImpressionView {
    const view = this.read(caller)
    this.#reads.add(caller.sessionId)
    return view
  }

  /**
   * Replace one user's whole impression. The caller must have read it first;
   * over-length content is refused before any write, never clipped.
   */
  edit(caller: Caller & { readonly content: unknown }): void {
    if (!this.#reads.has(caller.sessionId)) {
      throw new ImpressionError(409, 'impression/not-read', 'read the impression before editing it')
    }
    if (typeof caller.content !== 'string') {
      throw new ImpressionError(400, 'impression/invalid-content', 'the impression body must be a string')
    }
    const characters = [...caller.content].length
    if (characters > IMPRESSION_MAX_CHARACTERS) {
      throw new ImpressionError(400, 'impression/too-long',
        `the impression is ${String(characters)} Unicode characters; the limit is ${String(IMPRESSION_MAX_CHARACTERS)}`)
    }
    this.#store.saveImpression({ shortId: caller.shortId, content: caller.content })
  }

  /**
   * The text one user's system prompt carries: the stored body when there is
   * one, and nothing at all otherwise. Evaluated at each assembly, so it
   * reflects the latest edit and never expires.
   */
  promptText(shortId: number): string {
    const row = this.#store.impression({ shortId })
    if (row === undefined || row.content === '') return ''
    return `${PROMPT_HEADER}\n${row.content}`
  }

  /** Drop one calling session's read authorization when its Agent is disposed. */
  forget(sessionId: string): void {
    this.#reads.delete(sessionId)
  }
}

/** The session a tool call speaks for, as the owner derived from its header. */
type ToolCaller = Caller

/** The calling session's owner and gate key, or a refusal when it has no owner. */
function toolCallerOf(exec: ToolRunContext): ToolCaller {
  // The native tool contract types the agent as optional; a tool registered on
  // an agent context is only executed inside one.
  const agent = exec.agent as Agent
  const shortId = shortIdOf(agent.session.header.owner)
  if (shortId === undefined) {
    throw new ImpressionError(403, 'impression/missing-owner', 'the calling session has no owner')
  }
  return { shortId, sessionId: agent.session.id }
}

/** Make one service failure readable to the model with its product code first. */
function toolFailure(error: unknown): Error {
  if (error instanceof ImpressionError) return new Error(`${error.code}: ${error.message}`)
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Register the impression prompt section and both tools on one owned Agent.
 *
 * A session without an owner (the later maintenance child) gets neither: the
 * impression belongs to a user, and memory maintenance must not read or edit
 * it. `registered` is the same name set the memory tools use, so a replayed
 * registration on one Agent cannot add a duplicate section or tool.
 * @param agent - the agent whose scoped context is written.
 * @param service - the impression service the section and handlers call.
 * @param registered - the names already registered on this agent.
 */
export function registerImpressions(agent: Agent, service: ImpressionService, registered: Set<string>): void {
  const shortId = shortIdOf(agent.session.header.owner)
  if (shortId === undefined) return
  if (!registered.has(IMPRESSION_SECTION)) {
    agent.ctx.systemPrompt.section({
      name: IMPRESSION_SECTION,
      order: 2,
      interpolate: false,
      text: () => service.promptText(shortId),
    })
    registered.add(IMPRESSION_SECTION)
  }

  const add = toolRegistrar(agent, registered)
  add('impression_read', {
    description: '读取当前用户的整体印象；不存在时返回空正文。成功后才允许本会话调用 impression_edit。',
    parameters: {},
    execute: async (_args, exec) => {
      const caller = toolCallerOf(exec)
      const view = service.readForEdit(caller)
      return { content: view.content, updated_at: view.updatedAt, max_characters: IMPRESSION_MAX_CHARACTERS }
    },
  })
  add('impression_edit', {
    description: `仅在用户明确要求时整段替换其印象；先在本会话调用 impression_read。最多 ${String(IMPRESSION_MAX_CHARACTERS)} 个 Unicode 字符，超长拒绝，正文原样保存。`,
    parameters: { content: { type: 'string', required: true } },
    execute: async (args, exec) => {
      try {
        service.edit({ ...toolCallerOf(exec), content: args.content })
        return { ok: true }
      } catch (error) {
        throw toolFailure(error)
      }
    },
  })
}

/**
 * The addresses the impression entry publishes, in the order the carrier
 * registers them. The sole route is an authenticated, owner-only read.
 */
export const SURFACE = freezeSurface([
  { path: '/impression/read', method: 'POST', auth: 'authentication', body: 'json', response: 'json', prefix: 'impression' },
])

/** Paths the impression entry owns, in the order the carrier registers them. */
export const IMPRESSION_PATHS = Object.freeze(SURFACE.map(entry => entry.path))

/** One handler the carrier registers on the web server. */
export type ImpressionHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

/** The identity facts one impression route needs from the presented credential. */
type RouteCaller = { readonly shortId: number }

/**
 * Build one handler per path in {@link IMPRESSION_PATHS}. The caller is the
 * authenticated identity; the body cannot select another user's impression.
 */
export function impressionHandlers({ service, authenticate, fence }: {
  readonly service: ImpressionService
  readonly authenticate: (request: IncomingMessage) => RouteCaller | undefined
  readonly fence: (request: IncomingMessage) => unknown
}): Map<string, ImpressionHandler> {
  const callerOf = (request: IncomingMessage): RouteCaller => {
    const user = authenticate(request)
    if (user === undefined) {
      throw new ImpressionError(401, 'impression/unauthorized', 'present a live session credential')
    }
    return { shortId: user.shortId }
  }
  const post = (handle: (body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>): ImpressionHandler => postHandler({
    fence,
    handle,
    HttpError: ImpressionError,
    codePrefix: 'impression',
    internalMessage: 'the impression entry failed to handle this request',
  })
  /** The page's view of one impression; the owner is never repeated on the wire. */
  const publicView = (view: ImpressionView): Record<string, unknown> => ({
    content: view.content,
    updatedAt: view.updatedAt,
    maxCharacters: IMPRESSION_MAX_CHARACTERS,
  })

  return new Map([
    ['/impression/read', post(async (_body, request) => {
      const caller = callerOf(request)
      return { ok: true, impression: publicView(service.read(caller)) }
    })],

  ])
}
