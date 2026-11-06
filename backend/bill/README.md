# The Fairy's electricity bill

Fairy's own token consumption, folded from the session logs the backend already
keeps. There is no ledger table: every model call reports its usage into its own
session log, and the bill is a read over those logs.

- `ctx.ourfairyBill.snapshot()` → `{today, month, allTime, days}` in tokens.
  `days` is always the trailing 30 local days, oldest first, with zero days
  present at zero. Today, the month and the series come from one pass, so they
  cannot disagree.
- The model sees the bill in two places, and both read that one service: a
  reading at the **end of a user session's runtime context**, and one read-only
  tool for the questions the reading deliberately does not answer.
- This package publishes **no HTTP address**; the reading address is a separate
  ticket and reads this same service.

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
to the presenting layer; adjusting it must never require re-deriving history. It
is `TOKENS_PER_DENNY` in `src/reading.ts`, the one place the rate is written.

## The model-visible reading

One line, appended as the last section of the runtime-context snapshot:

```
电费读数：上一次互动 477 丁尼；本日累计约 4 万丁尼。
```

It is **constant for a whole turn**, and that is the constraint the design is
built around rather than a nicety. The channel only ever appends — it never
rewrites a snapshot it already wrote — while the loop re-resolves every context
on every attempt inside a step. This deployment's turns have a median of 12
steps and a p90 of 136, so a value that drifted per attempt would leave dozens
of permanent messages in a single turn.

So the reading is computed at two cheap moments (an agent's arrival, and each
`turn/end`) and then **pinned once per turn** at the loop's pre-step boundary;
the registered provider is synchronous and only formats the pin. A turn
therefore appends at most one reading, by construction.

What it reports, and why neither number can drift inside a turn:

- **上一次互动** — the last turn that *closed* before the open one, priced by
  this package's own fold (`src/previous.ts`), rounded to a whole Denny. dsh's
  `turnBoundary` projection locates the turn: the Agent interface exposes no
  turn or step, and that projection carries both the open turn's start seq and
  the latest turn number.
- **本日累计** — today's deployment-wide total in 10 000-Denny steps
  (`DENNY_DAY_BUCKET`). It is a running total, so it does move; a step about
  four times a day costs about four snapshots a day.

Two absences are worded apart and **neither is ever written as `0`**: no
completed interaction yet, and usage the provider never reported. The day total
distinguishes the same way, plus a day too small for one step. A settled turn
that spent less than a whole Denny reads `不足 1 丁尼` rather than rounding to a
number that would read as free.

The text is inert reference data: no second person, no invitation to speak, and
no change to the deployment persona. Whether the number is worth mentioning is
the persona's decision, not the line's.

Registration is global but the text renders empty outside a **user's own
session** — the same predicate the persona guard uses. A memory-maintenance or
skill-learning child carries no reading and is not offered the tool.

Order is `BILL_CONTEXT_ORDER` (1000), above every order dsh allocates (its
runtime contexts run from -1000 to 210) and above this deployment's own
`ourfairy:spaces` (0), so the reading is the snapshot's final section.

## The tool

`electricity_bill`, no parameters, read-only. It returns
`{today, month, allTime, days, contextReadingGranularityDenny}` where each total
carries both `denny` and the raw token `buckets`, and `days` is the trailing 30
local days. That is the same snapshot the bill page serves — the tool calls
`ctx.ourfairyBill.snapshot()`, so the two cannot disagree, and the field naming
the reading's bucket exists so a reader can reconcile the exact number with the
throttled line instead of suspecting one of them.

Like the aggregate, it prices **completed turns only**: a tool call runs inside
an open turn, so the turn containing the call is not billed yet.

## Public surface

- `.` — the row (`name`/`inject`/`apply`) and `ctx.ourfairyBill`.
- `./aggregate` — `aggregateBill`, `createBillService`, `SERIES_DAYS` and the
  snapshot types.
- `./fold` — `foldDailyTokens`, `turnSpans`, `localDay`, `TIME_ZONE`, the bucket
  helpers and their types.
- `./reading` — `renderBillReading`, `TOKENS_PER_DENNY`, `DENNY_DAY_BUCKET`, the
  reading types and `UNAVAILABLE_READING`.
- `./previous` — `previousInteraction`, which decides which completed turn the
  context reading reports.
- `./context` — `installBillContext`, `BILL_CONTEXT_NAME`, `BILL_CONTEXT_ORDER`
  and `isReadingAudience`.
- `./tools` — `registerBillTool`, `billToolValue` and `BILL_TOOL_NAME`.
