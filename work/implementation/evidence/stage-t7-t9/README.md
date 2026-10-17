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

- `node scripts/combo.mjs verify`: exit 0.
- `node scripts/ourfairy-backend.mjs doctor`: exit 0, all checks passed
- `node --test tests/spaces.test.mjs`: exit 0, 7/7, no skips
with real Loader/HTTP, SQLite/JSONL, files and
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
  no skips. This covers real chat/SQLite/JSONL,
  restricted subprocess file access, current membership revocation,
  restart, duplicate member updates and v1/v2 migrations; model HTTP is a
  deterministic double.
- `node scripts/combo.mjs verify`: exit 0.
- `node scripts/ourfairy-backend.mjs doctor --json`: `ok: true`
- `git diff --check`: exit 0.

Only OurFairy changed, so the exact external commits in `combo.json` remain
unchanged. T8 original evidence and execution limits are in
[`08-group-spaces/README.md`](../08-group-spaces/README.md). In particular,
already-running processes retain their initial mounts until termination;
membership removal applies to subsequent operations. No device or actual
official-cloud acceptance is claimed.

## T9 integration and stage freeze

Backend `ticket/09-attachments` at
`d84c9d738b570580f04be70a2141875b66e18f0a` was clean and included the
published T8 integration tip. Normal merge produced OurFairy source head
`6b4f9899342eddaa744f6378cef0c6b90695fb1d`. Merger inspected the additive
v4 upload lifecycle table, native message manifests/receipt reuse,
authenticated routes and exact readonly file grants. It adds no separate
message ledger, database or session-history authority.

Android `ticket/09-attachments` at
`bf4db2d6ff29df9d1fa195fa81460ae12757e21d` was clean and based on the
current product tip. Normal merge produced
`e58352f202ae1add0e9c4bd08b14807f4c84a9bb`; both commits have identical
tracked source tree `51e98c61fc824c7897d4f882c58cf3493f778d6d`.
`combo.json` now pins that exact Android integration commit; dsh remains
unchanged. Android original run evidence, bounded mcode source/diff/task
archives and limits were copied from `/tmp/ourfairy-t9-android-evidence/`
to [`09-attachments-android/`](../09-attachments-android/README.md).

Independent checks on the merged trees:

- `node --test tests/attachments.test.mjs tests/identity-store.test.mjs`:
  23/23 with no skips, using real product
  HTTP/SQLite/JSONL/CAS and bwrap processes with external HTTP model double.
- Android `ANDROID_HOME=/home/eafen405/Android/Sdk
  PATH=/tmp/ourfairy-stage-review/bin:$PATH./gradlew
  :app:testDebugUnitTest --tests
  'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest' --tests
  'me.rerere.rikkahub.data.remote.RemoteAttachmentApiTest'
  '-Dorg.gradle.jvmargs=-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4
  --parallel --console=plain`: successful; 10/10, zero failures/errors/skips
  （`t9-merged-android-tests.json`）.
- All three existing owner-built debug APK sizes and SHA-256 hashes match
  the original manifest, and their final tracked source tree equals the
  merged source (`t9-apk-verification.json`). No second APK build was run.
- `node scripts/combo.mjs verify`, `node scripts/ourfairy-backend.mjs doctor
  --json` and `git diff --check`: passed.
- dsh's complete pre-existing dirty path set and all 16 SHA-256 hashes
  remain identical to the stage-start manifest.

Owner's complete product suite was 71/71 and Android relevant suite 98/98;
merger intentionally ran the bounded checks above instead of repeating
those full suites. The APK build used the fake Firebase-key stub. No
device/Compose lifecycle, actual Android preference-disk failure,
APK-to-real-backend, official cloud/image semantic, signed-release or
performance acceptance is implied. Backend and Android original evidence
state their precise remaining integration limits. Formal two-axis stage
review follows the frozen published combination; this section records
integration verification only.

## Reviewed closeout and cleanup

The one staged two-axis review is archived at
[`review-t7-t9/README.md`](../review-t7-t9/README.md): Standards 1 P2,
corrected with independent merged 6/6 download/attachment regressions;
Spec 0 findings. Final source merge is OurFairy `fcd4502c45ca8e36cbded529a4cd8d8f5e00dd59`;
later commits contain review evidence and the stop handoff only. Android
remains `e58352f202ae1add0e9c4bd08b14807f4c84a9bb`, dsh remains
`d3fe98f969c3963c6d193e74c776692e33c1eb64`.

All seven stage worktrees were safely removed, retaining their branches
and every older worktree. Four OurFairy worktrees used normal removal.
Android's UI worktree used normal removal; main/API needed Git's submodule
`--force` removal switch after ordinary refusal, clean deinit and explicit
Lead authorization. Original intern artifacts were checked byte for byte
and preserved in evidence plus local archival branches before removal.
[cleanup.md](cleanup.md), [android-cleanup.md](android-cleanup.md) and the
adjacent JSON checks record exact scope, source/ignored-content checks,
publication methods and unchanged 16-file dsh hash baseline.

No task-owned implementation/build sessions remain running. Lead will
close #32 and update #23. Stop after T9; use the final resolved published
combination as the next review baseline. See the durable
[`stage-t7-t9-handoff.md`](../../notes/stage-t7-t9-handoff.md).
