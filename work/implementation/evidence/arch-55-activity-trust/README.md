# arch-55 — 客户端「快照是否可信」只答一次

提交：`a0ffa9c02e637eb36ce699db4434c3a49d5864f8`（`a0ffa9c0`），分支 `arch/55-activity-trust`，已合入 `5d8efe42`。

票：#55（OurFairy 架构收口地图 #69）
仓库：rikkahub，worktree `/home/eafen405/projects/rikkahub/.worktrees/arch-55-activity-trust`
分支：`arch/55-activity-trust`，集成分支 `product/ourfairy-v1`

## 前提核对（以当前代码为准）

票面行号在开工基线上逐条复核成立：

| 票面断言 | 核对结果 |
| --- | --- |
| `RemoteChatState.kt:76`-`:81` activity getter | 成立（`connected && !syncing && initialized && consumedThrough >= reported.throughSeq`） |
| `:225` `detach()` | 成立（`connected = false`，getter 转未知） |
| `:272`-`:275` 通知谓词 | 成立（`target >= latest.cursor && target >= activity.throughSeq`，且读未守卫的 `latest.activity`） |
| `:308` `publish` | 成立 |

结论：前提成立，非 premise-invalid。

## 改了什么

`app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt`

1. 新增 `RemoteChatSnapshot.activityEstablishedAt(committedThrough)`——**唯一的可信度规则**：projection 自身 `cursor` 与上报 run 的 `throughSeq` 都必须被该水位覆盖，否则返回 `status = 0` 的未知。
2. `activity` getter 改为只叠加「是否有绑定在观察」（`connected && initialized`），完整性判定委托给同一谓词。
3. 同步循环的通知决策改为 `observed.activityEstablishedAt(maxOf(old.consumedThrough, target))`，不再回读未守卫的 `latest.activity`，也不再自己写一遍 `target >= cursor && target >= activity.throughSeq`。
4. getter 去掉 `!syncing` 条件：`syncing` 是补页提示，不是第二条信任规则；已提交前缀在下一页抓取期间仍是既成事实。这同时消除了它与通知路径的第二处分歧。

`app/src/test/java/me/rerere/rikkahub/data/remote/RemoteActivityTrustTest.kt`（新增，4 条）钉住「两者由同一值决定」：
- 提醒发布时面板已能呈现同一活动；
- writer 屏障前两者都未建立、屏障后同一提交同时建立两者；
- 运行覆盖超出已提交水位时未知且静默；
- 提交期间 detach：快照被弃用故不发布，但消费已落盘（不重放）。

「先提交后发布」顺序未改：`update(...)` 写盘在前，`notifications.publish` 在后，崩溃窗口仍只可能漏一次声音、不会重放。

## 命令与结果

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-bin:$PATH
```

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| red（改动前实现 + 新测试，终版测试文件） | `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteActivityTrustTest'...` | FAILED，4 tests / 1 failed |
| red（初版测试文件，含 detach 断言） | 同上 | FAILED，4 tests / 2 failed |
| green（定向） | `--tests '...RemoteActivityTrustTest' --tests '...RemoteActivityStateTest' --tests '...RemoteNotificationStateTest' --tests '...RemoteNotificationWireTest' --tests '...RemoteChatStateTest'` | BUILD SUCCESSFUL |
| 验收 | `./gradlew :app:testDebugUnitTest :app:assembleDebug -Pourfairy.identityEndpoint=https://example.invalid -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain` | BUILD SUCCESSFUL；**70 套件 / 520 条 / 0 失败**，debug APK 产出 |

条数由  统计，验收前清空 `test-results` 重跑，避免读到旧产物。构成对账：基线 69 套件 / 515 条；合并进来的 #61（`f3248641`）+1 条；本票新增 `RemoteActivityTrustTest` 1 套件 / 4 条 → 70 套件 / 520 条，0 失败。

## 集成分支合并

开工基线 `771bffd1`。提交前 `product/ourfairy-v1` 已前进到 `5d8efe42`（#61 attempt row key），已 `git merge product/ourfairy-v1` 并解决（无冲突），在合并后状态复跑上述验收全量。

## 未完成 / 范围外

- 未做真机、模拟器、Firebase 或真实云服务验收；仅 JVM 测试与 debug 构建。
- 观察到的范围外事实（未改动）：
  - `RemoteChatPanel.kt:166` 仍用 `syncing` 决定「同步中」提示条，与本票无关。
  - 通知事实窗口用的是本次 checkpoint 的 `acknowledged`（`target = minOf(cursor, acknowledged)`），比 getter 用的 `consumedThrough` 保守：已提交前缀很大时，提醒可能比面板晚一拍结算。这是既有「先提交后发布」的保守方向（宁可晚、不可重放），本票未改；曾尝试钉住「committed 前缀即可结算」，因与既有事实窗口策略冲突而放弃，未纳入测试。

## 合并与验证（merger，#69 流程）

- rikkahub `product/ourfairy-v1` 合并提交：`07adb3430a23cad82197a351a961a455f74c8e2c`（`--no-ff` 合并 `arch/55-activity-trust`，无冲突）。
- 合并前集成分支 tip：`5d8efe425d4abb45ad1d1333214bd0c9a23473cc`（本票分支已包含它）。

### 复用依据（tree sha 对比）

```
$ git -C /home/eafen405/projects/rikkahub diff --quiet a0ffa9c02e637eb36ce699db4434c3a49d5864f8 07adb3430a23cad82197a351a961a455f74c8e2c
exit 0                                   # 合并后源树与实现者验收的 FINAL_SHA 完全相同
$ git rev-parse a0ffa9c02e637eb36ce699db4434c3a49d5864f8^{tree}   -> 4718a7ed78370ab6265c835e5fd0566b591b8106
$ git rev-parse 07adb3430a23cad82197a351a961a455f74c8e2c^{tree}   -> 4718a7ed78370ab6265c835e5fd0566b591b8106
```

两棵 tree sha 一致，故不重跑全量，复用实现者在同一源树上的验收证据：**70 套件 / 520 条 / 0 失败 + `:app:assembleDebug` BUILD SUCCESSFUL**。

### 合并后定向回归（主 checkout，合并后 tip `07adb343`）

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.RemoteActivityTrustTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteActivityStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteNotificationStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteNotificationWireTest' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

结果：BUILD SUCCESSFUL；按  统计 **4 套件 / 20 条 / 0 失败**（`RemoteActivityStateTest` 5、`RemoteActivityTrustTest` 4、`RemoteNotificationStateTest` 10、`RemoteNotificationWireTest` 1）。

### 未覆盖

- 未跑全量 JVM（依 tree sha 一致性复用）；未做真机/模拟器、Firebase、真实云服务或性能验收。
