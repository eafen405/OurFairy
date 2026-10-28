/** Remote chat operations over the live-session runtime (`runtime.ts`). */
import { Service } from '@deepseek-ai/cordis'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import { uploadIdsOf } from '@ourfairy/dsh-attachments'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { receiptFrom, transcriptAt, transcriptDefinition } from './units.js'
import { requestedSessionId } from './runtime.js'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage } from 'node:http'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { AttachmentInput } from './units.js'
import type { LiveSession, ProjectionListener, SessionOwner, SessionRuntime } from './runtime.js'
import type { SessionId } from '@deepseek-ai/dsh-session'

export class ChatError extends SessionScopeError {}

/** The untrusted JSON body one chat route receives. */
export type ChatRequest = Record<string, unknown>

/**
 * The product's user-message source: the native kind plus the product's own
 * request id and the attachments the request admitted.
 */
interface ProductUserSource {
  readonly kind: 'user'
  readonly rpcId: string
  readonly attachments?: readonly AttachmentInput[]
}

/**
 * `Number.isSafeInteger` as a type guard, so a checked value narrows to a
 * number before it is compared.
 */
const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value)

function requestIdOf(requestId: unknown): string {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) {
    throw new ChatError(400, 'chat/invalid-request', 'requestId must be a stable nonempty string of at most 128 characters')
  }
  return requestId
}

function maxEventsOf(value: unknown = 64): number {
  if (!isSafeInteger(value) || value < 1 || value > 256) {
    throw new ChatError(400, 'chat/invalid-page', 'maxEvents must be an integer from 1 to 256')
  }
  return value
}

/** One receipt match, as the transcript unit reports it. */
type ReceiptMatch = NonNullable<ReturnType<typeof receiptFrom>>

/** The observer one `/chat/observe` route registers; it returns the unsubscribe. */
export type ChatObserver = (listener: ProjectionListener) => () => void

export class RemoteChat extends Service {
  /** The live-session runtime every route reads through. */
  declare runtime: SessionRuntime

  constructor(ctx: Context, runtime: SessionRuntime) {
    super(ctx, 'ourfairyChat')
    this.runtime = runtime
  }

  /**
   * The caller one request speaks for.
   *
   * @param request - the request whose credential names the caller.
   * @param code - the unauthorized code this route family answers with; the
   *   session family's own route keeps its family's code.
   */
  caller(request: IncomingMessage, code = 'chat/unauthorized'): SessionOwner {
    const caller = this.ctx.ourfairySessions.authenticate(request)
    if (caller === undefined) throw new ChatError(401, code, 'present a live session credential')
    return caller
  }
  /** The transcript unit state for one live session, through the runtime's one lookup. */
  transcriptState(state: LiveSession) {
    return this.runtime.unitState(state, transcriptDefinition)
  }
  async send(owner: SessionOwner, { sessionId, requestId, text, uploadIds = [] }: ChatRequest) {
    const id = requestedSessionId(sessionId)
    const request = requestIdOf(requestId)
    const admitted = uploadIdsOf(uploadIds)
    if (typeof text !== 'string' || (!text.trim() && admitted.length === 0)) throw new ChatError(400, 'chat/invalid-request', 'provide text or an attachment')
    const state = await this.runtime.open(owner, id)
    return this.runtime.runSession(id, async () => {
      // Receipts live in the transcript unit; a retry answers from its state.
      let found = receiptFrom(this.transcriptState(state), request)
      if (found !== null && (found.text !== text || JSON.stringify(found.uploadIds) !== JSON.stringify(admitted))) throw new ChatError(409, 'chat/request-conflict', 'this requestId already accepted different text')
      if (found === null) {
        state.error = null
        const attachments = await this.ctx.ourfairyAttachments.inputs(owner, id, admitted)
        const content: ContentBlock[] = [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...attachments.map((item): ContentBlock => item.image ? { type: 'image', attachment: item.image } : { type: 'file', attachment: item.original }),
        ]
        const source: ProductUserSource = { kind: 'user', rpcId: request, ...(attachments.length ? { attachments } : {}) }
        this.runtime.followup(state, createUserMessage({ content, source }))
        // Answer from the unit state after the follow-up splice commits.
        found = receiptFrom(this.transcriptState(state), request)
      }
      await this.runtime.barrier(state)
      this.runtime.publish(state)
      // The follow-up committed the splice, so the receipt is in the unit state.
      return (found as ReceiptMatch).receipt
    })
  }
  async receipt(owner: SessionOwner, { sessionId, requestId }: ChatRequest) {
    const request = requestIdOf(requestId)
    const state = await this.runtime.open(owner, requestedSessionId(sessionId))
    return this.runtime.runSession(requestedSessionId(sessionId), async () => {
      await this.runtime.barrier(state)
      return receiptFrom(this.transcriptState(state), request)?.receipt ?? null
    })
  }
  async read(owner: SessionOwner, { sessionId, maxEvents }: ChatRequest) {
    const limit = maxEventsOf(maxEvents)
    const state = await this.runtime.open(owner, requestedSessionId(sessionId))
    await this.runtime.barrier(state)
    return this.runtime.projection(state, { maxEvents: limit })
  }
  async page(owner: SessionOwner, { sessionId, throughSeq, beforeSeq, maxEvents }: ChatRequest) {
    const limit = maxEventsOf(maxEvents)
    const id = requestedSessionId(sessionId)
    const state = await this.runtime.open(owner, id)
    // The live session already knows its observed cut; a page never re-reads
    // the log to learn it.
    const cursor = this.runtime.cursorOf(state)
    if (!isSafeInteger(throughSeq) || throughSeq < -1 || throughSeq > cursor
      || !isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > throughSeq + 1) {
      throw new ChatError(400, 'chat/invalid-page', 'name a fixed inclusive throughSeq and exclusive beforeSeq within that cut')
    }
    const end = Math.min(throughSeq + 1, beforeSeq)
    const fromSeq = Math.max(0, end - limit)
    // Project at the fixed cut, then select rows whose authoritative seq belongs
    // to this page. A page can validly contain no bubbles but still fills event coverage.
    return { sessionId: id, throughSeq, fromSeq, beforeSeq: fromSeq > 0 ? fromSeq : null,
      hasMore: fromSeq > 0, events: await this.runtime.pageEvents(state, fromSeq, end),
      messages: transcriptAt(this.transcriptState(state), throughSeq, fromSeq)
        .filter(message => message.seq < end) }
  }
  async checkpoint(owner: SessionOwner, { sessionId }: ChatRequest) {
    const state = await this.runtime.open(owner, requestedSessionId(sessionId))
    await this.runtime.barrier(state)
    return { sessionId: requestedSessionId(sessionId), durableThroughSeq: state.durableThroughSeq }
  }
  async stop(owner: SessionOwner, { sessionId }: ChatRequest) {
    this.runtime.stop(await this.runtime.open(owner, requestedSessionId(sessionId)))
  }

  /**
   * Pin one session's title to the text the caller wrote.
   *
   * The path is the session family's (`/sessions/rename`) and so are the codes
   * below: the subject is one session, and the caller reads the session family's
   * vocabulary. Serving it is chat's job all the same, because a rename is
   * accepted only on a live session: the native title service refuses any other
   * object, and opening one needs the persona and model selection only this
   * module installs.
   *
   * The answer is the row the list returns, built by the very service the list
   * uses, so "the list shows what the rename answered" cannot drift.
   */
  async rename(owner: SessionOwner, { sessionId, title }: ChatRequest) {
    const id = requestedSessionId(sessionId)
    if (typeof title !== 'string') throw new SessionScopeError(400, 'sessions/invalid-request', 'provide the new title as text')
    // This open exists to write a title, not to generate one: the historical
    // backfill would spend a model request that the next line makes pointless.
    const state = await this.runtime.open(owner, id, { titleBackfill: false })
    return await this.runtime.runSession(id, async () => {
      const accepted = this.runtime.renameTitle(state, title)
      if (accepted === undefined) {
        // Nothing was written, so this open still owes the session the one
        // backfill every other open would have given it.
        this.runtime.backfillTitle(state)
        throw new SessionScopeError(400, 'sessions/empty-title', 'the title has no visible characters once normalized')
      }
      await this.runtime.barrier(state)
      const header = await this.ctx.ourfairySessions.read(owner, id)
      return this.ctx.ourfairySessions.expose(header, owner.shortId, await this.ctx.ourfairySessions.titleOf(header.id))
    })
  }
  /** Routes pinned by replies running right now; a configuration write refuses to change them. */
  activeReplies() { return this.runtime.activeReplies() }

  /**
   * Run one shared-configuration write while the routes of running replies are
   * held still; `refusal` names them or returns undefined to allow the write.
   */
  withReplyGuard(refusal: (replies: { sessionId: SessionId; provider: string; model: string }[]) => unknown, work: () => Promise<unknown>) { return this.runtime.withReplyGuard(refusal, work) }

  async observe(owner: SessionOwner, { sessionId, maxEvents }: ChatRequest): Promise<ChatObserver> {
    const limit = maxEventsOf(maxEvents)
    const state = await this.runtime.open(owner, requestedSessionId(sessionId))
    await this.runtime.barrier(state)
    // Subscriber is registered before its initial observation; changed projections use the same source.
    return listener => this.runtime.subscribe(state, limit, listener)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The product's chat service, as this package provides it. */
    ourfairyChat: RemoteChat
  }
}
