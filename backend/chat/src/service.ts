/** Remote chat operations over the live-session runtime (`runtime.ts`). */
import { Service } from '@deepseek-ai/cordis'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import { uploadIdsOf } from '@ourfairy/dsh-attachments'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { receiptFrom, transcriptDefinition } from './units.js'
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

/** The one 400 for a page whose numbers do not name a range at a committed cut. */
function invalidPage(): ChatError {
  return new ChatError(400, 'chat/invalid-page', 'name a fixed inclusive throughSeq and exclusive beforeSeq within that cut')
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

  caller(request: IncomingMessage): SessionOwner {
    const caller = this.ctx.ourfairySessions.authenticate(request)
    if (caller === undefined) throw new ChatError(401, 'chat/unauthorized', 'present a live session credential')
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
    // Only the static shape of the range is validated here. Whether that cut
    // exists yet is the runtime page operation's dynamic decision, mapped to
    // the same HTTP error below.
    if (!isSafeInteger(throughSeq) || throughSeq < -1
      || !isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > throughSeq + 1) {
      throw invalidPage()
    }
    const page = await this.runtime.page(state, throughSeq, beforeSeq, limit)
    if (page === null) throw invalidPage()
    return page
  }
  async checkpoint(owner: SessionOwner, { sessionId }: ChatRequest) {
    const state = await this.runtime.open(owner, requestedSessionId(sessionId))
    await this.runtime.barrier(state)
    return { sessionId: requestedSessionId(sessionId), durableThroughSeq: state.durableThroughSeq }
  }
  async stop(owner: SessionOwner, { sessionId }: ChatRequest) {
    this.runtime.stop(await this.runtime.open(owner, requestedSessionId(sessionId)))
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
