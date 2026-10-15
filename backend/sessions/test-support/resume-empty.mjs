// Test-only composition check; no HTTP route or model request.
import { writeFileSync } from 'node:fs'

export const name = 'ourfairy-empty-session-resume'
export const inject = ['ourfairySessions', 'sessions', 'sessionPersistence', 'agents', 'agentLoop']

export async function apply(ctx, config) {
  const report = {}
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
    report.ownerAfterDispose = (await ctx.sessionPersistence.stat(header.id)).header.owner
  } catch (error) {
    report.error = error.stack ?? String(error)
  }
  writeFileSync(config.reportPath, `${JSON.stringify(report)}\n`)
}
