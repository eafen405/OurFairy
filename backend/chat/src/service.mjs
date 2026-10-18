/** Remote chat operations over the live-session runtime (`runtime.mjs`). */
import { Service } from '@deepseek-ai/cordis'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import { uploadIdsOf } from '@ourfairy/dsh-attachments'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { receiptIn, transcript } from './projection.mjs'

export class ChatError extends SessionScopeError {}
function requestIdOf(requestId) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 128) {
    throw new ChatError(400, 'chat/invalid-request', 'requestId must be a stable nonempty string of at most 128 characters')
  }
  return requestId
}

function maxEventsOf(value = 64) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) {
    throw new ChatError(400, 'chat/invalid-page', 'maxEvents must be an integer from 1 to 256')
  }
  return value
}

export class RemoteChat extends Service {
  constructor(ctx, runtime) {
    super(ctx, 'ourfairyChat')
    this.runtime = runtime
  }

  caller(request) {
    const caller = this.ctx.ourfairySessions.authenticate(request)
    if (caller === undefined) throw new ChatError(401, 'chat/unauthorized', 'present a live session credential')
    return caller
  }
  async send(owner, { sessionId, requestId, text, uploadIds = [] }) {
    requestIdOf(requestId)
    uploadIds = uploadIdsOf(uploadIds)
    if (typeof text !== 'string' || (!text.trim() && uploadIds.length === 0)) throw new ChatError(400, 'chat/invalid-request', 'provide text or an attachment')
    const state = await this.runtime.open(owner, sessionId)
    return this.runtime.runSession(sessionId, async () => {
      let found = receiptIn((await this.runtime.events(sessionId)).events, sessionId, requestId)
      if (found !== null && (found.text !== text || JSON.stringify(found.uploadIds) !== JSON.stringify(uploadIds))) throw new ChatError(409, 'chat/request-conflict', 'this requestId already accepted different text')
      if (found === null) {
        state.error = null
        const attachments = await this.ctx.ourfairyAttachments.inputs(owner, sessionId, uploadIds)
        this.runtime.followup(state, createUserMessage({ content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...attachments.map(item => item.image ? { type: 'image', attachment: item.image } : { type: 'file', attachment: item.original }),
        ], source: { kind: 'user', rpcId: requestId, ...(attachments.length ? { attachments } : {}) } }))
        found = receiptIn((await this.runtime.events(sessionId)).events, sessionId, requestId)
      }
      await this.runtime.barrier(state)
      this.runtime.publish(state)
      return found.receipt
    })
  }
  async receipt(owner, { sessionId, requestId }) {
    requestIdOf(requestId)
    const state = await this.runtime.open(owner, sessionId)
    return this.runtime.runSession(sessionId, async () => {
      await this.runtime.barrier(state)
      return receiptIn((await this.runtime.events(sessionId)).events, sessionId, requestId)?.receipt ?? null
    })
  }
  async read(owner, { sessionId, maxEvents }) {
    const limit = maxEventsOf(maxEvents)
    const state = await this.runtime.open(owner, sessionId)
    await this.runtime.barrier(state)
    return this.runtime.projection(state, { maxEvents: limit })
  }
  async page(owner, { sessionId, throughSeq, beforeSeq, maxEvents }) {
    const limit = maxEventsOf(maxEvents)
    await this.runtime.open(owner, sessionId)
    const { events, cursor } = await this.runtime.events(sessionId)
    if (!Number.isSafeInteger(throughSeq) || throughSeq < -1 || throughSeq > cursor
      || !Number.isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > throughSeq + 1) {
      throw new ChatError(400, 'chat/invalid-page', 'name a fixed inclusive throughSeq and exclusive beforeSeq within that cut')
    }
    const end = Math.min(throughSeq + 1, beforeSeq)
    const fromSeq = Math.max(0, end - limit)
    // Project at the fixed cut, then select rows whose authoritative seq belongs
    // to this page. A page can validly contain no bubbles but still fills event coverage.
    return { sessionId, throughSeq, fromSeq, beforeSeq: fromSeq > 0 ? fromSeq : null,
      hasMore: fromSeq > 0, events: events.slice(fromSeq, end),
      messages: transcript(events.slice(0, throughSeq + 1), sessionId)
        .filter(message => message.seq >= fromSeq && message.seq < end) }
  }
  async checkpoint(owner, { sessionId }) {
    const state = await this.runtime.open(owner, sessionId)
    await this.runtime.barrier(state)
    return { sessionId, durableThroughSeq: state.durableThroughSeq }
  }
  async stop(owner, { sessionId }) {
    this.runtime.stop(await this.runtime.open(owner, sessionId))
  }
  /** Routes pinned by replies running right now; a configuration write refuses to change them. */
  activeReplies() { return this.runtime.activeReplies() }

  /**
   * Run one shared-configuration write while the routes of running replies are
   * held still; `refusal` names them or returns undefined to allow the write.
   */
  withReplyGuard(refusal, work) { return this.runtime.withReplyGuard(refusal, work) }

  async observe(owner, { sessionId, maxEvents }) {
    const limit = maxEventsOf(maxEvents)
    const state = await this.runtime.open(owner, sessionId)
    await this.runtime.barrier(state)
    // Subscriber is registered before its initial observation; changed projections use the same source.
    return listener => this.runtime.subscribe(state, limit, listener)
  }
}
