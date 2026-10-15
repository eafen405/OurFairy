/** Public numeric transcript projection; formal Session events remain authoritative. */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'

const attachmentsOf = message => (message.source?.attachments ?? []).map((item, index) => ({ index, type: item.image ? 2 : 1, name: item.name, mime: item.mime, bytes: item.original.bytes }))
export const messageText = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
export function attemptText(stream) {
  return assembleAssistantStream(stream).interruptedBlocks().filter(block => block.type === 'text').map(block => block.text).join('')
}
export function requestMessages(events) {
  return events.flatMap(event => event.type === 'agent/inbox/spliced'
    ? event.data.inserted.map(message => ({ message, seq: event.seq })) : [])
}
export function receiptIn(events, sessionId, requestId) {
  const found = requestMessages(events).find(({ message }) => message.source?.kind === 'user' && message.source.rpcId === requestId)
  return found === undefined ? null : {
    receipt: { sessionId, requestId, messageId: found.message.id, acceptedSeq: found.seq },
    text: messageText(found.message), uploadIds: (found.message.source?.attachments ?? []).map(item => item.uploadId),
  }
}
export function transcript(events, sessionId) {
  const messages = new Map()
  const turnEnds = new Map(events.filter(event => event.type === 'turn/end').map(event => [event.data.turn, event.data.reason.kind]))
  for (const event of events) {
    if (event.type === 'agent/inbox/spliced') {
      for (const message of event.data.inserted) {
        if (message.source?.kind !== 'user' || !message.source.rpcId) continue
        messages.set(message.id, { messageId: message.id, seq: event.seq, requestId: message.source.rpcId, role: 1, status: 1, text: messageText(message), attachments: attachmentsOf(message) })
      }
    } else if (event.type === 'user/message' && isAppendSurfaceEvent(event) && event.data.source?.kind === 'user') {
      const message = event.data
      messages.set(message.id, { messageId: message.id, seq: event.seq, requestId: message.source.rpcId ?? null, role: 1, status: 2, text: messageText(message), attachments: attachmentsOf(message) })
    } else if ((event.type === 'assistant/message' || event.type === 'delivery/message') && isAppendSurfaceEvent(event)) {
      const message = event.data.message
      messages.set(message.id, { messageId: message.id, seq: event.seq, requestId: null, role: 2, status: event.data.interrupted ? 3 : 2, text: messageText(message), attachments: attachmentsOf(message) })
    } else if (event.type === 'assistant/attempt') {
      const messageId = `attempt:${sessionId}:${event.seq}`
      const interrupted = ['aborted', 'interrupted', 'forked'].includes(turnEnds.get(event.data.turn))
      messages.set(messageId, { messageId, seq: event.seq, requestId: null, role: 2, status: interrupted ? 3 : 4, text: attemptText(event.data.stream) })
    }
  }
  return [...messages.values()]
}
