// Test-only composition check; no HTTP route or model request.
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
// The dsh context's own seams: the agent registry, the session store and the
// durable store. The product's own owned-session service comes from this
// package's public entry.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@ourfairy/dsh-sessions'

export const name = 'ourfairy-empty-session-resume'
export const inject = ['ourfairySessions', 'sessions', 'sessionPersistence', 'agents', 'agentLoop']

export async function apply(ctx: Context, config: { readonly shortId: number; readonly reportPath: string }): Promise<void> {
  const report: Record<string, unknown> = {}
  try {
    const header = await ctx.ourfairySessions.primary({ shortId: config.shortId })
    report.created = { id: header.id, owner: header.owner }
    const read = await ctx.sessionPersistence.open(header.id, 'read')
    try {
      report.persistedEventCount = (await read.read()).events.length
    } finally {
      await read.close()
    }
    const handle = await ctx.agents.resume({ resumeSessionId: header.id })
    try {
      await handle.agent.whenIdle()
      report.resumed = { id: handle.agent.session.id, owner: handle.agent.session.header.owner }
      await ctx.sessions.flush(handle.agent.session)
    } finally {
      await handle.dispose()
    }
    const stat = await ctx.sessionPersistence.stat(header.id)
    if (stat === undefined) throw new Error(`no stored session ${header.id}`)
    report.ownerAfterDispose = stat.header.owner
  } catch (error) {
    const stack = error instanceof Error ? error.stack : undefined
    report.error = stack ?? String(error)
  }
  writeFileSync(config.reportPath, `${JSON.stringify(report)}\n`)
}
