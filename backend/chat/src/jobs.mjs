/** Owned HTTP controls over the native job registry, authorized like model tools. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionScopeError as ChatError } from '@ourfairy/dsh-sessions'
import { TASK_STATUS } from './history.mjs'

/** Owned HTTP controls reuse the same session authorization and registry as model tools. */
export function installJobs(ctx, runtime) {
  ctx.jobs.events.subscribe({ owners: 'all' }, event => {
    if (event.type === 'output') return
    const state = runtime.live(event.job.owner)
    if (state !== undefined) runtime.changed(state)
  })
  const jobOutput = async (owner, { sessionId, taskId, from }) => {
    const state = await runtime.open(owner, sessionId)
    if (!Number.isSafeInteger(from) || from < 0) throw new ChatError(400, 'chat/invalid-offset', 'from must be a nonnegative byte offset')
    const task = (await runtime.projection(state, { maxEvents: 1 })).tasks.find(task => task.taskId === taskId)
    if (task === undefined) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    if (task.availability === 0) return { taskId, availability: 0, chunks: [], next: task.output.total,
      ...task.output, lossy: true, status: task.status }
    const id = JobId(taskId.slice(ctx.jobs.generation.length + 1))
    const output = ctx.jobs.readAt(id, from, state.sessionId)
    const job = ctx.jobs.get(id, state.sessionId)
    return { taskId, availability: 1, chunks: output.chunks, next: output.next, lossy: output.lossy,
      earliest: job.output.earliest, total: job.output.total, status: TASK_STATUS[job.status] }
  }
  const jobStop = async (owner, { sessionId, taskId }) => {
    const state = await runtime.open(owner, sessionId)
    const task = (await runtime.projection(state, { maxEvents: 1 })).tasks.find(task => task.taskId === taskId)
    if (task === undefined) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    if (task.availability === 0) return 0
    const result = ctx.jobs.kill(JobId(taskId.slice(ctx.jobs.generation.length + 1)), state.sessionId, 'cancelled by the user')
    await runtime.barrier(state)
    return result === 'requested' ? 1 : 2
  }
  return { jobOutput, jobStop }
}
