/**
 * Test-only fault at the Session event-read boundary: after the test arms
 * `triggerPath`, hand the next read of the chosen Session a list with one
 * committed seq removed.
 *
 * The native log is append-only and dense, so a hole in a read cannot be
 * produced by a real boot. This row stands in for that torn read and changes
 * nothing else: the durable log, the writer and the projection remain the real
 * ones. The test arms it after the turn has settled, so the torn read is the
 * explicit read under test and the following reopen is a fresh observation.
 */
import { existsSync, writeFileSync } from 'node:fs'

export const name = 'ourfairy-session-event-loss'
export const inject = ['ourfairyChat']

export function apply(ctx, config) {
  const runtime = ctx.ourfairyChat.runtime
  const read = runtime.events.bind(runtime)
  let fired = false
  runtime.events = async sessionId => {
    const result = await read(sessionId)
    if (fired || String(sessionId) !== config.sessionId || !existsSync(config.triggerPath)) return result
    const { events, cursor } = result
    if (events.length < 3) return result
    fired = true
    const dropped = events.at(-2).seq
    writeFileSync(config.reportPath, `${JSON.stringify({ dropped })}\n`)
    return { events: [...events.slice(0, -2), events.at(-1)], cursor }
  }
}
