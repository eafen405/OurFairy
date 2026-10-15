/** A delivery shares the native Session writer; SQLite only coordinates crash recovery. */
import { createHash } from 'node:crypto'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionScopeError } from '@ourfairy/dsh-sessions'

export function installDelivery(ctx, chat) {
  const store = ctx.identity.store
  const receipt = row => ({ deliveryId: row.deliveryId, sessionId: row.sessionId,
    messageId: row.messageId, acceptedSeq: row.acceptedSeq })
  const find = (events, id) => events.find(event => event.type === 'delivery/message' && event.data.deliveryId === id)
  const append = (session, row) => session.append('delivery/message', {
    deliveryId: row.deliveryId,
    origin: { sessionId: row.senderSessionId, owner: `user:${row.senderShortId}` },
    message: createAssistantMessage({ content: [{ type: 'text', text: row.text }],
      source: { deliveryId: row.deliveryId, senderSessionId: row.senderSessionId } }),
  }, { surfaceOp: 'append' })

  async function settle(row) {
    return chat._exclusively(row.sessionId, async () => {
      let event
      const state = chat._live.get(row.sessionId)
      if (state) {
        event = find((await chat._events(row.sessionId)).events, row.deliveryId) ?? append(state.agent.session, row)
        await chat._barrier(state)
      } else {
        const handle = await ctx.sessionPersistence.open(row.sessionId, 'write')
        try {
          const read = await handle.read()
          event = find(read.events, row.deliveryId)
          if (!event) {
            const session = ctx.sessions.prepare(row.sessionId, { seed: read.events, meta: handle.header,
              inheritedEventCount: handle.inheritedEventCount, eventState: read.eventState })
            event = append(session, row)
            // Restore may add a lifecycle marker; persist the whole new suffix.
            await handle.append(session.snapshotEvents(read.events.length))
          }
          await handle.flush()
        } finally { await handle.close() }
      }
      const result = { messageId: event.data.message.id, acceptedSeq: event.seq }
      store.completeDelivery(row.deliveryId, result)
      // Notification consumers can recover from the durable business row even if an outlet fails.
      try { ctx.emit('ourfairy/delivery', { ...receipt(row), ...result }) } catch {}
      return { ...receipt(row), ...result }
    })
  }
  let recovery = Promise.resolve()
  const recover = async () => { for (const row of store.pendingDeliveries()) await settle(row) }
  recovery = recover()
  // Retain a rejection for calls to await, while also reporting failed startup recovery.
  recovery.catch(error => ctx.logger('ourfairy-delivery').warn(error))
  chat.deliver = async (agent, callId, { recipientShortId, text }) => {
    await recovery
    const senderShortId = Number(agent.session.header.owner?.replace(/^user:/, ''))
    const sender = store.userByShortId(senderShortId)
    if (!sender) throw new SessionScopeError(403, 'delivery/unknown-sender', 'delivery requires an active session owner')
    if (!Number.isSafeInteger(recipientShortId) || !store.userByShortId(recipientShortId)) {
      throw new SessionScopeError(404, 'delivery/unknown-recipient', 'name an existing user short number')
    }
    if (typeof text !== 'string' || !text.trim()) throw new SessionScopeError(400, 'delivery/invalid-text', 'provide the exact text to deliver')
    const target = store.userByShortId(recipientShortId)
    const primary = await ctx.ourfairySessions.primary(target)
    const deliveryId = createHash('sha256').update(JSON.stringify([agent.session.id, callId])).digest('hex')
    const row = store.prepareDelivery({ deliveryId, senderShortId, senderSessionId: agent.session.id,
      recipientShortId, sessionId: primary.id, text })
    return settle(row)
  }
  const register = agent => agent.ctx.tools.register(defineTool({ name: 'deliver_message',
    description: 'Deliver only the specified text to a user’s fixed primary chat. This does not read their history or start their Fairy. The call authorizes delivery; no extra sharing approval is needed.',
    parameters: { recipientShortId: { type: 'integer', required: true }, text: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => chat.deliver(exec.agent, exec.callId, args),
  }))
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}
