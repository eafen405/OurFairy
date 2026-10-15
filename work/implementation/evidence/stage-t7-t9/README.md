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

This directory records preparation only. Runtime acceptance and staged
review evidence will be added after the related implementations complete.
