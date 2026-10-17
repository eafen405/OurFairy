# arch-47-bundle-readme — evidence

Ticket: #47 (v1-bundle README 的缺行清单与运行时相反)
Branch: `arch/47-bundle-readme` (worktree `/home/eafen405/projects/OurFairy/.worktrees/arch-47-bundle-readme`)
Integration base: `integration/ourfairy-v1` @ `bd7359c` (unchanged through delivery)

## What changed

Commit `7b4e66d` — `docs(bundle): point the README at the one absent-row list instead of a copy`

1. `backend/v1-bundle/README.md`
   - "Deliberately absent rows": removed the hand-written list. The section now
     names `FORBIDDEN_ROW_IDS` in `tests/baseline-boot.test.mjs` as the only
     expectation and explains why the README keeps no copy (same reasoning the
     probe records in `backend/probe/src/index.mjs`). The 16 ids it used to list
     are still enforced by `baseline-boot.test.mjs`; the 7 that were wrong
     (`tool-fs`, `fs-observation-policy`, `tool-working-directory`, `tool-bash`,
     `sandbox-policy`, `shell-env`, `subprocess`) are mounted by
     `cordis.patch.yml` — no README claim about them remains.
   - "Row set": `cordis.patch.yml` is named as the row set (the file the loader
     reads); the 15-row table is re-labelled as an overview of anchor rows, not
     the inventory. Rows are unchanged so the existing rationale stays.
   - "Why this bundle is explicit": the stale sentence "file/shell/sandbox
     defaults whose permission adaptation has not landed" contradicted the
     runtime too (T7/#30 mounted the scoped adapters). Rewritten: base's rows are
     unscoped, v1 mounts `@ourfairy/dsh-spaces` adapters in their place and
     leaves the unscoped rows out.
2. `tests/bundle-readme.test.mjs` (new, 2 tests) — the executable form of the
   single-authority rule (map #64). It parses the absent-row expectation out of
   the test that owns it (no copied list) and the mounted rows out of
   `cordis.patch.yml`, then fails if the README:
   - does not name `FORBIDDEN_ROW_IDS` + `tests/baseline-boot.test.mjs`, or
   - quotes any id that the expectation already owns (§ restating the list), or
   - has a "Row set" table row naming an id the bundle does not mount, or a
     package that differs from the bundle's `name:`.

No README row list is retained, so no justification for keeping a copy is
needed; the remaining table is pinned to the runtime instead of being trusted.

## Commands and results (actual)

| Command | Result |
| --- | --- |
| `node --test tests/bundle-readme.test.mjs` (red, before fix) | 1 fail / 1 pass → `red-bundle-readme.log` |
| `node recheck.mjs` (red state) | 34 forbidden ids; 33 mounted; **16** forbidden ids restated in README → `red-restated-ids.log` |
| `node --test tests/bundle-readme.test.mjs` (green) | 2 pass → `green-bundle-readme.log` |
| `node recheck.mjs` (green state) | restated forbidden ids: none → `green-restated-ids.log` |
| mutation: README quotes `tool-fs-search` | test 1 fails, message names the id → `mutation-restated-id.log` |
| mutation: table row `plugin-manager` | test 2 fails, message names the unmounted row → `mutation-unmounted-row.log` |
| `npm test` (full) | **117 tests / 117 pass / 0 fail**, suites 6 → `full-npm-test.log` (baseline before this ticket: 115) |
| `npm run combo:verify` | combination verified, ourfairy worktree is the integration tip → `combo-verify.log` |

`git status` after the mutation runs: clean (mutations restored with `git checkout --`).

## Baseline check (premise)

Re-verified in the worktree after merging `integration/ourfairy-v1` @ `bd7359c`:

- `grep -c '^\s*- id:' backend/v1-bundle/cordis.patch.yml` → **33** mounted rows.
- README's old absent list quoted 16 ids owned by `FORBIDDEN_ROW_IDS` (wrong to
  restate at all) plus 7 mounted ids claimed absent — matches the ticket.
- `tests/baseline-boot.test.mjs:37` `FORBIDDEN_ROW_IDS` → 34 ids; unchanged.

## Not done / out of scope

- `work/implementation/evidence/01-baseline/README.md:106` also says the v1 row
  set is "15 行" and lists the old excluded groups. It is a dated evidence record
  for ticket #01 (when 15 was true); rewriting it would falsify that record, so it
  is left untouched. Its reader-facing fix is this ticket's README.
- `docs/research/*` and `docs/backend-skeleton-proposal.md` mention individual
  row ids as research facts; not claims about the current mount set.
- No push, no merge into integration, `combo.json` untouched, issue untouched.
