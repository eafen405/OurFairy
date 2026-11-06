/** On-demand facts from native projections; no volatile system-prompt prefix. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isUserSession } from '@ourfairy/dsh-identity/session'
import { tasksAndActivityAt, workDefinition } from './units.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-token-meter/client'

export function installSessionFacts(ctx: Context): void {
  const register = (agent: Agent): undefined => {
    if (!isUserSession(agent.session.header)) return
    agent.ctx.tools.register(defineTool({ name: 'session_facts',
      description: '读取当前会话的已报告累计 token 用量和后台任务数量。用量来自提供方回报，不含未报告部分，也不是金额；其它会话的活动不在结果中。',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async () => {
        const snapshot = ctx.sessionProjections.snapshot(agent.session)
        const work = ctx.sessionProjections.stateOf(agent.session, workDefinition.key)
        if (work === undefined) throw new Error('chat/missing-projection: session work projection is not registered')
        const { tasks } = tasksAndActivityAt(work, ctx, agent.session.id, agent.status !== 'idle', snapshot.asOfSeq)
        const usage = snapshot.values.tokenUsage
        return { sessionId: agent.session.id, throughSeq: snapshot.asOfSeq,
          reportedTokens: usage === undefined ? null : { ...usage },
          tasks: { total: tasks.length, running: tasks.filter(task => [1, 2].includes(task.status)).length } }
      },
    }))
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}
