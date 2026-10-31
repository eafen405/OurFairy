/**
 * Peer delivery as its own product row: the `deliver_message` tool, the durable
 * delivery coordination rows behind it, and their recovery at boot.
 *
 * The only chat access is the narrow `ourfairyChatRuntime` service: one
 * at-most-once append that resolves durable, and one outgoing-delivery queue.
 * This package imports no chat module, so disabling this row removes delivery
 * without touching chat's routes.
 */
import { createHash } from 'node:crypto'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import { MAX_ATTACHMENTS, MAX_MESSAGE_BYTES } from '@ourfairy/dsh-attachments'
import { MAINTENANCE_PRESET } from '@ourfairy/dsh-memory/preset'
import { ownerOf, shortIdOf } from '@ourfairy/dsh-identity/owner'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { DeliveryId, Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { IdentityService } from '@ourfairy/dsh-identity'
// The dsh context's own seams and the product's own context rows: the agent
// registry, the tool runtime, the session store, the attachments row and chat's
// narrow runtime facade. The imports are type-only, so they add no runtime
// dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@ourfairy/dsh-attachments'
import type {} from '@ourfairy/dsh-chat'
import type {} from '@ourfairy/dsh-identity'
import type {} from '@ourfairy/dsh-sessions'

export const name = 'ourfairy-delivery'
export const inject = ['identity', 'ourfairySessions', 'ourfairyAttachments', 'ourfairyChatRuntime', 'tools', 'agents']

/** One delivery row, as identity's delivery face exposes it. */
type DeliveryRow = NonNullable<ReturnType<IdentityService['deliveries']['prepare']>>

/** One user as identity's user face exposes it. */
type UserRow = NonNullable<ReturnType<IdentityService['users']['byShortId']>>

/**
 * One prepared delivery file, as the attachments row prepares it.
 *
 * The attachments row is the authority on the prepared file's shape; the
 * delivery row reads it back through the same context seam chat reads its
 * admitted attachments through.
 */
type PreparedFile = Awaited<ReturnType<Context['ourfairyAttachments']['prepareDeliveryFile']>>

/** The selector one delivery names, as the attachments row reads it. */
type DeliverySelector = Parameters<Context['ourfairyAttachments']['prepareDeliveryFile']>[1]

/** One delivered-message event, as the session log carries it. */
type DeliveryEvent = Extract<SessionEvent, { type: 'delivery/message' }>

/**
 * The product's extension of the native delivered-message source.
 *
 * The native `DeliveredMessageSource` carries the delivery id and the sending
 * session; the product adds the attachment manifest the delivery shares. This
 * is a local view type, not an augmentation of the native source map: the chat
 * row keeps its own view type of the product's user source, and two separate
 * programs augmenting the same native map would collide.
 */
interface ProductDeliveredSource {
  readonly deliveryId: string
  readonly senderSessionId: string
  readonly attachments?: readonly PreparedFile[]
}

/** The delivery tool's arguments, as its parameter schema declares them. */
interface DeliveryArgs {
  readonly recipientShortId: number
  readonly text: string
  readonly files?: DeliverySelector[]
}

export function apply(ctx: Context) {
  const runtime = ctx.ourfairyChatRuntime
  const { users, deliveries } = ctx.identity
  const receipt = (row: DeliveryRow) => ({ deliveryId: row.deliveryId, sessionId: row.sessionId,
    messageId: row.messageId, acceptedSeq: row.acceptedSeq })
  const find = (events: readonly SessionEvent[], id: string): DeliveryEvent | undefined => events.find((event): event is DeliveryEvent => event.type === 'delivery/message' && event.data.deliveryId === id)
  // The store keeps the prepared file as its own JSON, so the row carries it
  // untyped; the attachments row's prepared file is the authority, and the
  // manifest is only taken once every file of the row is prepared.
  const manifest = (row: DeliveryRow): PreparedFile[] => row.files.map(file => file.prepared as PreparedFile)
  const append = (session: Session, row: DeliveryRow): DeliveryEvent => session.append('delivery/message', {
    deliveryId: row.deliveryId as DeliveryId,
    origin: { sessionId: row.senderSessionId as SessionId, owner: ownerOf(row.senderShortId) },
    message: createAssistantMessage({ content: [{ type: 'text', text: row.text }, ...manifest(row).map((input): ContentBlock => ({ type: 'file', attachment: input.original }))],
      source: { deliveryId: row.deliveryId, senderSessionId: row.senderSessionId, ...(row.files.length ? { attachments: manifest(row) } : {}) } as ProductDeliveredSource }),
  }, { surfaceOp: 'append' })

  async function settle(row: DeliveryRow) {
    // One call owns the whole write protocol: the target session's queue, the
    // live/cold branch, dedupe against the live-preferred read, the cold
    // handle's lifecycle and the durability barrier. It resolves only after the
    // event is durable, so the business row is completed afterwards.
    const event = await runtime.appendOnce(row.sessionId as SessionId,
      events => find(events, row.deliveryId),
      session => append(session, row))
    const result = { messageId: event.data.message.id, acceptedSeq: event.seq }
    // The durable row is the authority on the delivery fact; the event is durable
    // before this write, and the session writer queue has ended before notifying.
    deliveries.complete(row.deliveryId, result)
    const settled = { ...receipt(row), ...result }
    // The writer queue ends before notifying; the durable row survives any outlet failure.
    try { await ctx.parallel('ourfairy/delivery', settled) }
    // The caught value is reported as it is; the migration does not turn it
    // into a different error.
    catch (error) { ctx.logger('ourfairy-delivery').warn('delivery %s notification outlet failed: %s', row.deliveryId, (error as Error).message) }
    return settled
  }
  const recovery = (async () => {
    for (const row of deliveries.pending()) {
      try { await settle(row) }
      catch (error) { ctx.logger('ourfairy-delivery').warn('pending delivery %s: %s', row.deliveryId, (error as Error).message) }
    }
  })()
  const deliver = async (agent: Agent, callId: ToolCallId, { recipientShortId, text, files = [] }: DeliveryArgs, signal: AbortSignal) => {
    await recovery
    // The owner may be missing: the identity face coerces the short id and
    // answers with no user, and the refusal below is the row's answer to that.
    // The cast narrows the type only; the value is passed on unchanged.
    const senderShortId = shortIdOf(agent.session.header.owner) as number
    const sender = users.byShortId(senderShortId)
    if (!sender) throw new SessionScopeError(403, 'delivery/unknown-sender', 'delivery requires an active session owner')
    if (!Number.isSafeInteger(recipientShortId) || !users.byShortId(recipientShortId)) {
      throw new SessionScopeError(404, 'delivery/unknown-recipient', 'name an existing user short number')
    }
    if (typeof text !== 'string' || !text.trim()) throw new SessionScopeError(400, 'delivery/invalid-text', 'provide the exact text to deliver')
    files = fileSelectors(files)
    // The recipient was checked above, so the user is there; the identity face
    // types its lookup as optional and the migration adds no second check.
    const target = users.byShortId(recipientShortId) as UserRow
    const primary = await ctx.ourfairySessions.primary(target)
    const deliveryId = createHash('sha256').update(JSON.stringify([agent.session.id, callId])).digest('hex')
    return runtime.runDelivery(deliveryId as SessionId, async () => {
      // The store writes the row and reads it back in the same transaction, so
      // the row is there; the migration keeps the original failure instead of
      // adding a check.
      let row = deliveries.prepare({ deliveryId, senderShortId, senderSessionId: agent.session.id,
        recipientShortId, sessionId: primary.id, text, files: files.map(selector => ({ selector, prepared: null })) }) as DeliveryRow
      for (let index = 0; index < row.files.length; index++) {
        // The loop bound is the file count, so the index is in range.
        if (row.files[index]!.prepared !== null) continue
        const prepared = await ctx.ourfairyAttachments.prepareDeliveryFile(agent, row.files[index]!.selector as DeliverySelector, signal)
        const bytes = row.files.reduce((sum, file) => sum + ((file.prepared as PreparedFile | null | undefined)?.original.bytes ?? 0), prepared.original.bytes)
        if (bytes > MAX_MESSAGE_BYTES) throw new SessionScopeError(413, 'delivery/too-large', 'delivery files exceed 64 MiB')
        row = deliveries.prepareFile(deliveryId, index, prepared) as DeliveryRow
      }
      return settle(row)
    })
  }
  const register = (agent: Agent): undefined => {
    // The memory maintenance child may use long-term memory tools only; a
    // scope's own registration cannot be hidden by dsh's tool restriction, so
    // every product row skips this preset.
    if (agent.session.header?.agentPreset === MAINTENANCE_PRESET) return undefined
    agent.ctx.tools.register(defineTool({ name: 'deliver_message',
      description: 'Deliver the specified text and optional files selected by readable path or current-session messageId/index to a user’s fixed primary chat. This does not read their history or start their Fairy. The call authorizes delivery; no extra sharing approval is needed.',
      parameters: { recipientShortId: { type: 'integer', required: true }, text: { type: 'string', required: true },
        files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, messageId: { type: 'string' }, index: { type: 'integer' } } } } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }] },
      // The tool contract types the agent as optional; the delivery needs one,
      // and the migration does not add a check the tool never had.
      execute: (args, exec) => deliver(exec.agent as Agent, exec.callId, args, exec.signal),
    }))
    return undefined
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}

function fileSelectors(files: DeliveryArgs['files']): DeliverySelector[] {
  if (!Array.isArray(files) || files.length > MAX_ATTACHMENTS) throw new SessionScopeError(400, 'delivery/invalid-files', 'select at most 8 files')
  return files.map(file => {
    if (file && typeof file.path === 'string' && file.path.trim() && file.messageId === undefined && file.index === undefined) return { path: file.path }
    if (file && file.path === undefined && typeof file.messageId === 'string' && file.messageId && isSafeInteger(file.index) && file.index >= 0) return { messageId: file.messageId, index: file.index }
    throw new SessionScopeError(400, 'delivery/invalid-files', 'each selected file needs a readable path or a current-session messageId/index')
  })
}

/**
 * Whether one value is a safe integer.
 *
 * `Number.isSafeInteger` is the check itself; it is written as a type guard so
 * the value that passes it can be used as a number.
 */
function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The product's delivery notification. The delivery row emits it once the
     * durable row has settled; the shape below is the one the notification
     * carries, and it is the same shape chat's test fixture declares, so the
     * two declarations stay mergeable.
     */
    'ourfairy/delivery': (result: { readonly messageId: string; readonly acceptedSeq: number }) => void | Promise<void>
  }
}
