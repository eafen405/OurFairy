/**
 * Incremental chat projection units for the native `ctx.sessionProjections`
 * registry (ticket #89).
 *
 * Two units, both host-only (no `wire` view):
 *
 * - `ourfairyTranscript` folds the human transcript rows plus the narrow
 *   receipts map a `/chat/send` retry needs.
 * - `ourfairyWork` folds the task roster and its activity summary in ONE pass,
 *   because the activity state machine reads the task/report state after every
 *   event. A second unit would need a second copy of the report interpretation,
 *   so both outputs stay in one fold with two read functions.
 *
 * Both units are pure synchronous folds over committed Session events. `apply`
 * returns the SAME state reference for an event it does not interpret, and
 * state is plain JSON so the registry can checkpoint it. Durable state holds
 * log-derived facts only: job availability, the Agent's `running` status,
 * attempt text, `replyStatus`, `stopping` and `error` stay live in
 * `runtime.mjs` and are overlaid at read time.
 *
 * `stateVersion` increments whenever this module's fold semantics or state
 * shape change; the registry then discards persisted rows of an older version
 * and refolds the log from `init`.
 *
 * This module is the only fold of a chat session: the read path
 * (`runtime.mjs`, `service.mjs`) takes durable values from these units and
 * overlays the live facts, so the former per-read full folds are gone.
 * `tests/projection-units.test.mjs` pins their output against expectations
 * frozen from those folds for fixed logs, including shapes the old fold
 * produced by accident (an attempt row has no `attachments`; a consumed report
 * carries the `turn` and message facts it was consumed with).
 */

import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'
import { z } from 'zod'

/** Native job lifecycle status to the wire's numeric task status (README `任务状态`). */
export const TASK_STATUS = Object.freeze({ running: 1, stopping: 2, completed: 3, killed: 4, failed: 5 })
const terminal = status => status >= 3
const interruptedKind = kind => ['aborted', 'interrupted', 'forked'].includes(kind)
const taskKey = (generation, id) => `${generation}/${id}`

const messageText = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
const attachmentsOf = message => (message.source?.attachments ?? []).map((item, index) => ({ index, type: item.image ? 2 : 1, name: item.name, mime: item.mime, bytes: item.original.bytes }))
const attemptText = stream => assembleAssistantStream(stream).interruptedBlocks().filter(block => block.type === 'text').map(block => block.text).join('')

/* ------------------------------------------------------------- transcript */

const cutPointSchema = z.object({ seq: z.number().int(), status: z.number().int() })
const attachmentSchema = z.object({ index: z.number().int(), type: z.number().int(), name: z.string(), mime: z.string(), bytes: z.number().int() })
const transcriptRowSchema = z.object({
  messageId: z.string(),
  requestId: z.string().nullable(),
  role: z.number().int(),
  text: z.string(),
  /** `null` is the attempt shape, which carries no `attachments` field at all. */
  attachments: z.array(attachmentSchema).nullable(),
  /** Where and how the row first appeared. */
  first: cutPointSchema,
  /**
   * The later event that changed the row's status, when one did.
   * `repositions` separates the two cases the cut must tell apart: a surface
   * append moves the row's page position to the append's seq, while a turn end
   * settles only an attempt's status and leaves the attempt's own seq.
   */
  settled: cutPointSchema.extend({ repositions: z.boolean() }).nullable(),
})
const receiptSchema = z.object({
  requestId: z.string(),
  messageId: z.string(),
  acceptedSeq: z.number().int(),
  text: z.string(),
  uploadIds: z.array(z.string()),
})
const turnEndSchema = z.object({ seq: z.number().int(), interrupted: z.boolean() })
export const transcriptStateSchema = z.object({
  sessionId: z.string(),
  rows: z.array(transcriptRowSchema),
  index: z.record(z.string(), z.number().int()),
  attemptsByTurn: z.record(z.string(), z.array(z.number().int())),
  turnEnds: z.record(z.string(), turnEndSchema),
  receipts: z.array(receiptSchema),
})

/** One row's wire shape at the inclusive cut `cut`, in the old fold's field order. */
function rowAtCut(row, cut) {
  const settled = row.settled !== null && row.settled.seq <= cut ? row.settled : null
  return {
    messageId: row.messageId,
    seq: settled !== null && settled.repositions ? settled.seq : row.first.seq,
    requestId: row.requestId,
    role: row.role,
    status: settled === null ? row.first.status : settled.status,
    text: row.text,
    ...(row.attachments === null ? {} : { attachments: row.attachments }),
  }
}

/**
 * The transcript unit: messages the human saw, in first-appearance order (the
 * old Map fold's order, which is not seq order), plus the receipts map
 * `service.mjs` answers from without scanning the log.
 */
export const transcriptDefinition = {
  key: 'ourfairyTranscript',
  stateVersion: 1,
  stateSchema: transcriptStateSchema,
  init: header => ({ sessionId: header.id, rows: [], index: {}, attemptsByTurn: {}, turnEnds: {}, receipts: [] }),
  apply(state, event) {
    if (event.type === 'agent/inbox/spliced') {
      const inserted = event.data.inserted.filter(message => message.source?.kind === 'user' && message.source.rpcId)
      if (inserted.length === 0) return state
      const rows = [...state.rows]
      const index = { ...state.index }
      const receipts = [...state.receipts]
      for (const message of inserted) {
        const row = {
          messageId: message.id, requestId: message.source.rpcId, role: 1,
          text: messageText(message), attachments: attachmentsOf(message),
          first: { seq: event.seq, status: 1 }, settled: null,
        }
        if (index[message.id] === undefined) { index[message.id] = rows.length; rows.push(row) } else rows[index[message.id]] = row
        // The FIRST splice that carried this request id is the receipt, even if
        // the queued copy was later appended, replaced or discarded.
        if (!receipts.some(receipt => receipt.requestId === row.requestId)) {
          receipts.push({ requestId: row.requestId, messageId: message.id, acceptedSeq: event.seq, text: row.text,
            uploadIds: (message.source.attachments ?? []).map(item => item.uploadId) })
        }
      }
      return { ...state, rows, index, receipts }
    }
    if (event.type === 'user/message' && isAppendSurfaceEvent(event) && event.data.source?.kind === 'user') {
      const message = event.data
      const row = { messageId: message.id, requestId: message.source.rpcId ?? null, role: 1,
        text: messageText(message), attachments: attachmentsOf(message) }
      // The queued copy (spliced earlier) keeps its first appearance and gains
      // the settle point; a message that was only ever appended starts settled.
      return state.index[message.id] === undefined
        ? putRow(state, { ...row, first: { seq: event.seq, status: 2 }, settled: null })
        : putRow(state, row, { seq: event.seq, status: 2, repositions: true })
    }
    if ((event.type === 'assistant/message' || event.type === 'delivery/message') && isAppendSurfaceEvent(event)) {
      const message = event.data.message
      return putRow(state, { messageId: message.id, requestId: null, role: 2,
        text: messageText(message), attachments: attachmentsOf(message),
        first: { seq: event.seq, status: event.data.interrupted ? 3 : 2 }, settled: null })
    }
    if (event.type === 'assistant/attempt') {
      const messageId = `attempt:${state.sessionId}:${event.seq}`
      const turn = String(event.data.turn)
      const ended = state.turnEnds[turn]
      const attempts = state.attemptsByTurn[turn] ?? []
      return { ...state,
        rows: [...state.rows, {
          messageId, requestId: null, role: 2, text: attemptText(event.data.stream), attachments: null,
          first: { seq: event.seq, status: 4 },
          settled: ended === undefined ? null : { seq: ended.seq, status: ended.interrupted ? 3 : 4, repositions: false },
        }],
        index: { ...state.index, [messageId]: state.rows.length },
        attemptsByTurn: { ...state.attemptsByTurn, [turn]: [...attempts, state.rows.length] } }
    }
    if (event.type === 'turn/end') {
      const turn = String(event.data.turn)
      const interrupted = interruptedKind(event.data.reason.kind)
      const turnEnds = { ...state.turnEnds, [turn]: { seq: event.seq, interrupted } }
      const indices = state.attemptsByTurn[turn]
      if (indices === undefined || indices.length === 0) return { ...state, turnEnds }
      // Backfill every attempt of this turn: the old fold judged all of them
      // from the whole log's turn ends, not from the order they arrived in.
      const settled = { seq: event.seq, status: interrupted ? 3 : 4, repositions: false }
      const rows = [...state.rows]
      for (const index of indices) rows[index] = { ...rows[index], settled }
      return { ...state, rows, turnEnds }
    }
    return state
  },
}

/** Record one message row, keeping the Map fold's "a later event carries this id" rule. */
function putRow(state, row, settled = null) {
  const index = state.index[row.messageId]
  if (index === undefined) {
    return { ...state, rows: [...state.rows, row], index: { ...state.index, [row.messageId]: state.rows.length } }
  }
  const rows = [...state.rows]
  // The row's first appearance (and therefore its page position before the
  // settle cut) is the earlier event's fact.
  rows[index] = { ...row, first: rows[index].first, settled }
  return { ...state, rows }
}

/**
 * Every transcript row visible at the inclusive log cut `cut`, in
 * first-appearance order — the order the per-read Map fold returned.
 * @param state - the transcript unit state.
 * @param cut - inclusive `throughSeq`; the default reads the current end.
 */
export function transcriptAt(state, cut = Infinity) {
  return state.rows.filter(row => row.first.seq <= cut).map(row => rowAtCut(row, cut))
}

/**
 * The receipt a request id was accepted under, read from unit state alone.
 * @param state - the transcript unit state.
 * @param sessionId - the session the receipt belongs to.
 * @param requestId - the client-generated request identity.
 * @returns `{receipt,text,uploadIds}`, or null for an unseen request id.
 */
export function receiptFrom(state, sessionId, requestId) {
  const receipt = state.receipts.find(item => item.requestId === requestId)
  if (receipt === undefined) return null
  return { receipt: { sessionId, requestId, messageId: receipt.messageId, acceptedSeq: receipt.acceptedSeq },
    text: receipt.text, uploadIds: receipt.uploadIds }
}

/* ------------------------------------------------------------- tasks */

const jobRowSchema = z.object({
  taskId: z.string(), generation: z.string(), kind: z.string(), label: z.string(), status: z.string(), startedAt: z.number(),
  finishedAt: z.number().optional(), detail: z.string().optional(),
  output: z.object({ earliest: z.number(), total: z.number() }),
})
const reportSchema = z.object({
  generation: z.string(), jobId: z.string(), delivery: z.string(),
  messageId: z.string().optional(), reason: z.string().optional(), scheduledTurn: z.number().int().nullable(),
})
/** A consumed task notice's record: the notice facts the report interpretation reads back. */
const consumedSchema = z.object({ status: z.number().int(), turn: z.number().int().nullable().optional() })
const activityEntrySchema = z.object({
  episodeId: z.string(), startedSeq: z.number().int(), outputSeq: z.number().int().optional(),
})
const activitySchema = z.object({
  episode: activityEntrySchema.nullable(),
  completed: activityEntrySchema.extend({ finishedSeq: z.number().int() }).nullable(),
  delivery: z.object({ episodeId: z.string(), seq: z.number().int() }).nullable(),
  executing: z.boolean(),
  parked: z.boolean(),
  latestOutput: z.number().int().nullable(),
  decisions: z.array(z.string()),
  unavailable: z.array(z.string()),
})
export const workStateSchema = z.object({
  sessionId: z.string(),
  order: z.array(z.string()),
  rows: z.record(z.string(), jobRowSchema),
  reports: z.record(z.string(), reportSchema),
  consumed: z.record(z.string(), consumedSchema),
  queues: z.record(z.string(), z.array(z.unknown())),
  endings: z.record(z.string(), z.string()),
  turn: z.number().int().nullable(),
  activity: activitySchema,
})

const emptyActivity = () => ({ episode: null, completed: null, delivery: null, executing: false, parked: false,
  latestOutput: null, decisions: [], unavailable: [] })

/** The roster after the folded prefix, with each row's report interpretation. */
function rosterOf(state) {
  return state.order.map(taskId => ({ ...state.rows[taskId], report: reportState(taskId, state) }))
}

/** One report's state comes only from the native decision, inbox and turn records. */
function reportState(taskId, state) {
  const report = state.reports[taskId]
  if (report === undefined) return { status: 0 }
  let value = { status: report.delivery === 'failed' ? 5 : ['wakeup', 'busy-context'].includes(report.delivery) ? 1 : 0,
    ...(report.messageId === undefined ? {} : { messageId: report.messageId }) }
  const consumed = state.consumed[report.messageId]
  if (consumed !== undefined) {
    value = { ...value, ...consumed }
    const ending = state.endings[String(consumed.turn)]
    if (ending !== undefined) value.status = ending === 'completed' ? 3 : interruptedKind(ending) ? 4 : 5
  }
  if (value.status === 1 && consumed === undefined) {
    const ending = state.endings[String(report.scheduledTurn)]
    if (ending !== undefined) value.status = interruptedKind(ending) ? 4 : ending === 'completed' ? 0 : 5
  }
  return value
}

/**
 * One activity transition over the task snapshot after `event` — the state
 * machine from `activity.mjs`, carried as data rather than closure variables so
 * the registry can checkpoint it. Mutates the copy it is handed.
 */
function visitActivity(activity, sessionId, event, state) {
  const data = event.data
  if (event.type === 'session/end-seed') {
    // Restored process-local work has no continuation guarantee; later real turns need their own episode.
    const lost = rosterOf(state).filter(row => ['running', 'stopping'].includes(row.status) || [1, 2].includes(row.report.status))
    if (lost.length > 0 || activity.decisions.length > 0) activity.episode = null
    for (const row of lost) if (!activity.unavailable.includes(row.taskId)) activity.unavailable.push(row.taskId)
    activity.decisions = []
    activity.parked = true
  }
  if (event.type === 'agent/inbox/spliced' && data.inserted.some(message => message.source?.kind === 'user')) activity.parked = false
  if (event.type === 'turn/start') { activity.executing = true; activity.parked = false }
  else if (event.type === 'turn/end') { activity.executing = false; if (data.reason.kind !== 'completed') activity.parked = true }
  else if (event.type === 'jobs/lifecycle') {
    const id = taskKey(data.generation, data.job.id)
    if (data.phase === 'settled') { if (!activity.decisions.includes(id)) activity.decisions.push(id) }
    else if (data.phase === 'removed') activity.decisions = activity.decisions.filter(item => item !== id)
  } else if (event.type === 'jobs/report') {
    const id = taskKey(data.generation, data.jobId)
    activity.decisions = activity.decisions.filter(item => item !== id)
  }
  const begin = seq => { activity.episode ??= { episodeId: `${sessionId}/${seq}`, startedSeq: seq } }
  const pending = Object.values(state.queues).flat()
  const waking = !activity.parked && pending.some(message => message.source?.kind === 'user')
  const working = activity.executing || waking || activity.decisions.length > 0
    || rosterOf(state).some(row => !activity.unavailable.includes(row.taskId)
      && (['running', 'stopping'].includes(row.status) || [1, 2].includes(row.report.status)))
  if (working) begin(event.seq)
  if (event.type === 'delivery/message') {
    begin(event.seq)
    activity.delivery = { episodeId: activity.episode.episodeId, seq: event.seq }
    activity.latestOutput = event.seq
  } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') activity.latestOutput = event.seq
  if (activity.episode !== null && activity.latestOutput !== null && activity.latestOutput >= activity.episode.startedSeq) {
    activity.episode.outputSeq = activity.latestOutput
  }
  if (!working && activity.episode !== null) {
    activity.completed = { ...activity.episode, finishedSeq: event.seq }
    activity.episode = null
  }
}

/** Whether the work unit interprets an event at all; everything else keeps the state reference. */
function workEventOf(event) {
  switch (event.type) {
    case 'jobs/lifecycle':
    case 'jobs/report':
    case 'turn/start':
    case 'turn/end':
    case 'agent/inbox/spliced':
    case 'session/end-seed':
    case 'delivery/message':
    case 'assistant/message':
    case 'assistant/attempt':
      return true
    case 'user/message':
      return event.data.source?.kind === 'tool-jobs'
    default:
      return false
  }
}

/**
 * The shared task + activity unit: one fold, two read outputs.
 */
export const workDefinition = {
  key: 'ourfairyWork',
  stateVersion: 1,
  stateSchema: workStateSchema,
  init: header => ({ sessionId: header.id, order: [], rows: {}, reports: {}, consumed: {}, queues: {}, endings: {},
    turn: null, activity: emptyActivity() }),
  apply(state, event) {
    if (!workEventOf(event)) return state
    const data = event.data
    const next = { ...state, activity: { ...state.activity,
      episode: state.activity.episode === null ? null : { ...state.activity.episode },
      completed: state.activity.completed === null ? null : { ...state.activity.completed },
      delivery: state.activity.delivery === null ? null : { ...state.activity.delivery },
      decisions: [...state.activity.decisions], unavailable: [...state.activity.unavailable] } }
    if (event.type === 'jobs/lifecycle') {
      const taskId = taskKey(data.generation, data.job.id)
      if (data.phase === 'removed') {
        if (state.rows[taskId] !== undefined) {
          const rows = { ...next.rows }
          delete rows[taskId]
          next.rows = rows
          next.order = next.order.filter(item => item !== taskId)
        }
      } else {
        next.rows = { ...next.rows, [taskId]: { taskId, ...data.job, generation: data.generation } }
        if (state.rows[taskId] === undefined) next.order = [...state.order, taskId]
      }
    } else if (event.type === 'jobs/report') {
      next.reports = { ...next.reports, [taskKey(data.generation, data.jobId)]: { ...data, scheduledTurn: next.turn } }
    } else if (event.type === 'turn/start') {
      next.turn = data.turn
    } else if (event.type === 'turn/end') {
      next.endings = { ...next.endings, [String(data.turn)]: data.reason.kind }
      next.turn = null
    } else if (event.type === 'agent/inbox/spliced') {
      const queue = [...(next.queues[data.target] ?? [])]
      const removed = queue.splice(data.start, data.removedCount ?? 0, ...data.inserted)
      next.queues = { ...next.queues, [data.target]: queue }
      for (const message of removed) {
        if (message.source?.kind !== 'tool-jobs') continue
        next.consumed = { ...next.consumed,
          [message.id]: data.outcome === 'canceled' ? { status: 4 } : { status: 2, turn: next.turn } }
      }
    } else if (event.type === 'user/message' && data.source?.kind === 'tool-jobs') {
      next.consumed = { ...next.consumed, [data.id]: { status: 2, turn: next.turn } }
    }
    visitActivity(next.activity, next.sessionId, event, next)
    return next
  },
}

/** Wire tasks: the folded roster enriched with the live registry's availability. */
function tasksAt(state, ctx, sessionId) {
  const live = new Map(ctx.jobs.list(sessionId).filter(job => job.owner === sessionId).map(job => [job.id, job]))
  return rosterOf(state).map(row => {
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

/** Read-time activity summary over the durable machine state, the live roster and `running`. */
function activityAt(state, tasks, running, cut) {
  const durable = state.activity
  const reasons = [
    ...(running ? [1] : []),
    ...(tasks.some(task => [1, 2].includes(task.status)) ? [2] : []),
    ...(tasks.some(task => [1, 2].includes(task.report.status)) ? [3] : []),
  ]
  const unknown = tasks.some(task => task.status === 0 || task.report.status === 6)
  let episode = durable.episode
  if (running && episode === null) {
    if (durable.completed !== null) {
      episode = { episodeId: durable.completed.episodeId, startedSeq: durable.completed.startedSeq }
    } else {
      const startedSeq = cut === -1 ? 0 : cut
      episode = { episodeId: `${state.sessionId}/${startedSeq}`, startedSeq }
    }
  }
  const current = episode ?? durable.completed
  if (durable.delivery !== null && durable.delivery.episodeId === current?.episodeId) reasons.push(4)
  return { status: reasons.some(reason => reason !== 4) ? 2 : unknown ? 0 : 1,
    reasons, episodeId: current?.episodeId ?? null, startedSeq: current?.startedSeq ?? null,
    throughSeq: cut,
    ...(durable.completed === null ? {} : { completed: durable.completed }),
    ...(durable.delivery === null ? {} : { delivery: durable.delivery }) }
}

/**
 * The wire `{tasks,activity}` pair at the inclusive log cut `cut`.
 * @param state - the work unit state.
 * @param ctx - host context carrying the jobs registry.
 * @param sessionId - the session whose live jobs are read.
 * @param running - whether the Agent is running right now (live, never folded).
 * @param cut - inclusive `throughSeq`, `-1` for an empty log.
 */
export function tasksAndActivityAt(state, ctx, sessionId, running, cut = Infinity) {
  const tasks = tasksAt(state, ctx, sessionId)
  return { tasks, activity: activityAt(state, tasks, running, cut) }
}

/**
 * Register both units on the native registry. `register` installs its own
 * effect on the calling fiber, so unloading the chat plugin removes the keys.
 * @param ctx - a context carrying the native `sessionProjections` service.
 * @returns the two registration disposers.
 */
export function registerProjectionUnits(ctx) {
  return [ctx.sessionProjections.register(transcriptDefinition), ctx.sessionProjections.register(workDefinition)]
}
