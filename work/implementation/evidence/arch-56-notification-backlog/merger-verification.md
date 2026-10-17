# arch-56 merger verification — 跨会话通知积压合并为一次发布

- 票：<https://github.com/eafen405/OurFairy/issues/56>（地图 #69）
- 票分支：`arch/56-notification-backlog`（worktree `/home/eafen405/projects/rikkahub/.worktrees/arch-56-notification-backlog`）
- 实现者 FINAL_SHA：`aff55b75688199ec1fe3515a3c0150f2df209bab`（`git log --oneline -3` 核对一致）
- 集成分支合并前 tip：`189648274074846e31a3c131b96e17687578ceb9`（工作树已包含，`merge-integration.log` = `Already up to date.`）
- 合并提交：`a0c03bc413e9e8f1451fba7ced924b958c342849`（`Merge branch 'arch/56-notification-backlog' into product/ourfairy-v1`，`--no-ff`，无冲突，merger 未改动任何实现代码）

## 复用实现者全量证据的依据

- `git -C /home/eafen405/projects/rikkahub diff --quiet aff55b75 a0c03bc4` → **exit 0**（无差异）。
- 合并树 sha：`3c0e7cad4fab6b32c35c33481712ee5632daacf5`；FINAL_SHA 树 sha：`3c0e7cad4fab6b32c35c33481712ee5632daacf5`，**完全相同**。
- 因此合并后源树就是实现者验收过的同一棵树：复用其全量验收 **72 套件 / 527 tests，failures 0 / errors 0 / skipped 0** + `:app:assembleDebug`（`acceptance-full.log`、`suite-counts.tsv`），不重跑全量；按 MERGER.md 要求在主 checkout 合并后状态下另跑定向回归。

## 合并后定向回归（主 checkout `/home/eafen405/projects/rikkahub`，HEAD = `a0c03bc4`）

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/home/eafen405/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.RemoteNotification*' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteActivityTrustTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteReceiveStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteReceiveControllerTest*' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

- `merger-targeted-regression.log`：`BUILD SUCCESSFUL in 34s`，exit 0。
- 从 `app/build/test-results/testDebugUnitTest/*.xml` 统计：**5 套件 / 22 条，failures 0 / errors 0 / skipped 0**
  （`RemoteNotificationBacklogTest` 3、`RemoteNotificationStateTest` 10、`RemoteNotificationWireTest` 1、`RemoteActivityTrustTest` 4、`RemoteReceiveStateTest` 4）。
- 说明：`RemoteReceiveControllerTest` 实际位于 `me.rerere.rikkahub.service`（本票改了它），上述 `data.remote` 前缀过滤匹配 0 条，故单独补跑：

```bash
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.service.RemoteReceiveControllerTest' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

- `merger-targeted-controller.log`：`BUILD SUCCESSFUL in 8s`，exit 0，**1 套件 / 4 条，failures 0**。
- 定向合计：**26 条，0 失败**，与实现者 `targeted-3.log` 的 26 条一致。

## 范围与未完成项

- 合并冲突：无。实现代码：merger 未改动。
- 未做真机/模拟器、Firebase 运行时、真实云服务与性能验收（与实现者声明一致）。
- 范围外发现（实现者 README 记录，未改）：「`RemoteChatState` 的 `before`/`cut` 是跨会话共享字段，多会话绑定时互相覆盖；现有测试用每会话独立 `fromSeq=0` 投影规避」。merger 复核：`before`/`cut` 是 `RemoteChatState` 实例字段，当前生产路径 `RemoteReceiveState` 为每个会话各建一个实例，未找到多会话共用同一实例的路径；该发现建议另立票核实后再定性，本票不处理。
- 未完成项：无（本票范围内）。
