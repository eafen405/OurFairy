> 2026-10-20 状态：日期化记录。本文记录 2026-10-20 的判断，不描述当前实现。

# Native capability dependencies

This is the upgrade record for the four native dsh capabilities the first
version adopted under spec [#71](https://github.com/eafen405/OurFairy/issues/71).
For each it names the package, service, row or subpath depended on; the behavior
the product relies on; the executable tests that pin that behavior; and what to
do on an upstream change.

It is **not** the row inventory. The mounted rows and their config have one
authority: [`backend/v1-bundle/cordis.patch.yml`](../../backend/v1-bundle/cordis.patch.yml).
The fixed combination, including the dsh commit, is [`combo.json`](../../combo.json).
This record names only the rows and exports the product depends on, so a reader
can tell which parts of that composition are load-bearing.

Run `npm run backend:doctor` before a boot: its `native capabilities` check
reads the **installed** profile through dsh's own loader and fails naming the
missing row or export. [`tests/native-capabilities.test.mjs`](../../tests/native-capabilities.test.mjs)
proves that failure. The doctor check covers the rows and the public export;
the services those rows provide and the provider `retryPolicy` are pinned by the
behavior tests named below, which exercise a real boot. The check itself loads
the profile through `@deepseek-ai/dsh-app-boot`'s public exports
(`loadProfileDirectory`, `composeEntries`, `loadOverlayPatches`); that package is
part of the pinned dsh installation recorded in `combo.json`.

## Dependency record

### PDF worker: `ctx.subprocess`

- **Dependency.** The `ctx.subprocess` service from
  `@deepseek-ai/dsh-subprocess`, provided by the `subprocess` row
  (`@deepseek-ai/dsh-subprocess-local`) in the bundle. The product package
  declares the peer in [`backend/attachments/package.json`](../../backend/attachments/package.json).
- **Behavior relied on.** `spawn` takes the bwrap/prlimit argv plus a wall
  deadline `signal`, `graceMs`, a 256 KiB stdout cap and a small, discarded
  stderr collector; the service kills the whole process range and the module awaits
  `waitForExit()` before removing its temporary directory; the cancellation
  test asserts that no worker survives. The module keeps the page rules and maps the service's termination
  and exit facts to numeric status: a worker the service terminates (the 10 s
  deadline, a caller stop, the resource limit) and a `152`/`137` exit map to
  `resource-limit`; any other non-zero exit is `worker-unavailable`. See
  [`backend/attachments/src/pdf.ts`](../../backend/attachments/src/pdf.ts) and
  [`backend/attachments/pdf/README.md`](../../backend/attachments/pdf/README.md).
- **Compatibility tests.** [`tests/pdf-worker-cancel.test.mjs`](../../tests/pdf-worker-cancel.test.mjs)
  (the service registers, cancellation kills the worker, no process survives,
  the temp directory is removed), [`tests/sandbox-network-profile.test.mjs`](../../tests/sandbox-network-profile.test.mjs)
  (the PDF profile never receives `--share-net`), and
  [`tests/pdf.test.mjs`](../../tests/pdf.test.mjs) (the tool behavior across
  damaged/encrypted/empty/partial/resource-limit results).
- **On an upstream change.** Adapt `runWorker` to the new service call shape and
  keep the same exit mapping; the cancellation test is the gate. If the service
  is removed upstream, restore the pre-#81 narrow private `spawn` adapter
  inside `pdf.mjs` (same bwrap/prlimit argv and budgets) rather than an
  unconfined parser, and keep the network-profile assertion green.

### Model retry: `llm-retry` plus the provider `retryPolicy`

- **Dependency.** The `llm-retry` row (`@deepseek-ai/dsh-llm-retry`) and the
  `retryPolicy` on the `llm-pi-ai` provider profile in the bundle (normal mode:
  a bounded backoff over the transient failure codes). The policy is per route;
  the row takes no config.
- **Behavior relied on.** A transient model failure re-runs the failed step
  inside the same open turn, after a durable `llm/retry` event and a cancellable
  bounded backoff, before `llm/retry-started`. One user message produces one
  assistant settlement, and the model-visible request carries no retry state.
  See the bundle's "model-request recovery" section and
  [ticket #82's measurements](../../work/implementation/evidence/82-native-rows/README.md).
- **Compatibility tests.** [`tests/native-rows.test.mjs`](../../tests/native-rows.test.mjs):
  the rate-limit-then-success case (one user message, one settlement, the two
  durable events), the stop-during-backoff case, and the reverse control that
  disables the row and asserts no second request and no retry events. The last
  case is what would fail if product code ever grew its own retry loop.
- **On an upstream change.** Adapt the row name/config and the provider policy
  field together; the reverse-control case pins that recovery comes from the
  mounted row. If the capability disappears upstream, keep the pinned dsh or
  carry a minimal upstream patch ([ADR-0001](../adr/0001-upstream-extension-policy.md));
  do not add a product retry loop.

### Spill: `spill-local` plus `spill-policy`

- **Dependency.** The `spill-local` and `spill-policy` rows
  (`@deepseek-ai/dsh-spill-local`, `@deepseek-ai/dsh-spill-policy`), with
  `spill-local.root` inside `DSH_HOME` and the inline budget declared by the
  `spill-policy` row. The product also imports
  `sessionDir(root, sessionId)` from `spill-local` to contribute only the
  current session's spill directory.
- **Behavior relied on.** An oversized tool result reaches the model as a
  bounded preview with a file locator and an omitted-bytes notice; the complete
  result is a session-scoped file under the mounted root. The product's
  [`backend/chat/src/spill-read.ts`](../../backend/chat/src/spill-read.ts)
  grants that one directory read-only per session, so `read` and the confined
  shell can retrieve it while other sessions and users are denied. The budget
  measurement and value are in [ticket #82's evidence](../../work/implementation/evidence/82-native-rows/README.md);
  retrieval and denial are in [ticket #83's evidence](../../work/implementation/evidence/83-spill-read/README.md).
- **Compatibility tests.** [`tests/native-rows.test.mjs`](../../tests/native-rows.test.mjs)
  (oversized bash result: preview, locator under `DSH_HOME/spill`, complete
  file) and [`tests/spill-read.test.mjs`](../../tests/spill-read.test.mjs)
  (full read, shell search, read-only enforcement, cross-session and cross-user
  denial).
- **On an upstream change.** Adapt the row names/config and the `sessionDir`
  import; the two suites assert both the policy effect and the product's read
  grant. If the rows are removed upstream, keep the pinned dsh or carry the
  minimal upstream rows rather than reimplementing the policy inside the
  product; the budget is a measured deployment choice.

### History and follow: `@deepseek-ai/dsh-agent/session-history`

- **Dependency.** The public subpath export
  `@deepseek-ai/dsh-agent/session-history` from `@deepseek-ai/dsh-agent`, with
  `createSessionHistorySeam`, `assistantStream`, `eventCursor` and
  `SessionHistoryGapError`. It exists at dsh commit
  `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf` (added by #84 in
  `ffb5a266aa`). The product imports it in
  [`backend/chat/src/runtime.ts`](../../backend/chat/src/runtime.ts).
- **Behavior relied on.** `assistantStream(sessionId)` returns the native
  baseline: the active attempt's `attemptId`, revision and compact stream, and
  `needsResync` when the fold dropped a corrupted attempt. The product publishes
  an attempt only while it is one continuous prefix, and withdraws it when the
  native fold says resync. `eventCursor(-1)` plus `SessionHistoryGapError`
  turns a torn durable read into a fresh `observeSession` cut instead of
  publishing a gap as continuous history. See the adapter's
  [ticket #85 evidence](../../work/implementation/evidence/85-history-adapter/README.md).
- **Compatibility tests.** [`tests/reconnect.test.mjs`](../../tests/reconnect.test.mjs):
  the lost-Assistant-frame case and the torn-durable-read case (plus the
  existing reconnect/page/checkpoint cases). The dsh-side contract for the seam
  itself lives in the dsh fork at that commit:
  [`packages/core/agent/tests/session-history.spec.ts`](https://github.com/eafen405/deepseek-harness/blob/5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf/packages/core/agent/tests/session-history.spec.ts)
  and
  [`packages/core/agent/tests/session-history-loader.spec.ts`](https://github.com/eafen405/deepseek-harness/blob/5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf/packages/core/agent/tests/session-history-loader.spec.ts).
  They are run in the dsh checkout, not by this repository's `npm test`; the
  product-side gate is `tests/reconnect.test.mjs`.
- **On an upstream change and replacement rule.** The fork-only export is
  replaced when an upstream equivalent public seam exists: switch the single
  import in `runtime.mjs`, delete the fork-only subpath and its two specs, and
  keep `tests/reconnect.test.mjs` as the product compatibility gate. If the
  subpath changes shape, adapt `runtime.mjs` at that one import. If it
  disappears with no upstream equivalent, the fallback is the pre-#85 product
  fold (event accumulation plus gap repair), which reintroduces the duplicated
  algorithm; `tests/reconnect.test.mjs` would have to be rewritten to pin that
  fallback.

## Retained product implementations

These two capabilities were deliberately **not** replaced by the native
features with similar names. The tests below are the drift signal: if the
native capability later becomes sufficient, those tests are the ones that must
be changed or deleted with the behavior, rather than silently kept.

### Attachment upload

The product keeps its own `/attachments/propose`, `/attachments/chunk`,
`/attachments/complete` and `/attachments/download` protocol
([`backend/attachments/src/index.ts`](../../backend/attachments/src/index.ts))
and the upload lifecycle in
[`backend/attachments/src/service.ts`](../../backend/attachments/src/service.ts).

- **Why.** The protocol is resumable at the acknowledged offset (a lost chunk
  ACK can repeat exact bytes; a conflicting offset is refused), uploads expire
  24 hours after proposal, completion verifies the original size/hash, and a
  completed original stays downloadable byte-for-byte by admitted message
  identity. Native `fileUploads`
  ([README at the pinned dsh](https://github.com/eafen405/deepseek-harness/blob/5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf/packages/client/file-upload/README.md))
  is a streaming intake with Session-owned staged receipts, and documents
  "uploads are not resumable" and one-shot stream bodies; it has no
  upload-expiry state and no original-byte download route. Its transport is the
  raw `/api/session/uploadFileBinary` route plus the generated Remote under the
  Connection's `/api` carrier, not the product's `/attachments/*` protocol.
- **Drift signal.** [`tests/attachments.test.mjs`](../../tests/attachments.test.mjs)
  pins the reasons: "lost chunk ACK retries exact bytes, expired upload cannot
  be new input, and admitted retry survives expiry" and "upload completes
  before sending and original downloads by qualified message identity across
  restart". If native uploads gain resumability, expiry and original download,
  those cases are what a replacement must preserve or explicitly retire.

### Job output and stop

The product keeps `/chat/jobs/output` and `/chat/jobs/stop`
([`backend/chat/src/jobs.ts`](../../backend/chat/src/jobs.ts),
[`backend/chat/src/index.ts`](../../backend/chat/src/index.ts)) over the
native job registry's `readAt`, `get` and `kill`.

- **Why.** The product projection folds `jobs/lifecycle`, `jobs/report`, inbox
  splices and turn ends into a durable per-session task list
  ([`backend/chat/src/units.ts`](../../backend/chat/src/units.ts), and the
  "后台任务折叠" section of [`backend/chat/README.md`](../../backend/chat/README.md)).
  That fold survives a restart and keeps task identities tied to the registry
  generation, so an old task id stays unavailable instead of resolving to a new
  same-named job; output reads use absolute UTF-8 offsets and an explicit
  availability flag. Native `jobController`
  ([README at the pinned dsh](https://github.com/eafen405/deepseek-harness/blob/5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf/packages/api/job-controller/README.md))
  is a process-local Typert Remote transport (`job.list`, `job.follow`,
  `job.kill`) over the same registry; it documents that a Host restart loses
  every ring and roster and does not fold durable per-session task facts. It
  also does not expose the product's output/stop request and response shapes.
- **Drift signal.** [`tests/jobs.test.mjs`](../../tests/jobs.test.mjs) pins the
  reasons: "confined detached scripts cannot read another user and old task
  identities stay unavailable after restart", "producer-side loss exposes
  missing output rather than treating a terminal status as complete output",
  and "registry retention preserves absolute byte offsets and explicitly marks
  an evicted prefix". A native replacement must keep those cases green or the
  cases must be retired with the behavior.

## Verification

- `npm run backend:doctor` — the `native capabilities` check reads the installed
  profile and names a missing/disabled/drifted row or the missing history
  export.
- `node --test tests/native-capabilities.test.mjs` — the check passes on the
  shipped composition and fails, naming the row/package/remedy, when the
  installed profile loses `llm-retry`.
- The compatibility suites listed per capability above; they boot the launcher,
  so a row that stopped providing its service, or a removed provider
  `retryPolicy`, fails them rather than silently changing behavior.
