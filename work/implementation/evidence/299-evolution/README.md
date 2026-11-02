# #299 — Skill evolution, growth confirmation, atomic switch and rollback

Ticket: [#299](https://github.com/eafen405/OurFairy/issues/299), spec [#295](../../../../docs/specs/fairy-skills.md).
Branch: `ticket/299-evolution`, worktree `.worktrees/299-evolution`, based on `integration/spec-295` tip
`e38bd9f1c9` (after #296 and #297); merged with the then-current integration tip before hand-off.

## What changed

**Evolution module (`backend/skill-creator/src/evolution.ts`, new)**

- The one growth calculation: `new > floor(old * 1.1)`. Exactly 110% is not exceeded; 109% and
  110% need no confirmation, 111% does. A new skill has no baseline.
- `targetBenefit` validation (non-empty, ≤ 500 characters). A revision without a benefit is
  refused before anything is staged.
- `latestInspectSeq` / `confirmationOf` / `confirmationCandidate`: the growth confirmation is the
  user's own `user/message` whose joined text is exactly `确认增长`, in the reviewing session, with
  `seq` after the latest **successful** `skill_manage inspect` call for that version and an id equal
  to the supplied reference. Failed inspects never anchor a confirmation.
- `planVerificationReuse`: a parent scenario is reused only when name, command and every `uses`
  path resolve to the same file hashes in the parent and candidate manifests; everything else
  reruns. Reused records keep the parent's recorded facts and gain `reusedFrom`.
- `rollbackScenarios`: the historical approved version's recorded scenarios are the rollback's
  verification plan.

**Revision creation (`src/creation.ts`, `src/store.ts`, `src/tools.ts`)**

- `create` with `parentVersionId` (must be the skill's current approved version of the caller's
  personal identity) and `targetBenefit` writes a complete package rewrite on the same identity:
  `source_type: 3`, `parent_version_id`, the growth flag, the benefit in `source_location`. An
  unknown/stale/other-owner parent, a renamed package, a missing benefit and a benefit without a
  parent are refused. A plain create that collides with an approved identity is still refused.
- `skill_manage list` now also reads the caller's durable log so a growth-exceeded pending item
  carries `growthConfirmMessageId` — the one discovery path for a model that cannot read durable
  message ids. Approval re-reads the same message from the log; the list value is never trusted on
  its own.
- `skill_manage review approve` requires `growthConfirmMessageId` when the stored growth flag says
  the version grew more than 10%. The message must be the caller's own, exact, same-session,
  post-display message; a modeled boolean fails argument validation, and a forged id, wrong text,
  another session/user or a message older than the latest display is refused
  (`skills/growth-confirmation-invalid`). The confirmer, time and message id are written with the
  approval in the same transaction.
- Approval re-checks, inside one `BEGIN IMMEDIATE`: pending state, archive state, the on-disk
  manifest hash, that a revision's parent is still the current pointer, and that an exceeded
  growth has a validated confirmation. It supersedes the old current, switches the pointer,
  preserves preferences and writes the growth confirmation. A failed transaction renames the
  candidate back. Two pending revisions of the same parent can coexist; only the one whose parent
  is still current publishes, the loser keeps a pending draft and fails with `skills/changed`.
- The old current version keeps serving the catalog and read-only resource view during review.
  After the switch only the new current version is served by the native loader and the read-only
  contribution; a superseded version directory stays on disk for audit/rollback but is not a
  model-visible resource.

**Rollback (`src/creation.ts`, `src/tools.ts`)**

- `skill_manage rollback {versionId}` accepts an approved **superseded** version of a skill the
  caller may review. It copies the clean package through staging, re-hashes it against the
  historical row, re-runs its recorded scenarios (reusing the current report where name, command
  and `uses` hashes match), and inserts a new pending candidate: `source_type: 4`,
  `parent_version_id` = current, growth computed against the current version, benefit
  `回滚到版本 N 的已审核内容` and `rollbackOf` provenance. Review is the normal approval path; the
  pointer never moves at rollback time. A pending/current/unknown source is refused, and a repeat
  rollback of content that is already current is refused as a no-op.
- `inspect` on a superseded version now names `rollback` in `nextActions` (the only model-visible
  way to discover historical version ids, via the current version's `parentVersionId`).

**Pool derivation (`src/service.ts`, `src/store.ts`, `src/http.ts`)**

- `pendingRevision` is derived per caller: true while the identity has a pending sibling, or a
  newest changes-requested one; a newer settled draft clears the changes-requested state. Only
  identities the caller can review count. `/skills/list`, `skill_manage list` and the Android page
  read this derived boolean; the client computes nothing.

**Review display (`src/creation.ts`)**

- Block 1 carries `核心正文 <old> → <new> 字符（±N%）` (or `新技能，N 字符`, or the counts for a
  zero-length parent body); block 3 counts executed/reused/unexecuted/failed and prints a reused
  scenario as `↺ … → 复用自版本 N`; block 4 carries the exact
  `篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」` instruction when required. That
  instruction is reserved after the display is clipped, so a long verification list cannot push
  it out of the 4000-character bound.

**Verification runner (`src/verify.ts`)**

- `ScenarioRecord` records `uses` and `reusedFrom`. `runVerification` accepts already-recorded
  parent runs as `reused`; a reuse-only revision needs no bwrap namespace (nothing runs) and still
  reports complete. A report is approvable when it has executed or reused evidence and no
  unexecuted/failed entries.

**Skill Creator and docs**

- The bundled `skill-creator` body now documents revision creation, the target-benefit rule, the
  growth confirmation flow, verification reuse and rollback.
- `skill_manage`'s description documents revisions, growth confirmation and rollback.
- `backend/skill-creator/README.md` documents the evolution/rollback rules, `pendingRevision`, the
  reused verification records and the remaining install/sharing/learning seams.

**Android (`SkillsPage.kt`, strings, tests)**

- A pool item with `pendingRevision` renders a `有待审修订` `StatusChip`; a pending candidate with
  `growthExceeded` renders a `需确认增长` chip. Both come from backend booleans; the page never
  computes a percentage or a version state.
- The review panel already renders the backend display verbatim; a test now pins that the growth
  characters and the `确认增长` instruction reach the panel unchanged.

## Commands and results

All commands ran in `/home/eafen405/projects/OurFairy/.worktrees/299-evolution` with
`android/local.properties` pointing at `/home/eafen405/Android/Sdk` (gitignored).

| Command | Result |
| --- | --- |
| `npm run build` | pass |
| `node --test tests/skill-evolution.test.mjs tests/skill-evolution-display.test.mjs tests/skill-creation.test.mjs tests/skill-creation-store.test.mjs tests/skill-package.test.mjs tests/skill-runtime.test.mjs tests/skill-verify.test.mjs tests/route-inventory.test.mjs tests/identity-http.test.mjs tests/docs.test.mjs` | 72/72 pass (focused backend set) |
| `npm test` | see the final hand-off run recorded below |
| `npm run combo:verify` | pass (`ourfairy`, `dsh`, `android source`) |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | see the final hand-off run recorded below |

No raw logs are committed; the commands above are the record.

## Model-double vs real service

- All backend runtime claims are **model-double evidence**: a loopback Messages-protocol double
  issued real `skill_manage`/`skill`/`read` tool calls; the real launcher, profile, Loader, SQLite
  store, filesystem, bwrap sandbox and HTTP surface executed the product. The tests observe the
  model's own tool results, the durable log, the SQLite rows and the native loader.
- Verification tests spawn real `/bin/bash -lc` commands under real bwrap; they are not
  model-double evidence. A reuse-only revision is evidence that the parent's recorded facts were
  reused, not that the scenario ran again.
- No real cloud-model turn and no real ASR service was exercised. #299 does not require real-model
  acceptance; no real-model sample was run.
- Android evidence is Robolectric unit/Compose evidence plus `lintDebug`; no emulator or physical
  device acceptance was performed.

## 未完成项与风险

- **Common-skill revisions and rollback:** this branch's revision/rollback parent must belong to
  the caller's **personal** identity, because common creation/consent/approval is #298's surface
  and did not exist in this branch's base. When #298 lands, its common-permission rules should
  extend `#revisionContext` and `canReview` so a Phaethon-owned or proposer-owned common revision
  can use the same path. This is the one cross-ticket seam that may need a follow-up edit at merge
  time.
- **Growth-confirmation discovery:** the model cannot read durable message ids from its context,
  so `skill_manage list` reports the candidate's confirmation id after the user replied; approval
  still re-reads the message by id and checks owner, text and order. If a user confirms once after
  inspecting two growth candidates, that one message can authorize both (the user did reply after
  both displays); this is deliberate and not a forgery path.
- **Changes-requested state:** a changes-requested row marks `pendingRevision` only while it is the
  newest version row. Once a newer draft exists, that draft (or its settled outcome) is the state
  the pool presents; this keeps the label from sticking forever after an approval. It is a small
  reading of the addendum's “pending/changes-requested sibling”.
- **Verification reuse and descriptions:** reuse keys on name, command and `uses` file hashes; a
  scenario whose description or `timeoutMs` changed is still reused because neither changes what
  was executed. A parent report without `uses` (a row written before this ticket) never reuses a
  scenario that declares `uses`.
- **Rollback scenarios:** rollback reuses the historical report's recorded commands. A historical
  approved version with no recorded scenario (not expected: approval requires executed or reused
  evidence) is refused rather than inventing a scenario.
- **Out-of-ticket finding:** none beyond the cross-ticket seam above. The store schema already
  carried every growth/confirmation column in v1, so this ticket added no migration.
