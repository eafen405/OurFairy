/**
 * The electricity-bill row: this Fairy's token consumption, derived from the
 * session logs the deployment already keeps.
 *
 * The row is deliberately thin. It publishes one reading face —
 * `ctx.ourfairyBill.snapshot()`, which answers today, this month, all time and
 * the last 30 days from one pass — and owns the process-local per-session cache
 * that pass reuses. It mounts no route and injects no context: those are later
 * tickets, and both read this same service rather than re-deriving anything.
 *
 * The row is in the bundle's `plugins` group. Stopping the segment still leaves
 * a backend that establishes sessions and runs model turns; only the bill
 * reading goes away with it.
 *
 * @module @ourfairy/dsh-bill
 */
import { Service } from '@deepseek-ai/cordis'
import { createBillService, type BillService, type BillSnapshot } from './aggregate.js'
import { sessionSource } from './source.js'
import type { Context } from '@deepseek-ai/cordis'
// The dsh seams this row reads: the live session store, the durable session
// store that answers a log's revision, and the validating replay read. The
// imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'

export const name = 'ourfairy-bill'
export const inject = ['sessions', 'sessionPersistence', 'sessionQuery']

export { SERIES_DAYS } from './aggregate.js'
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
 * Mount the row.
 * @param ctx - the owning plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(Bill)
}
