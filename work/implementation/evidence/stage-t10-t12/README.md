# T10–T12 stage integration evidence

Authorized scope: #33/T10, #34/T11, #35/T12, then one staged independent
Standards/Spec review, correction, publication and stop. No T13+ work.

## Fixed review baseline

| Repository | Integration branch | Published baseline |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `20144666d97becf82af3a3c24553ec28c639adda` |
| rikkahub | `product/ourfairy-v1` | `e58352f202ae1add0e9c4bd08b14807f4c84a9bb` |
| dsh | `product/ourfairy-v1` | `d3fe98f969c3963c6d193e74c776692e33c1eb64` |

These are the resolved previous-stage combination, including the T9
download cleanup fix. The stage's review must use these fixed baselines.

## Initial checks (2026-10-15)

Commands: `git branch --show-current`, `git rev-parse HEAD`,
`git status --short`, and a GitHub GraphQL `blockedBy(first:20)` query for
issues 33, 34 and 35. The initial network-restricted query failed to
connect; the same read-only query with network permission succeeded.
Raw dependency response: [dependency-query.json](dependency-query.json).

- #33 and #34 each depend only on #28, which is CLOSED; both may start.
- #35 depends on CLOSED #32 and OPEN #34; implementation waits for #34.
- OurFairy was clean before this evidence. Android's existing
  `?? .worktrees/` is preserved.
- All 16 pre-existing dsh dirty paths and their SHA-256 bytes equal the
  previous stage's committed snapshot. The exact `git diff --name-only`
  set also matches. No dsh dirty file was edited, reset, staged or cleaned.
  Snapshot: [dsh-preexisting-dirty-sha256.json](dsh-preexisting-dirty-sha256.json).
  Summary: [baseline-check.log](baseline-check.log).

## Integration protocol

Ticket owners merge the latest target integration tip into their own
branches before reporting completion. Merger waits for Lead's explicit
merge instruction, merges completed ticket branches only, and records
bounded checks for changed product interfaces/native contracts. Lead
coordinates publication, tracker closure and worktree cleanup.

## T11 Android compatibility merge

Merged owner `4c4b5a09f910a340d49c8089e850d53caf5739fb` into rikkahub
`product/ourfairy-v1` as `d80dfcb9a3ded6e78d78da67edb33f4b88131332`.
The owner contains the pre-merge target integration tip. Diff inspection
confirmed only two test files changed; production already represents a
committed Fairy delivery independently of an active attempt.

Parsed original JUnit XML: API 18, state 9, recovery 14, **41/41**, zero
failures/errors/skips. Full owner log and XML are archived at
`../11-text-delivery/android/`; no duplicate JVM run was needed for this
test-only merge. Post-merge Android retains only pre-existing
`?? .worktrees/`. No device/Compose runtime acceptance is claimed.

## T11 backend merge and independent check

Merged owner `a04a33a57cb9691be26113f44a6dd4f1f5d5953d` as
`7b24e251f6e566972dbe01f20d6861eea95066c8`. The owner contains target
integration tip `ccaebef`; source diff matches text delivery, its schema-v5
coordination rows, transcript projection and launcher hash. No unfinished
T10 code or dsh source change was imported.

Executed from the merged main checkout:
`node --test tests/text-delivery.test.mjs` → **6/6**, no skips/failures.
Raw output: [t11-merged-text-delivery.log](t11-merged-text-delivery.log).
This independently exercises real profile, local HTTP/SSE, SQLite and
native JSONL for cold/live delivery, concurrent senders/primary creation,
stable retry/restart after a coordination fault, rejected durability
checkpoint, and notification failure. The model HTTP endpoint and injected
failure outlets are controlled fixtures, not official cloud/disk faults.
`node scripts/combo.mjs verify` and `git diff --check` passed. Android remains
the paired test-only compatibility merge recorded above. #34 is ready for
Lead to close; #35 remains unstarted until tracker closure unblocks it.

## T12 Android compatibility merge

Owner `55ce5f8de2dfb2b9ec3864eeee4acb04004d07cd` contained target
Android tip `d80dfcb9`; merged as `b0911d34bdbe6ee8f559167ede41da95a9f082f8`.
Diff inspection confirms only the existing attachment state test changed,
adding a delivered-attachment download alongside an independent attempt.
No production DTO/UI/transport changes were needed. Parsed original XML:
attachment API 5, attachment state 6, chat API 18, chat state 9, **38/38**,
zero failures/errors/skips. Original evidence is under
`../12-file-delivery/android/`. No duplicate JVM/APK run; no phone/SAF/Compose
runtime acceptance claimed. Android still has only existing `?? .worktrees/`.

## T10 merge and independent checks

dsh owner `e55843252b` merged normally as
`173e155a85305db378dd92b1fa057ac6e6dea86e`; OurFairy owner
`8162a463cf4023f1be26fc2d826aa744f8c4cd43` merged as `ec5a916` after
confirming it contained then-current target `a080f42`. Combo pin committed
as `ce01730`, so downstream T12 can merge the exact source combination.

The ordinary dsh merge initially refused the two dirty catalog files. Only
these two files were stashed temporarily, the normal merge completed with
hooks, and stash pop restored them without conflict. Their original
`client-connection` source-line 92→97 hunks/context remain exact (Git diff
blob hashes naturally changed). The other 14 files retain exact initial
SHA-256 bytes; all original 16 paths remain dirty and unstaged. See
`dsh-preservation.log`, both `*.preserved.patch` and the post-T10 snapshot.
No pre-existing change was committed or discarded.

`corepack pnpm@11.28.5 run build:lib:host` in the main dsh checkout failed
on two unchanged, pre-existing dirty test type errors: delivery-message
test line 92 (`TS2339`) and v3-to-v4 codec test line 60 (`TS2322`). Raw:
`t10-main-host-build.log`. The clean owner previously passed host/client
build, typecheck and 116 native regressions; that evidence remains under
`../10-conversation-search/`. The main full-host command is not reported as
passing and those unrelated tests were left untouched.

Refreshed only changed production query packages, retaining typechecking:
`tsc -b packages/session-query/session-query/tsconfig.json packages/session-query/session-query-sqlite/tsconfig.json`
then normal host `tsdown` with both package-name filters, both exit 0
(`t10-main-query-build.log`). Native/client source and required existing
artifacts were unchanged, so no redundant full rebuild ran.

Independent merged run:
`node --test tests/baseline-boot.test.mjs tests/conversation-search.test.mjs`
→ **10/10**, no failures/skips (`t10-merged-profile-search.log`). It covers
the actual configured profile, isolated home, Chinese excerpt/readback,
owner scope before limits, foreign/admin refusal, bounded Unicode reads,
real query-DB deletion/rebuild, and T11 recipient-only delivered-body
search/read. External model requests use local controlled HTTP fixtures.
Combo verify and diff checks pass. #33 is ready for Lead closure.
