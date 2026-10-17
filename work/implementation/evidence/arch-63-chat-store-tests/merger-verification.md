# arch-63 merger verification — 测试改走 ChatSyncStore interface 并收敛覆盖事件 fixture

- 票：<https://github.com/eafen405/OurFairy/issues/63>（地图 #69）
- 票分支：`arch/63-chat-store-tests`（worktree `/home/eafen405/projects/rikkahub/.worktrees/arch-63-chat-store-tests`）
- 实现者 FINAL_SHA：`531fcb15da5ac10f807870b0677dbea565a3c398`（`git log --oneline -3` 核对一致）
- 集成分支合并前 tip：`a0c03bc413e9e8f1451fba7ced924b958c342849`（票分支已包含：`git merge-base --is-ancestor a0c03bc4 531fcb15` → 0）
- 合并提交：`6f6cf7ff17e663733633e425163b95ccf07587d3`（`Merge branch 'arch/63-chat-store-tests' into product/ourfairy-v1`，`--no-ff`，无冲突，merger 未改动任何实现代码）

## 复用实现者全量证据的依据

- `git -C /home/eafen405/projects/rikkahub diff --quiet 531fcb15 6f6cf7ff` → **exit 0**（无差异）。
- 合并树 sha：`474fd544cd546f1f26aa039dba0f8eaa3a9587b5`；FINAL_SHA 树 sha：`474fd544cd546f1f26aa039dba0f8eaa3a9587b5`，**完全相同**。
- 因此合并后源树就是实现者验收过的同一棵树：复用其全量验收 **72 套件 / 527 tests，failures 0 / errors 0 / skipped 0** + `:app:assembleDebug`（`full-acceptance.log`、`full-acceptance-final.log`、`full-acceptance-final-rerun.log`），不重跑全量；按 MERGER.md 要求在主 checkout 合并后状态下另跑定向回归。

## 合并后定向回归（主 checkout `/home/eafen405/projects/rikkahub`，HEAD = `6f6cf7ff`）

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/home/eafen405/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.*' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

- `merger-targeted-regression.log`：`BUILD SUCCESSFUL in 47s`，exit 0。
- 从 `app/build/test-results/testDebugUnitTest/*.xml` 统计：**20 套件 / 136 条，failures 0 / errors 0 / skipped 0**。
- 含本票直接涉及的 9 个测试类：`RemoteNotificationStateTest` 10、`RemoteChatRecoveryTest` 14、`RemoteChatStateTest` 9、`RemoteNotificationBacklogTest` 3、`RemoteReceiveStateTest` 4、`RemoteActivityStateTest` 5、`RemoteAttachmentStateTest` 6、`RemoteActivityTrustTest` 4、`RemoteNotificationWireTest` 1；其余为同包基线套件。

## 范围与未完成项

- 本票只改测试：9 个文件（+122/−115），新增测试 helper `RemoteChatFixtures.kt`；无生产代码改动、无测试条数变化（527 与基线一致）。
- 合并冲突：无。实现代码：merger 未改动。
- 实现者记录的 red 证据（`red-probe-old-assertions-green.log` / `red-new-assertions-fail.log`）如实保留：让替身 `load` 返回 bind 时旧记录（接口说谎）时，旧断言仍绿，证明旧断言不经过 `ChatSyncStore`；同一说谎替身下改为 `store.load` 的断言失败（1 failed），恢复真实语义后通过。
- 实现者评估「第三条生产接口建议」后不做（仅测试会消费，违反「新增接口须写明消费者」），取其低成本一半：fixture 工厂放在投影类型同包 helper，连续性规则只在 `eventCoverage` 陈述一次；merger 复核该取舍与票面「不得为测试造机制」一致，未改。
- 未做真机/模拟器、Firebase 运行时、真实云服务与性能验收（与实现者声明一致）。
- 未完成项：无（本票范围内）。
