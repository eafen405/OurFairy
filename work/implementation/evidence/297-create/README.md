# #297 — Explicit creation, verification and review

Ticket: [#297](https://github.com/eafen405/OurFairy/issues/297), spec [#295](../../../../docs/specs/fairy-skills.md).
Branch: `ticket/297-create`, worktree `.worktrees/297-create`, based on `integration/spec-295` tip
`d9b7e1462a` (after #296); merged again before hand-off.

## What changed

**Skill Creator content (`backend/skill-creator/bundled/skill-creator/SKILL.md`)**

- Extended (not replaced) with the binding creation contract: when to use it; workflow → skill vs
  stable fact → memory and never both; flat single-line frontmatter only (with optional
  `whenToUse` / `not-applicable` / `license`); the complete `skill_manage create` payload
  (`scope`, `focus`, `files`, `scenarios`, `evidence`, `license`); the 1–3 closed-loop scenario
  rule and `uses`; the system-recorded verification rule; and the create → inspect → user decision
  → review flow (a change request means a new draft/hash/verification; the model never claims
  approval). This is the same file background creation (#300) will reuse.

**`skill_manage` (backend/skill-creator/src/tools.ts, index.ts)**

- One tool, `skill_manage`, registered on user sessions only on `agent.ctx` with the row's
  name-guarded replay registration. Actions `list`, `inspect`, `create`, `review`; every call
  renders one `JSON.stringify` text block. The English description states the workflow→skill,
  fact→memory, no-double-write boundary, candidate status, review ownership and the fields the
  model may not submit (owner, reviewer, landing path, manifest hash, verification result).
  `create` refuses `address` (install) and `parentVersionId`/`targetBenefit` (evolution) instead
  of silently ignoring a later ticket's payload. An approval invalidates the owner's live
  provider registrations.

**Creation (`src/creation.ts`, `src/store.ts`, `src/package.ts`)**

- `focus` resolution from the durable log: current/latest turn by default, a numbered turn, or the
  latest turn plus a task statement; records `{kind, turn, startSeq, endSeq, toolCalls}` (and the
  task) as provenance in `source_location`.
- `create` writes the model's complete file set through `tmp/<uuid>/` with the shared package
  writer, validates it with the one package/manifest algorithm, moves it to `candidates/<uuid>/`,
  inserts the identity (first candidate) or joins an identity that has no approved version
  (request-changes path), and refuses a name that already has an approved current version.
- Store additions: `createDraft`, `pendingDrafts` (bounded 50, personal owner or common proposer),
  `updateVerification`, `recordReviewDecision` (pending-only predicate in the UPDATE) and
  `publishDraft` (one `BEGIN IMMEDIATE` transaction re-checking pending state, archive state and
  the caller's on-disk manifest re-check, superseding the old current row before approving the new
  one, inserting the first personal-approval default preference, preserving any explicit one).
- `package.ts` gains `writeSkillPackage` (relative-path, duplicate, file-vs-directory and
  executable-bit checks).

**Verification (`src/verify.ts`)**

- Copies the candidate into a fresh `verify/<uuid>/work/`, creates a one-off `HOME`, `TMPDIR` and
  package-manager caches inside the same directory, and runs every scenario as
  `/bin/bash -lc <command>` under `bwrap` (`workspaceRoot`/`writableRoots` = the verify root,
  `readRoots: []`, no `envRoot`, network shared). Probe failure → all scenarios `unexecuted` and
  the report incomplete. Per-scenario timeout and the turn's abort signal kill the process group
  and are recorded; stdout/stderr are bounded to 4000 characters each. The report lists
  executed/reused/unexecuted/failed, the environment and the run time, and the disposable
  directory is deleted afterwards. `reused` stays empty (the evolution ticket's seam); optional
  with/without comparisons run in the same environment.

**Inspect and review (`src/creation.ts`, `src/http.ts`, `src/review-open.ts`)**

- `inspect` returns the read-only review package (source/provenance, growth, core characters,
  applicability, package list bounded to 64 entries with the true total, parent diff, verification,
  `next_actions`, growth-confirmation shape) and a deterministic four-block `display` bounded to
  4000 characters; `expand: "skill"` / `expand: "files" path=…` return bounded full text.
- `review` implements `approve` / `request_changes` / `reject` for the personal owner through one
  exported `canReview` function. Approval re-reads the pending row, archive state and the on-disk
  manifest hash, requires a complete report with at least one executed and no failed/unexecuted
  scenario, refuses a growth-exceeded version until #299 completes the confirmation rule, renames
  the candidate into `versions/<skillId>/<uuid>/`, and publishes in one transaction (rollback
  renames the directory back).
- `/skills/list` now returns the caller's bounded pending candidates and the real `pendingCount`.
- `/skills/review-open {versionId}` checks the same review visibility, resolves the caller's fixed
  primary session, and uses `ctx.ourfairyChatRuntime.appendOnce` to append exactly one
  `user/message` whose source is `{kind:'skill-review', form:'instructions', versionId,
  manifestHash}`; it answers `{ok, sessionId}`. The transcript fold ignores non-`user` sources, so
  this is model context without a user bubble.

**Chat projection (`backend/chat/src/units.ts`, README)**

- Transcript `stateVersion` 5 → 6. A successful `tool/result` whose first text block is JSON with
  `kind === 'skill-review'` and a non-empty `display` appends exactly one projection-only row
  `{messageId: 'skill-review:<callId>', role: 3, kind: 2, status: 2, text: display,
  seq: result seq, toolCallId}`; first appearance wins; failed, malformed and unrelated results
  derive none. No event is appended, so the row stays out of model history, deliveries and search.

**Memory boundary**

- `backend/memory/src/tools.ts` (`MEMORY_POLICY`) and `backend/memory/src/maintenance.ts`
  (`MAINTENANCE_POLICY`) now state the same rule as the tool and Skill Creator: reusable workflows
  belong to `skill_manage`-created skills, stable facts/preferences to memory, and the same content
  is never written to both. `tests/memory-policy.test.mjs` pins both prompts.

**Android**

- `SkillsApi`/`SkillsState`: pending candidates use the backend's `versionId` shape; new
  `reviewOpen(token, versionId)` POSTs `/skills/review-open` and answers the primary session id;
  `SkillsState.openPending` serializes the call and reports refusals without a re-read.
- `SkillsPage`: a pending item calls `review-open` and hands the answered session id to the host.
- `FairyDestinations`: the Skills destination opens `Screen.Conversation(sessionId)`.
- `RemoteTranscript`: `role == 3, kind == 2` renders a full-width multi-line review panel
  (`skill-review` test tag), not a bubble or the activation line.
- `FairySettingsPage`: when the skills group opens, the page reads `/skills/list` and shows a
  `待审 N` `StatusChip`; a restored settings page still performs no network read until that group
  opens. The badge count is the backend's, never derived.
- Strings added in both values files (`skills_pending_badge`).

**Docs**

- `backend/skill-creator/README.md` now documents the creation/review/verification surface and the
  remaining #298/#299/#300 seams; `backend/chat/README.md` documents role 3 kind 2 and
  `stateVersion` 6; `docs/architecture/agent-capabilities.md` states 26 model tools including
  `skill_manage`.

## Commands and results

All commands ran in `/home/eafen405/projects/OurFairy/.worktrees/297-create` with
`android/local.properties` pointing at `/home/eafen405/Android/Sdk` (gitignored).

| Command | Result |
| --- | --- |
| `npm run build` | pass (all product projects emit) |
| `node --test tests/skill-package.test.mjs tests/skill-creation-store.test.mjs tests/skill-verify.test.mjs tests/skill-creation.test.mjs tests/skill-runtime.test.mjs tests/projection-units.test.mjs tests/route-inventory.test.mjs tests/identity-http.test.mjs tests/model-double.test.mjs tests/memory-policy.test.mjs` | 94/94 pass (three suites) |
| `npm test` | 524/524 pass, 19 suites (full gate at the start of the hand-off commit) |
| `npm run combo:verify` | pass (`ourfairy`, `dsh`, `android source`) |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | BUILD SUCCESSFUL; `:app:testDebugUnitTest`/`:ui:testDebugUnitTest`/`:highlight:testDebugUnitTest` 651 tests, 0 failures/errors; lintDebug clean |

The focused backend set is the ticket's affected surface plus the files whose counts/strings it
edits. `npm test` and the Android gate ran again on the final hand-off state through the repo's
pre-commit gate. The bwrap verification suite is real-process evidence: the test host has
`bubblewrap 0.11.1` at `/usr/bin/bwrap`.

No raw logs are committed; the commands above are the record.

## Model-double vs real service

- All backend runtime claims are **model-double evidence**: a loopback Messages-protocol double
  issued real `skill_manage`/`skill` tool calls; the real launcher, profile, Loader, SQLite store,
  filesystem, bwrap sandbox and HTTP surface executed the product. Tool descriptions, catalog,
  review rows and conversation references are asserted from the captured model requests and the
  durable log.
- The verification runner tests spawn real `/bin/bash -lc` commands under real bwrap; they are not
  model-double evidence.
- No real cloud-model turn and no real ASR service was exercised. #297 does not require real-model
  acceptance; no real-model sample was run.
- Android evidence is Robolectric unit/Compose evidence (651 tests) plus `lintDebug`; no emulator or
  physical-device acceptance was performed.

## 未完成项与风险

- **Later-ticket scope, by design:** install-from-address, common proposals/Phaethon approval,
  archive/restore, evolution/revisions, growth-confirmation message validation and background
  learning are not implemented here. The tool refuses their payloads explicitly; the permission,
  growth and verification-reuse seams are marked for #298/#299/#300.
- **Growth confirmation:** the approval gate already refuses a growth-exceeded version without a
  confirmation, but the `确认增长` message-reference validation is #299. A #297 candidate has no
  parent, so the branch is unreachable in this ticket.
- **Verification reuse:** `reused` is always empty in #297; scenario `uses` is recorded so #299 can
  key reuse without a second format.
- **Review result size:** the inspect result includes the review package plus the display. The
  display is bounded (4000 chars) and the package list is capped at 64 entries, but a very large
  verification report could make the whole tool result exceed the deployment's tool-result prune
  threshold under compaction pressure; the native pruner would then rewrite the text and the
  projection could not parse the `skill-review` marker for that one result (the tool result itself
  still reaches the model). The backend still has the authoritative review package.
- **Review reference lifetime:** the system-context reference is appended once per candidate and
  stays in the primary session log after the decision; #300/#298 may add expiry or a replacement
  policy. It is inert model context, not a user bubble.
- **Pool list width:** `skill_manage list`/`/skills/list` bound pending to 50 but return the whole
  visible pool (personal project scale). #298's common pool may need a bound.
- **Test flake observed (environment, not product):** one full-gate run hit
  `tests/speech.test.mjs` with a mock-server timeout while the machine was loaded; the test passed
  alone and in the next full gate. One Android full run hit `KoinApplicationAlreadyStartedException`
  in `ClientStartupTest`; the class and the next full run passed. Both are recorded here rather
  than silently ignored.
- **Android cold-start no-network guarantee:** the settings badge read is gated on opening the
  skills group, so the existing restored-settings cold start still makes no network request. If a
  later ticket wants the badge visible on a collapsed row, it must revisit that guarantee
  deliberately.
- **Out-of-ticket observation:** `tests/route-inventory.test.mjs`'s header comment carried a stale
  "35 JSON-after-fence addresses" count from before #296; this ticket replaced the stale arithmetic
  with a pointer to the matrix it actually asserts, without changing behaviour.
