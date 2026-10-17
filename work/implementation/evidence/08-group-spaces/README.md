# T8 / #31 — durable groups and live membership-scoped files

Repository/branch: OurFairy `ticket/08-group-spaces`, based on integration `d26dbe6c6ad3f3f7fb91a5d1a74e5ef250cb5714`. No dsh or Android source changes. Schema design was disclosed before implementation; the existing business SQLite gains only `groups` and `group_members` (v3), with numeric relations, logical deletion, timestamps/actors and ordinary lookup indexes. No foreign key, secondary unique index, role platform, new client page or group chat.

Implementation:

- Reuses `IdentityStore`'s one SQLite connection/immediate transaction; v1/v2 upgrades preserve credentials/invites. Creation joins only the designated owner. Changes recheck the exact group's current owner inside the transaction. Duplicate add/remove is harmless and re-add revives the same membership row. Owner removal is refused; no owner transfer or group deletion feature.
- Reuses native scoped chat tools inside the existing spaces module: `groups`, Phaethon's `group_create`, and owners' `group_members` (action 1=add, 2=remove). A group assigned to an already-live user updates that user's live scoped tool visibility. Execution always checks current identity/target authority; visibility is never authorization.
- `extraRoots(session)` reads current membership on every operation. Native file/dir/image/bash providers retain the existing scope enforcement. Removing a member invalidates subsequent group access; a former group cwd recovers to the private root before the next prompt so chat remains usable. Already-running processes keep their originally granted mounts until they end; no live mount revocation claim.

## Actual commands and results

All tests launch the shipped profile/Loader, authenticated HTTP chat and deterministic external HTTP model double, retaining real SQLite/JSONL and actual files/bubblewrap subprocesses. No DB mutation manufactures a permission state. The raw v2 SQL is only an independently constructed migration fixture; schema inspection enforces AGENTS.md.

```sh
node --test tests/groups.test.mjs
node --test tests/identity-store.test.mjs tests/groups.test.mjs tests/spaces.test.mjs
node --test "tests/**/*.test.mjs"
node scripts/combo.mjs verify
node scripts/ourfairy-backend.mjs doctor --json
git diff --check
```

- real missing `group_create` tool failed; : first slice 1/1 green.
- expanded tests exposed revoked-cwd prompt failure, plus an unrelated test helper counting replies inside the bounded 64-event window. The helper now compares the public stable `messageId`.
- intermediate fixture mistakenly used `id`; retained as failed evidence, not a product failure or acceptance pass.
- corrected fixture isolated the actual product failure (`chat failed before tool result: path outside authorized spaces`); : 4/4 green after the bounded private-cwd recovery.
- 28/28 passed. Tests cover designated owner/live tool visibility, ordinary member/other-group-owner/admin parameter bypass, actual group file and confined script sharing, remove/re-add with same live cwd, no admin implicit read, concurrent duplicate additions, restart authorization, v1/v2 migrations and existing T7 regressions.
- 65/66; the old model-double catalog expectation omitted newly shipped group tools. Updated that expectation; : **66/66**, zero skipped/cancelled.
- verified pinned dsh/rikkahub and ticket ancestry. : `ok: true`. `git diff --check`: no output, exit 0.

`mcode-schema/` archives the explicitly bounded schema-only delegation and actual report. The initial sandbox invocation could not write mcode's user-state file; normal escalation ran the same task successfully. I inspected the actual additive migration diff, implemented the business checks/scoped tools/root wiring, and ran all behavioral acceptance above. mcode's own report is not substituted for acceptance.

Not run: real official cloud model, Android device/emulator, APK-to-backend runtime or production deployment. Existing T7 real network/dependency-install tests ran in the product suite; this ticket adds no separate networking policy. This evidence does not complete the overall v1 specification.
