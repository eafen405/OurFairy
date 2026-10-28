/** The live chat session: the resumed native Agent plus the state a projection publishes. */
import { randomUUID } from 'node:crypto'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { SessionHistoryGapError, createSessionHistorySeam } from '@deepseek-ai/dsh-agent/session-history'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import { attemptText, attemptTools, tasksAndActivityAt, transcriptAt, transcriptDefinition, workDefinition } from './units.js'
import { FAIRY_PERSONA, ownerIdentity } from './persona.js'
import { SessionQueues } from './queues.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionHistorySeam } from '@deepseek-ai/dsh-agent/session-history'
import type { OwnedSessionService } from '@ourfairy/dsh-sessions'
// Type-only: the dsh context's own seams — the agent registry, the shared model
// selection, the model registry, the session store, the persistence handle and
// the projection registry.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection'
import type {} from '@ourfairy/dsh-sessions'

/** The owner facts the owned-session service names a caller by. */
export type SessionOwner = NonNullable<ReturnType<OwnedSessionService['authenticate']>>

/**
 * The session id one request names.
 *
 * A request body is untrusted JSON, so the id arrives as an unknown value. The
 * owned-session service is the authority that refuses anything but a string
 * before the runtime keys it, and the runtime keys that very string; one
 * assertion marks the boundary instead of one per use.
 *
 * @param sessionId - the session id a request body carried.
 * @returns the same value, typed as the session id the runtime keys.
 */
export function requestedSessionId(sessionId: unknown): SessionId {
  return sessionId as SessionId
}

/** The observed event window of one live session. */
interface ObservedWindow {
  /** The seeded log prefix; null until the first read resolves. */
  events: SessionEvent[] | null
  /** The seq the window's append accepts next. */
  nextSeq: number
  /** Committed events that arrived before the seed resolved. */
  buffer: SessionEvent[]
  /** The in-flight seed, so one read pays for one log read. */
  seeding: Promise<void> | null
}

/** The cut one observer reads at. */
interface ProjectionRange {
  /** How many events the observer's window keeps. */
  readonly maxEvents: number
  /** The cut this observer froze at its first projection. */
  throughSeq?: number
  /** The window this observer froze at its first projection. */
  fromSeq?: number
}

/** One observer of one live session's published projections. */
interface Observer extends ProjectionRange {
  /** The listener a published projection reaches. */
  readonly listener: ProjectionListener
}

/** The observed window once its seed resolved: the log prefix is present. */
type SeededWindow = ObservedWindow & { events: SessionEvent[] }

/** One observer's listener: a published projection, or the failure that replaced it. */
export type ProjectionListener = (projection: ChatProjection | undefined, error?: Error) => void

/** The wire task row the work unit publishes. */
type WireTask = ReturnType<typeof tasksAndActivityAt>['tasks'][number]
/** The wire activity summary the work unit publishes. */
type WireActivity = ReturnType<typeof tasksAndActivityAt>['activity']
/** The wire transcript row the transcript unit publishes. */
type WireMessage = ReturnType<typeof transcriptAt>[number]

/** One published projection: the durable unit state plus the live overlay. */
export interface ChatProjection {
  readonly sessionId: SessionId
  readonly generation: string
  readonly version: number
  readonly cursor: number
  readonly durableThroughSeq: number
  readonly throughSeq: number
  readonly fromSeq: number
  readonly events: readonly SessionEvent[]
  readonly hasMore: boolean
  readonly beforeSeq: number | null
  readonly tasks: WireTask[]
  readonly activity: WireActivity
  readonly messages: WireMessage[]
  /**
   * The live attempt: cumulative text plus the tool names it has requested so
   * far. `tools` is omitted when the step requested none, like a message row.
   */
  readonly attempt: { readonly attemptId: string; readonly revision: number; readonly text: string; readonly tools?: readonly string[] } | null
  readonly settledAttempt: { readonly attemptId: string; readonly seq: number } | null
  readonly replyStatus: number
  readonly error: string | null | undefined
}

/**
 * One live chat session: the resumed native Agent plus the live inputs a
 * projection adds to the native Session events. Derived runtime state only.
 */
export class LiveSession {
  generation = randomUUID()
  version = 0
  durableThroughSeq = -1
  settledAttempt: { attemptId: string; seq: number } | null = null
  stopping = false
  error: string | null | undefined = null
  listeners = new Set<Observer>()
  scheduled = false
  publishTimer: ReturnType<typeof setTimeout> | null = null
  agent: Agent | null = null
  /**
   * The observed event window: `events` is null until the first read seeds it
   * with one log read; `nextSeq` is the seq its append accepts next; `buffer`
   * holds committed events that arrived before the seed resolved. A `null`
   * window means no read has needed the log yet, so a session that is only
   * written never pays for one.
   */
  window: ObservedWindow | null = null
  /** Per-turn shared selection: refreshed at each turn start, never mid-turn. */
  selection: ModelSelectionRef | null = null
  /** Route this session's running turn is pinned to; undefined between turns. */
  route: { provider: string; model: string } | null = null
  /** A turn began while a shared-configuration write was in flight; re-read it before the first request. */
  recheckSelection = false

  get session(): Session { return (this.agent as Agent).session }
  get sessionId(): SessionId { return (this.agent as Agent).id }
  get status(): 'idle' | 'running' { return (this.agent as Agent).status }
}

/**
 * Owns every live chat session: opening it once, its ordered writes, its event
 * reads and its published projections. `jobs.ts` receives this runtime
 * directly; the delivery row reaches it only through the `ourfairyChatRuntime`
 * service.
 */
export class SessionRuntime {
  /** The host context this runtime reads; assigned by the constructor. */
  declare ctx: Context
  #live = new Map<SessionId, LiveSession>()
  #opening = new Map<SessionId, Promise<LiveSession>>()
  #queues = new SessionQueues()
  /** Non-null while one shared-configuration write is in flight (admission barrier). */
  #configWrite: Promise<void> | null = null
  /** Native Assistant fold and durable event cursor; one seam per runtime. */
  #history: SessionHistorySeam
  constructor(ctx: Context) {
    this.ctx = ctx
    this.#history = createSessionHistorySeam(ctx)
    ctx.effect(() => () => this.#history[Symbol.dispose](), 'ourfairy-chat: native session history seam')
  }

  live(sessionId: SessionId): LiveSession | undefined { return this.#live.get(sessionId) }

  /** Authorize this owner, then return the one live session for `sessionId`. */
  async open(owner: SessionOwner, sessionId: unknown): Promise<LiveSession> {
    // The stored owner is checked even for a live Agent and before resume can repair/write.
    await this.ctx.ourfairySessions.read(owner, sessionId)
    // The owned-session service above is the authority that the id is a string;
    // the runtime keys that very string.
    const key = sessionId as SessionId
    const live = this.#live.get(key)
    if (live !== undefined) return live
    let opening = this.#opening.get(key)
    if (opening === undefined) {
      opening = this.runSession(key, () => this.#resume(owner, key))
      this.#opening.set(key, opening)
    }
    try { return await opening } finally {
      if (this.#opening.get(key) === opening) this.#opening.delete(key)
    }
  }

  /** Serialize work that writes one session. */
  runSession<T>(sessionId: SessionId, work: () => Promise<T>): Promise<T> { return this.#queues.runSession(sessionId, work) }
  /** Serialize one outgoing delivery's preparation, apart from the target session's queue. */
  runDelivery<T>(deliveryId: SessionId, work: () => Promise<T>): Promise<T> { return this.#queues.runDelivery(deliveryId, work) }

  async #resume(owner: SessionOwner, sessionId: SessionId) {
    const state = new LiveSession()
    await this.ctx.agents.resume({ resumeSessionId: sessionId,
      agentOptions: this.ctx.agentDefaultModel.currentSelection(),
      setup: (agentCtx, agent) => {
        state.agent = agent
        const selection: ModelSelectionRef = { current: this.ctx.agentDefaultModel.currentSelection(), assembled: undefined }
        state.selection = selection
        installModelSelection(agentCtx, selection)
        agentCtx.systemPrompt.section({ name: 'ourfairy:persona', order: 0, text: FAIRY_PERSONA, interpolate: false })
        const nickname = this.ctx.identity.users.byShortId(owner.shortId)?.name
        agentCtx.systemPrompt.section({ name: 'ourfairy:identity', order: 1, interpolate: false,
          text: ownerIdentity(owner.shortId, nickname) })
        const changed = () => this.changed(state)
        // A turn pins the shared selection read at its start: a running reply,
        // including its tool-continuation steps, never switches mid-turn.
        agentCtx.on('session/event', (_session, event) => {
          this.#observe(state, event)
          if (event.type === 'turn/start') {
            selection.current = this.ctx.agentDefaultModel.currentSelection()
            state.route = { provider: selection.current.provider, model: selection.current.model }
            state.recheckSelection = this.#configWrite !== null
          } else if (event.type === 'turn/end') {
            state.route = null
          }
          changed()
        })
        // A message accepted while an image-capable model was selected must not
        // be silently projected to text when the shared selection changed before
        // its turn began: refuse that turn and say why. The native adapter would
        // otherwise downgrade the image to a text reference without failing.
        agentCtx.on('agent/pre-step', async ({ messages, step }, next) => {
          if (step === 1 && messages.some(message => (message.content ?? []).some(block => block.type === 'image'))) {
            // The shared selection is always a selection: the runtime sets it
            // before the agent runs and only ever assigns another one.
            const shared = selection.current as ModelSelection
            const info = await this.ctx.llm.resolveModelInfo(shared.provider, shared.model)
            // Only an explicit negative declaration is a refusal; an adapter that
            // declares nothing keeps the native behaviour of sending the image.
            if (info.inputModalities !== undefined && !info.inputModalities.includes('image')) {
              state.error = `共享模型 ${shared.provider}/${shared.model} 不接受图片输入；本次排队消息已拒绝，请切换到支持图片的模型后重发。`
              throw new Error(state.error)
            }
          }
          return next()
        }, { prepend: true })
        // A configuration write in flight delays the model request, so a reply
        // that began during the write adopts the committed route instead of a
        // half-applied one.
        agentCtx.on('agent/request', async (_payload, next) => {
          const write = this.#configWrite
          if (write !== null) await write
          if (state.recheckSelection) {
            state.recheckSelection = false
            const shared = this.ctx.agentDefaultModel.currentSelection()
            selection.current = shared
            selection.assembled = shared
            state.route = { provider: shared.provider, model: shared.model }
          }
          return next()
        }, { prepend: true })
        agentCtx.on('agent/assistant-stream', ({ frame }) => {
          if (frame.type === 'start') {
            state.error = null
          } else if (frame.type === 'end') {
            // Native settlement is the exact formal seq; no text/content identity inference.
            state.settledAttempt = frame.outcome.kind === 'committed'
              ? { attemptId: frame.attemptId, seq: frame.outcome.seq } : null
          }
          // The attempt's text comes from the native history seam, not a second fold here.
          changed()
        })
        agentCtx.on('agent/error', ({ error }) => { state.error = (error as { message?: string } | null | undefined)?.message ?? String(error); changed() })
        agentCtx.on('agent/status', ({ status }) => {
          if (status === 'idle') {
            state.stopping = false
            this.barrier(state).then(changed, error => { state.error = (error as { message?: string }).message; changed() })
          }
          changed()
        })
      },
    })
    this.#live.set(sessionId, state)
    return state
  }

  /** Routes pinned by replies that are running right now; the live sessions are the only roster. */
  activeReplies() {
    return [...this.#live.values()]
      .filter(state => state.route !== null)
      .map(state => ({ sessionId: state.sessionId, ...state.route as { provider: string; model: string } }))
  }

  /**
   * Run one shared-configuration write with the routes of running replies held
   * still. A reply that starts during the write re-reads the committed selection
   * before its first model request, so it can never straddle two definitions.
   * @param refusal - maps the running replies to a refusal message, or undefined.
   * @param work - the settings write to perform.
   */
  async withReplyGuard(refusal: (replies: { sessionId: SessionId; provider: string; model: string }[]) => unknown, work: () => Promise<unknown>) {
    const previous = this.#configWrite
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const mine = previous === null ? gate : previous.then(() => gate)
    this.#configWrite = mine
    await previous
    try {
      const reason = refusal(this.activeReplies())
      if (reason !== undefined) throw reason
      return await work()
    } finally {
      release()
      if (this.#configWrite === mine) this.#configWrite = null
    }
  }

  /** One safe one-shot read of a session's event stream, shared with attachments. */
  events(sessionId: SessionId) { return readSessionEvents(this.ctx, sessionId) }

  /**
   * Read the native Assistant baseline once: the live attempt's authoritative
   * text, or null once the fold lost continuity (a withdrawn attempt is correct,
   * a concatenation of two attempts is not).
   */
  attemptOf(state: LiveSession) {
    const { baseline, needsResync } = this.#history.assistantStream(state.sessionId)
    const attempt = needsResync ? undefined : baseline.activeAttempt
    if (attempt === undefined) return null
    const tools = attemptTools(attempt.stream)
    return { attemptId: attempt.attemptId, revision: baseline.revision, text: attemptText(attempt.stream),
      ...(tools.length === 0 ? {} : { tools }) }
  }

  /**
   * One contiguous read of this session's durable events.
   *
   * `readSessionEvents` observes an exact append-only prefix, so its seqs are
   * dense. The native cursor still owns the judgement: a read that skips a seq
   * is reopened once from a fresh observation rather than folded as continuous
   * history. A second gap is a defect in the read, not a recoverable cut.
   */
  async contiguousEvents(sessionId: SessionId) {
    for (let reopen = 0; reopen < 2; reopen++) {
      const read = await this.events(sessionId)
      const cursor = this.#history.eventCursor(-1)
      try {
        for (const event of read.events) cursor.accept(event.seq)
      } catch (error) {
        if (error instanceof SessionHistoryGapError) continue
        throw error
      }
      if (cursor.cursor !== read.cursor) continue
      return read
    }
    throw new Error(`chat: session "${sessionId}" could not be read as one contiguous event run`)
  }

  /**
   * One page's event slice only. A seeded window already holds the log, so this
   * is an array slice; otherwise the native read handle returns exactly the
   * requested range. Paging never reads the whole log.
   */
  async pageEvents(state: LiveSession, fromSeq: number, end: number) {
    const seeded = state.window?.events
    if (seeded != null) return seeded.slice(fromSeq, end)
    const handle = await this.ctx.sessionPersistence.open(state.sessionId, 'read')
    try {
      const { events } = await handle.read(fromSeq, end - fromSeq)
      return [...events]
    } finally {
      await handle.close()
    }
  }

  async barrier(state: LiveSession) {
    // Capture BEFORE await: later appended events are not claimed durable by this barrier.
    const through = state.session.seq - 1
    await this.ctx.sessions.flush(state.session)
    if (through > state.durableThroughSeq) {
      state.durableThroughSeq = through
      this.changed(state)
    }
  }

  /** The only writer of `version`: record that published inputs changed, then publish. */
  changed(state: LiveSession) { state.version++; this.publish(state) }

  /** Schedule one projection pass for the current listeners; does not change the version. */
  publish(state: LiveSession) {
    if (state.listeners.size === 0) return
    if (state.scheduled) {
      if (state.publishTimer !== null && state.status === 'idle') {
        clearTimeout(state.publishTimer)
        state.publishTimer = null
        queueMicrotask(() => this.#publishNow(state))
      }
      return
    }
    state.scheduled = true
    if (state.status === 'idle') queueMicrotask(() => this.#publishNow(state))
    else state.publishTimer = setTimeout(() => this.#publishNow(state), 32)
  }

  /** One shared publication for every observer; running fragments coalesce before projection. */
  async #publishNow(state: LiveSession) {
    state.publishTimer = null
    const version = state.version
    try {
      for (const observer of state.listeners) {
        const projection = await this.projection(state, observer)
        if (state.listeners.has(observer)) observer.listener(projection)
      }
    } catch (error) {
      for (const observer of state.listeners) observer.listener(undefined, error as Error)
    } finally {
      state.scheduled = false
      if (state.version !== version) this.publish(state)
    }
  }

  /**
   * Keep the observed window current from committed events. The listener runs
   * on every commit, so appending here is the only per-event window work; a
   * commit before the seed resolved waits in the buffer for the merge.
   */
  #observe(state: LiveSession, event: SessionEvent) {
    const window = state.window
    if (window === null) return
    if (window.events === null) {
      window.buffer.push(event)
      return
    }
    // Committed seqs are contiguous, so this appends. The guard drops the
    // duplicate the seed race can produce (an event already in the seed).
    if (event.seq < window.nextSeq) return
    window.events.push(event)
    window.nextSeq = event.seq + 1
  }

  /**
   * The one observed window for this session, seeding it on first use. Every
   * observer formats its own slice of this window; the log is read once.
   */
  async #windowOf(state: LiveSession): Promise<SeededWindow> {
    let window = state.window
    if (window === null) {
      window = state.window = { events: null, nextSeq: 0, buffer: [], seeding: null }
    }
    // The seed resolves with the log prefix in place, so the window is seeded
    // from here on.
    if (window.events !== null) return window as SeededWindow
    window.seeding ??= this.#seedWindow(state, window).catch(error => {
      // Drop the half-seeded window so a later read retries from the log.
      state.window = null
      throw error
    })
    await window.seeding
    return window as SeededWindow
  }

  /** One log read, merged with the commits that arrived while it was in flight. */
  async #seedWindow(state: LiveSession, window: ObservedWindow) {
    const { events } = await this.contiguousEvents(state.sessionId)
    const seeded = [...events]
    let nextSeq = (seeded.at(-1)?.seq ?? -1) + 1
    for (const event of window.buffer) {
      if (event.seq < nextSeq) continue
      seeded.push(event)
      nextSeq = event.seq + 1
    }
    window.events = seeded
    window.nextSeq = nextSeq
    window.buffer = []
  }

  /** One durable unit's current state; the units are registered by `index.ts`. */
  unitState<K extends keyof SessionProjectionStateMap>(state: LiveSession, definition: ProjectionDefinition<K, SessionProjectionStateMap[K]>): SessionProjectionStateMap[K] {
    const unit = this.ctx.sessionProjections.stateOf(state.session, definition.key)
    if (unit === undefined) throw new Error(`chat projection "${definition.key}" is not registered`)
    return unit
  }

  /**
   * The committed cut this live session can serve. A seeded window is the
   * observed authority; before the first read the session's own sequence is.
   */
  cursorOf(state: LiveSession) {
    const events = state.window?.events
    if (events != null) return events.at(-1)?.seq ?? -1
    return state.session.seq - 1
  }

  /**
   * One observer's view: the durable unit state plus the live overlay. The
   * opening observer freezes `throughSeq`/`fromSeq`; later snapshots keep that
   * cut and include its `fromSeq` through the current cursor.
   */
  async projection(state: LiveSession, range: ProjectionRange): Promise<ChatProjection> {
    const window = await this.#windowOf(state)
    const attempt = this.attemptOf(state)
    const cursor = this.cursorOf(state)
    const throughSeq = range.throughSeq ?? cursor
    const fromSeq = range.fromSeq ?? Math.max(0, throughSeq - range.maxEvents + 1)
    // One observer retains only its opening tail plus all later formal events.
    // Older history is explicitly paged against throughSeq, never replaced by a full-history follow.
    range.throughSeq = throughSeq
    range.fromSeq = fromSeq
    const transcriptState = this.unitState(state, transcriptDefinition)
    const workState = this.unitState(state, workDefinition)
    const { tasks, activity } = tasksAndActivityAt(workState, this.ctx, state.sessionId, state.status !== 'idle', cursor)
    return { sessionId: state.sessionId, generation: state.generation, version: state.version, cursor,
      durableThroughSeq: Math.min(cursor, state.durableThroughSeq),
      throughSeq, fromSeq, events: window.events.slice(fromSeq), hasMore: fromSeq > 0, beforeSeq: fromSeq > 0 ? fromSeq : null,
      tasks, activity,
      messages: transcriptAt(transcriptState, Infinity, fromSeq),
      attempt,
      settledAttempt: state.settledAttempt,
      replyStatus: state.status === 'idle' ? 0 : state.stopping ? 2 : 1, error: state.error }
  }

  /** Register one observer after its initial barrier; returns the unsubscribe. */
  subscribe(state: LiveSession, maxEvents: number, listener: ProjectionListener) {
    const observer: Observer = { listener, maxEvents }
    state.listeners.add(observer)
    this.publish(state)
    return () => state.listeners.delete(observer)
  }

  /** Queue one user message on the live agent. */
  followup(state: LiveSession, message: UserMessage) { (state.agent as Agent).followup(message) }

  /** Ask the live agent to stop the current reply, keeping accepted queued input. */
  stop(state: LiveSession) {
    state.stopping = state.status === 'running'
    ;(state.agent as Agent).cancel({ kind: 'user' }, { keepInbox: true })
    this.changed(state)
  }
}
