/** Task roster and report facts derive from native Session events; output stays in ctx.jobs. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionScopeError as ChatError } from '@ourfairy/dsh-sessions'

const STATUS = Object.freeze({ running: 1, stopping: 2, completed: 3, killed: 4, failed: 5 })
const keyOf = (generation, id) => `${generation}/${id}`
const terminal = status => status >= 3

/** Fold job/report records and existing inbox/turn facts without a second activity log. */
export function projectTasks(ctx, events, sessionId) {
  const rows = new Map()
  const reports = new Map()
  const messages = new Map()
  const queues = new Map()
  const endings = new Map()
  let turn
  for (const event of events) {
    const data = event.data
    if (event.type === 'jobs/lifecycle') {
      const taskId = keyOf(data.generation, data.job.id)
      if (data.phase === 'removed') rows.delete(taskId)
      else rows.set(taskId, { taskId, ...data.job, generation: data.generation })
    } else if (event.type === 'jobs/report') {
      reports.set(keyOf(data.generation, data.jobId), { ...data, scheduledTurn: turn })
    } else if (event.type === 'turn/start') turn = data.turn
    else if (event.type === 'turn/end') { endings.set(data.turn, data.reason.kind); turn = undefined }
    else if (event.type === 'agent/inbox/spliced') {
      const queue = queues.get(data.target) ?? []
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...data.inserted)
      queues.set(data.target, queue)
      for (const message of removed) {
        if (message.source?.kind !== 'tool-jobs') continue
        messages.set(message.id, data.outcome === 'canceled' ? { status: 4 } : { status: 2, turn })
      }
    } else if (event.type === 'user/message' && data.source?.kind === 'tool-jobs') {
      messages.set(data.id, { status: 2, turn })
    }
  }
  const live = new Map(ctx.jobs.list(sessionId).filter(job => job.owner === sessionId).map(job => [job.id, job]))
  return [...rows.values()].map(row => {
    const job = row.generation === ctx.jobs.generation ? live.get(row.id) : undefined
    const available = job !== undefined
    const current = job ?? row
    const status = STATUS[current.status]
    const report = reports.get(row.taskId)
    let state = { status: 0 }
    if (report !== undefined) {
      state = { status: report.delivery === 'failed' ? 5 : ['wakeup', 'busy-context'].includes(report.delivery) ? 1 : 0,
        ...(report.messageId === undefined ? {} : { messageId: report.messageId }) }
      const consumed = messages.get(report.messageId)
      if (consumed !== undefined) {
        state = { ...state, ...consumed }
        const ending = endings.get(consumed.turn)
        if (ending !== undefined) state.status = ending === 'completed' ? 3 : ['aborted', 'interrupted', 'forked'].includes(ending) ? 4 : 5
      }
      if (state.status === 1 && consumed === undefined) {
        const ending = endings.get(report.scheduledTurn)
        if (ending !== undefined) state.status = ['aborted', 'interrupted', 'forked'].includes(ending) ? 4 : ending === 'completed' ? 0 : 5
      }
      // A queue can survive a Host restart, but it does not schedule inference by itself.
      if (!available && [1, 2].includes(state.status)) state.status = 6
    }
    return { taskId: row.taskId, kind: current.kind, label: current.label,
      status: !available && !terminal(status) ? 0 : status, availability: available ? 1 : 0,
      startedAt: current.startedAt, ...(current.finishedAt === undefined ? {} : { finishedAt: current.finishedAt }),
      ...(current.detail === undefined ? {} : { detail: current.detail }),
      ...(current.progress === undefined ? {} : { progress: current.progress }),
      output: { earliest: current.output.earliest, total: current.output.total }, report: state }
  })
}

/** Owned HTTP controls reuse the same session authorization and registry as model tools. */
export function installJobs(ctx, chat) {
  ctx.jobs.events.subscribe({ owners: 'all' }, event => {
    if (event.type === 'output') return
    const state = chat._live.get(event.job.owner)
    if (state !== undefined) { state.version++; chat._publish(state) }
  })
  chat.jobOutput = async (owner, { sessionId, taskId, from }) => {
    const state = await chat._agent(owner, sessionId)
    if (!Number.isSafeInteger(from) || from < 0) throw new ChatError(400, 'chat/invalid-offset', 'from must be a nonnegative byte offset')
    const task = (await chat._projection(state, { maxEvents: 1 })).tasks.find(task => task.taskId === taskId)
    if (task === undefined) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    if (task.availability === 0) return { taskId, availability: 0, chunks: [], next: task.output.total,
      ...task.output, lossy: true, status: task.status }
    const id = JobId(taskId.slice(ctx.jobs.generation.length + 1))
    const output = ctx.jobs.readAt(id, from, state.agent.id)
    const job = ctx.jobs.get(id, state.agent.id)
    return { taskId, availability: 1, chunks: output.chunks, next: output.next, lossy: output.lossy,
      earliest: job.output.earliest, total: job.output.total, status: STATUS[job.status] }
  }
  chat.jobStop = async (owner, { sessionId, taskId }) => {
    const state = await chat._agent(owner, sessionId)
    const task = (await chat._projection(state, { maxEvents: 1 })).tasks.find(task => task.taskId === taskId)
    if (task === undefined) throw new ChatError(404, 'chat/job-not-found', 'task does not belong to this session')
    if (task.availability === 0) return 0
    const result = ctx.jobs.kill(JobId(taskId.slice(ctx.jobs.generation.length + 1)), state.agent.id, 'cancelled by the user')
    await chat._barrier(state)
    return result === 'requested' ? 1 : 2
  }
}
