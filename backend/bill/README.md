# The Fairy's electricity bill

Fairy's own token consumption, folded from the session logs the backend already
keeps. There is no ledger table: every model call reports its usage into its own
session log, and the bill is a read over those logs.

- `ctx.ourfairyBill.snapshot()` → `{today, month, allTime, days}` in tokens.
  `days` is always the trailing 30 local days, oldest first, with zero days
  present at zero. Today, the month and the series come from one pass, so they
  cannot disagree.
- `GET /bill`, bearer credential → one bill reading. This package owns that one
  address; the model-visible context reading (#320) is a separate ticket and
  consumes the same service.

## The reading address

`GET /bill` is the bill's only address, and it takes no body — a read, not a
command, which is why it is the product's second `GET` and keeps its own
admission instead of going through `postHandler`.

```json
{ "ok": true,
  "bill": {
    "today":   { "tokens": { "inputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 0 }, "denny": 0 },
    "month":   { "tokens": { … }, "denny": 0 },
    "allTime": { "tokens": { … }, "denny": 0 },
    "days": [ { "day": "2026-10-08", "tokens": { … }, "denny": 0 }, … 30 entries ]
  } }
```

- **Admission is a live credential and nothing more** (`auth: 'authentication'`).
  The bill is this Fairy's public total and belongs to no session, so an
  ordinary agent reads exactly what the administrator reads; there is no
  ownership or role check, and the caller comes from the credential because a
  bill read has no body to name anyone in.
- **The order is the security claim**: fence → method → credential → aggregate.
  An anonymous caller is refused before any log is opened, and an untrusted
  `Host` is refused before the credential is even read.
- **One address on purpose.** Today, the month, all time and the series are one
  observation; two addresses would let two numbers quoted to each other come
  from different snapshots.
- **Empty is not failure.** No sessions, or none with usage, is a zero bill with
  30 zero days. A corpus that cannot be read is `500 bill/internal` — never a
  zero bill, because "spent nothing" and "could not compute" are different
  answers. Refusals keep the product shape: `bill/unauthorized` (401),
  `bill/forbidden-authority` (403), `bill/method-not-allowed` (405).

## Where the numbers come from

- Usage is read from both places it is recorded: a settled message's
  `data.usage` and a retried attempt's own stream. A retried attempt leaves no
  message of its own, so reading only messages would lose those tokens.
- One complete turn is folded by dsh's own `deriveTurnTokenUsage`
  (`@deepseek-ai/dsh-token-meter/client`), which fails closed on missing
  lifecycle boundaries, incomplete usage, unsafe counts, or contradictory
  totals. A turn with no `turn/end` therefore contributes nothing; the bill
  never estimates a crashed turn.
- A turn is billed to the local day it **started**. Boundaries are cut in
  `Asia/Shanghai` (exported as `TIME_ZONE`), which is also the zone the
  today/month windows and the 30-day series use.
- Every session counts, ownership ignored: memory-maintenance and skill-learning
  children consume the same electricity. Archived sessions still count.
- Auxiliary calls that report no usage (title generation) contribute nothing;
  there is no attempt to synthesize a number for them.

## The cache

The bill is cached per session, keyed by that session's persistence revision.
The revision must be read per session with `sessionPersistence.stat` — the
session listing's records carry no revision. Two rules make the cache honest:

- A session that has not materialized reports a revision minted at creation that
  never moves, so it is **never** cached; its contribution is recomputed every
  time.
- A live session is answered by the live-preferred read, not by the
  revision-guarded cold path, so it is never revision-guarded either.

Hence the first read costs one replay per session (header listing, then each
whole log), and a later read costs the listing plus one `stat` per session.
`tests/bill-aggregate.test.mjs` pins that path.

## Units

The bill is stored and derived in tokens only. The Denny rate (1 Denny = 3000
tokens, from "1.8e9 tokens ≈ 600000 Denny") is a narrative constant and belongs
to the presenting layer; adjusting it must never require re-deriving history.

The constant is written down **once**, in `src/denny.ts`
(`TOKENS_PER_DENNY`), with `dennyOf`/`dennyOfTokens` as the only conversion.
That module imports nothing, and it is a published subpath (`./denny`) so the
other presenting faces — the Fairy's context reading (#320) and the bill page
(#322) — quote the same rate rather than each carrying a copy.

Conversion rounds to **a tenth of a Denny**. One Denny is 3000 tokens, so a
single settled turn is often a fraction of one; an integer would show a real
spend as zero, while the exact quotient would claim a precision this narrative
rate does not have. Every figure is reported beside its own token count, so the
underlying number stays checkable at full precision. (The context reading
rounds differently on purpose — it throttles the daily figure to whole ten
thousands of Dennies so that a turn's repeated appends stay rare; that is a
different job from quoting one number on a page.)

## Public surface

- `.` — the row (`name`/`inject`/`apply`), `ctx.ourfairyBill`, the one address's
  `SURFACE`/`BILL_PATHS` and the view/error types.
- `./aggregate` — `aggregateBill`, `createBillService`, `SERIES_DAYS` and the
  snapshot types.
- `./fold` — `foldDailyTokens`, `turnSpans`, `localDay`, `TIME_ZONE`, the bucket
  helpers and their types.
- `./denny` — `TOKENS_PER_DENNY`, `dennyOf`, `dennyOfTokens`, `tokensOf`: the
  one rate and the one conversion.
- `./http` — `SURFACE`, `BILL_PATHS`, `billHandlers`, `billView`, `BillError`
  and the wire-view types.
