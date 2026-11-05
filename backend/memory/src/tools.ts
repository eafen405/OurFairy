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
    description: '保存用户明确要求记住，或用户亲自陈述的长期事实、偏好、重复习惯、共同经历。排除会话摘要、画像或性格推测、环境/位置/设备/天气/时间推断、一次性情绪或感受、短期状态和待办、记忆维护操作，以及 Fairy 回复或工具结果中的自述；无合格内容就不写。可复用工作流交给主会话的 skill_manage，避免重复写入。来源与归属由会话确定；默认普通层，is_private=true 为私密层。正文原样存储，最多 8000 个 Unicode 字符，超长拒绝。',
    parameters: { content: { type: 'string', required: true }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const writer = await writerOf(exec, service)
      service.add({ ...writer, content: args.content, isPrivate: args.is_private === true })
      return { ok: true }
    },
  })
  add('memory_search', {
    description: '按字面关键词检索长期记忆，默认普通层，is_private=true 查私密层。两层都是产品共享记忆；私密层须显式选择，不是仅归属用户可读。start_at/end_at 为内容更新时间的毫秒闭区间，须同时提供或省略。返回编号、正文、归属用户短号和内容时间；最多 20 条、8000 字符，并报告截断。编辑、删除、切层须先在本会话检索到编号。',
    parameters: { query: { type: 'string', required: true }, start_at: { type: 'integer' }, end_at: { type: 'integer' }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const { sessionId } = callerOf(exec)
      return service.search({ sessionId, query: args.query, isPrivate: args.is_private === true, startAt: args.start_at, endAt: args.end_at })
    },
  })
  add('memory_edit', {
    description: '修改本会话经 memory_search 找到的记忆。old_string 须恰好出现一次；整段替换时传完整旧正文。更新内容时间和来源会话，保留编号与层级。新正文最多 8000 个 Unicode 字符，超长拒绝。',
    parameters: { id: { type: 'integer', required: true }, old_string: { type: 'string', required: true }, new_string: { type: 'string', required: true }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const writer = await writerOf(exec, service)
      service.edit({ ...writer, id: args.id, isPrivate: args.is_private === true, oldString: args.old_string, newString: args.new_string })
      return { ok: true }
    },
  })
  add('memory_delete', {
    description: '删除本会话经 memory_search 找到的记忆；物理删除，编号永不复用。',
    parameters: { id: { type: 'integer', required: true }, is_private: { type: 'boolean' } },
    execute: async (args, exec) => {
      const { sessionId } = callerOf(exec)
      service.remove({ sessionId, id: args.id, isPrivate: args.is_private === true })
      return { ok: true }
    },
  })
  add('memory_switch', {
    description: '将本会话经 memory_search 找到的记忆在普通/私密层之间切换；正文、来源和内容时间保持原值。',
    parameters: { id: { type: 'integer', required: true } },
    execute: async (args, exec) => {
      const { sessionId } = callerOf(exec)
      service.switchLayer({ sessionId, id: args.id })
      return { ok: true }
    },
  })
}

