/**
 * The memory tools registered on every live Agent.
 *
 * Each handler does only what a tool may do: it reads the calling session from
 * the native execution context and hands the typed arguments to the service.
 * The session is the authority for both the source of a write and the gate that
 * authorizes a change, so the model has no field for either.
 *
 * @module @ourfairy/dsh-memory/src/tools
 */
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { toolRegistrar } from './tool-kit.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MemoryService } from './service.js'
// The system-prompt seam this module adds the memory policy section to.
import type {} from '@deepseek-ai/dsh-system-prompt'

/** The scoped system prompt section that tells the Fairy when not to write. */
export const MEMORY_POLICY_SECTION = 'ourfairy:memory-policy'

/**
 * When the main Fairy does and does not write a long-term memory.
 *
 * The real-model acceptance (#248) found the Fairy writing session summaries
 * and inferred environment/profile facts. The rule is guidance at the model's
 * own seam, not a semantic filter: only what the user explicitly asked for or
 * clearly stated about themselves survives; summaries, profiles, inferences
 * and one-off observations do not. Maintenance has its own policy with the same
 * rule so neither writer can make the other's noise legitimate.
 */
export const MEMORY_POLICY = '长期记忆只保存用户明确要求记住的内容，或用户自己明确说出的、可长期复用的稳定事实、偏好和共同经历。'
  + '只有用户明确要求记住，或长期不变的属性、重复习惯和明确说出的共同经历才写；不要记录带有「最近」「今天」「现在」「刚才」等时间限定的状态、动向、计划或待办，即使用户自己提到了也不写。'
  + '不要写会话摘要、用户画像、性格推测、IP/位置/设备/天气/时间等环境推断、一次性情绪或身体感受，也不要把 Fairy 自己的回复或工具结果当成用户事实。'
  + '不要把你执行过的记忆增删改、用户对记忆的增删改或切换要求、以及维护过程本身写成新记忆；不要记录待办、未结项提醒、会话任务状态或 Fairy 的建议，这些操作或状态已经存在于记忆或会话本身。'
  + '没有明确、可长期保留的内容时不要写记忆；'
  + '用户明确要求记住时立即用 memory_add 保存；已有记忆过时时先 memory_search 找到，再用 memory_edit 更新或 memory_delete 删除，不要新增副本。'

/** The calling session, as read-only and layer-changing handlers need it. */
function callerOf(exec: ToolRunContext): { sessionId: string; ownerShortId: number | undefined } {
  // The native tool contract types the agent as optional; a tool that is
  // registered on an agent context is only executed inside one.
  const agent = exec.agent as Agent
  return { sessionId: agent.session.id, ownerShortId: shortIdOf(agent.session.header.owner) }
}

/** The session a content write is attributed to, resolved by the service from persistent headers. */
async function writerOf(exec: ToolRunContext, service: MemoryService): Promise<{ sessionId: string; ownerShortId: number; sourceSession: string }> {
  const agent = exec.agent as Agent
  return { sessionId: agent.session.id, ...await service.sourceOf(agent) }
}

/**
 * Register this row's tools on one agent, once.
 * @param agent - the agent whose scoped tool registry is written.
 * @param service - the memory service the handlers call.
 * @param registered - the names already registered on this agent.
 */
export function registerMemoryTools(agent: Agent, service: MemoryService, registered: Set<string>): void {
  const add = toolRegistrar(agent, registered)
  add('memory_add', {
    description: 'Remember one durable fact or shared experience as a long-term memory. Store the exact text; the source session and its owner are filled in for you. The memory is normal unless is_private is true. Only store what the user explicitly asked to remember, or a stable long-term fact, preference or shared experience the user stated themselves. Never store session summaries, user profiles, personality guesses, location/IP/device/weather/time inferences, one-off moods or body sensations, or anything inferred from your own replies or tool results. Never store time-bound observations ("recently", "today", "right now") even when the user mentions them. Never store a memory about a memory operation the user requested or you performed, a todo/open task state, or a maintenance result. When nothing clearly qualifies, write nothing. At most 8000 Unicode characters; longer text is refused, never truncated. A successful call answers `{ok:true}`.',
    parameters: { content: { type: 'string', required: true }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const writer = await writerOf(exec, service)
      service.add({ ...writer, content: args.content, isPrivate: args.is_private === true })
      return { ok: true }
    },
  })
  add('memory_search', {
    description: 'Search long-term memories by a literal keyword or phrase. start_at and end_at are millisecond timestamps forming one closed interval over the last content change; pass both or neither. Returns memory numbers, content, the owner short number and the content time, capped at 20 memories and 8000 characters with explicit truncation. Only numbers returned here can be edited, deleted or switched in this session.',
    parameters: { query: { type: 'string', required: true }, start_at: { type: 'integer' }, end_at: { type: 'integer' }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const { sessionId } = callerOf(exec)
      return service.search({ sessionId, query: args.query, isPrivate: args.is_private === true, startAt: args.start_at, endAt: args.end_at })
    },
  })
  add('memory_edit', {
    description: 'Edit one memory you have just found with memory_search in this session. old_string must occur exactly once in its content; pass the complete old content to rewrite the whole memory. The content time moves with the edit; the number and layer stay. The edited content is at most 8000 Unicode characters; longer text is refused, never truncated. A successful call answers `{ok:true}`.',
    parameters: { id: { type: 'integer', required: true }, old_string: { type: 'string', required: true }, new_string: { type: 'string', required: true }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const writer = await writerOf(exec, service)
      service.edit({ ...writer, id: args.id, isPrivate: args.is_private === true, oldString: args.old_string, newString: args.new_string })
      return { ok: true }
    },
  })
  add('memory_delete', {
    description: 'Delete one memory you have just found with memory_search in this session. The row is removed physically and its number is never reused. A successful call answers `{ok:true}`.',
    parameters: { id: { type: 'integer', required: true }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const { sessionId } = callerOf(exec)
      service.remove({ sessionId, id: args.id, isPrivate: args.is_private === true })
      return { ok: true }
    },
  })
  add('memory_switch', {
    description: 'Switch one memory you have just found with memory_search in this session between the normal and private layers. The direction follows its current layer; content, source and content time do not change. A successful call answers `{ok:true}`.',
    parameters: { id: { type: 'integer', required: true } },
    execute: async (args, exec) => {
      const { sessionId } = callerOf(exec)
      service.switchLayer({ sessionId, id: args.id })
      return { ok: true }
    },
  })
}

/**
 * Add the owned-session memory policy to one Agent, once.
 *
 * The section is registered only for a session with a user owner. The
 * maintenance child is ownerless by design and carries its own policy in
 * `maintenance.ts`; an owned prompt policy must not leak into it.
 * @param agent - the agent whose scoped system prompt is written.
 * @param registered - the names already registered on this agent.
 */
export function registerMemoryPolicy(agent: Agent, registered: Set<string>): void {
  if (shortIdOf(agent.session.header.owner) === undefined) return
  if (registered.has(MEMORY_POLICY_SECTION)) return
  agent.ctx.systemPrompt.section({
    name: MEMORY_POLICY_SECTION,
    order: 3,
    interpolate: false,
    text: MEMORY_POLICY,
  })
  registered.add(MEMORY_POLICY_SECTION)
}

