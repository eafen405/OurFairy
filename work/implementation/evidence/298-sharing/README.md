# #298 — Address install, shared proposals and skill lifecycle

Ticket: [#298](https://github.com/eafen405/OurFairy/issues/298), spec [#295](../../../../docs/specs/fairy-skills.md).
Branch: `ticket/298-sharing`, worktree `.worktrees/298-sharing`, based on
`integration/spec-295` tip `e38bd9f1c9` (after #297). Before hand-off the tip
advanced to `a6f3a63289` (merge of #299, evolution and version review); it was
merged into this branch and the conflicts in `creation.ts`, `tools.ts`,
`service.ts` and the README were resolved by keeping both tickets' behaviour.
The final branch/merge SHA is in the report.

## What changed

### Install (`backend/skill-creator/src/install.ts`)

- Supported addresses: a GitHub repository tree/blob path
  (`https://github.com/<owner>/<repo>/tree/<ref>/<path...>`; a `/blob/.../SKILL.md`
  path names its parent directory), the `github:<owner>/<repo>/<path>@<ref>`
  shorthand, and a direct `.tar.gz`/`.tgz` URL. A `.zip` is refused with
  `skills/unsupported-archive` instead of being read by an untested extractor.
- A GitHub ref is resolved to a commit through
  `GET <api>/repos/<owner>/<repo>/commits/<ref>`, then the commit tarball is
  downloaded from `<codeload>/<owner>/<repo>/tar.gz/<sha>` and only the skill
  subtree is extracted.
- `OURFAIRY_GITHUB_API_BASE` / `OURFAIRY_GITHUB_CODELOAD_BASE` override the two
  hosts; `OURFAIRY_SKILL_INSTALL_MAX_BYTES` bounds download, inflation and
  package size (bundle config `installMaxBytes`).
- Fetching follows at most five redirects, times out, refuses a declared or
  streamed response over the bound before buffering it, and only accepts
  `http`/`https` URLs without embedded credentials.
- Extraction accepts regular files and directories only; it rejects absolute
  paths, `..`, backslashes, NUL, symlinks, hardlinks, devices/FIFOs, unsafe
  destination paths, an oversized package, too many files, and an archive that
  does not contain exactly one package with a top-level `SKILL.md`. Directory
  entries with the conventional trailing slash are accepted.
- Extraction happens under `tmp/install-<uuid>/` in the skill data root (never a
  native scan root). The package is then copied by the ordinary creation path;
  nothing executes package code, registers a plugin or skips review.
- The version records `address`, `resolvedVersion` (commit SHA or archive
  digest), archive `digest`, `fetchedAt`, optional ETag/Last-Modified, and the
  license from frontmatter or a root `LICENSE*` file (kept in the package).
  `source_type` is 1 (install).

### Shared proposals and lifecycle (`src/sharing.ts`, `src/creation.ts`)

- `scope: 2` requires the user turn that opened the current turn to contain one
  of `共有`, `共享`, `所有人`, `大家`; the claimed `user/message` id, text and seq
  are recorded as the sharing consent. A common identity has
  `owner_short_id = NULL` and `proposed_by = caller`.
- Common candidates are visible to their proposer and Phaethon only
  (`/skills/list` pending, `skill_manage list`, `inspect`, `review-open`).
  Phaethon alone can decide; a proposer who can read a candidate gets
  `skills/forbidden` on a review decision. A common decision creates no
  preference rows for anyone, so the common default (disabled) applies to each
  user independently.
- Common review material records only the consent plus the fixed source (if an
  install) and never the proposer's raw session id, focus range or evidence.
- Archive/restore: personal owner only; common Phaethon only. Archive sets
  `archived_at`, removes the identity from pool winners, catalog and read-only
  resources, and keeps content, version history, source and preferences.
  Restore clears the marker and never resets preferences; a missing row again
  takes the scope default.

### Client surface (`src/http.ts`, `src/notify.ts`, `src/store.ts`, `src/tools.ts`)

- New `/skills/archive` and `/skills/restore` (`{skillId}`) routes; 44 published
  product addresses (was 42).
- `/skills/list` adds a bounded, newest-first `reviewResults`
  (`versionId, skillId, name, scope, status, decidedAt, proposer`) and returns
  common pending candidates to the proposer and Phaethon.
- Action scopes are accurate per caller: personal lifecycle always 1; common
  lifecycle 2 only for Phaethon and 0 for every other caller (0 = not offered,
  so the client hides the control). Server-side permission checks are the
  authority.
- `skill_manage` gains `address`, `archive` and `restore`; `create` still needs
  at least one scenario and still runs the #297 verification/review/publish
  path. The tool description now states install, common-consent, Phaethon-only
  common approval and lifecycle rules.

### Android

- `SkillsApi`/`SkillsState`: `archive`, `restore`, `reviewResults`, and action
  scope 0; writes re-read the pool.
- `SkillsPage`: archive/restore controls rendered only when the backend offers
  the action, with the backend's scope label; archived items show state 4 and a
  restore control; recent decisions section; pending rows show scope.
- `SkillsReviewLedger` + `SkillsReviewNotifier`: a durable per-account set of
  observed pending/decided version ids; one merged local notification per newly
  observed set, consumed before publication (a suppressed foreground/disabled
  attempt is recorded and never replayed). Proposer-only decisions are the only
  decision reminders.
- `AndroidRemoteNotifications`: new `Fairy 技能提醒` channel, `publishSkills`
  and `ACTION_OPEN_SKILLS`; `RouteActivity` admits it only for the same endpoint
  and account and opens `Screen.Skills`.
- `RemoteReceiveService` polls the bounded list once a minute while background
  reception runs; `RemoteReceiveController` also observes on app start/stop and
  identity changes.

## Merge with #299

#299 (evolution, revision review, rollback) merged first at `a6f3a63289`.
Conflicts:

- `creation.ts`: #299's revision/growth/reuse path and #298's install/common
  consent path are one `create`. A revision is personal (from its parent
  identity); a new common candidate goes through the consent rule. `pending`
  now takes both the reviewing log (growth confirmation discovery) and the
  caller's administrator bit (common-candidate visibility).
- `tools.ts`: one action enum (`list`, `inspect`, `create`, `review`,
  `rollback`, `archive`, `restore`), one description and one execute switch;
  the revision inputs (`parentVersionId`, `targetBenefit`,
  `growthConfirmMessageId`) and the install/lifecycle inputs coexist.
- `service.ts`: `pendingRevision` from #299's open drafts plus #298's
  caller-aware lifecycle action scopes.
- README: one table and seam list for both tickets.
- `#visible` became `#visible(shortId, isAdmin, versionId, action)`; rollback
  keeps the personal-only #299 rule (`canReview(..., false, ...)`), while
  inspect/review/rollback display use the shared permission functions.
- `reviewTarget` and the /skills/list pending call carry the administrator bit.

## Tests and results

Focused backend (real launcher, real SQLite, real bwrap, loopback GitHub-shaped
stub and model double; no network):

```
npm run build
node --test tests/skill-install.test.mjs tests/skill-install-product.test.mjs \
  tests/skill-sharing.test.mjs tests/skill-creation.test.mjs tests/skill-runtime.test.mjs \
  tests/skill-package.test.mjs tests/skill-creation-store.test.mjs tests/skill-verify.test.mjs \
  tests/route-inventory.test.mjs tests/identity-http.test.mjs
```

Result on the merged tree: 33/33 in the install/sharing/route suites and
89/89 across the whole focused skill set (the #297 creation suite, the #299
evolution/display suites, runtime, store, package, verify and the route
inventory). The suites cover address parsing, GitHub commit resolution, direct
archives, fixed-version immutability, traversal/symlink/oversize refusals, no
scan-root write, review-required install, common consent/visibility/permissions/
defaults, archive/restore permissions, preference preservation, catalog and
read-only resource removal/restore, provider invalidation, `reviewResults`, and
the 44-address inventory/fence.

Android focused:

```
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.SkillsApiTest' \
  --tests 'me.rerere.rikkahub.data.remote.SkillsStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.SkillsReviewNotifierTest' \
  --tests 'me.rerere.rikkahub.ui.identity.SkillsPageTest' \
  --tests 'me.rerere.rikkahub.NotificationColdStartTest' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest'
```

Full gates on the merged tree:

- `npm test`: **569/569 pass**.
- `npm run combo:verify`: all three rows `ok` (product worktree based on the
  integration tip, dsh pinned commit unchanged, Android source declaration).
- `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug`:
  **BUILD SUCCESSFUL**, 596 app unit-test cases plus lint (`test` and
  `lintDebug` in one run).

Full-suite runs of the pre-existing `skill-creation` and `skill-runtime` suites
showed occasional load-timing flakes under the parallel full suite (one case
each, in different runs); each suite passes repeatedly when run alone, and the
final merged `npm test` passed in full. The flakes are recorded rather than
hidden because they are not introduced by #298 and no #298 assertion failed.

## Not executed

- No real GitHub/network fetch: every install case uses the loopback stub.
  Redirect, timeout and real-host behaviour are covered by reading the same
  fetch code, not by a live GitHub call.
- No real Android device/emulator: the client evidence is Robolectric + Compose
  unit tests, not a device acceptance run.
- No real-model acceptance: #298 does not require it; all model turns use the
  deterministic double.
- No #300 background creation, so the install/notification path is exercised
  only through explicit user turns.

## Out-of-ticket findings / risks

- A GitHub ref containing `/` is parsed as its first path segment; tag/branch
  names with slashes need the `github:` shorthand with an unambiguous ref.
- GNU tar long-name (`L`/`K`) entries are refused; codeload tarballs use the
  ustar prefix field for normal repository paths.
- The background reminder polls once a minute and only while the existing
  background reception service runs; without that service enabled, the in-app
  badge remains the surface.
- The full-suite timing flakes above are pre-existing in the #297 suites; no
  assertion about #298 failed in the repeated focused runs.
