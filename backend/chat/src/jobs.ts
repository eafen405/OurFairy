/** Owned HTTP controls over the native job registry, authorized like model tools. */
import { SessionScopeError as ChatError } from '@ourfairy/dsh-sessions'
import { taskStatusOf } from './units.js'
import { requestedSessionId } from './runtime.js'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LiveSession, SessionOwner, SessionRuntime } from './runtime.js'

/**
 * `Number.isSafeInteger` as a type guard, so a checked value narrows to a
 * number before it is compared.
 */
const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value)

/** Native `JobRegistry.kill` outcome to the wire's numeric stop outcome (README `后台任务`). */
export const STOP_OUTCOME = Object.freeze({ requested: 1, 'already-finished': 2 })

/**
 * The wire stop outcome for one native `kill` return value. A value this table
 * does not name is a product error, not "already finished": folding it into `2`
 * would claim a settlement the native registry never reported. The raw value
 * stays in the message so the drift names itself.
 */
export function stopOutcomeOf(result: string): number {
  if (!Object.hasOwn(STOP_OUTCOME, result)) {
    throw new ChatError(500, 'chat/unknown-stop-outcome', `the native job registry returned an unknown stop outcome ${JSON.stringify(result)}`)
  }
  // `Object.hasOwn` is the authority for "this table names the outcome"; the
  // assertion only tells the compiler which member survived that check.
  return STOP_OUTCOME[result as keyof typeof STOP_OUTCOME]
}

export function installJobs(ctx: Context, runtime: SessionRuntime) {
  ctx.jobs.events.subscribe({ owners: 'all' }, event => {
    if (event.type === 'output') return
    // An unowned job carries no owner; the live map has no entry for it either.
    const state = runtime.live(event.job.owner as SessionId)
    if (state !== undefined) runtime.changed(state)
  })
  /** The one task a request names, or the existing 404; both controls share this lookup. */
  const taskOr404 = (state: LiveSession, taskId: unknown) => {
    const found = runtime.taskOf(state, taskId)
    if (found === null) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    return found
  }
  const jobOutput = async (owner: SessionOwner, { sessionId, taskId, from }: Record<string, unknown>) => {
    const state = await runtime.open(owner, requestedSessionId(sessionId))
    if (!isSafeInteger(from) || from < 0) throw new ChatError(400, 'chat/invalid-offset', 'from must be a nonnegative byte offset')
    const found = taskOr404(state, taskId)
    if (found.jobId === null) return { taskId, availability: 0, chunks: [], next: found.task.output.total,
      ...found.task.output, lossy: true, status: found.task.status }
    const output = ctx.jobs.readAt(found.jobId, from, state.sessionId)
    const job = ctx.jobs.get(found.jobId, state.sessionId)
    return { taskId, availability: 1, chunks: output.chunks, next: output.next, lossy: output.lossy,
      earliest: job.output.earliest, total: job.output.total, status: taskStatusOf(job.status) }
  }
  const jobStop = async (owner: SessionOwner, { sessionId, taskId }: Record<string, unknown>) => {
    const state = await runtime.open(owner, requestedSessionId(sessionId))
    const found = taskOr404(state, taskId)
    if (found.jobId === null) return 0
    const result = ctx.jobs.kill(found.jobId, state.sessionId, 'cancelled by the user')
    await runtime.barrier(state)
    return stopOutcomeOf(result)
  }
  return { jobOutput, jobStop }
}
