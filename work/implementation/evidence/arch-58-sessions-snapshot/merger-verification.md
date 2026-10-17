# arch-58 merger verification — 会话集快照单一权威；账号发布时同步绑定 receiver

- 票：<https://github.com/eafen405/OurFairy/issues/58>（地图 #69）
- 票分支：`arch/58-sessions-snapshot`（worktree `/home/eafen405/projects/rikkahub/.worktrees/arch-58-sessions-snapshot`）
- 实现者 FINAL_SHA：`6af8c3c8eca1d981d7ec40df470e483d61877798`（`git log --oneline -3` 核对：`6af8c3c8` merge `6f6cf7ff` + `5616d7f4` 实现提交）
- 集成分支合并前 tip：`6f6cf7ff17e663733633e425163b95ccf07587d3`（#63 合并；票分支已包含：`git merge-base --is-ancestor 6f6cf7ff 6af8c3c8` → 0）
- 合并提交：`81f1b06bf7df8889100e7abb377759bb415e906b`（`Merge branch 'arch/58-sessions-snapshot' into product/ourfairy-v1`，`--no-ff`，无冲突；父提交 `6f6cf7ff` + `6af8c3c8`）
- merger 未改动任何实现代码。

## 复用实现者全量证据的依据

- `git -C /home/eafen405/projects/rikkahub diff --quiet 6af8c3c8 81f1b06b` → **exit 0**（无差异）。
- 合并树 sha：`51b3f1a03e4a98bd839fde15e902f89d2e09dffc`；FINAL_SHA 树 sha：`51b3f1a03e4a98bd839fde15e902f89d2e09dffc`，**完全相同**（`git rev-parse <sha>^{tree}`）。
- 因此合并后源树就是实现者验收过的同一棵树：复用其全量验收 **72 套件 / 530 tests，failures 0 / errors 0 / skipped 0** + `:app:assembleDebug`（`acceptance-1.log`、`acceptance-2-merged.log`、`suite-counts.tsv`），不重跑全量；按 MERGER.md 要求在主 checkout 合并后状态下另跑定向回归。

## 合并后定向回归（主 checkout `/home/eafen405/projects/rikkahub`，HEAD = `81f1b06b`）

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/home/eafen405/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.*' \
  --tests 'me.rerere.rikkahub.service.*' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteNotificationNavigationTest' \
  --tests 'me.rerere.rikkahub.ui.identity.IdentityNavigationTest' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

- `merger-targeted.log`：`BUILD SUCCESSFUL in 28s`，exit 0。
- 从 `app/build/test-results/testDebugUnitTest/*.xml` 统计：**28 套件 / 202 条，failures 0 / errors 0 / skipped 0**。
- 含本票直接涉及的 8 个测试类：`AccountSessionTest` 8、`RemoteReceiveStateTest` 5、`RemoteReceiveControllerTest` 6、`RemoteNotificationBacklogTest` 3、`RemoteNotificationStateTest` 10、`RemoteActivityTrustTest` 4、`RemoteNotificationNavigationTest` 3、`IdentityNavigationTest` 5；其余为 `data.remote.*` / `service.*` 同包基线套件。合并后整套 `data.remote.*`（20 套件 / 136 条）+ `service.*`（6 套件 / 57 条）+ 两个 identity 导航套件全绿。

## 范围与未完成项

- 改动 8 个文件（+119/−29）：6 个生产文件（`AccountSession`、`OwnedSessionState`、`RemoteReceiveState`、`IdentityModule`、`RemoteReceiveController`、`IdentitySessionsPage`）+ 2 个测试文件；净删除 `mutableSessions`、`isBoundTo`、页面守卫、controller 两处 `receiver.bind`，未新增状态类或文件。
- 合并冲突：无。
- 实现者如实记录的测试边界保留：**Koin `IdentityModule` 接线与页面守卫删除没有 JVM 测试基建，属编译级 + 模块级保证**（仓库无 Koin/Compose JVM 测试；行为测试用与模块同形的 `receiver::bindIdentity` 接线，接线漂移风险在「模块改回 lambda 绑定字段」一处）。页面只读 `state.sessions`，不再含账号谓词，由编译级验证兜底。
- 未做真机/模拟器、Firebase 运行时、真实云服务与性能验收（与实现者声明一致）。
- 未完成项：无（本票范围内）。
