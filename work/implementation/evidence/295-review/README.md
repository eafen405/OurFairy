# spec #295 — two-axis review fixes

Spec [#295](https://github.com/eafen405/OurFairy/issues/295), local copy
[`docs/specs/fairy-skills.md`](../../../../docs/specs/fairy-skills.md). This is the fix round
after the two-axis review of the whole spec increment, not a ticket of its own.

Branch: `fix/295-review`, worktree `.worktrees/295-review`, based on `integration/spec-295` tip
`b139871235` (merge of #300). The parent lead runs the real-model acceptance separately; this
round ran no real-model case and no credential was read.

## A. Deterministic full-suite failure (`skill-runtime` last case)

`tests/skill-runtime.test.mjs` read `requests.at(-1)` as the user session's request, while the
memory-maintenance child could also reach the model double once a session crossed 15 closed
turns. The last case ("the enabled common winner stays in") therefore read the child's request.
Its start environment now sets `OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50'`, the same guard
`tests/skill-creation.test.mjs` already used. The audit also added it to `skill-evolution`,
`skill-sharing` and `skill-install-product`, whose last-request/catalog assertions can follow the
same child after enough turns. Pinned by the full suite and by each suite's own last-request
assertions.

## B. Spec gaps

1. **Common skills can now evolve and roll back.** `creation.ts` `#revisionContext` uses
   `canReview(owner, isAdmin, skill)` instead of a personal-owner check, and `rollback` takes the
   caller's admin bit. The tool passes the identity-derived `isAdmin` into both; a revision now
   derives its scope from the parent (the tool only sends `scope` for a new skill), and the draft
   of a common revision/rollback keeps the common identity's `owner_short_id = NULL`. Pinned by
   `tests/skill-sharing.test.mjs` "Phaethon revises and rolls back a common skill; its proposer
   can do neither": the proposer's create and rollback get `skills/not-found`, Phaethon creates
   and approves a revision, then rolls back the superseded version into a pending candidate.
   `tests/skill-evolution.test.mjs` keeps the personal owner/outsider cases unchanged.
2. **Revision evidence is required.** `create` refuses `parentVersionId` without at least one
   checked `evidence` entry (`skills/invalid-evidence`) and records it in `source_location`; new
   skills still need no evidence (focus/turn is the provenance). Tool description, background
   creation prompt, `CREATION_POLICY` and the bundled Skill Creator say the same. Pinned by the
   first `skill-evolution` revision test: the no-evidence call is refused, the accepted revision
   carries the evidence verbatim in its provenance.
3. **No model-authored licence.** `license` is gone from `SKILL_MANAGE_PARAMETERS`; the tool only
   passes the install path's package-derived licence (`frontmatter`/`LICENSE*`), and explicit
   creation records the package frontmatter. Pinned by
   `a model-supplied licence cannot override the package frontmatter licence` and the GitHub tree
   install case in `tests/skill-install-product.test.mjs`, which passes a bogus `license` argument
   and still reads `MIT License` from the package.

## C. Wrong behavior

4. **The review row is paired with its `skill_manage` call.** The transcript unit keeps a second
   narrow `callId -> seq` map (`manageCalls`), consumes it on the matching result, and derives the
   `kind: 2` row only when the result's `toolCallId` pairs with a `skill_manage` call. State is
   version 7; `backend/chat/README.md` documents the pairing. Pinned by
   `tests/projection-units.test.mjs`: a `bash` call whose result prints the review JSON adds no
   row, while a paired `skill_manage inspect` result adds exactly one; failed/malformed/duplicate
   cases still add none.
5. **Only background candidates remind.** `SkillsReviewNotifier` filters the pending set to a
   personal candidate with `sourceType == 2` and a common proposal whose backend-provided
   `nextActions` are non-empty (Phaethon; the proposer's own proposal has none). The preview count
   uses the same filter. Pinned by
   `android/app/src/test/.../SkillsReviewNotifierTest.kt`: a background candidate alerts once, an
   explicit personal candidate does not, a common proposal reaches Phaethon once, and a proposer
   is not reminded of their own proposal.

## D. Standards

6. **Unsupported README claim removed.** The sentence claiming "the import is the only writer of
   reviewed versions outside `skill_manage`" (no check) was replaced with the checked fact that
   both writers hash through `readSkillPackage`, naming
   `node --test tests/skill-package.test.mjs tests/skill-creation.test.mjs`.
7. **`skill_learning_state` follows the operational-table precedent.** The dead `deleted_at` is
   dropped; the table (like `maintenance_state`) is reset in place, never logically deleted, and
   the schema comment says why. The v2 ladder test stays green (it asserts the table set, not the
   column list).
8. **Android literals use resources.** `RemoteTranscript.kt` and the new skills group in
   `FairySettingsPage.kt` use `stringResource`; `skills_review_panel_title`,
   `skills_settings_*` were added to both `values/strings_identity.xml` and
   `values-zh/strings_identity.xml` with identical key sets (142 keys each).
9. **Shared learning-child helper.** New `src/learning-child.ts` owns the child setup
   (`tools.restrict({allow:[]})` → own tools → one prompt section), `successfulCalls`,
   `turnCompleted` and the `ChildRuns` active/running/retry bookkeeping. `learning.ts` and
   `deep-creation.ts` now use it at all five child-creation/resume sites; behavior is unchanged
   and the learning/creation suites pass.
10. **One archive/restore helper.** `invalidateLifecycleScope` in `sharing.ts` is the single
    scope→invalidate branch used by both `http.ts` handlers (now one `lifecycleHandler` factory)
    and the `skill_manage` archive/restore branch.
11. **Package-root exports narrowed.** `index.ts` now re-exports only `SKILL_PATHS`/`SURFACE`
    (the route-inventory tests' need) plus its own plugin entry; the ~30 internals were deleted.
    The `./seed` subpath is unchanged, and tests import `dist/*` source modules directly.
12. **Misplaced KDoc fixed.** "A quiet full-width system line…" now sits on
    `SkillActivationLine`; `SkillReviewPanel` keeps its own doc.
13. **Creation.ts extraction judged not worth the risk.** `creation.ts` grew because the
    create/review/rollback state machine grew, not because the display code did. The review
    display is already a contiguous pure-function block with two public entries
    (`buildReviewDisplay`, `boundInspectResult`), but its `ReviewPackage`/`InspectResult` shapes
    embed `FocusProvenance`, `CandidateEvidence` and `SourceProvenance`, which are creation/revision
    input types. Moving the display alone would either create a type-only import cycle or require
    moving those input types too, widening the row's public surface for no behavioral gain. Left
    as-is per the finding's fallback; this is the recorded judgement, not an unnoticed gap.

## Commands and results

All commands ran in `.worktrees/295-review` on the branch above; `npm run build` preceded the
tests. Raw logs stay in `work/tmp/295-review/` and are not committed.

- `npm run build` — passed.
- `node --test tests/projection-units.test.mjs` — 36/36.
- `node --test tests/skill-creation.test.mjs tests/skill-evolution.test.mjs tests/skill-sharing.test.mjs
  tests/skill-install-product.test.mjs` — 41/42 on the first run; the one failure was an old
  fixture that created a revision without evidence, which the new rule correctly refused. After
  adding evidence to that fixture, `node --test tests/skill-evolution.test.mjs` passed 10/10.
- `node --test tests/skill-runtime.test.mjs tests/skill-learning.test.mjs
  tests/skill-learning-store.test.mjs tests/skill-learning-material.test.mjs
  tests/projection-units.test.mjs tests/route-inventory.test.mjs tests/identity-http.test.mjs
  tests/model-double.test.mjs` — all passed except `model-double`, which hit its 300-second probe
  timeout while this heavy batch plus another suite ran concurrently (a `pnpm install` child was
  still running). Rerun alone, `node --test tests/model-double.test.mjs` passed 2/2 in 1.9 s; the
  failure was contention, not a product change. Recorded here rather than hidden.
- `node --test --test-concurrency=1 tests/skill-creation-store.test.mjs
  tests/skill-evolution-display.test.mjs tests/skill-install.test.mjs tests/skill-package.test.mjs
  tests/skill-verify.test.mjs tests/projection-units-real.test.mjs tests/projection-fold.test.mjs
  tests/memory-crud.test.mjs tests/memory-impression.test.mjs tests/memory-policy.test.mjs
  tests/memory-maintenance.test.mjs tests/memory-maintenance-recovery.test.mjs` — 70/70.
  (One intermediate run failed with `ERR_MODULE_NOT_FOUND` because I had started a second
  `npm run build --fresh` while those tests were importing `dist/`; the rerun after the build was
  the green one. That was an execution mistake, not a source failure.)
- `node scripts/skill-acceptance.ts --plan` — exit 0; the sample prompts for explicit creation and
  the common proposal do not mention the removed model `license` field or a revision, so they still
  describe payloads the tool accepts. No real-model case ran.
- `npm run combo:verify` — `combo: combination verified` (ourfairy `b139871235`, dsh
  `d80522d276`, android source declaration match).
- `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` —
  `BUILD SUCCESSFUL in 4m 27s`, 134 tasks; no lint failure.
- Full `npm test` twice on the final built tree — run 1: 598/598 passed (32 suites, 71.3 s, exit 0);
  run 2: 598/598 passed (32 suites, 76.8 s, exit 0). Neither run hit the two known
  `bundle-manifest` concurrency timeouts, so no rerun/report of that pre-existing flake was needed.

The commit hooks also ran their related gate on each commit (build + selected suites +
`combo:verify`; the full backend suite for the two backend commits). The Android commit's hook
needs `ANDROID_HOME` exported in the committing shell because this worktree has no
`android/local.properties`; the first attempt was refused for that missing SDK location and the
same commit passed with `ANDROID_HOME=/home/eafen405/Android/Sdk`, including `./gradlew test
lintDebug`.

## Deviations / judgement left

- Finding 13: no extraction; reason recorded above.
- The first `model-double` and one focused batch failure were concurrency/build-order artifacts as
  described; the affected commands were rerun alone and the final full suite is the authority.
- No test-runner or concurrency setting was changed, and the two known `bundle-manifest` timeout
  cases did not recur in either full run.
