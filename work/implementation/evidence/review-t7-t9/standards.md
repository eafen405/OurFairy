# Standards review — T7–T9

Reviewed the fixed ranges in `/tmp/ourfairy-stage789-review-ranges.md`, against both repositories’ `AGENTS.md`, `work/implementation/CONVENTIONS.md`, the user-overridden stage plan, and the changed backend README contracts. dsh has no increment. Archived mcode drafts are evidence, not product implementations.

## Finding

**P2 — Release the download source when the client disconnects during backpressure.** `backend/attachments/src/index.mjs:45` introduces:

```js
if (!res.write(step.value)) await once(res, 'drain')
```

When a client closes a download while this wait is pending, Node emits `close` without another `drain`. The responder never reaches its `finally { await iterator.return?.() }`. The native attachment generator consequently remains suspended; its source stream is destroyed only in that generator’s `finally` (`deepseek-harness/packages/attachment/attachment-local/src/file-store.ts:175`). Each interrupted download can retain its open file source until backend restart.

This conflicts with OurFairy `AGENTS.md:14`’s “精简不减保障” requirement to retain necessary failure recovery. A local response-close cancellation/cleanup for the existing stream and drain wait is sufficient; no retry or transfer framework is needed.

**Reproduction:** `/tmp/ourfairy-stage789-download-abort-probe.mjs` extracts and executes the actual new responder against a real loopback HTTP connection. Only the attachment source is an instrumented async generator. Destroying the client after its first received data produced `/tmp/ourfairy-stage789-download-abort-result.json`:

```json
{"responseClosed":true,"handlerSettled":false,"sourceClosed":false,"chunks":2}
```

No other actionable Standards findings. The new group/upload tables reuse the business store, and the scoped providers reuse native interfaces; this review does not recommend additional abstractions or speculative host-tampering safeguards. No redundant full suite was run.
