/**
 * The frozen material one maintenance child reads.
 *
 * The child sees the interval's user messages, Fairy replies, attachment names
 * and memory change calls — nothing else. Attachment bodies, every other tool's
 * input and output, impression injections, source system prompts and compaction
 * replacements stay out by construction: they are simply not among the events
 * this module projects. The material is plain text because it is written as the
 * child's user message; source attribution still comes from the child's
 * persistent `parentSession` header, never from this text.
 *
 * @module @ourfairy/dsh-memory/src/material
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'

/** The memory tools whose calls are part of the material. */
export const MEMORY_CHANGE_TOOLS = new Set(['memory_add', 'memory_edit', 'memory_delete', 'memory_switch'])

/** One closed turn that a real user message opened. */
export type ClosedTurn = {
  readonly seq: SessionSeq
  readonly time: number
}

/** The window one material assembly covers: after the last completion, through the frozen cut. */
export type MaterialWindow = {
  readonly events: readonly SessionEvent[]
  /** Last event a completed interval covered; -1 before the first completion. */
  readonly watermarkSeq: number
  /** Frozen last closed-turn position of this interval. */
  readonly cutSeq: number
}

/** The material's opening line; it names the boundary once instead of repeating it per row. */
const MATERIAL_HEADER = '维护材料：以下只包含本封口区间内的用户消息、Fairy 回复、附件名称和记忆变更调用。'
  + '附件正文、其他工具的输入输出、系统提示、印象与压缩摘要都不在材料中。'

/** The product's own fields on a message source, as chat writes them. */
type ProductMessageSource = {
  readonly kind?: string
  readonly attachments?: readonly { readonly name?: string }[]
}

/** Message text, joined from the text blocks the model actually saw. */
function messageText(content: readonly { readonly type: string; readonly text?: string }[] | undefined): string {
  return (content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** Whether one event is an append-origin user message from the human. */
function isHumanMessage(event: SessionEvent): event is SessionEvent<'user/message'> & { surfaceOp: 'append' } {
  if (event.type !== 'user/message' || !isAppendSurfaceEvent(event)) return false
  return (event.data.source as ProductMessageSource | undefined)?.kind === 'user'
}

/** Every closed turn in the observed log that a human user opened. */
export function closedUserTurns(events: readonly SessionEvent[]): ClosedTurn[] {
  const turns: ClosedTurn[] = []
  let humanMessageSeen = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      humanMessageSeen = false
    } else if (isHumanMessage(event)) {
      humanMessageSeen = true
    } else if (event.type === 'turn/end') {
      if (humanMessageSeen) turns.push({ seq: event.seq, time: event.time })
      humanMessageSeen = false
    }
  }
  return turns
}

/**
 * Project one frozen interval into the child's user-visible material.
 *
 * The watermark is exclusive and the cut inclusive: every event after the last
 * completed position up to and including the frozen cut contributes at most
 * one row. Replacement messages are excluded, so a compaction summary never
 * masquerades as conversation.
 * @param window - the observed events and the two positions that bound them.
 * @returns the material text written as the child's user message.
 */
export function assembleMaterial({ events, watermarkSeq, cutSeq }: MaterialWindow): string {
  const rows: string[] = [MATERIAL_HEADER]
  for (const event of events) {
    if (event.seq <= watermarkSeq || event.seq > cutSeq) continue
    if (isHumanMessage(event)) {
      const message = event.data as UserMessage
      const text = messageText(message.content).trim()
      if (text !== '') rows.push(`[用户] ${text}`)
      for (const attachment of (message.source as ProductMessageSource | undefined)?.attachments ?? []) {
        if (typeof attachment.name === 'string' && attachment.name !== '') rows.push(`[附件] ${attachment.name}`)
      }
      continue
    }
    if (event.type === 'assistant/message' && isAppendSurfaceEvent(event)) {
      const text = messageText(event.data.message.content).trim()
      if (text !== '') rows.push(`[Fairy] ${text}`)
      continue
    }
    if (event.type === 'tool/call' && MEMORY_CHANGE_TOOLS.has(event.data.name)) {
      rows.push(`[记忆变更] ${event.data.name} ${event.data.arguments}`)
    }
  }
  return rows.join('\n')
}
