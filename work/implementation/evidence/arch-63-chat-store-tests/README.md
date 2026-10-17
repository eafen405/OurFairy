# #63 Android 测试走 ChatSyncStore interface 并收敛覆盖事件 fixture

- 票：https://github.com/eafen405/OurFairy/issues/63
- 仓库：`/home/eafen405/projects/rikkahub`（worktree `.worktrees/arch-63-chat-store-tests`）
- 分支：`arch/63-chat-store-tests`
- 集成基线：`product/ourfairy-v1` = `a0c03bc4`（#56 之后）
- 提交：`531fcb15 test(remote): observe sync state through ChatSyncStore and share event fixtures`
- FINAL_SHA：`531fcb15`（`git merge product/ourfairy-v1` → `Already up to date.`）

## 改了什么

只改测试（9 个文件，+122/−115，无生产代码、无新测试条数）：

1. **持久状态经 interface 观察**
   - `RemoteNotificationStateTest`：原先 9+ 处 `store.records[key]?.notificationThrough` / `notificationEpisodeId` / `notificationOwed` 断言改为 `store.load(key)`；写入/清空改由替身的 `seed`/`forget` 完成，测试不再触碰私有 map。
   - `platform.before` 的顺序断言（「先提交后尝试」）改为在发布时刻用 `runBlocking { store.load(key) }` 读回持久记录并在测试内断言，不再把规则写进替身。
   - 同类持久断言一并改走 `load`：`RemoteChatRecoveryTest`（pending）、`RemoteNotificationBacklogTest`（notificationOwed）、`RemoteActivityTrustTest`（notificationThrough）。
   - 通知测试的 `Store.load` 保持真实 `AndroidChatSyncStore` 语义：缺失键返回 `ChatSyncRecord()`，`save` 失败则不写入。

2. **共享 fixture，连续性规则只述一次**
   - 新增 `app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatFixtures.kt`（与投影类型同包）：
     - `remoteEvent(seq)`
     - `eventCoverage(from, through)`：`[from, through]` 每序号一个事件的唯一实现
     - `deliveryProjection(seq, version)`：通知投递 fixture
   - `RemoteNotificationStateTest` / `RemoteChatRecoveryTest` / `RemoteChatStateTest` 三处手工覆盖 builder 删除，改用 `eventCoverage`；顺带清掉 `RemoteNotificationBacklogTest`、`RemoteReceiveStateTest`、`RemoteActivityStateTest`、`RemoteAttachmentStateTest`、`RemoteActivityTrustTest` 对「某个测试类 companion builder」的跨类引用，全部指向共享 helper。
   - 事件 JSON 不再带无消费者的 `payload` 字段（仍保持每个 seq 一个事件；测试未读取 payload）。

3. **第三条建议的评估（未做生产改造）**
   - 生产侧新增「受校验投影入口」需要给测试新增生产 API，而生产代码只消费后端投影、不构造它；消费者只有测试，违反「新增接口须写明消费者 / 不为测试造机制」，故不做。
   - 取其低成本一半：fixture 工厂放在投影类型同包的测试 helper 中，连续性规则只在 `eventCoverage` 陈述一次。

## 命令与结果

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/home/eafen405/ourfairy-bin:$PATH

# 基线（改动前，remote 包）
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
# BUILD SUCCESSFUL in 1m 52s

# 验收（全量 JVM + debug 构建）
./gradlew :app:testDebugUnitTest :app:assembleDebug \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
# BUILD SUCCESSFUL；按 app/build/test-results/testDebugUnitTest/*.xml 统计
# suites=72 tests=527 failures=0 errors=0 skipped=0

# 提交后、确认集成分支已包含后强跑一次（cleanTest 后真执行）
./gradlew :app:cleanTestDebugUnitTest :app:testDebugUnitTest :app:assembleDebug \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
# BUILD SUCCESSFUL in 20s；suites=72 tests=527 failures=0
```

## red / green 证据（日志同目录）

- `red-probe-old-assertions-green.log`：临时让替身 `load` 返回「bind 时的旧记录」（接口说谎），旧断言仍绿 —— 证明旧断言根本不经过 `ChatSyncStore`。
- `red-new-assertions-fail.log`：同一说谎替身下，改为 `store.load` 的断言失败（`RemoteNotificationStateTest.kt:109`，1 failed）—— 新断言能捕捉接口/持久状态不一致。
- `green-new-assertions-pass.log` / `green-notification-store-interface.log`：恢复 `load` 真实语义后通过。
- `targeted-after-refactor.log`：9 个受影响测试类全部通过。
- `full-acceptance.log`、`full-acceptance-final-rerun.log`：全量 72 套件 / 527 条 + `assembleDebug` 通过。

## 未做 / 未声称

- 无生产行为变更，无新增/删除测试条数（527 与基线一致），断言语义未弱化。
- 未做真机/模拟器、Firebase、真实云服务验收。
- `RemoteNotificationWireTest`（真实 SSE 重放）未改，作为高 leverage 测试保留。
