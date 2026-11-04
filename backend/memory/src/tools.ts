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
    description: 'Store the exact text of a long-term memory only when the user explicitly asks to remember it, or personally states a durable fact, preference, repeated habit or shared experience. The source session and owner are derived; the memory is normal unless is_private is true. Keep session summaries, profiles or personality guesses, inferred environment/location/device/weather/time, one-off moods or sensations, time-bound observations, todos, memory/maintenance operations, and claims from Fairy\'s own replies or tool results out of memory. Put reusable workflows in skill_manage instead of double-writing. If nothing qualifies, make no write. At most 8000 Unicode characters; longer text is refused, never truncated. A successful call answers `{ok:true}`.',
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

