# T7–T9 handoff — stop after the reviewed stage

Authorized stage: T7/#30, T8/#31 and T9/#32, one independent two-axis
code review and bounded correction. All implementations and the single
review finding are integrated. Stop here; do not start T10 or later work
without the user's resumption. Lead will close #32 and update #23 in the
tracker. Stage cleanup is complete as recorded below.

## Final combination

| Repository | Integration branch | Resolved source |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `fcd4502c45ca8e36cbded529a4cd8d8f5e00dd59` (final source merge; subsequent closeout commits contain evidence/handoff only) |
| rikkahub | `product/ourfairy-v1` | `e58352f202ae1add0e9c4bd08b14807f4c84a9bb` |
| dsh | `product/ourfairy-v1` | `d3fe98f969c3963c6d193e74c776692e33c1eb64` (unchanged this stage) |

`combo.json` locks the exact external commits and OurFairy's integration
branch, avoiding a self-referential commit hash. The final public OurFairy
head is the closeout commit containing this file, reported with remote
verification at publication. On resumption, record that final published
head before any new commit. **The next review baseline is this final
resolved/published combination, including the download fix**, not the
original review head `98ee42d`, nor the previous stage's `97b776f`.

## Delivered behavior and reuse

- T7 derives private/public roots from permanent native Session owner,
  reuses dsh file/directory/bash interfaces, and confines real subprocesses
  with narrow bubblewrap mounts. Network is allowed; one shared dependency
  environment remains. cwd/escalation cannot widen user scope. Detached
  job/controller entry points remain disabled pending T13; actual shell
  background descendants already inherit confinement.
- T8 adds only `groups` and `group_members` to the existing identity
  SQLite (v3), with numeric actions, logical deletion/actors/timestamps,
  no FK or unique secondary indexes. Existing chat tools create groups
  and manage membership; every later file/process operation recomputes
  membership. Revoked group cwd recovers privately. Already-running
  processes retain initial mounts until they end.
- T9 adds one `uploads` lifecycle table (v4, v1/v2/v3 migration covered).
  Native CAS owns original/normalized bytes; native message source owns
  admitted references and request receipts. Authenticated upload/chunk/
  complete and message-qualified original downloads reuse these facts.
  Exact readonly leaves qualify model/tool/script reads by session;
  matching hashes grant no authority. Android uses existing chat/pending
  preferences with ordered upload IDs and temporary original-byte drafts,
  picker/upload/download binding checks, attachment rendering and SAF
  export. No Room history, generic outbox or permission framework.

## Review and validation

Independent review: Standards **1 P2**, fixed; Spec **0**. The concrete
P2 was a download interrupted while waiting for backpressure, retaining
the source. One local AbortController connection to response close,
native stream and drain wait fixes it. Original reports/ranges,
reproduction, red/green and merged regression are preserved under
`work/implementation/evidence/review-t7-t9/`; no second full review ran.

Actual owner checks: product suite **71/71** before bounded review fix;
Android relevant JVM suite **98/98** and debug APK build. Actual merger
checks: T7 runtime **7/7**; T8 groups+migrations **21/21**; T9 attachments+
migrations **23/23**; Android API/pending state **10/10**; final merged
download cleanup plus normal attachment regressions **6/6**. Combo,
doctor and diff checks passed. All three owner APK hashes match; owner
and merged Android tracked source trees are identical. Raw evidence is
in `work/implementation/evidence/stage-t7-t9/` and each ticket directory.

Backend behavior uses real profile/Loader, SQLite/JSONL/CAS, HTTP, files,
Linux namespaces and restricted subprocesses, with deterministic external
HTTP model/package fixtures. Android public state uses controlled
backend/preferences adapters and API tests use loopback HTTP. These do
not claim phone/emulator/Compose/activity-result runtime, actual Android
preference-disk faults, APK-to-real-backend, official cloud/image semantic,
signed-release or performance acceptance. Build uses a fake Firebase-key
stub. No production deployment or later receiver delivery/jobs acceptance
was performed.

## Preserved state and worktrees

All seven current-stage worktrees have been removed after source/archive
checks; branches and older worktrees remain. Four OurFairy paths and the
Android UI scratch path used ordinary removal. Android main/API required
Git's submodule `--force` worktree-removal switch after normal refusal,
clean deinit and explicit Lead authorization; no force push/reset was used.
See `work/implementation/evidence/stage-t7-t9/cleanup.md` and its Android
report for exact commands and byte-for-byte archive checks.

The 16 pre-existing dsh dirty files remain byte-for-byte equal to
`/tmp/ourfairy-t7-t9-dsh-dirty-baseline.json` (committed copy under stage
evidence). Do not reset, include or clean those files. Older worktrees
remain outside this stage's cleanup scope. mcode Android API/UI original
tracked diffs and untracked Kotlin sources are archived in the Android
evidence directory and retained local archival branches; their worktrees
were removed only after exact comparisons. No task-owned implementation
or build execution remains running.

mcode CLI worked; source-transfer automatic approval rejection was not a
model failure. Bounded mcode schema/API/UI work was inspected and corrected
by owners. No dsh harness invocation or dsh source change was needed.

Read `AGENTS.md`, `CONVENTIONS.md`, actual GitHub dependencies, this
handoff, and the next ticket before resuming. Continue coordinating large
work through capable owners and bounded intern tasks; preserve the user's
personal-project preference for simple reuse and review only concrete
user-visible/spec/standards problems.
