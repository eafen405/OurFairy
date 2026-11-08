# #332 — One stored package path vocabulary and one crash re-home rule

Ticket: [#332](https://github.com/eafen405/OurFairy/issues/332), spec [#328](https://github.com/eafen405/OurFairy/issues/328).
Branch: `ticket/332-skill-package-paths`, worktree `.worktrees/332-skill-package-paths`,
base `integration/spec-328` tip `e8350e4` (docs-only over `main` @ `25a2b34`).
Work follows the exploration map in `work/../OurFairy-work/spec-328/E1-skill-creator.md` §4
(path vocabulary over 6 files, 3 validations, 2 re-home algorithms).

## What changed

**New module (`backend/skill-creator/src/paths.ts`, ~150 lines, only `node:fs`/`node:path`)**

- `SKILL_DIR` — the data root's areas (`candidates`, `versions`, `tmp`, `verify`), frozen. The one
  place the candidate/version vocabulary is written.
- `checkPackagePath(relative)` — the one stored-path safety rule: non-empty, relative, `/` only,
  at least `area/package`, no empty/`.`/`..` segment, no `\`, no control character
  (`\p{Cc}`, includes NUL), no drive-letter first segment. The old three copies checked only
  empty/`.`/`..`; the extra refusals are the intended tightening (E1 §4.5).
- `insideRoot(root, absolute)` — one root-containment predicate; replaces `service.ts`'s `inside`
  and `index.ts`'s `insideRoot`.
- `packageDirectory(root, segments)` and `candidatePackagePath` / `versionPackagePath` — the only
  way a stored row value is produced (`candidates/<uuid>`, `versions/<skillId>/<uuid>`, `/`
  separated and relative to the data root).
- `rehomeCandidatePackage({root, packagePath, skillId})` → `'present' | 'rehomed' | 'missing'` —
  the one crash re-home. It validates the row's own path, accepts an existing directory whatever
  its shape (`'present'`, matching the old boot scan's early `continue`), and only moves a
  `candidates/<id>` shape from `versions/<skillId>/<id>`; a concurrent re-home is answered as
  `'present'`, a rename failure with the bytes still only in `versions/` as `'missing'`.

**Consumers (they keep their own decisions; the module only supplies names/directories)**

- `service.versionDirectory`: `checkPackagePath` + `packageDirectory` + `insideRoot`; the two 500
  `skills/integrity` messages and status are unchanged. Local `inside` deleted.
- `store.validateDraft`: `checkPackagePath` + first segment `candidates`; `skills/invalid-path` and
  the message are unchanged.
- `seed.importReviewedPackage`: `packageDirectory`/`SKILL_DIR` for `tmp/` and `versions/` roots and
  the final directory, `versionPackagePath` for the row value. Staging → re-read → `place` inside
  the store transaction → failure cleanup order untouched.
- `creation`: `candidatePackagePath` for both draft rows (create/rollback); `SKILL_DIR`/
  `packageDirectory` in `#stageCandidate`, the publish target and `tmp/` cleanup;
  `versionPackagePath` for the approved row. Publish's rename → `publishDraft` (in-transaction
  recheck) → failure rename-back order untouched, and the transaction/recheck predicates were not
  moved into the module.
- `creation.#packageDirectory` and `creation.reconcile` now share `rehomeCandidatePackage`: the
  read path re-homes inline, the boot scan re-homes and counts; everything else in `reconcile`
  keeps its order (remove `tmp/`, re-home, settle only a row with no bytes anywhere).
- `index.ts`: the local `insideRoot` copy is replaced by the shared one.

**Boot semantics pinned for an illegal stored row (E1 §6 risk 2)**

Every production writer now produces a checked path (`createDraft` for candidates from
create/rollback, `publishDraft` through creation, `importReviewed` through seed), so the stricter
check cannot turn a legitimate historical row unreadable. A row whose stored path the check
refuses is *left pending* at boot (the old code did the same by `continue`); the system does not
make a terminal decision for a row it cannot interpret, and the read path refuses it with a 500
`skills/integrity`. This is pinned by the new e2e case below.

**Out of scope (unchanged)**: `package.ts`'s in-package relative paths, `install.ts`'s archive
entry validation and its `tmp/install-<uuid>` staging literal (different surface, not the
candidate/version vocabulary; install.ts is outside this ticket's write scope), `verify.ts`'s
one-shot `verify/<uuid>`, publish/seed transactions and `store.importReviewed`'s `place` callback,
the provider's read-only contribution.

## Tests

New pure interface suite `tests/skill-paths.test.mjs` (imports `dist/paths.js`, independent
expected values from the documented layout): vocabulary values, `checkPackagePath` accepted and
refused shapes, `insideRoot` truth table, `rehomeCandidatePackage` `present`/`rehomed`/`missing`
with real directories, wrong-skill/no-shape/no-bytes cases.

Extended (existing seams):

- `tests/skill-creation-store.test.mjs`: `createDraft` refuses `''`, `candidates`,
  `candidates/`, `candidates//uuid`, `candidates/./uuid`, `candidates/../uuid`,
  `./candidates/uuid`, `/candidates/uuid`, `versions/1/uuid`, `candidates\\uuid` with
  `skills/invalid-path`, and writes no row.
- `tests/skill-package.test.mjs` (stub-store service test): `versionDirectory` refuses
  `candidates/../pkg`, `candidates\pkg`, `/versions/1/pkg`, `versions` with 500
  `skills/integrity`, and still resolves `versions/1/pkg` under the root.
- `tests/skill-evolution.test.mjs` (`publish crash reconciliation` describe):
  - new: the read path re-homes a displaced candidate with **no restart** (inspect succeeds,
    `package_path` stays `candidates/<uuid>`, bytes are back under `candidates/`);
  - new: a pending row whose stored path is unsafe is left pending at boot (`status = 0`,
    `review_note = null`) while inspect refuses it with `skills/integrity`;
  - existing boot-convergence case (moved bytes re-homed, missing bytes settled, `tmp/` cleaned)
    still passes unchanged.

Commands and results (worktree, `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`):

```
npm run build                                                # tsc -b clean
node --test tests/skill-paths.test.mjs                       # 15 pass / 0 fail
node --test tests/skill-paths.test.mjs tests/skill-creation-store.test.mjs tests/skill-package.test.mjs
                                                             # 41 pass / 0 fail
node --test --test-name-pattern='displaced pending candidate|re-homes|unsafe stored path' \
  tests/skill-evolution.test.mjs                             # 3 pass / 0 fail
```

## Delivery state and local gate

- `11fcc77` — `refactor(#332)`: the module, the six consumers, the README section and the tests.
- `d866f1e` — merge of `integration/spec-328` tip `012abdc` (#334's docs gate) into the ticket
  branch, no conflicts, made with `--no-verify` per the Lead's standing instruction: the
  pre-merge-commit hook runs the full `npm test`, whose authority is the Lead's exclusive run on
  the integration branch, and this 6-core machine had 4–6 parallel worktrees running heavy suites.
- A later merge (before hand-off) brings the integration tip to `1c0188a` (#331, Android
  remote-state: `android/` sources and its evidence only — no backend change), again with
  `--no-verify` for the same reason. The ticket branch is based on that tip.
- The normal commit gate was tried first. The related selector (it selects every test whose body
  names `backend/skill-creator/` or declares `@covers backend/skill-creator`) ran 19 files; the
  build passed and every failure was a load-sensitive `send` 30 s reply timeout in
  `tests/skill-learning.test.mjs` (background detection turns; no path/vocabulary assertion
  involved, and that file is not part of this ticket's behaviour surface). Per the Lead's
  authorization the local commit used `--no-verify`, recording that failure list here; the full
  suite is left to closeout on `integration/spec-328`.

Isolated re-runs on the merged tip (`d866f1e`, integration tip `012abdc` — all green):

```
node --test tests/skill-paths.test.mjs tests/skill-creation-store.test.mjs tests/skill-package.test.mjs
                                                             # 41 pass / 0 fail
node --test tests/skill-evolution.test.mjs                   # 17 pass / 0 fail
   # includes the three publish-crash cases (boot re-home + settle, read-path re-home
   # without restart, unsafe stored path left pending) and the existing recovery case.
node --test --test-concurrency=1 tests/skill-install-product.test.mjs \
  tests/skill-runtime.test.mjs tests/skill-creation.test.mjs # 34 pass / 0 fail
   # seed import + versions/ placement, service read path/catalog/load, and the full
   # create → inspect → approve → publish rename/transaction flow.
```

The full `tests/skill-evolution.test.mjs` file had also been run once on the pre-merge tip under
the peak load; only the final crash describe flaked (three `send` 30 s timeouts in the test
helper's wall clock, not a behaviour assertion), and the targeted re-run of those cases passed
before the clean full-file run above.

## Deletion test

Delete `paths.ts` and these must be rewritten: the store's draft path check, the service's
path check + directory join, the seed's `versions/`/`tmp/` literals, creation's five path
literals, and the two copies of the crash re-home. Delete the consumers' duplicated fragments and
nothing else needs to know how a stored path is validated or where a candidate's bytes might sit —
the two callers of the re-home only map three states. This is why the module earns its place: it
was already one algorithm copied twice plus three validations, not a hypothetical seam.
