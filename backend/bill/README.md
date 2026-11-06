# The Fairy's electricity bill

Fairy's own token consumption, folded from the session logs the backend already
keeps. There is no ledger table: every model call reports its usage into its own
session log, and the bill is a read over those logs.

- `ctx.ourfairyBill.snapshot()` → `{today, month, allTime, days}` in tokens.
  `days` is always the trailing 30 local days, oldest first, with zero days
  present at zero. Today, the month and the series come from one pass, so they
  cannot disagree.
- This package publishes **no HTTP address** and injects **no context**. The
  reading address and the model-visible reading are separate tickets and both
  consume this service.

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

## Public surface

- `.` — the row (`name`/`inject`/`apply`) and `ctx.ourfairyBill`.
- `./aggregate` — `aggregateBill`, `createBillService`, `SERIES_DAYS` and the
  snapshot types.
- `./fold` — `foldDailyTokens`, `turnSpans`, `localDay`, `TIME_ZONE`, the bucket
  helpers and their types.
