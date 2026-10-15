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
