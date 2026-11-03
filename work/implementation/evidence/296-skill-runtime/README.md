# #296 — Skill runtime and client maintenance

Ticket: [#296](https://github.com/eafen405/OurFairy/issues/296), spec [#295](../../../../docs/specs/fairy-skills.md).
Branch: `ticket/296-runtime`, worktree `.worktrees/296-runtime`, based on `integration/spec-295` tip
`d94f2a2be8` (merged again before hand-off).

## What changed

**Native assembly and deployment**

- `backend/v1-bundle/cordis.patch.yml` mounts, inside the `plugins` group:
  `skill` (`@deepseek-ai/dsh-skill`), `skill-filesystem` (`includeDefaultRoots: false`,
  `watch: false`, explicit `bundledSkillDir`), `tool-skill` (`catalogDescriptionMaxLength: 500`)
  and the product row `skills` (`@ourfairy/dsh-skill-creator`).
- `scripts/ourfairy-composition.ts` exports
  `OURFAIRY_BUNDLED_SKILLS_DIR = <root>/backend/skill-creator/bundled`; the patch reads
  `OURFAIRY_SEED_SKILLS_DIR` optionally (empty = none).
- `tests/baseline-boot.test.mjs` no longer forbids the three native skill rows.

**New package `backend/skill-creator` (`@ourfairy/dsh-skill-creator`)**

- `src/package.ts`: the one package/manifest algorithm (flat frontmatter subset, name/description
  budgets, 8000-code-point body, symlink/non-regular rejection, sorted POSIX manifest of
  `{path,type,sha256,executable}`, SHA-256 of canonical JSON, path hygiene) and the copy helper.
- `src/store.ts`: schema v1 (`meta`, `skill`, `skill_version` with the review/growth/install
  columns, `skill_user_preference`), WAL, ladder, `BEGIN IMMEDIATE`, typed row helpers,
  `COALESCE` partial unique identity index and one-current-version partial index.
- `src/seed.ts` (`./seed` export): `importReviewedPackage(...)`; validates, copies through
  `tmp/<uuid>/`, re-validates the staged copy and refuses a changed source, moves into
  `versions/<skillId>/<uuid>/` inside the import transaction, sets the current pointer and an
  optional preference.
- `src/service.ts`: pool derivation (states 1 in catalog, 2 shadowed, 3 disabled, 4 archived;
  personal default on, common default off; personal winner shadows common), catalog winners,
  integrity-checked load, read-only version dirs, seed directory import.
- `src/provider.ts`: `ourfairy-skills` provider registered per user-session Agent through
  `agent.ctx.inject(['skills'], …)` (the agent scope does not itself declare `skills`), replay for
  `ctx.agents.list()`, `rank: 100`, `source: 'ourfairy'`, `resourceBase` directory,
  locator `{versionId, manifestHash}`, forced `modelInvocable: true, userInvocable: false`,
  per-owner invalidation handles and disposal.
- `src/http.ts`: `SURFACE` `/skills/list`, `/skills/detail`, `/skills/preference` (POST + JSON,
  prefix `skills`, authentication/ownership, caller from the credential); pool items carry
  `state`, `scope`, `enabled`, `pendingRevision`, `shadowedBy` and
  `actions {toggle, archive, restore}` in numeric codes; `pending: [] / pendingCount: 0`.
- `src/index.ts`: Config per D3 (learning/verify/install fields declared for later tickets),
  store/service/seed/provider/routes composition, read-only contribution of the bundled root and
  the caller's current version dirs, per-agent registration and disposal.
- `bundled/skill-creator/SKILL.md`: deployment Skill Creator content (workflow→skill vs fact→memory,
  package shape, cleansing, relative paths, scenario verification, review-before-use), with
  `user-invocable: false`.
- `README.md`, `package.json`, `tsconfig.json`, `locale/en.json`, root `tsconfig.json` reference and
  bundle `package.json` dependency.

**Chat projection activation row**

- `backend/chat/src/units.ts`: transcript `stateVersion` 4→5; a bounded
  `callId -> {name, seq}` map fed only by `tool/call` with `name === 'skill'` (name parsed from
  `arguments`); a successful append-surface `tool/result` appends exactly one projection-only row
  `{messageId: 'skill-activation:<callId>', role: 3, kind: 1, status: 2, text: '加载了skill:<name>',
  seq: result seq, toolCallId}` and consumes the map; failed results consume without a row;
  duplicates are first-wins; `kind`/`toolCallId` appear on the wire only when set.
- `backend/chat/README.md` documents role 3, the activation rule, dedupe and stateVersion 5.

**Android**

- `RemoteChatApi.RemoteChatMessage` gains optional `kind`/`toolCallId`; `RemoteTranscript` branches
  `role == 3` before the user/Fairy layout and renders a quiet activation line (`kind 2` reserved).
- New `SkillsApi`/`SkillsState`/`SkillsPage` over the impression trio: pool with per-item switches,
  scope labels, backend-derived state labels, shadow explanation, archive/restore scope line, an
  empty-but-shaped pending section with the `onOpenPending(candidateId)` seam.
- `Screen.Skills`, destination/access/restore/page, `DestinationPageScope`, Koin singleton,
  `RouteActivity`, settings entry, strings in both values files (same key set).

**Tests**

- New `tests/skill-package.test.mjs` (package/manifest/store/seed unit seams).
- New `tests/skill-runtime.test.mjs` (real launcher/profile/model double): probe rows and a
  complete bundled-only native catalog; closed user/project/session roots; empty-session no
  catalog; first-turn catalog and non-bubble; seed import defaults; enable→catalog; native
  activation→one role-3 row with durable seq; failure/prose/catalog paths with no row; cold restart
  reproduces once; personal/common winner and shadow; disable-personal restores common without
  restart; resource read, write/bash refusal and unchanged bytes; data-root and archived-version
  read refusal; another user and Phaethon isolation; tamper→integrity failure; archived/disabled
  absence.
- `tests/projection-units.test.mjs` covers the fold (success/failure/non-skill/malformed/
  duplicate/two calls/cut/window/checkpoint) and binds transcript 5 to the README.
- `tests/fixtures/projection-real-expected.json` shifted seqs/cuts/work positions by one for the
  catalog message now written at the first pre-step.
- `tests/route-inventory.test.mjs` 38→41 addresses and the new row; `tests/identity-http.test.mjs`
  fence count 38→41; `tests/model-double.test.mjs` exact tool list gains `skill`.
- Android: `SkillsApiTest`, `SkillsStateTest`, `SkillsPageTest`,
  `RemoteTranscriptSkillActivationTest`, `RemoteChatApiTest`/`RemoteChatStateTest` activation cases,
  and destination/restore/settings matrices updated.
- Four existing model doubles (`memory-impression`, `delivery-cold-concurrency`,
  `native-compaction`, `gateway-compaction-settings`) now ignore the native catalog user message
  when selecting the current user text; their expected behaviour is unchanged.

## Commands and results

All commands ran in `/home/eafen405/projects/OurFairy/.worktrees/296-runtime`.

| Command | Result |
| --- | --- |
| `npm run build` | pass (all product projects emit) |
| `node --test tests/skill-package.test.mjs tests/skill-runtime.test.mjs` | 16/16 pass |
| `node --test` focused set (ticket list + `model-double` + `product-sources`) | 118/118 pass |
| `npm test` | 498/498 pass, 18 suites, ~87 s (a clean rerun; an earlier run was distorted by stray processes left by timed-out tests and was cleaned before this result) |
| `npm run combo:verify` | pass (`ourfairy`, `dsh`, `android source`) |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | BUILD SUCCESSFUL, 574 tests, lint clean |

The focused set was: `skill-runtime`, `skill-package`, `projection-units`,
`projection-units-real`, `chat-cold-boundary`, `reconnect`, `baseline-boot`, `bundle-packages`,
`bundle-groups`, `plugin-compatibility`, `route-inventory`, `identity-http`, `native-capabilities`,
`docs`, `model-double`, `product-sources`.

## Model double vs real service

- Every backend runtime claim above is **model-double evidence**: a loopback Messages-protocol
  double drove chat and tool calls; the real launcher, real dsh profile, real Loader, real SQLite,
  real filesystem and real sandbox executed the product.
- No real cloud model turn and no real ASR service was exercised. #296 does not require real-model
  acceptance; that belongs to #300's separate record.
- Android evidence is Robolectric/unit-test evidence on the JVM; no emulator or device run and no
  release build. `lintDebug` is not a device check.

## Not executed and why

- No real phone/emulator visual acceptance; not part of this ticket's gate.
- No `assembleDebug`/`assembleRelease`; the ticket's client gate is `test lintDebug`, and the
  Android module instructions reserve release acceptance for the release flow.
- No real-model quality acceptance; see above.

## Unfinished items / risks

- The Skills page renders the backend's archive/restore action scope but performs no archive or
  restore; those endpoints and permissions belong to #298. Pending review is empty by design and
  `kind: 2` is reserved.
- The client and backend must ship together for role-3 rows: an old client would render a role-3
  row as a user bubble. This matches the existing "no mixed-version promise" stance in
  `backend/chat/README.md`.
- Two full-suite runs before cleanup timed out in unrelated boot tests because orphaned backend and
  `pnpm install` processes from earlier timed-out runs were still alive. After killing only this
  worktree's strays, the clean full run passed. No product change was made for that artifact.
- The native filesystem provider is trusted operator input: it follows symlinks in the bundled
  root. The deployment root is inside the repository, and the product manifest validator rejects
  symlinks for package content; the bundled meta skill is deployment content, not a reviewed
  version.
