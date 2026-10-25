/** Owned HTTP controls over the native job registry, authorized like model tools. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionScopeError as ChatError } from '@ourfairy/dsh-sessions'
import { taskStatusOf } from './units.js'
import { requestedSessionId } from './runtime.js'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionOwner, SessionRuntime } from './runtime.js'

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
  const jobOutput = async (owner: SessionOwner, { sessionId, taskId, from }: Record<string, unknown>) => {
    const state = await runtime.open(owner, requestedSessionId(sessionId))
    if (!isSafeInteger(from) || from < 0) throw new ChatError(400, 'chat/invalid-offset', 'from must be a nonnegative byte offset')
    const task = (await runtime.projection(state, { maxEvents: 1 })).tasks.find(task => task.taskId === taskId)
    if (task === undefined) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    if (task.availability === 0) return { taskId, availability: 0, chunks: [], next: task.output.total,
      ...task.output, lossy: true, status: task.status }
    // The task was found by its id, so the request's taskId is that string.
    const id = JobId((taskId as string).slice(ctx.jobs.generation.length + 1))
    const output = ctx.jobs.readAt(id, from, state.sessionId)
    const job = ctx.jobs.get(id, state.sessionId)
    return { taskId, availability: 1, chunks: output.chunks, next: output.next, lossy: output.lossy,
      earliest: job.output.earliest, total: job.output.total, status: taskStatusOf(job.status) }
  }
  const jobStop = async (owner: SessionOwner, { sessionId, taskId }: Record<string, unknown>) => {
    const state = await runtime.open(owner, requestedSessionId(sessionId))
    const task = (await runtime.projection(state, { maxEvents: 1 })).tasks.find(task => task.taskId === taskId)
    if (task === undefined) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    if (task.availability === 0) return 0
    // The task was found by its id, so the request's taskId is that string.
    const result = ctx.jobs.kill(JobId((taskId as string).slice(ctx.jobs.generation.length + 1)), state.sessionId, 'cancelled by the user')
    await runtime.barrier(state)
    return stopOutcomeOf(result)
  }
  return { jobOutput, jobStop }
}
