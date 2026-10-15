# T7–T9 stage evidence

## Preparation (2026-10-15)

Scope and review baseline are recorded in
[`stage-t7-t9-plan.md`](../../notes/stage-t7-t9-plan.md).
Before implementation, `git branch --show-current` and `git rev-parse HEAD`
confirmed these integration branches and commits:

| Repository | Branch | Commit |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `97b776fac2eca207b308884b890748ce51f308ed` |
| rikkahub | `product/ourfairy-v1` | `d8567891533e6bc725f48382c43b2096de4e422b` |
| deepseek-harness | `product/ourfairy-v1` | `d3fe98f969c3963c6d193e74c776692e33c1eb64` |

`issues-at-start.json` archives the Lead's GitHub GraphQL response from
`/tmp/ourfairy-t7-t9-issues.json`: #30 is open and depends on closed #28;
#31 and #32 are open and blocked by #30. Ticket completion and dependency
changes must be checked again when the implementation frontier advances.

`dsh-preexisting-dirty-sha256.json` archives the 16 existing modified dsh
files from `/tmp/ourfairy-t7-t9-dsh-dirty-baseline.json`. Preparation checked
the full `git status --porcelain -z` path set against that manifest and
recomputed every file's SHA-256 with Python `hashlib`; all 16 matched.
These changes belong to prior work and must not be reset or included here.
rikkahub also reported an existing untracked `.worktrees/` directory, which
was preserved. No product source was changed during this preparation.

## MiniMax Code read-only location task

`mcode-readonly-run.json` is the non-secret runner metadata from
`/tmp/delegate-minimax-6350pv3v/run.json`. The CLI completed normally with
exit code 0 after 113.625 seconds; stderr was empty. This confirms mcode
worked for this task. Its Android/Fairybot reuse report at
`/tmp/ourfairy-t9-android-reuse.md` is only a source-location index, not
accepted authorization or runtime evidence. No implementation, Gradle
build, device check, or model request was run by this task.

The report's inference that the existing server has no authorization was
subsequently checked against source by an experienced worker and rejected.
Merger independently read the pointed source: Fairybot
`src/server/files.ts:796` checks upload owner, completed state and expiry;
`src/server/admission.ts:434` resolves only committed inputs in the current
session; `src/server/admission.ts:459` checks committed state, account and
session for original downloads. These are static source facts, not new
runtime acceptance. Do not reuse the inference or treat client-side owner
fields as evidence of missing server authorization. The uncorrected
stdout/report is deliberately not copied into committed evidence.

A later attempt to delegate code reuse to mcode was blocked by automatic
approval review. That was an execution-approval restriction, not a model
or mcode CLI error. This read-only task remains a successful invocation.

Runtime and review evidence is recorded below as implementations complete.

## T7 integration

Merged `ticket/07-space-execution` at
`606101a1ec8317a6a660301dab813092d01218ef` with a normal no-fast-forward
merge, producing `bc089a828135c5f65df0a2ddb28d49a370a07184`.
The ticket worktree was clean and `git merge-base --is-ancestor
integration/ourfairy-v1 HEAD` succeeded before the merge. Its diff was
limited to product space providers, profile/launcher/probe wiring, related
tests and evidence. The owner reported 61/61 full-suite results; merger
read the test source and original logs, and independently ran the bounded
runtime suite on the merged source. This is integration verification,
not the staged two-axis code review scheduled after T7–T9.

Actual commands on merged OurFairy:

- `node scripts/combo.mjs verify`: exit 0 (`t7-merged-combo.log`).
- `node scripts/ourfairy-backend.mjs doctor`: exit 0, all checks passed
  (`t7-merged-doctor.log`).
- `node --test tests/spaces.test.mjs`: exit 0, 7/7, no skips
  (`t7-merged-runtime.log`), with real Loader/HTTP, SQLite/JSONL, files and
  bubblewrap subprocesses; external model and package source are local
  deterministic fixtures. Network and shared dependency use succeeded.
- `git diff --check`: exit 0.
- Recomputed all 16 pre-existing dsh dirty-file hashes and compared the
  complete dirty path set: unchanged.

There are no dsh or Android source changes in T7, so `combo.json` retains
the existing exact external commits. No full-suite rerun, device, official
cloud inference, detached-job controller or production acceptance was
performed by merger. Original T7 evidence and limitations are in
[`07-space-execution/README.md`](../07-space-execution/README.md).

## T8 integration

Merged `ticket/08-group-spaces` at
`2dbe49acfd05a080e8775084c54c5d4085bb3d6c` with a normal no-fast-forward
merge, producing `6083cc15e12e282f8e7ee59da29360a7b62a6478`.
The ticket worktree was clean, and the current integration tip was an
ancestor before merging. Merger inspected the additive schema v3 migration,
numeric membership actions, actor/timestamp/deletion fields, absence of
foreign keys and unique secondary indexes, transaction checks and scoped
group root wiring. Existing v1/v2 identity records are retained; no separate
business database or client group-management flow was added.

The owner recorded 66/66 full-suite and 28/28 related results. Merger read
the source and original logs, then independently ran the following on the
merged tree, without repeating the full suite or initiating stage review:

- `node --test tests/groups.test.mjs tests/identity-store.test.mjs`: 21/21,
  no skips (`t8-merged-runtime.log`). This covers real chat/SQLite/JSONL,
  restricted subprocess file access, current membership revocation,
  restart, duplicate member updates and v1/v2 migrations; model HTTP is a
  deterministic double.
- `node scripts/combo.mjs verify`: exit 0 (`t8-merged-combo.log`).
- `node scripts/ourfairy-backend.mjs doctor --json`: `ok: true`
  (`t8-merged-doctor.log`).
- `git diff --check`: exit 0.

Only OurFairy changed, so the exact external commits in `combo.json` remain
unchanged. T8 original evidence and execution limits are in
[`08-group-spaces/README.md`](../08-group-spaces/README.md). In particular,
already-running processes retain their initial mounts until termination;
membership removal applies to subsequent operations. No device or actual
official-cloud acceptance is claimed.
