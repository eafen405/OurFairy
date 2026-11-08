# #330 — One resolved origin per skill candidate; the domain refuses source conflicts

Ticket: [#330](https://github.com/eafen405/OurFairy/issues/330), spec [#328](https://github.com/eafen405/OurFairy/issues/328).
Branch: `ticket/330-skill-source-contract`, worktree `.worktrees/330-skill-source-contract`,
base `integration/spec-328` tip `9e4a3a3` (`merge(#332)`; #331/#334 already merged).
Work follows the exploration map in `/home/fatfish/OurFairy-work/spec-328/E1-skill-creator.md` §3
(three-way origin priority, five constructible illegal combinations, producer list, test surface).

## What was wrong

`SkillCreation.create` decided a candidate's source with a priority chain
(`background > install > revision ? evolution : explicit`) and then composed the stored
`source_location` with nested spreads. Overlapping optional fields were therefore silently
*ignored* instead of refused: a background claim with an install source recorded the claim and
dropped the address; a revision with an install source was recorded as `source_type: 1` while also
naming a parent; `install + deferVerification` staged a candidate that `verifyBackground` could
never verify (a permanently stuck pending row). Only the model tool (`tools.ts`) checked any of
this, and only for the argument shapes the model can produce — the background producer and any
future internal caller were unchecked.

## What changed

**New module (`backend/skill-creator/src/origin.ts`, ~90 lines, no fs/store dependency)**

- `OriginFacts` — the six facts a create call hands the domain: `install`, `background`,
  `revision`, `deferredVerification`, `focusNamed`, `packageDir`.
- `CandidateOrigin` — `'explicit' | 'install' | 'background' | 'evolution'`. The module resolves
  the semantic origin and nothing else; the numeric `SOURCE_TYPE` code stays with `creation`/store.
- `candidateOrigin(facts)` — the five refusals, in a fixed order, each naming the two facts that
  disagree, all `SkillError(400, 'skills/invalid-source')`:
  1. background + install → refused (a claim is not an address);
  2. revision + install → refused (the ticket's rule: a revision is written from package files,
     never from an install address);
  3. deferred verification without a background claim → refused (only the background child may
     run verification later; this also covers `install + defer`);
  4. background + named focus → refused (a claim has no calling turn; the focus was silently
     ignored before);
  5. install without a fetched package directory → refused (the fetch is the only source of the
     staged bytes).
  Otherwise `background → 'background'`, `install → 'install'`,
  `revision → 'evolution'`, else `'explicit'`.
- `BackgroundProvenance` moved here from `creation.ts`; `creation.ts` re-exports it so
  `CreateCandidateInput`'s public shape is unchanged (no external importer existed).

**`creation.create`**

- Resolves `origin` once, after the byte-shape checks and *before* focus resolution, evidence
  validation and `#stageCandidate`: every refusal happens before any byte or row exists.
- `focus` is resolved only for a non-background origin, and only a non-install origin requires it;
  the background/implicit-focus special case became the origin rule.
- The provenance block is a `switch (origin)` over named blocks (`personalProvenance`,
  `consentProvenance`, `benefitProvenance`, `installProvenance`, `backgroundProvenance`); each
  branch writes only the fields its origin owns. Key order inside `source_location` changed for a
  background claim (evidence/benefit swapped); the field set is identical.
- `source_type` is `SOURCE_TYPE_OF_ORIGIN[origin]` — one mapping, every value read from
  `store.SOURCE_TYPE`, replacing the priority ternary.
- Kept untouched: staging order (`tmp/` → re-read → `candidates/`), the pending row insert,
  `#verifyAndRecord`, the `deferVerification` early return, the failure cleanup, the shared
  `skills/*` error mapping, rollback and seed.

**`tools.ts`** — no logic change. A comment above the create argument checks records that the
adapter owns the model's input vocabulary while the domain (`origin.ts`) is the authority over
which sources may be combined; the adapter checks stay (ticket AC3) and keep their own error code
`skills/invalid-request`.

**`README.md`** — one bullet in “Creation, verification and review” describing the one-origin
contract and the five refusals.

**Out of scope (unchanged)**: `CreateCandidateInput` is not narrowed into a three-entry union
(architecture review candidate B was deferred), rollback/seed still set their literal
`source_type` (4/5) outside `create`, `store.importReviewed` still accepts the caller's
`sourceType`, and the “stuck pending candidate from pre-fix rows” settlement is not added here.

## Producers audited before implementing (required by the ticket)

```
grep -rn "\.create(" backend/skill-creator/src/
  tools.ts:283                 -> SkillCreation.create   (model tool)
  deep-creation.ts:612         -> SkillCreation.create   (background learning child)
  deep-creation.ts:387/learning.ts:733/814 -> agents.create (agent sessions, not a skill candidate)
```

So exactly the two known producers call `create`. Both stay legal under the new rules:
`tools.ts` sends `files+focus` (explicit), `files+focus+parent+evidence+benefit` (evolution), or
`fetchedDir+install` (install); `deep-creation.ts` sends `background + files + optional parent/
benefit/evidence + deferVerification` and never a focus or an install source.

## Tests

New domain suite `tests/skill-creation-domain.test.mjs` (imports `dist/*`, no backend): the five
illegal combinations are built through `SkillCreation.create` itself and must be refused with 400
`skills/invalid-source` while the version count, `candidates/` and `tmp/` stay untouched; the four
legal origins are pinned by `source_type` and the exact provenance fields (explicit 0 with
session/focus; install 1 with the fixed address/version/digest and no claim; background 2 with the
claim, benefit and deferred scenarios; evolution 3 with parent and benefit); the resolver is also
called directly and must name the four origins and refuse the five conflicts with a message that
names both disagreeing facts. Legal cases use one real `true` scenario under bwrap; the refusals
never reach staging, so their absence of bwrap is itself observable in the empty data root.

Commands and results (worktree, `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`):

```
npm run typecheck                                          # tsc -b clean
npm test -- tests/skill-creation-domain.test.mjs           # build + 15 pass / 0 fail
```

Regression suites (the ticket's product surface, whole-backend e2e). The first combined
`npm test --` run (fresh build) was made while three other agents were running Gradle and two
other full test suites on the same 4-core box; it failed three load-timing cases in
`skill-learning.test.mjs` (`waitFor`/`send` deadlines and the known cross-test async bleed of
that suite's detection intervals). Each file was then re-run in isolation against the built dist,
and `skill-learning.test.mjs` was re-run once more after the competing load dropped:

```
node --test tests/skill-creation.test.mjs                   # 16 pass / 0 fail
node --test tests/skill-install.test.mjs                    # 17 pass / 0 fail
node --test tests/skill-evolution.test.mjs                  # 17 pass / 0 fail
node --test tests/skill-learning.test.mjs                   # 22 pass / 0 fail (rerun; earlier runs had load flakes)
node --test tests/skill-install-product.test.mjs tests/skill-sharing.test.mjs \
  tests/skill-review-entry.test.mjs                         # 29 pass / 0 fail (common-install + sharing provenance)
```

The pre-commit related gate (19 files, 217 tests: every test whose body names
`backend/skill-creator/` plus this commit's new suite and the Markdown link check) was run
twice and both runs failed on exactly the same two load-timing cases, both unrelated to the
source contract (`tests/skill-learning.test.mjs` background detection):

- `a failure signal never counts toward the two-session creation threshold` — an in-flight
  detection child from an earlier case was answered by the next case's scripted model double, so
  an unexpected claim appeared (`2 !== 0` where the test expects none);
- `an uncertain review is stored as uncertain and never triggers creation` — the same cross-test
  async bleed (`seen.creation.length 1 !== 0`).

The captured reproduction run recorded `217 tests / 215 pass / 2 fail`; the other 18 selected
files passed, including the new domain suite and the whole creation/install/evolution/learning
sets. `tests/skill-learning.test.mjs` passes 22/22 in isolation (above) and the two failing cases
never call `creation.create` with a source combination, which is the only surface this ticket
changes. The feature commit therefore used `--no-verify` under the Lead's standing authorization
for this parallel-load condition; the full suite remains the closeout gate on
`integration/spec-328`.

After merging the integration tip `75cae52` (commits `a3c6b6f`; clean merge — #332's
`candidatePackagePath` line and #329/#330's regions did not overlap this change), the merged state
was re-validated with a fresh build:

```
npm run typecheck                                            # tsc -b clean
npm run build                                                # tsc -b --fresh clean
node --test tests/skill-creation-domain.test.mjs             # 15 pass / 0 fail
node --test tests/skill-creation.test.mjs                    # 16 pass / 0 fail
node --test tests/skill-install.test.mjs                     # 17 pass / 0 fail
node --test tests/skill-evolution.test.mjs                   # 17 pass / 0 fail
```

At merge time `integration/spec-328` did not yet contain #329's merge; the Lead/merger owns the
final ordering, and this branch's merge of the tip is the last conflict-free base it needs.

## Delivery state

- `851d44a` — `feat(#330)`: `origin.ts`, the `create` rewiring, the adapter comment, the README
  bullet and the new domain suite (tests and implementation in one commit: the suite imports the
  module it pins).
- `a3c6b6f` — merge of `integration/spec-328` tip `75cae52` (#333/#335) into the ticket branch,
  made with `--no-verify` by the Lead's standing policy for the merge-commit suite under parallel
  load; clean, no conflicts.
- This evidence file is the `docs(#330)` commit.

The branch is based on `9e4a3a3` (`merge(#332)`, so #332's path vocabulary was already in the
`create` body) and re-validated after the merge above.

## Deletion test

Delete `origin.ts` and `creation.create` must again grow the priority ternary, the five guards and
the implicit-focus special case; the five combinations become constructible again (E1 §7.1
measured exactly that on the base commit). Delete the guards and this ticket's domain suite fails
on every illegal case while the legal-source cases stay green — the module carries no behaviour
the four origins do not need. It is not a seam for future replacement: it exists because the
algorithm was already one copy of “which source is this”, spread over two chained expressions and
one adapter check.
