/**
 * The electricity-bill row: this Fairy's token consumption, derived from the
 * session logs the deployment already keeps.
 *
 * The row publishes one reading face —
 * `ctx.ourfairyBill.snapshot()`, which answers today, this month, all time and
 * the last 30 days from one pass — owns the process-local per-session cache
 * that pass reuses, and mounts the one address that serves it. Everything it
 * exposes is that one observation: the Denny conversion at the wire edge
 * belongs to the one rate module, and the context reading (#320) reads the same
 * service rather than re-deriving a number.
 *
 * The row is in the bundle's `plugins` group. Stopping the segment still leaves
 * a backend that establishes sessions and runs model turns; only the bill
 * reading goes away with it.
 *
 * @module @ourfairy/dsh-bill
 */
import { Service } from '@deepseek-ai/cordis'
import { mountRoutes } from '@ourfairy/dsh-http/http'
import { createBillService, type BillService, type BillSnapshot } from './aggregate.js'
import { billHandlers, SURFACE } from './http.js'
import { sessionSource } from './source.js'
import type { Context } from '@deepseek-ai/cordis'
// The dsh seams this row reads: the live session store, the durable session
// store that answers a log's revision, and the validating replay read; then the
// carrier's route registry, the trust fence, and the identity service the one
// address derives its caller from. The imports are type-only, so they add no
// runtime dependency.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@ourfairy/dsh-identity'

export const name = 'ourfairy-bill'
export const inject = ['sessions', 'sessionPersistence', 'sessionQuery', 'webServer', 'connection', 'identity']

export { SERIES_DAYS } from './aggregate.js'
export type {
  BillDay, BillService, BillSnapshot, BillSource, BillTotals, BillSessionHeader, BillSessionRevision,
} from './aggregate.js'
export { addBuckets, foldDailyTokens, localDay, TIME_ZONE, zeroBuckets } from './fold.js'
export type { DailyTokens, TokenBuckets, TurnSpan } from './fold.js'
export { dennyOf, dennyOfTokens, TOKENS_PER_DENNY } from './denny.js'
export { BILL_PATHS, BillError, billHandlers, billView, SURFACE } from './http.js'
export type { BillDayView, BillHandler, BillTotalView, BillView } from './http.js'

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
 *
 * The service is constructed here rather than in a child plugin, the way the
 * identity and sessions rows do it: `ctx.ourfairyBill` is then readable from
 * this same context, so the one address can serve the very instance the rest of
 * the product reads. A child plugin's service lives one fiber deeper and is not
 * reachable from a parent that does not inject it.
 * @param ctx - the owning plugin context.
 */
export function apply(ctx: Context): void {
  const bill = new Bill(ctx)
  mountRoutes(ctx, {
    label: 'ourfairy-bill',
    surface: SURFACE,
    handlers: billHandlers({
      service: bill,
      authenticate: request => ctx.identity.authenticateRequest(request),
      fence: request => ctx.connection.fence(request),
    }),
  })
}
