# T13–T15 review fix

Resolved the sole Standards P3 finding (dsh AGENTS opaque cross-boundary IDs). Spec reported zero findings. dsh branch `fix/stage1315-review`, commit `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`, starts from `fc5c7ac0220cf48c404cda34d1584901387eea06`. OurFairy evidence worktree starts from `bc984e9a49aa155fc8f8a79dff30768a17921a56`.

The existing jobs brand leaf now exports `JobGeneration`. Registry construction brands the existing UUID; completion sources, lifecycle/report records use that type. Report message IDs and the local report helper reuse the existing LLM `MessageId`. No runtime validation, fallback, storage/wire change, or behavior change was added. Existing fixtures already consume registry-issued values; no test that mirrors aliases was added.

## Actual checks

All dsh commands ran in `/home/eafen405/projects/deepseek-harness/.worktrees/stage1315-review-fix` using Node 24 and fixed pnpm 11.28.5.

- `corepack pnpm@11.28.5 run typecheck`: final run exit 0, complete Host TypeScript/build/bundles and Client `tsc -b tsconfig.client.json` passed.. Two earlier attempts reached successful Host compilation/bundling, then pnpm refused worktree dependency symlinks for task-state storage. Only worktree-local root `node_modules` and its task-state directory were changed to real directories; shared dependencies remained linked. Earlier logs are retained.
- `corepack pnpm@11.28.5 --silent run verify-persistence-changes --json`: initially correctly reported stale current metadata; `corepack pnpm@11.28.5 run gen-persistence-catalog` refreshed it; subsequent verifier exit 0, **66 roots match 15 history records, zero structural changes**. Brands erase to existing strings. Only current inventory aliases/source metadata, catalog declarations and generated bilingual pairing changed; no historical acknowledgement or snapshots needed alteration.
- `corepack pnpm@11.28.5 run verify-translation-pairing --write packages/jobs/jobs/README.md`: refreshed the revised English/Chinese description of the branded registry generation.
- `corepack pnpm@11.28.5 run doc-sync`: **38/43 passed** on its first run. Four failures match the already documented existing drifts: event graph pages, type-equivalence pages, Cordis catalog, config catalog. The fifth was doc-typecheck blocked by the same initial dependency symlink layout. After correcting that layout and completing the Host build, `corepack pnpm@11.28.5 run doc-typecheck:contracts-ready` passed: **81 blocks compiled**. This resolves that environmental fifth failure without rerunning the four known unrelated failures. Logs retain both outcomes.
- `git diff --cached --check`: passed. Normal `git commit` hooks passed staged lint, bilingual pairing, whitespace and vendor guard. `git merge product/ourfairy-v1`: already up to date before delivery.

No runtime behavior tests were added or rerun for this static-only correction; the stage behavior evidence remains in the ticket directories. No cloud/device acceptance is claimed. The coordinator will run final OurFairy integration checks and maintain the exact combo. No pushes were performed by this implementer. The root dsh dirty files were untouched.
