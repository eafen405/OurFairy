# T7–T9 stage

Authorized scope: T7/#30, T8/#31 and T9/#32, then one independent two-axis staged code review, bounded corrections, publication and cleanup. Stop before T10 or any other ticket.

## Fixed review baseline

The preceding stage's final reviewed and published combination is the comparison point:

- OurFairy `integration/ourfairy-v1`: `97b776fac2eca207b308884b890748ce51f308ed`.
- rikkahub `product/ourfairy-v1`: `d8567891533e6bc725f48382c43b2096de4e422b`.
- dsh `product/ourfairy-v1`: `d3fe98f969c3963c6d193e74c776692e33c1eb64`.

Use three-dot diffs from these exact commits to the pinned stage heads. Do not repeat the previous stage's original, pre-fix review range.

## Frontier and implementation

GitHub native dependencies were queried on 2026-10-15 (`/tmp/ourfairy-t7-t9-issues.json`): #30 depends on closed #28; #31 and #32 depend on open #30. Implement and integrate #30 first, then run #31 and #32 concurrently in their own worktrees.

Experienced implementers own actual process isolation, live membership checks, attachment authorization and integration. MiniMax Code is preferred for bounded code reuse, mechanical implementation and UI work, with actual diffs and relevant behavior checks used for acceptance. Current preparatory mcode task only locates Android attachment reuse code; it does not implement a blocked ticket.

Existing user-confirmed test seams remain the real product profile/Loader and public HTTP/model-tool entry points with real SQLite, JSONL, attachment bytes, filesystem and restricted subprocesses; deterministic doubles replace external models/network inputs. Android tests observe shared remote state and platform adapters. Device and official-cloud checks remain separate evidence.

No data-structure additions have been selected at stage start. Each implementing owner must report necessary additions before implementation so Lead can disclose them to the user. Reuse existing authorities and capability interfaces; do not build general permission or outbox frameworks.

## Preserved local state

dsh has 16 pre-existing dirty files, recorded by SHA-256 in `/tmp/ourfairy-t7-t9-dsh-dirty-baseline.json`. Preserve them and all older worktrees. Remove only clean, integrated worktrees created for this stage after evidence is archived.
