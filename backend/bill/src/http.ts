/**
 * The bill row's one request path, and the view it answers with.
 *
 * The bill is one Fairy's public total, derived from her own session logs. It
 * therefore belongs to no session and no reader: the address requires a live
 * credential and nothing more, which is the same admission `/sessions/create`
 * has and deliberately weaker than `/gateway/*`'s administrator role. The
 * caller is still derived from the credential, never from the body — a bill
 * read has no body at all.
 *
 * The address is single on purpose. Today, this month, all time and the 30-day
 * series are one observation of one aggregate; two addresses would let two
 * numbers quoted to each other fall on different snapshots.
 *
 * The wire carries tokens and Dennies at every level. Tokens are what is stored
 * and derived, so they are the figure that stays true if the narrative rate is
 * ever revised; the Denny is the same number in the unit the Fairy speaks.
 *
 * @module @ourfairy/dsh-bill/http
 */
import { freezeSurface, sendJson } from '@ourfairy/dsh-http/http'
import { dennyOf } from './denny.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BillDay, BillSnapshot, BillTotals, BillService } from './aggregate.js'
import type { TokenBuckets } from './fold.js'

/**
 * One total as the wire carries it: the four provider buckets and the same
 * amount in Dennies, side by side.
 */
export interface BillTotalView {
  /** The provider's four disjoint buckets. */
  readonly tokens: TokenBuckets
  /** The same amount in the narrative unit, to a tenth. */
  readonly denny: number
}

/** One day of the trailing series, in both units; a zero day is present at zero. */
export interface BillDayView extends BillTotalView {
  /** The local civil date. */
  readonly day: string
}

/** The whole bill as one response: three totals and the series, from one pass. */
export interface BillView extends Record<keyof BillTotals, BillTotalView> {
  /** The trailing 30 local days, oldest first, zero-filled. */
  readonly days: readonly BillDayView[]
}

/**
 * The single address this row publishes, and the only one `mountRoutes` mounts.
 *
 * `auth: 'authentication'` is the spec's decision, not a default: the bill is
 * the Fairy's public total, so an ordinary agent reads it. `body: 'none'` is
 * why the method is GET — the request names no subject and carries no payload.
 */
export const SURFACE = freezeSurface([
  { path: '/bill', method: 'GET', auth: 'authentication', body: 'none', response: 'json', prefix: 'bill' },
])

/** Paths this module owns, in the order the carrier registers them. */
export const BILL_PATHS = Object.freeze(SURFACE.map(entry => entry.path))

/** The bill row's refusal: the product error shape under the row's own prefix. */
export class BillError extends Error {
  declare readonly status: number
  declare readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'BillError'
    this.status = status
    this.code = `bill/${code}`
  }
}

/**
 * One total in both units.
 * @param buckets - the total's four disjoint buckets.
 * @returns the same amount in tokens and Dennies.
 */
function totalView(buckets: TokenBuckets): BillTotalView {
  return { tokens: buckets, denny: dennyOf(buckets) }
}

/** One day in both units. */
function dayView(day: BillDay): BillDayView {
  return { day: day.day, ...totalView(day.tokens) }
}

/**
 * The wire view of one snapshot.
 *
 * Nothing here re-derives a number: every figure is the aggregate's, and the
 * token-to-Denny conversion belongs to the one rate module.
 * @param snapshot - one observation of the bill.
 * @returns the totals and the series, each in both units.
 */
export function billView(snapshot: BillSnapshot): BillView {
  return {
    today: totalView(snapshot.today),
    month: totalView(snapshot.month),
    allTime: totalView(snapshot.allTime),
    days: snapshot.days.map(dayView),
  }
}

/** One handler the carrier registers on the web server. */
export type BillHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

/**
 * Build the handler for {@link BILL_PATHS}.
 *
 * This keeps its own admission rather than reusing `postHandler`: that wrapper
 * admits `POST` only, because every other product address is an RPC command
 * that reads a JSON body. A bodyless read is a `GET`, and pretending otherwise
 * would be a lie in the published surface.
 *
 * The order is the security claim, and the route test asserts it: the sentinel
 * fence first (it needs no credential), then the credential, and only then the
 * aggregate. An anonymous caller is refused before a byte of any log is opened.
 * @param options - the bill service and the two shared seams.
 * @returns one handler per published path.
 */
export function billHandlers({ service, authenticate, fence }: {
  readonly service: Pick<BillService, 'snapshot'>
  readonly authenticate: (request: IncomingMessage) => unknown
  readonly fence: (request: IncomingMessage) => unknown
}): Map<string, BillHandler> {
  const handle: BillHandler = async (request, response) => {
    try {
      if (fence(request) !== undefined) throw new BillError(403, 'forbidden-authority', 'untrusted Host or Origin')
      if (request.method !== 'GET') throw new BillError(405, 'method-not-allowed', 'use GET')
      if (authenticate(request) === undefined) throw new BillError(401, 'unauthorized', 'present a live session credential')
      // One read of one aggregate: the caller is never told a number the next
      // read would not repeat from the same logs.
      sendJson(response, 200, { ok: true, bill: billView(await service.snapshot()) })
    } catch (error) {
      const known = error instanceof BillError
      sendJson(response, known ? error.status : 500, {
        ok: false,
        error: { code: known ? error.code : 'bill/internal', message: known ? error.message : 'the bill failed to compute' },
      })
    }
  }
  return new Map(BILL_PATHS.map(path => [path, handle]))
}
