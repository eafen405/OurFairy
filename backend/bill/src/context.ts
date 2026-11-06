/**
 * The bill reading at the end of a user session's runtime context.
 *
 * ### Why this is a cache and not a computation
 *
 * The runtime-context channel's text provider is synchronous — `resolveContext`
 * calls the function directly and the declared type is
 * `string | ((context) => string)`, never a Promise — so it cannot await a
 * session read or an aggregate.
 *
 * Worse, the loop re-resolves every context on **every attempt inside a step**,
 * and this deployment's turns have a median of 12 steps (p90: 136). The channel
 * only ever appends and never replaces, so a value that moved per attempt would
 * leave dozens of permanent user messages in one turn.
 *
 * So the reading is computed at the only two moments that are cheap and
 * meaningful, and the provider only formats:
 *
 * - when a user session's agent appears (a resumed session needs a first
 *   reading), and
 * - when a turn ends — the turn that just closed is exactly what the *next*
 *   turn reports as "the previous interaction".
 *
 * It is then **pinned once per turn** at the loop's own pre-step boundary. The
 * provider returns that pin for every attempt of the turn, so the appended
 * snapshot is at most one per turn by construction rather than by luck.
 *
 * ### Why the pin is set at pre-step and not while assembling
 *
 * One step assembles its prompt more than once: `assemble()` renders the
 * contexts, then every attempt calls `refreshContext()` again. Only the second
 * pass reaches the session — the loop replaces the pre-step projection's
 * runtime-context message with the freshly projected one — so pinning at
 * pre-step is what makes both passes agree, and what lets the pin wait for the
 * refresh to land.
 *
 * ### What "the previous interaction" means
 *
 * The last turn that closed before the current one, located from the log's own
 * `turn/start`…`turn/end` pairs. dsh's `turnBoundary` projection supplies the
 * turn number and the open turn's start (the Agent interface exposes no turn or
 * step); the per-turn total is the bill's existing fold, so the reading and the
 * bill page share one arithmetic.
 *
 * ### Scope
 *
 * The contribution is registered globally but renders empty for anything that
 * is not a user's own session — the same predicate the persona guard uses. A
 * memory maintenance or skill learning child therefore carries no reading, and
 * pays no context cost for an account that is not its own.
 *
 * @module @ourfairy/dsh-bill/context
 */
import { isUserSession } from '@ourfairy/dsh-identity/session'
import { previousInteraction } from './previous.js'
import { renderBillReading, type BillReading, type DayReading } from './reading.js'
import type { BillService } from './aggregate.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * Where the reading sits in the runtime-context snapshot.
 *
 * It must be the last section, after every operational context this deployment
 * mounts: `working-directory:current` (100, required), `sandbox:policy` (110)
 * and `approval:policy` (115). dsh allocates its own orders from -1000 up to
 * 210, so a value above that whole range is last by construction, and a future
 * allocation below it cannot silently overtake the reading.
 */
export const BILL_CONTEXT_ORDER = 1000

/** The context's name, in the same `namespace:aspect` form as its neighbours. */
export const BILL_CONTEXT_NAME = 'bill:reading'

/** One user session's reading state. */
interface ReadingState {
  /** The text pinned for the current turn; stable from pre-step to step end. */
  pinned?: string
  /** The text the next turn will pin, produced by the last refresh. */
  pending?: string
  /** Serializes refreshes, so a turn end cannot interleave with an agent's arrival. */
  queue: Promise<void>
}

/**
 * The reading pinned when no refresh has produced one.
 *
 * A session on its first turn genuinely has no previous interaction — known
 * without any I/O — so it says so. Every other case reports the data as
 * unavailable: a limitation she can repeat is better than a number nobody
 * measured, and neither is ever rendered as `0`.
 * @param turn - the turn being opened.
 * @returns the reading to pin.
 */
function placeholderReading(turn: number): BillReading {
  return {
    previous: turn <= 1 ? { kind: 'none' } : { kind: 'unavailable' },
    day: { kind: 'unavailable' },
  }
}

/** The slice of the composition this module reads. */
export interface BillContextServices {
  readonly systemPrompt: {
    context(contribution: {
      readonly name: string
      readonly order: number
      readonly interpolate?: boolean
      readonly text: string | ((context: { readonly agent?: Agent }) => string)
    }): unknown
  }
  readonly sessionProjections: {
    stateOf(session: Session, key: 'turnBoundary'):
      { readonly openTurnStartSeq: number | null, readonly lastTurn: number } | undefined
  }
  readonly sessionQuery: {
    readSession(id: Session['id']): Promise<{ readonly events: readonly SessionEvent[] }>
  }
  readonly agents: { list(): readonly Agent[] }
  readonly on: Context['on']
}

/**
 * Register the bill's runtime-context contribution and its refresh triggers.
 * @param ctx - the composition: the prompt registry, the agent registry, the
 *   turn-boundary projection and the live-preferred log reader.
 * @param bill - the row's own reading face. The day total reported here is the
 *   same call the bill page serves, so the two cannot disagree.
 */
export function installBillContext(ctx: BillContextServices, bill: BillService): void {
  const states = new Map<Agent, ReadingState>()

  /**
   * One refresh: the previous interaction's settled total, then the day's total.
   * @param agent - the session whose reading is recomputed.
   * @param openTurnStartSeq - the open turn's start when there is one. A
   *   refresh triggered by `turn/end` passes `null`, because the turn that just
   *   closed is a completed interaction and a boundary state read a moment
   *   early must not hide it.
   */
  const compute = async (agent: Agent, openTurnStartSeq: number | null): Promise<string> => {
    let previous: BillReading['previous']
    try {
      const { events } = await ctx.sessionQuery.readSession(agent.session.id)
      previous = previousInteraction(events, openTurnStartSeq)
    } catch {
      // A log that cannot be read is a fact about the reading, not a zero.
      previous = { kind: 'unavailable' }
    }
    let day: DayReading
    try {
      day = { kind: 'settled', tokens: (await bill.snapshot()).today }
    } catch {
      day = { kind: 'unavailable' }
    }
    return renderBillReading({ previous, day })
  }

  /** Queue one refresh behind whatever this session is already doing. */
  const refresh = (agent: Agent, state: ReadingState, openTurnStartSeq: number | null): Promise<void> => {
    state.queue = state.queue.then(async () => {
      // A disposed agent has no reading to keep: the refresh writes nothing.
      if (states.get(agent) !== state) return
      state.pending = await compute(agent, openTurnStartSeq)
    }, () => undefined)
    return state.queue
  }

  ctx.systemPrompt.context({
    name: BILL_CONTEXT_NAME,
    order: BILL_CONTEXT_ORDER,
    interpolate: false,
    // Synchronous by contract: it reads the turn's pin, never the log.
    text: ({ agent }) => {
      // The audience rule: the bill is not about a maintenance or learning
      // child, and an unrelated agent pays for no reading at all.
      if (agent === undefined || !isUserSession(agent.session.header)) return ''
      return states.get(agent)?.pinned ?? ''
    },
  })

  const watch = (agent: Agent): void => {
    if (!isUserSession(agent.session.header)) return
    const state: ReadingState = { queue: Promise.resolve() }
    states.set(agent, state)
    agent.ctx.on('session/event', (session, event) => {
      // The turn that just closed is what the next turn reports, so this is the
      // one event that makes a pinned reading stale.
      if (session === agent.session && event.type === 'turn/end') void refresh(agent, state, null)
    })
    // A resumed session runs its first turn with no `turn/end` to learn from.
    const boundary = ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')
    void refresh(agent, state, boundary?.openTurnStartSeq ?? null)
  }

  // Ahead of the loop's own pre-step continuation, so this turn's first
  // materialized snapshot already sees a landed refresh.
  ctx.on('agent/pre-step', async (payload, next) => {
    const state = states.get(payload.agent)
    if (state !== undefined) {
      await state.queue
      payload.signal.throwIfAborted()
      // The pin is set here, once, and every attempt in this turn re-reads it.
      state.pinned = state.pending
        ?? renderBillReading(placeholderReading(payload.turn))
    }
    return next()
  }, { global: true, prepend: true })

  ctx.on('agent/created', ({ agent }) => { watch(agent) }, { global: true })
  ctx.on('agent/disposed', ({ agent }) => { states.delete(agent) }, { global: true })
  for (const agent of ctx.agents.list()) watch(agent)
}

/**
 * Whether one session header is in the reading's audience.
 *
 * Exported because the scope rule is the ticket's own decision — a child session
 * must not see the bill — and it is the same predicate the persona guard uses.
 * @param header - the durable session header, if any.
 * @returns true only for a user's own session.
 */
export function isReadingAudience(header: SessionHeader | undefined): boolean {
  return isUserSession(header)
}
