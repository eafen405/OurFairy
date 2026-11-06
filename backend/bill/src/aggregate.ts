/**
 * The cross-session aggregate: this Fairy's whole token consumption, derived
 * from the session logs the deployment already keeps.
 *
 * There is no ledger table. Every model call reports its usage into its own
 * session log, so the bill is a fold over the logs — archived sessions, unowned
 * maintenance and learning children included, because they burn the same
 * electricity. A session's contribution is cached per session, keyed by the
 * persistence revision of its log: an unchanged revision means an unchanged
 * log, so the expensive read is skipped. A session that has not materialized
 * has a placeholder revision that never moves and is therefore never cached.
 *
 * The seam this module reads is passed in ({@link BillSource}), not looked up
 * from the context: the aggregation is a pure-ish function of "what sessions
 * exist and what their logs say", which is what makes its caching observable
 * without reaching into private state.
 *
 * @module @ourfairy/dsh-bill/aggregate
 */
import { addBuckets, foldDailyTokens, localDay, zeroBuckets, type DailyTokens, type TokenBuckets } from './fold.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** How many days the trailing series covers. */
export const SERIES_DAYS = 30

/** One session as the cheap header listing reports it. */
export interface BillSessionHeader {
  /** The stored session id. */
  readonly id: string
  /** Whether the session is live in this process right now. */
  readonly live: boolean
}

/** One session's persistence observation. */
export interface BillSessionRevision {
  /** Opaque change token for the stored log. */
  readonly revision: string
  /**
   * Whether the log has reached durable storage. A created-but-unwritten
   * session reports a placeholder revision that never changes, so its answer
   * must not be cached.
   */
  readonly materialized: boolean
}

/**
 * The session facts the bill reads. The row supplies the real implementation;
 * the tests supply a recording fake.
 */
export interface BillSource {
  /** Every stored session, live or cold, in any order. */
  list(): Promise<readonly BillSessionHeader[]>
  /** One session's revision, or `undefined` when it is gone. */
  stat(id: string): Promise<BillSessionRevision | undefined>
  /**
   * Load and replay-validate one session's complete log. A live session is
   * answered from its in-memory snapshot; a cold one from storage.
   */
  read(id: string): Promise<readonly SessionEvent[]>
}

/** The three totals a bill answers with. */
export interface BillTotals {
  /** Local today, from local 00:00. */
  readonly today: TokenBuckets
  /** Local this month, from the 1st at 00:00. */
  readonly month: TokenBuckets
  /** Every recorded day, with no start. */
  readonly allTime: TokenBuckets
}

/** One day of the trailing series; a day with no spend is present at zero. */
export interface BillDay {
  /** The local civil date. */
  readonly day: string
  /** That day's totals; all zero when nothing was spent. */
  readonly tokens: TokenBuckets
}

/** One bill observation: the three totals and the series, from the same pass. */
export interface BillSnapshot extends BillTotals {
  /** The trailing {@link SERIES_DAYS} local days, oldest first, zero-filled. */
  readonly days: readonly BillDay[]
}

/** One cached session: the revision it was read at, and what it contributed. */
interface CachedSession {
  readonly revision: string
  readonly days: readonly DailyTokens[]
}

/** The trailing series' day keys, oldest first, including today. */
function seriesDays(now: number): string[] {
  const keys: string[] = []
  // Step back a day at a time and keep the first sighting of each local date.
  // A DST transition can repeat or skip a 24-hour step; de-duplicating keeps
  // the result a run of distinct local days whatever the zone does.
  for (let offset = 0; keys.length < SERIES_DAYS && offset < SERIES_DAYS * 2; offset += 1) {
    const key = localDay(now - offset * 86_400_000)
    if (!keys.includes(key)) keys.push(key)
  }
  return keys.reverse()
}

/**
 * Aggregate one snapshot of the whole deployment's bill.
 *
 * The totals and the series are produced in one pass, so they cannot disagree.
 * A session that cannot be read fails the whole snapshot: reporting zero would
 * make "no spend" and "could not compute" the same answer.
 * @param source - the session facts to read.
 * @param now - the instant the snapshot describes.
 * @param cache - the per-session contributions to reuse; the service owns it.
 * @returns the three totals and the trailing series.
 */
export async function aggregateBill(
  source: BillSource,
  now: number,
  cache: Map<string, CachedSession> = new Map(),
): Promise<BillSnapshot> {
  const keys = seriesDays(now)
  const todayKey = keys[keys.length - 1] as string
  const monthKey = todayKey.slice(0, 7)
  const inSeries = new Set(keys)

  let today = zeroBuckets()
  let month = zeroBuckets()
  let allTime = zeroBuckets()
  const perDay = new Map<string, TokenBuckets>()

  const sessions = await source.list()
  for (const { id, live } of sessions) {
    let days: readonly DailyTokens[]
    if (live) {
      // A live session is still being appended, so the revision guard does not
      // apply to it: it is read from its snapshot every time and never cached.
      days = foldDailyTokens(await source.read(id))
    } else {
      const known = cache.get(id)
      const observed = await source.stat(id)
      // Gone between the listing and the observation: it contributes nothing.
      if (observed === undefined) continue
      if (known !== undefined && observed.materialized && known.revision === observed.revision) {
        days = known.days
      } else {
        days = foldDailyTokens(await source.read(id))
        if (observed.materialized) cache.set(id, { revision: observed.revision, days })
        else cache.delete(id)
      }
    }

    for (const entry of days) {
      allTime = addBuckets(allTime, entry.tokens)
      if (entry.day === todayKey) today = addBuckets(today, entry.tokens)
      if (entry.day.startsWith(monthKey)) month = addBuckets(month, entry.tokens)
      if (inSeries.has(entry.day)) perDay.set(entry.day, addBuckets(perDay.get(entry.day) ?? zeroBuckets(), entry.tokens))
    }
  }

  return {
    today,
    month,
    allTime,
    days: keys.map(day => ({ day, tokens: perDay.get(day) ?? zeroBuckets() })),
  }
}

/** What the row publishes to the rest of the product. */
export interface BillService {
  /** One observation of the bill, reusing unchanged sessions. */
  snapshot(): Promise<BillSnapshot>
}

/**
 * The row's reading face: the aggregate plus the cache it lives in.
 * @param source - the session facts to read.
 * @param now - supplies the instant each snapshot describes. Reading it per
 *   snapshot is what lets a snapshot taken after local midnight move its day
 *   and month windows without a restart.
 * @returns the service the row publishes.
 */
export function createBillService(source: BillSource, now: () => number): BillService {
  const cache = new Map<string, CachedSession>()
  return {
    snapshot: () => aggregateBill(source, now(), cache),
  }
}
