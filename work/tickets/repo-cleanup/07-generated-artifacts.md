## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-07。

## What to build

在本机逐项确认并回收可再生缓存与临时产物，报告实际回收空间；不退役 worktree，不整理 Git 引用，不处理未提交成果。

## Current evidence

只读盘点估算的大项包括：integration-250 worktree 内约 6.2G Gradle/Robolectric 缓存、主检出约 811M Android 构建产物，以及 `work/tmp/` 下约 570M 运行日志和实验中间产物。数字只用于排序，执行时必须重新测量和确认所有者。

## Scope

仅以下已确认可再生的路径，存在活跃进程或所有者异议时跳过：

- 主检出的 `android/app/build`、`android/ui/build`、`android/highlight/build`、`android/build`、`android/build-logic/build`、`android/.gradle`、`android/.kotlin`。
- `.worktrees/integration-250/work/tmp/gradle-home` 与 `robolectric`，前提是该 worktree 仍存在且未运行相关构建。
- `work/tmp/retro-logs/`、`persona-distillation/`、`ts-build-route/`、`ts-boundary/`、`ourfairy-ts/`，前提是所有者确认不再需要这些中间结果。

## Acceptance criteria

- [ ] 执行前记录目标路径、大小、对应 worktree 的 `git status` 和相关进程；状态已变化时重新判断，不照搬盘点结论。
- [ ] 每个目标都确认为可再生产物或获所有者明确确认；活跃进程正在使用的目标保持不动。
- [ ] 删除后相关 worktree 的 tracked/untracked 状态与执行前一致，回收量以 before/after 实测报告。
- [ ] 不停止或删除他人的进程、分支、worktree、stash、研究结论和恢复材料。
- [ ] 最终 Android 全量门禁能够重新建立所需构建产物；若本票未执行，CLEAN-08 不得声称覆盖冷重建。

## Verification

使用只读状态与大小命令逐项核对；本票没有 tracked diff，不用 `npm test` 代替安全性验收。重建验证归入 CLEAN-08。

## Blocked by

无，但每个目标都有独立的运行时/所有者前置条件。

## Out of scope

明确保留 `.cleanup-logs/`、`work/tmp/repo-env/`、`.ourfairy/`、`.corepack/`、`.git/lost-found/`、所有未提交/未跟踪文件、`android/work/`、Git refs、stash 和全部 worktree 本体；不执行 `git gc`、远端删除或推送。
