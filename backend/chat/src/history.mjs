/** One fold of native Session events yields the task roster and its activity summary. */
import { observeActivity } from './activity.mjs'

/** Native job lifecycle status to the wire's numeric task status; the job controls answer with the same codes. */
export const TASK_STATUS = Object.freeze({ running: 1, stopping: 2, completed: 3, killed: 4, failed: 5 })
const keyOf = (generation, id) => `${generation}/${id}`
const terminal = status => status >= 3

/** One report's state comes only from the native decision, inbox and turn records. */
function reportState(row, reports, messages, endings) {
  const report = reports.get(row.taskId)
  if (report === undefined) return { status: 0 }
  let state = { status: report.delivery === 'failed' ? 5 : ['wakeup', 'busy-context'].includes(report.delivery) ? 1 : 0,
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
  return state
}

/** Fold once; `visit` sees the state after each event, so activity shares this pass. */
function taskHistory(events, visit) {
  const rows = new Map()
  const reports = new Map()
  const messages = new Map()
  const queues = new Map()
  const endings = new Map()
  const snapshot = () => [...rows.values()].map(row => ({ ...row, report: reportState(row, reports, messages, endings) }))
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
    visit(event, snapshot(), [...queues.values()].flat())
  }
  return snapshot()
}

/** Enrich the folded roster with current registry availability; no second task store. */
function projectTasks(ctx, rows, sessionId) {
  const live = new Map(ctx.jobs.list(sessionId).filter(job => job.owner === sessionId).map(job => [job.id, job]))
  return rows.map(row => {
    const job = row.generation === ctx.jobs.generation ? live.get(row.id) : undefined
    const available = job !== undefined
    const current = job ?? row
    const status = TASK_STATUS[current.status]
    const report = { ...row.report }
    // A restored queue does not schedule inference by itself.
    if (!available && [1, 2].includes(report.status)) report.status = 6
    return { taskId: row.taskId, kind: current.kind, label: current.label,
      status: !available && !terminal(status) ? 0 : status, availability: available ? 1 : 0,
      startedAt: current.startedAt, ...(current.finishedAt === undefined ? {} : { finishedAt: current.finishedAt }),
      ...(current.detail === undefined ? {} : { detail: current.detail }),
      ...(current.progress === undefined ? {} : { progress: current.progress }),
      output: { earliest: current.output.earliest, total: current.output.total }, report }
  })
}

/**
 * Derive the projection's task and activity facts from a single fold: the
 * roster interprets the fold's final rows, and the activity state machine
 * observes its per-event states. `running` is the live agent status at
 * projection time, not a log fact.
 */
export function projectSession(ctx, events, sessionId, running) {
  const activity = observeActivity(sessionId)
  const tasks = projectTasks(ctx, taskHistory(events, activity.visit), sessionId)
  return { tasks, activity: activity.finish(tasks, running) }
}
