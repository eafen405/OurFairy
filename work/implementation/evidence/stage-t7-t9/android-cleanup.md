# T7–T9 Android cleanup — 2026-10-15

Scope authorized by Lead: remove only this round's 09-attachments, 09-attachments-api, 09-attachments-ui worktrees; preserve all branches and older worktrees. No integration source/evidence/root tracked files edited by this cleanup. No reset, broad rm, merge or push. Following normal Git refusal, Lead explicitly authorized Git worktree remove --force for the two exact submodule-bearing paths after the safety checks documented below.

## Verified integration and artifacts

- Android product/ourfairy-v1 = e58352f202ae1add0e9c4bd08b14807f4c84a9bb.
- Main ticket ticket/09-attachments = bf4db2d6ff29df9d1fa195fa81460ae12757e21d. `git merge-base --is-ancestor` passed. `git rev-parse ticket/09-attachments^{tree}` equals `git rev-parse product/ourfairy-v1^{tree}`. Worktree status (tracked + all untracked source) empty before cleanup and after normal remove refusal.
- Final 98/98 relevant JVM tests and debug APK are documented in OurFairy work/implementation/evidence/09-attachments-android. This cleanup reread all 3 APK files before deinitialization and verified byte length + SHA256 match the durable apk.json:
  - arm64-v8a: 36bedb994b7dbf150c47041df7bc5305bd269e6b28d723453996898aef6c4ef7
  - universal: b244b4d96bf50392765a57e607dfa7859bf04b4623dc1250e6ca35e068cad1ad
  - x86_64: 800d344cf5031986113f25412950b1b64b44bd33939f597ca885df0a8fea70a1

## Complete original mcode archive verification

For each scratch worktree, `git diff --binary` matched the corresponding durable OurFairy evidence `mcode-*-tracked.diff` byte for byte. `git ls-files --others --exclude-standard` matched the complete file set under `mcode-*-original/` (no additional untracked source); every source file matched byte for byte. The report below records SHA256s. After local archive commits, every originally untracked file was checked again using `git show <archive-branch>:<path>` against the same durable original file.

- /home/eafen405/projects/rikkahub/.worktrees/09-attachments-api
  - Tracked diff: 8665 bytes; SHA256 13db902ab3c2f1d243245ded02dba9754dc50c5c21ea7db6fb8264c152fa6b7d.
  - Untracked source `app/src/main/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApi.kt` SHA256 ef62d69f14aac17bfc6ff859dfef1f09534204e4ef0e50ed22be49f51ae17f2c.
  - Untracked source `app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApiTest.kt` SHA256 131e617b08125bb73a01d0e7858b79387a12e5dff91b392ee1df925a612cfe2c.
- /home/eafen405/projects/rikkahub/.worktrees/09-attachments-ui
  - Tracked diff: 18343 bytes; SHA256 2fa3cd6116c74274ab027c0bafb048cf05f57d53bbfa01a5c86847cefd0de094.
  - Untracked source `app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteAttachmentFiles.kt` SHA256 1cc9b0ef2bfd885f1cd21d16d33f0ec106303caaa9eec1affbb11a09b8b37f73.

The final product includes all intended API/DTO and picker/SAF behaviors from these originals, with coordinator corrections documented in the evidence README: missing coroutineContext/OkHttp imports; binding epoch remember keys; cancellation cleanup; bounded explicit HTTP retries; two observed fixture expectations; pending restoration guard. Original scratch commits intentionally preserve the *uncorrected* mcode output. They are archival local branches, not product dependencies.

## Local archive commits and normal removal results

| Worktree | Retained branch / SHA | Result |
| --- | --- | --- |
| 09-attachments | ticket/09-attachments / bf4db2d6ff29df9d1fa195fa81460ae12757e21d | Normal `git worktree remove .worktrees/09-attachments` refused: `fatal: working trees containing submodules cannot be moved or removed`. Left present and clean. |
| 09-attachments-api | subtask/09-attachments-api / 20c5a0a3d20b9a1d2380d7e03eb58ad73468d6c8 | Original 6 source files committed locally with `archive: preserve original T9 mcode attachment API task`; normal `git worktree remove .worktrees/09-attachments-api` refused the same submodule limitation. Left present and clean. |
| 09-attachments-ui | subtask/09-attachments-ui / e57e9108413f20e5ac7bd3bf24b0f13588a72f31 | Original 2 source files committed locally with `archive: preserve original T9 mcode picker UI task`; normal `git worktree remove .worktrees/09-attachments-ui` succeeded. |

No archive branches were merged/pushed. Earlier 03-identity, 04-owned-sessions and review-24-26-identity worktrees and all existing branches retained unchanged.

## Task-generated ignored contents and submodules

Before removal, inspected `git ls-files --others --ignored --exclude-standard --directory` for each worktree. Only task build/dependency products were present: .gradle/.kotlin/build outputs, module build dirs, generated web static/build files, workspace .cxx where used, ignored fake-key google-services.json and main local.properties. Main node_modules symlink had already been unlinked after validation. Both scratch node_modules were actual task-generated pnpm install directories (not symlinks); their top-level contained only .pnpm/metadata, .bin and the project's declared package dependencies. They were not a source archive and were left to normal worktree removal; UI copies removed by successful normal removal, API copies remain with its refused worktree.

Main/API material3/material-color-utilities were initialized at the pinned 5b3618b16fdc3825e21d5679bafd144662088ea1. Each submodule `git status --porcelain --untracked-files=all` was empty. Ran normal `git submodule deinit -- material3/material-color-utilities` (no force), which cleared the task checkout successfully. Git still refuses main/API worktree removal because submodule repository administration remains associated with them. Per instruction, stopped and reported; no manual metadata deletion, force removal or recursive deletion attempted.

## Final state / outstanding cleanup

- UI worktree removed normally. Main and API worktrees remain clean due to Git's submodule worktree limitation; Lead informed immediately.
- Root product tracked diff remains empty and product HEAD remains e58352f202ae1add0e9c4bd08b14807f4c84a9bb; root `?? .worktrees/` was pre-existing.
- All tasks launched by this agent have returned: two mcode runs status completed exit0; all Gradle/verification sessions returned; final UI remove session returned exit0. No agent-owned implementation/build work remains running (shared pre-existing Gradle daemons are not stopped).
- No extra feature/test work started. Stage remains stopped after review.

## Final authorized submodule removal (supersedes outstanding cleanup above)

After receiving the normal-remove refusal evidence, Lead explicitly authorized only these two precise `git worktree remove --force` commands. This is Git's required submodule-worktree switch; no force push, reset, manual Git metadata edit or broad deletion was used.

Immediately before execution, rechecked for both exact paths:

1. `git status --porcelain --untracked-files=all` empty.
2. `git ls-files --others --ignored --exclude-standard --directory` exactly equals the earlier reviewed generated-content set; no additional ignored/personal files appeared.
3. `material3/material-color-utilities` directory exists but is empty after clean normal deinit. No submodule dirty bytes are being removed.
4. Main ticket remains an ancestor of product integration; complete original scratch bytes remain in both durable evidence and the preserved archive branch commits.

Commands in /home/eafen405/projects/rikkahub, all successful exit0:

```sh
git worktree remove --force .worktrees/09-attachments-api
git worktree remove --force .worktrees/09-attachments
```

All three this-round Android worktrees are now removed. UI was removed by normal non-force command; API/main required the explicitly authorized submodule switch. Final `git worktree list --porcelain` retains only root product checkout and older 03-identity, 04-owned-sessions, review-24-26-identity unchanged. Final `git status --short` is the same pre-existing `?? .worktrees/`; no tracked root edit. All four product/ticket/archive refs remain exactly as listed above. Final command session returned exit0; no agent-owned task remains running.
