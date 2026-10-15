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
  const manifest = row => row.files.map(file => file.prepared)
  const append = (session, row) => session.append('delivery/message', {
    deliveryId: row.deliveryId,
    origin: { sessionId: row.senderSessionId, owner: `user:${row.senderShortId}` },
    message: createAssistantMessage({ content: [{ type: 'text', text: row.text }, ...manifest(row).map(input => ({ type: 'file', attachment: input.original }))],
      source: { deliveryId: row.deliveryId, senderSessionId: row.senderSessionId, ...(row.files.length ? { attachments: manifest(row) } : {}) } }),
  }, { surfaceOp: 'append' })

  async function settle(row) {
    const result = await chat._exclusively(row.sessionId, async () => {
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
      return { ...receipt(row), ...result }
    })
    // The writer queue ends before notifying; the durable row survives any outlet failure.
    try { await ctx.parallel('ourfairy/delivery', result) }
    catch (error) { ctx.logger('ourfairy-delivery').warn('delivery %s notification outlet failed: %s', row.deliveryId, error.message) }
    return result
  }
  const recovery = (async () => {
    for (const row of store.pendingDeliveries()) {
      try { await settle(row) }
      catch (error) { ctx.logger('ourfairy-delivery').warn('pending delivery %s: %s', row.deliveryId, error.message) }
    }
  })()
  chat.deliver = async (agent, callId, { recipientShortId, text, files = [] }, signal) => {
    await recovery
    const senderShortId = Number(agent.session.header.owner?.replace(/^user:/, ''))
    const sender = store.userByShortId(senderShortId)
    if (!sender) throw new SessionScopeError(403, 'delivery/unknown-sender', 'delivery requires an active session owner')
    if (!Number.isSafeInteger(recipientShortId) || !store.userByShortId(recipientShortId)) {
      throw new SessionScopeError(404, 'delivery/unknown-recipient', 'name an existing user short number')
    }
    if (typeof text !== 'string' || !text.trim()) throw new SessionScopeError(400, 'delivery/invalid-text', 'provide the exact text to deliver')
    files = fileSelectors(files)
    const target = store.userByShortId(recipientShortId)
    const primary = await ctx.ourfairySessions.primary(target)
    const deliveryId = createHash('sha256').update(JSON.stringify([agent.session.id, callId])).digest('hex')
    return chat._exclusively('delivery:' + deliveryId, async () => {
      let row = store.prepareDelivery({ deliveryId, senderShortId, senderSessionId: agent.session.id,
        recipientShortId, sessionId: primary.id, text, files: files.map(selector => ({ selector, prepared: null })) })
      for (let index = 0; index < row.files.length; index++) {
        if (row.files[index].prepared !== null) continue
        const prepared = await ctx.ourfairyAttachments.prepareDeliveryFile(agent, row.files[index].selector, signal)
        const bytes = row.files.reduce((sum, file) => sum + (file.prepared?.original.bytes ?? 0), prepared.original.bytes)
        if (bytes > 64 * 1024 * 1024) throw new SessionScopeError(413, 'delivery/too-large', 'delivery files exceed 64 MiB')
        row = store.prepareDeliveryFile(deliveryId, index, prepared)
      }
      return settle(row)
    })
  }
  const register = agent => agent.ctx.tools.register(defineTool({ name: 'deliver_message',
    description: 'Deliver the specified text and optional files selected by readable path or current-session messageId/index to a user’s fixed primary chat. This does not read their history or start their Fairy. The call authorizes delivery; no extra sharing approval is needed.',
    parameters: { recipientShortId: { type: 'integer', required: true }, text: { type: 'string', required: true },
      files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, messageId: { type: 'string' }, index: { type: 'integer' } } } } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => chat.deliver(exec.agent, exec.callId, args, exec.signal),
  }))
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}

function fileSelectors(files) {
  if (!Array.isArray(files) || files.length > 8) throw new SessionScopeError(400, 'delivery/invalid-files', 'select at most 8 files')
  return files.map(file => {
    if (file && typeof file.path === 'string' && file.path.trim() && file.messageId === undefined && file.index === undefined) return { path: file.path }
    if (file && file.path === undefined && typeof file.messageId === 'string' && file.messageId && Number.isSafeInteger(file.index) && file.index >= 0) return { messageId: file.messageId, index: file.index }
    throw new SessionScopeError(400, 'delivery/invalid-files', 'each selected file needs a readable path or a current-session messageId/index')
  })
}
