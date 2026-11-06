/**
 * The electricity-bill row: this Fairy's token consumption, derived from the
 * session logs the deployment already keeps.
 *
 * The row publishes one reading face — `ctx.ourfairyBill.snapshot()`, which
 * answers today, this month, all time and the last 30 days from one pass — and
 * owns the process-local per-session cache that pass reuses.
 *
 * It contributes two things to the model, and both consume that one face rather
 * than re-deriving anything:
 *
 * - the reading appended to a user session's runtime context (`context.ts`),
 *   throttled and pinned so it costs at most one snapshot per turn; and
 * - one read-only tool for the monthly and historical questions the throttled
 *   context reading deliberately does not answer (`tools.ts`).
 *
 * It mounts no HTTP route: the reading address is a separate ticket and reads
 * this same service.
 *
 * The row is in the bundle's `plugins` group. Stopping the segment still leaves
 * a backend that establishes sessions and runs model turns; only the bill
 * reading goes away with it.
 *
 * @module @ourfairy/dsh-bill
 */
import { Service } from '@deepseek-ai/cordis'
import { isUserSession } from '@ourfairy/dsh-identity/session'
import { createBillService, type BillService, type BillSnapshot } from './aggregate.js'
import { installBillContext } from './context.js'
import { sessionSource } from './source.js'
import { registerBillTool } from './tools.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
// The dsh seams this row reads: the live session store, the durable session
// store that answers a log's revision, the validating replay read, the agent
// registry whose sessions receive the reading, the prompt registry it is
// written to, the turn-boundary projection that locates a turn, and the
// per-agent tool registry. The imports are type-only, so they add no runtime
// dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'ourfairy-bill'
export const inject = ['sessions', 'sessionPersistence', 'sessionQuery',
  'agents', 'systemPrompt', 'sessionProjections', 'tools']

export { SERIES_DAYS } from './aggregate.js'
export { DENNY_DAY_BUCKET, TOKENS_PER_DENNY, dennyOfBuckets, renderBillReading, UNAVAILABLE_READING } from './reading.js'
export { previousInteraction } from './previous.js'
export { BILL_CONTEXT_NAME, BILL_CONTEXT_ORDER, installBillContext, isReadingAudience } from './context.js'
export { BILL_TOOL_NAME, billToolValue, registerBillTool } from './tools.js'
export type { BillReading, DayReading, PreviousReading } from './reading.js'
export type {
  BillDay, BillService, BillSnapshot, BillSource, BillTotals, BillSessionHeader, BillSessionRevision,
} from './aggregate.js'
export { addBuckets, foldDailyTokens, localDay, TIME_ZONE, zeroBuckets } from './fold.js'
export type { DailyTokens, TokenBuckets, TurnSpan } from './fold.js'

/**
 * The row's reading face as the rest of the product sees it.
 *
 * The reading is a closure over the aggregate rather than a private field:
 * Cordis hands consumers a proxy of this service, and a `#private` field is
 * unreadable through it. Nothing else about the instance is exposed.
 */
export class Bill extends Service implements BillService {
  /**
   * One observation of the bill.
   *
   * The cache lives as long as this row, so a second read only pays the header
   * listing and one revision observation per session — never a log read unless
   * that session's revision moved.
   * @returns today, this month, all time and the trailing 30-day series.
   */
  readonly snapshot: () => Promise<BillSnapshot>

  constructor(ctx: Context) {
    super(ctx, 'ourfairyBill')
    const service = createBillService(sessionSource(ctx), () => Date.now())
    this.snapshot = () => service.snapshot()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The product's electricity-bill service, as this package provides it. */
    ourfairyBill: Bill
  }
}

/**
 * Mount the row: the service, then the two model-visible faces that consume it.
 * @param ctx - the owning plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(Bill)
  ctx.inject(['ourfairyBill'], context => {
    const bill = context.ourfairyBill
    installBillContext(context, bill)
    // The tool is registered per agent, on the same audience the reading uses:
    // a maintenance or learning child has no bill to read.
    const registrations = new Map<Agent, Set<string>>()
    const register = (agent: Agent): undefined => {
      if (!isUserSession(agent.session.header)) return undefined
      const names = registrations.get(agent) ?? new Set<string>()
      registrations.set(agent, names)
      registerBillTool(agent, bill, names)
      return undefined
    }
    context.on('agent/created', ({ agent }) => register(agent), { global: true })
    context.on('agent/disposed', ({ agent }) => { registrations.delete(agent) }, { global: true })
    for (const agent of context.agents.list()) register(agent)
  })
}
