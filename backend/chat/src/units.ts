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
 * `runtime.ts` and are overlaid at read time.
 *
 * The native `inbox` projection owns pending messages. `ourfairyWork` keeps
 * only each pending message's id and source kind, because report consumption
 * and activity episode boundaries must be replayed from history; storing the
 * messages themselves would be a second inbox authority.
 *
 * `stateVersion` increments whenever this module's fold semantics or state
 * shape change; the registry then discards persisted rows of an older version
 * and refolds the log from `init`. The transcript is at version 4 (immutable
 * first appearance plus ordered transitions, a move index, and each row's tool
 * names); the work unit is at version 2 (the narrow pending id/kind index).
 *
 * This module is the only fold of a chat session: the read path
 * (`runtime.ts`, `service.ts`) takes durable values from these units and
 * overlays the live facts, so the former per-read full folds are gone.
 * `tests/projection-units.test.mjs` pins their output against expectations
 * frozen from those folds for fixed logs, including shapes the old fold
 * produced by accident (an attempt row has no `attachments`; a consumed report
 * carries the `turn` and message facts it was consumed with).
 */

import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { assembleAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { AssistantMessage, SessionEvent, SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import type { AssistantStreamRecord, ContentBlock } from '@deepseek-ai/dsh-llm'
// Type-only: the dsh context's own seams and the event and message-source
// vocabularies other rows declare. The imports add no runtime dependency.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tool-jobs'
import type {} from '@ourfairy/dsh-attachments'

/**
 * One attachment the product admitted on a message, as the attachments row
 * reports it.
 *
 * The shape is derived from the attachments service instead of restated here,
 * so the attachments row stays the only authority on what an admitted
 * attachment is.
 */
export type AttachmentInput = Awaited<ReturnType<Context['ourfairyAttachments']['inputs']>>[number]

/**
 * A message as the chat fold reads it: the native message plus the product's
 * own fields on its source.
 *
 * The native `MessageSource` owns `kind`; the product writes `rpcId` and
 * `attachments` into the same JSON source object, so one narrow view reads
 * them without a second message type or a second fold.
 */
interface ProductMessage {
  readonly id: string
  readonly content?: readonly ContentBlock[]
  readonly source: {
    readonly kind?: string
    readonly rpcId?: string
    readonly attachments?: readonly AttachmentInput[]
  }
}

/**
 * The product's view of one native message.
 *
 * The native message is assignable to this view: the view only adds optional
 * fields the product writes, so no cast is needed to read them.
 */
function productMessage(message: UserMessage | AssistantMessage): ProductMessage {
  return message
}

/** Native job lifecycle status to the wire's numeric task status (README `任务状态`). */
export const TASK_STATUS = Object.freeze({ running: 1, stopping: 2, completed: 3, killed: 4, failed: 5 })

/**
 * The wire task status for one native job status. A native value the table
 * does not name is `0` (unknown): returning `undefined` would drop the field
 * from the projection and hide an unconverged task, and guessing a terminal
 * number would claim a settlement that never happened.
 */
export function taskStatusOf(status: string): number {
  // `Object.hasOwn` is the authority for "this table names the status"; the
  // assertion only tells the compiler which member survived that check.
  return Object.hasOwn(TASK_STATUS, status) ? TASK_STATUS[status as keyof typeof TASK_STATUS] : 0
}

const terminal = (status: number) => status >= 3
const interruptedKind = (kind: string) => ['aborted', 'interrupted', 'forked'].includes(kind)
const taskKey = (generation: string, id: string) => `${generation}/${id}`

const messageText = (message: ProductMessage) => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
/**
 * The tool names one message requested, in content-block order.
 *
 * Only the name is projected: the arguments and the matching tool results stay
 * in the native session, because the chat tells the reader *that* Fairy used a
 * tool, not what it was asked or what it returned.
 */
const toolNamesOf = (message: ProductMessage) => (message.content ?? []).filter(block => block.type === 'tool-call').map(block => block.name)
const attachmentsOf = (message: ProductMessage) => (message.source?.attachments ?? []).map((item, index) => ({ index, type: item.image ? 2 : 1, name: item.name, mime: item.mime, bytes: item.original.bytes }))
/** The interrupted text blocks of one native Assistant stream, shared with the live attempt read. */
export const attemptText = (stream: readonly AssistantStreamRecord[]) => assembleAssistantStream(stream).interruptedBlocks().filter(block => block.type === 'text').map(block => block.text).join('')
/**
 * The tool names one Assistant stream has requested so far, in first-request order.
 *
 * A call's name can arrive after its record starts, so an unnamed record is
 * skipped rather than projected as an empty name; a repeated id keeps its first
 * name because the stream can re-open the same call. This is the same fact the
 * committed message carries, read from the stream of a step that has not
 * produced a message yet — the aborted or still-running step would otherwise
 * settle as an empty row again.
 */
export const attemptTools = (stream: readonly AssistantStreamRecord[]) => {
  const names = new Map<string, string>()
  for (const record of stream) {
    if (record.type !== 'tool-call-chunks' || record.name === undefined) continue
    if (!names.has(record.id)) names.set(record.id, record.name)
  }
  return [...names.values()]
}

/* ------------------------------------------------------------- transcript */

const cutPointSchema = z.object({ seq: z.number().int(), status: z.number().int() })
const attachmentSchema = z.object({ index: z.number().int(), type: z.number().int(), name: z.string(), mime: z.string(), bytes: z.number().int() })
const transitionSchema = cutPointSchema.extend({ repositions: z.boolean() })
const transcriptRowSchema = z.object({
  messageId: z.string(),
  requestId: z.string().nullable(),
  role: z.number().int(),
  text: z.string(),
  /** `null` is the attempt shape, which carries no `attachments` field at all. */
  attachments: z.array(attachmentSchema).nullable(),
  /**
   * Tool names this row's message requested, in block order; empty for a row
   * that requested none. Arguments and results are never part of the row.
   */
  tools: z.array(z.string()),
  /**
   * Where the row first appeared. Immutable: it is the row's position in the
   * first-appearance order and the anchor for a cut before any transition.
   */
  first: cutPointSchema,
  /**
   * Every later event that changed the row's seq/status, in event order.
   * `repositions` separates the two cases a cut must tell apart: a surface
   * append or a re-splice moves the row's page position to that event's seq,
   * while a turn end settles only an attempt's status and leaves the attempt's
   * own seq. Keeping the list (not just the latest) means a cut between two
   * transitions still answers the row the way the old prefix fold did.
   */
  transitions: z.array(transitionSchema),
})
const receiptSchema = z.object({
  requestId: z.string(),
  messageId: z.string(),
  acceptedSeq: z.number().int(),
  text: z.string(),
  uploadIds: z.array(z.string()),
})
const turnEndSchema = z.object({ seq: z.number().int(), interrupted: z.boolean() })
const moveSchema = z.object({ index: z.number().int(), seq: z.number().int() })
export const transcriptStateSchema = z.object({
  sessionId: z.string(),
  rows: z.array(transcriptRowSchema),
  index: z.record(z.string(), z.number().int()),
  attemptsByTurn: z.record(z.string(), z.array(z.number().int())),
  turnEnds: z.record(z.string(), turnEndSchema),
  receipts: z.array(receiptSchema),
  /**
   * Transitions that moved a row forward, in event-seq order. This is the
   * narrow side index that lets a read window start at `fromSeq` without
   * scanning every earlier row; `rows` itself stays in immutable
   * first-appearance order.
   */
  moves: z.array(moveSchema),
})

/** The transcript unit state, as the schema above declares it. */
type TranscriptState = z.infer<typeof transcriptStateSchema>
/** One transcript row, as the schema above declares it. */
type TranscriptRow = z.infer<typeof transcriptRowSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The human transcript rows plus the narrow receipts map a retry needs. */
    ourfairyTranscript: TranscriptState
    /** The task roster and its activity summary, folded in one pass. */
    ourfairyWork: WorkState
  }
}

/** One row's wire shape at the inclusive cut `cut`, in the old fold's field order. */
function rowAtCut(row: TranscriptRow, cut: number) {
  let transition: z.infer<typeof transitionSchema> | null = null
  for (let offset = row.transitions.length - 1; offset >= 0; offset--) {
    // The loop walks the array backwards from its own length, so the entry is
    // always there.
    const candidate = row.transitions[offset] as z.infer<typeof transitionSchema>
    if (candidate.seq <= cut) { transition = candidate; break }
  }
  return {
    messageId: row.messageId,
    seq: transition !== null && transition.repositions ? transition.seq : row.first.seq,
    requestId: row.requestId,
    role: row.role,
    status: transition === null ? row.first.status : transition.status,
    text: row.text,
    ...(row.attachments === null ? {} : { attachments: row.attachments }),
    ...(row.tools.length === 0 ? {} : { tools: row.tools }),
  }
}

/**
 * The transcript unit: messages the human saw, in first-appearance order (the
 * old Map fold's order, which is not seq order), plus the receipts map
 * `service.ts` answers from without scanning the log.
 */
export const transcriptDefinition: ProjectionDefinition<'ourfairyTranscript', TranscriptState> = {
  key: 'ourfairyTranscript',
  stateVersion: 4,
  stateSchema: transcriptStateSchema,
  init: header => ({ sessionId: header.id, rows: [], index: {}, attemptsByTurn: {}, turnEnds: {}, receipts: [], moves: [] }),
  apply(state, event) {
    if (event.type === 'agent/inbox/spliced') {
      const inserted = event.data.inserted.filter(message => {
        const view = productMessage(message)
        return view.source?.kind === 'user' && view.source.rpcId
      })
      if (inserted.length === 0) return state
      const rows = [...state.rows]
      const index = { ...state.index }
      const receipts = [...state.receipts]
      const moves = [...state.moves]
      for (const message of inserted) {
        const view = productMessage(message)
        // The filter above kept only messages whose `rpcId` is truthy, so it is
        // a nonempty string here.
        const requestId = view.source.rpcId as string
        const text = messageText(view)
        const attachments = attachmentsOf(view)
        const existing = index[message.id]
        if (existing === undefined) {
          index[message.id] = rows.length
          rows.push({ messageId: message.id, requestId, role: 1, text, attachments, tools: [],
            first: { seq: event.seq, status: 1 }, transitions: [] })
        } else {
          // `index` only holds positions of rows that exist.
          const row = rows[existing] as TranscriptRow
          rows[existing] = { ...row, requestId, text, attachments,
            transitions: [...row.transitions, { seq: event.seq, status: 1, repositions: true }] }
          moves.push({ index: existing, seq: event.seq })
        }
        // The FIRST splice that carried this request id is the receipt, even if
        // the queued copy was later appended, replaced or discarded.
        if (!receipts.some(receipt => receipt.requestId === requestId)) {
          receipts.push({ requestId, messageId: message.id, acceptedSeq: event.seq, text,
            uploadIds: (view.source.attachments ?? []).map(item => item.uploadId) })
        }
      }
      return { ...state, rows, index, receipts, moves }
    }
    if (event.type === 'user/message' && isAppendSurfaceEvent(event) && event.data.source?.kind === 'user') {
      const message = event.data
      const view = productMessage(message)
      const fields = { requestId: view.source.rpcId ?? null, role: 1,
        text: messageText(view), attachments: attachmentsOf(view), tools: [] }
      const existing = state.index[message.id]
      if (existing === undefined) {
        return appendRow(state, { messageId: message.id, ...fields,
          first: { seq: event.seq, status: 2 }, transitions: [] })
      }
      return recordTransition(state, existing, fields, { seq: event.seq, status: 2, repositions: true })
    }
    if ((event.type === 'assistant/message' || event.type === 'delivery/message') && isAppendSurfaceEvent(event)) {
      const message = event.data.message
      const view = productMessage(message)
      // Only an assistant step names tools: a delivered message is another
      // session's report, and the delivery's presentation does not change.
      const fields = { requestId: null, role: 2,
        text: messageText(view), attachments: attachmentsOf(view),
        tools: event.type === 'assistant/message' ? toolNamesOf(view) : [] }
      // `interrupted` is the assistant event's own field; a delivered message
      // carries none, so it reads as not interrupted.
      const status = (event.data as { interrupted?: true }).interrupted ? 3 : 2
      const existing = state.index[message.id]
      if (existing === undefined) {
        return appendRow(state, { messageId: message.id, ...fields,
          first: { seq: event.seq, status }, transitions: [] })
      }
      return recordTransition(state, existing, fields, { seq: event.seq, status, repositions: true })
    }
    if (event.type === 'assistant/attempt') {
      const messageId = `attempt:${state.sessionId}:${event.seq}`
      const turn = String(event.data.turn)
      const ended = state.turnEnds[turn]
      const attempts = state.attemptsByTurn[turn] ?? []
      return { ...state,
        rows: [...state.rows, {
          messageId, requestId: null, role: 2, text: attemptText(event.data.stream), attachments: null,
          tools: attemptTools(event.data.stream),
          // A turn end that already exists in the prefix settles the attempt at
          // its own seq (the old fold looked up the whole log's turn ends).
          first: { seq: event.seq, status: ended !== undefined && ended.interrupted ? 3 : 4 }, transitions: [],
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
      // Backfill every attempt of this turn with a status-only transition; the
      // attempt keeps its own seq.
      const rows = [...state.rows]
      for (const index of indices) {
        // The index came from `attemptsByTurn`, which only holds row positions.
        const row = rows[index] as TranscriptRow
        rows[index] = { ...row, transitions: [...row.transitions,
          { seq: event.seq, status: interrupted ? 3 : 4, repositions: false }] }
      }
      return { ...state, rows, turnEnds }
    }
    return state
  },
}

/** Append a brand-new row; its first appearance anchors the order. */
function appendRow(state: TranscriptState, row: TranscriptRow): TranscriptState {
  return { ...state, rows: [...state.rows, row], index: { ...state.index, [row.messageId]: state.rows.length } }
}

/** Record one later event's transition for an existing row, keeping its first appearance. */
function recordTransition(state: TranscriptState, index: number, fields: Partial<TranscriptRow>, transition: z.infer<typeof transitionSchema>): TranscriptState {
  const rows = [...state.rows]
  // The index came from `state.index`, which only holds positions of rows that
  // exist.
  const row = rows[index] as TranscriptRow
  rows[index] = { ...row, ...fields, transitions: [...row.transitions, transition] }
  const moves = transition.repositions ? [...state.moves, { index, seq: transition.seq }] : state.moves
  return { ...state, rows, moves }
}

/** First index in ascending `items` whose extracted key is at least `target`. */
function firstAtLeast<T>(items: readonly T[], keyOf: (item: T) => number, target: number): number {
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = (low + high) >> 1
    // The loop invariant is `low < high <= items.length`, so
    // `middle < high <= items.length` and `items[middle]` is in range. The
    // assertion names that bound; it is not a check the old code made.
    if (keyOf(items[middle] as T) < target) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Every transcript row visible at the inclusive log cut `cut` whose wire `seq`
 * is at least `fromSeq`, in first-appearance order — the order the per-read Map
 * fold returned. `moves` is the narrow index that makes a tail read
 * independent of the transcript's length: rows before `fromSeq` are considered
 * only when a later transition moved them into the window.
 * @param state - the transcript unit state.
 * @param cut - inclusive `throughSeq`; the default reads the current end.
 * @param fromSeq - inclusive lower bound on the row's `seq` at `cut`.
 */
export function transcriptAt(state: TranscriptState, cut = Infinity, fromSeq = 0) {
  const start = firstAtLeast(state.rows, row => row.first.seq, fromSeq)
  const end = firstAtLeast(state.rows, row => row.first.seq, cut === Infinity ? Infinity : cut + 1)
  const movedIntoWindow = new Set<number>()
  const firstMove = firstAtLeast(state.moves, move => move.seq, fromSeq)
  for (let offset = firstMove; offset < state.moves.length; offset++) {
    // The loop walks the array forwards from its own length, so the entry is
    // always there.
    const move = state.moves[offset] as z.infer<typeof moveSchema>
    if (move.seq > cut) break
    // The move index came from `state.index`, which only holds positions of
    // rows that exist.
    const row = state.rows[move.index] as TranscriptRow
    // Rows whose first appearance is already in the window are emitted by the
    // slice below; only an earlier row moved forward needs this path.
    if (row.first.seq >= fromSeq) continue
    if (rowAtCut(row, cut).seq >= fromSeq) movedIntoWindow.add(move.index)
  }
  const moved = [...movedIntoWindow].sort((left, right) => left - right)
  const visible = start < end ? Array.from({ length: end - start }, (_, offset) => start + offset) : []
  return [...moved, ...visible].map(index => rowAtCut(state.rows[index] as TranscriptRow, cut))
}

/**
 * The receipt a request id was accepted under, read from unit state alone.
 * @param state - the transcript unit state.
 * @param requestId - the client-generated request identity.
 * @returns `{receipt,text,uploadIds}`, or null for an unseen request id.
 */
export function receiptFrom(state: TranscriptState, requestId: string) {
  const receipt = state.receipts.find(item => item.requestId === requestId)
  if (receipt === undefined) return null
  return { receipt: { sessionId: state.sessionId, requestId, messageId: receipt.messageId, acceptedSeq: receipt.acceptedSeq },
    text: receipt.text, uploadIds: receipt.uploadIds }
}

/* ------------------------------------------------------------- tasks */

const jobRowSchema = z.object({
  taskId: z.string(), generation: z.string(),
  /** The native job identity kept alongside the generation-qualified taskId. */
  id: z.string(),
  /** Legacy job shape; `tasksAt` still renders it when a persisted row has one. */
  progress: z.unknown().optional(),
  kind: z.string(), label: z.string(), status: z.string(), startedAt: z.number(),
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
/**
 * One pending message's identity and source kind. The native `inbox`
 * projection owns the messages themselves; the work unit keeps only this
 * narrow per-event index because report consumption and activity episode
 * boundaries must be replayed historically, which a current inbox snapshot
 * cannot reconstruct.
 */
const pendingEntrySchema = z.object({ id: z.string(), kind: z.string() })
export const workStateSchema = z.object({
  sessionId: z.string(),
  order: z.array(z.string()),
  rows: z.record(z.string(), jobRowSchema),
  reports: z.record(z.string(), reportSchema),
  consumed: z.record(z.string(), consumedSchema),
  pending: z.record(z.string(), z.array(pendingEntrySchema)),
  endings: z.record(z.string(), z.string()),
  turn: z.number().int().nullable(),
  activity: activitySchema,
})

/** The work unit state, as the schema above declares it. */
type WorkState = z.infer<typeof workStateSchema>
/** One task row, as the schema above declares it. */
type JobRow = z.infer<typeof jobRowSchema>
/** One activity episode entry, as the schema above declares it. */
type ActivityEntry = z.infer<typeof activityEntrySchema>
/** The activity summary, as the schema above declares it. */
type Activity = z.infer<typeof activitySchema>

const emptyActivity = (): Activity => ({ episode: null, completed: null, delivery: null, executing: false, parked: false,
  latestOutput: null, decisions: [], unavailable: [] })

/** One folded row with its report interpretation: the roster's row composition. */
function rowWithReport(state: WorkState, row: JobRow) {
  return { ...row, report: reportState(row.taskId, state) }
}

/** The roster after the folded prefix, with each row's report interpretation. */
function rosterOf(state: WorkState) {
  return state.order.map(taskId => rowWithReport(state, state.rows[taskId] as JobRow))
}

/** One report's state comes only from the native decision, inbox and turn records. */
function reportState(taskId: string, state: WorkState) {
  const report = state.reports[taskId]
  if (report === undefined) return { status: 0 }
  let value: { status: number; messageId?: string | undefined; turn?: number | null | undefined } = { status: report.delivery === 'failed' ? 5 : ['wakeup', 'busy-context'].includes(report.delivery) ? 1 : 0,
    ...(report.messageId === undefined ? {} : { messageId: report.messageId }) }
  // A report without a message id reads the consumed map's `undefined` key,
  // which no consumed row uses.
  const consumed = state.consumed[report.messageId as string]
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
 * machine the replaced per-read activity fold implemented, carried as data
 * rather than closure variables so the registry can checkpoint it. Mutates the
 * copy it is handed.
 */
function visitActivity(activity: Activity, sessionId: string, event: SessionEvent, state: WorkState) {
  if (event.type === 'session/end-seed') {
    // Restored process-local work has no continuation guarantee; later real turns need their own episode.
    const lost = rosterOf(state).filter(row => ['running', 'stopping'].includes(row.status) || [1, 2].includes(row.report.status))
    if (lost.length > 0 || activity.decisions.length > 0) activity.episode = null
    for (const row of lost) if (!activity.unavailable.includes(row.taskId)) activity.unavailable.push(row.taskId)
    activity.decisions = []
    activity.parked = true
  }
  if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source?.kind === 'user')) activity.parked = false
  if (event.type === 'turn/start') { activity.executing = true; activity.parked = false }
  else if (event.type === 'turn/end') { activity.executing = false; if (event.data.reason.kind !== 'completed') activity.parked = true }
  else if (event.type === 'jobs/lifecycle') {
    const id = taskKey(event.data.generation, event.data.job.id)
    if (event.data.phase === 'settled') { if (!activity.decisions.includes(id)) activity.decisions.push(id) }
    else if (event.data.phase === 'removed') activity.decisions = activity.decisions.filter(item => item !== id)
  } else if (event.type === 'jobs/report') {
    const id = taskKey(event.data.generation, event.data.jobId)
    activity.decisions = activity.decisions.filter(item => item !== id)
  }
  const begin = (seq: number): ActivityEntry => {
    activity.episode ??= { episodeId: `${sessionId}/${seq}`, startedSeq: seq }
    return activity.episode
  }
  const pending = Object.values(state.pending).flat()
  const waking = !activity.parked && pending.some(message => message.kind === 'user')
  const working = activity.executing || waking || activity.decisions.length > 0
    || rosterOf(state).some(row => !activity.unavailable.includes(row.taskId)
      && (['running', 'stopping'].includes(row.status) || [1, 2].includes(row.report.status)))
  if (working) begin(event.seq)
  if (event.type === 'delivery/message') {
    const episode = begin(event.seq)
    activity.delivery = { episodeId: episode.episodeId, seq: event.seq }
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
function workEventOf(event: SessionEvent): boolean {
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
export const workDefinition: ProjectionDefinition<'ourfairyWork', WorkState> = {
  key: 'ourfairyWork',
  stateVersion: 2,
  stateSchema: workStateSchema,
  init: header => ({ sessionId: header.id, order: [], rows: {}, reports: {}, consumed: {}, pending: {}, endings: {},
    turn: null, activity: emptyActivity() }),
  apply(state, event) {
    if (!workEventOf(event)) return state
    const next = { ...state, activity: { ...state.activity,
      episode: state.activity.episode === null ? null : { ...state.activity.episode },
      completed: state.activity.completed === null ? null : { ...state.activity.completed },
      delivery: state.activity.delivery === null ? null : { ...state.activity.delivery },
      decisions: [...state.activity.decisions], unavailable: [...state.activity.unavailable] } }
    if (event.type === 'jobs/lifecycle') {
      const taskId = taskKey(event.data.generation, event.data.job.id)
      if (event.data.phase === 'removed') {
        if (state.rows[taskId] !== undefined) {
          const rows = { ...next.rows }
          delete rows[taskId]
          next.rows = rows
          next.order = next.order.filter(item => item !== taskId)
        }
      } else {
        next.rows = { ...next.rows, [taskId]: { taskId, ...event.data.job, generation: event.data.generation } }
        if (state.rows[taskId] === undefined) next.order = [...state.order, taskId]
      }
    } else if (event.type === 'jobs/report') {
      next.reports = { ...next.reports, [taskKey(event.data.generation, event.data.jobId)]: { ...event.data, scheduledTurn: next.turn } }
    } else if (event.type === 'turn/start') {
      next.turn = event.data.turn
    } else if (event.type === 'turn/end') {
      next.endings = { ...next.endings, [String(event.data.turn)]: event.data.reason.kind }
      next.turn = null
    } else if (event.type === 'agent/inbox/spliced') {
      const queue = [...(next.pending[event.data.target] ?? [])]
      const removed = queue.splice(event.data.start, event.data.removedCount ?? 0,
        ...event.data.inserted.map(message => ({ id: message.id, kind: message.source?.kind ?? 'other' })))
      next.pending = { ...next.pending, [event.data.target]: queue }
      for (const message of removed) {
        if (message.kind !== 'tool-jobs') continue
        next.consumed = { ...next.consumed,
          [message.id]: event.data.outcome === 'canceled' ? { status: 4 } : { status: 2, turn: next.turn } }
      }
    } else if (event.type === 'user/message' && event.data.source?.kind === 'tool-jobs') {
      next.consumed = { ...next.consumed, [event.data.id]: { status: 2, turn: next.turn } }
    }
    visitActivity(next.activity, next.sessionId, event, next)
    return next
  },
}

/** The live jobs this session owns, keyed by native id: the availability authority. */
function liveJobsOf(ctx: Context, sessionId: SessionId) {
  return new Map<string, JobView>(ctx.jobs.list(sessionId).filter(job => job.owner === sessionId).map(job => [job.id, job]))
}

/**
 * One folded row as the wire task, overlaid with the live native job when it has
 * one. This is the only task-row projection: the full list and the single
 * lookup both read through it, so status mapping, report degradation and
 * generation availability cannot drift apart.
 */
function taskRowOf(row: JobRow & { report: ReturnType<typeof reportState> }, job: JobView | undefined) {
  const available = job !== undefined
  const current = job ?? row
  const status = taskStatusOf(current.status)
  const report = { ...row.report }
  // A restored queue does not schedule inference by itself.
  if (!available && [1, 2].includes(report.status)) report.status = 6
  return { taskId: row.taskId, kind: current.kind, label: current.label,
    status: !available && !terminal(status) ? 0 : status, availability: available ? 1 : 0,
    startedAt: current.startedAt, ...(current.finishedAt === undefined ? {} : { finishedAt: current.finishedAt }),
    ...(current.detail === undefined ? {} : { detail: current.detail }),
    ...(current.progress === undefined ? {} : { progress: current.progress }),
    output: { earliest: current.output.earliest, total: current.output.total }, report }
}

/**
 * One folded row's wire task and the native `JobId` that backs it.
 *
 * `jobId` is non-null only when the row's generation is the registry's current
 * generation and that generation still holds the job for this session. An older
 * generation's row is retained history, never a live identity, even when a
 * same-named job exists after a restart.
 */
function taskRowWithJob(row: JobRow & { report: ReturnType<typeof reportState> }, ctx: Context, live: ReadonlyMap<string, JobView>) {
  const job = row.generation === ctx.jobs.generation ? live.get(row.id) : undefined
  return { task: taskRowOf(row, job), jobId: job === undefined ? null : job.id }
}

/** Wire tasks: the folded roster enriched with the live registry's availability. */
function tasksAt(state: WorkState, ctx: Context, sessionId: SessionId) {
  const live = liveJobsOf(ctx, sessionId)
  return rosterOf(state).map(row => taskRowWithJob(row, ctx, live).task)
}

/**
 * Look one task up by its product id, with the native job that currently backs
 * it. Reads the work unit state and the jobs registry only.
 * @param state - the work unit state.
 * @param ctx - host context carrying the jobs registry.
 * @param sessionId - the session whose live jobs are read.
 * @param taskId - the untrusted product task id; only an own folded row names a task.
 * @returns `{task, jobId}`, or null when no folded row has that id.
 */
export function taskAt(state: WorkState, ctx: Context, sessionId: SessionId, taskId: string) {
  // The id arrives from untrusted JSON: inherited names such as `__proto__`
  // must not read Object.prototype as if it were a folded row.
  if (!Object.hasOwn(state.rows, taskId)) return null
  return taskRowWithJob(rowWithReport(state, state.rows[taskId] as JobRow), ctx, liveJobsOf(ctx, sessionId))
}

/** Read-time activity summary over the durable machine state, the live roster and `running`. */
function activityAt(state: WorkState, tasks: ReturnType<typeof tasksAt>, running: boolean, cut: number) {
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
 * @param cut - inclusive `throughSeq`, `-1` for an empty log. Required: an
 *   omitted cut would fabricate a `session/Infinity` episode.
 */
export function tasksAndActivityAt(state: WorkState, ctx: Context, sessionId: SessionId, running: boolean, cut: number) {
  const tasks = tasksAt(state, ctx, sessionId)
  return { tasks, activity: activityAt(state, tasks, running, cut) }
}

/**
 * Register both units on the native registry. `register` installs its own
 * effect on the calling fiber, so unloading the chat plugin removes the keys.
 * @param ctx - a context carrying the native `sessionProjections` service.
 * @returns the two registration disposers.
 */
export function registerProjectionUnits(ctx: Context) {
  return [ctx.sessionProjections.register(transcriptDefinition), ctx.sessionProjections.register(workDefinition)]
}
