# 票 #60 — 客户端「是否在前台」两套读取，且接收链路无测试

分支：`arch/60-foreground`（rikkahub worktree `.worktrees/arch-60-foreground`）
基线：`771bffd1` → 开工先 `git merge product/ourfairy-v1` 到 `07adb343` → 汇报前再合到 `fcba0647`

## 前提核对（就地复核，票面自注置信度低）

票面描述的代码在当前 tip 上**成立**：

| 票面说法 | 复核结果 |
| --- | --- |
| `AndroidRemoteNotifications.isForeground()` 按需查 `ProcessLifecycleOwner` | 成立，`service/AndroidRemoteNotifications.kt:51` |
| 发布决策读取 `isForeground()` | 成立，`data/remote/RemoteChatState.kt:323`（`notifications?.isForeground() == false`） |
| `RemoteReceiveController` 构造时缓存同一事实、由 lifecycle 回调维护 | 成立，原 `service/RemoteReceiveController.kt:28`（`private var foreground = notifications.isForeground()`）+ `:34/:38` 两处赋值 |
| 缓存值决定观察是否运行 | 成立，原 `:91`（`foreground \|\| running`） |
| 三者无测试 | 成立，`grep -rn "RemoteReceiveController\|RemoteReceiveService\|AndroidRemoteNotifications" app/src/test` 无引用 |

票面提到的接缝 `RemoteNotificationPlatform` 是**通知发布**平台（`isForeground` + `publish`），controller 并不持有它——controller 直接依赖 `AndroidRemoteNotifications` 具体类。故按票面允许的「最小改动共享同一事实来源」新增了读取侧接缝。

结论：前提成立，非 premise-invalid。

## 改动

1. **删除 controller 的第二份前台事实。** `private var foreground`、构造时读取、`onStart`/`onStop` 里的两次赋值全部删除。`reconcile()` 与账号收集回调改为**当下**问平台：`platform.isForeground()`。lifecycle 观察者只保留「什么时候重新判断」，不再发布事实。
2. **新增读取侧接缝 `data/remote/RemoteReceivePlatform`**（`enabled` / `isForeground()` / `setEnabled`），由 `AndroidRemoteNotifications` 实现。前台事实因此只有一个发布者：发布路径与接收路径问的是同一个对象、同一个 `ProcessLifecycleOwner` 读取。`RemoteNotificationPlatform`（发布）保持原样，未并入——发布与接收的消费者不同，合并会把 `publish` 塞进只需要读的 controller。
3. **抽出 `service/RemoteReceiveServiceHost`**（`start()` / `stop()`），Android 实现在 `RemoteReceiveServiceLauncher`。这是让 controller 可在 JVM 测试中驱动的**唯一**原因：原实现直接 `ContextCompat.startForegroundService(context, Intent(...))`。controller 不再持有 `Context`。
4. `di/IdentityModule.kt` 接线：注册 launcher，把 `ProcessLifecycleOwner.get().lifecycle` 作为参数注入。
5. **新增 `app/src/test/java/me/rerere/rikkahub/service/RemoteReceiveControllerTest.kt`**（4 条），用平台替身、`LifecycleRegistry` 替身、service host 替身驱动**真实的** `RemoteReceiveState` + `RemoteChatState` + `AccountSession`，断言可观察行为（观察开/关、service 启/停、状态文案），不断言私有字段。

## TDD 证据

- **Red 1（编译级）**：`red-1-compile.log` — 测试先写，接缝尚不存在：`Unresolved reference 'RemoteReceivePlatform'` + 构造参数类型全错位。
- **行为级 Red（关键）**：`red-3-cached-foreground.log` — 在 green 实现上**临时还原**「构造时缓存 + lifecycle 回调维护」的旧写法，定向测试立即失败：
  ```
  RemoteReceiveControllerTest > a decision taken between lifecycle callbacks follows the platform, not a remembered copy FAILED
  4 tests completed, 1 failed
  ```
  即：平台已答「后台」而 lifecycle 尚未回调时，缓存版不会停止观察——正是票面描述的分歧。恢复 green 实现后通过。
  （`red-2-cached-foreground.log` 是同一实验的早期版本，当时测试 2 依赖了未启动 registry 的 `ON_STOP` 不派发这一副作用，已改成显式 `screens.start()` 后重跑，见 `red-3`。）
- **Green**：`run-8.log` — `RemoteReceiveControllerTest` 4/4 通过。

## 命令与结果（均在最终合并状态 `1bfc24d5` 上复跑）

```
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.service.RemoteReceiveControllerTest*' ...
  → BUILD SUCCESSFUL；TEST-...RemoteReceiveControllerTest.xml tests=4 failures=0

./gradlew :app:testDebugUnitTest :app:assembleDebug ...
  → BUILD SUCCESSFUL
  → app/build/test-results/testDebugUnitTest/*.xml 合计 suites=71 tests=524 failures=0 errors=0 skipped=0
  → app/build/outputs/apk/debug/app-universal-debug.apk（99,398,749 B）
```

基线 69 套件 / 515 条 → 71 套件 / 524 条（新增 1 套件 4 条；另 1 套件/5 条来自期间合入的集成分支 #59）。

日志：`red-1-compile.log`、`red-2-cached-foreground.log`、`red-3-cached-foreground.log`、`run-2..8.log`、`acceptance-1.log`、`acceptance-2-merged.log`。

## 未完成项与边界（如实）

- **`RemoteReceiveService` 仍无 JVM 测试。** 它是 `android.app.Service`，`onStartCommand` 走 `ServiceCompat.startForeground` 与 `PendingIntent`，在无 Robolectric/无设备的本仓 JVM 测试里无法驱动（本仓无 Robolectric 依赖，`libs.versions.toml` 与 `app/build.gradle.kts` 均无）。按票面「不要给 service 造重型 Android 测试」，未引入 Robolectric；该类的行为（启动失败回调 `serviceStopped`、超时、`onDestroy`）仍只有代码审阅保证。若将来要覆盖，最小代价是引入 Robolectric 后驱动 `onStartCommand`。
- **`AndroidRemoteNotifications` 的发布/权限判定仍无测试**，同理依赖 `Context`、`NotificationManager`、`SharedPreferences`。本次只测了它作为「前台事实唯一读取者」在 controller 侧被消费的方式（平台替身），其自身 `isForeground()` 的 `ProcessLifecycleOwner` 读取未被 JVM 验证。
- **未做真机/模拟器/Firebase 验收**，仅 JVM 测试与 debug 构建。前台/后台切换的真实时序（尤其 `ProcessLifecycleOwner` 700ms 延迟）未在设备上观察。
- 未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。

## Merger 收录（arch-60-foreground → rikkahub `product/ourfairy-v1`）

合并提交：`189648274074846e31a3c131b96e17687578ceb9`（`Merge branch 'arch/60-foreground' into product/ourfairy-v1`，`--no-ff`，无冲突）。

**复用条件（源树相同，故不重跑全量）**：

```
$ git -C /home/eafen405/projects/rikkahub diff --quiet 1bfc24d5 189648274
  → exit 0（无差异）
$ git rev-parse 1bfc24d5^{tree}   → fee6651e4d31601d68dd87d2cd1c5f0b71e6512f
$ git rev-parse 189648274^{tree}  → fee6651e4d31601d68dd87d2cd1c5f0b71e6512f
```

合并前后 tree sha 完全相同（票分支已含集成分支 tip `fcba0647`，`git merge-base --is-ancestor fcba0647 1bfc24d5` 成立），即实现者验收的 71 套件 / 524 tests / 0 fail 与 `assembleDebug` 正是跑在这棵树上。故**复用**实现者全量证据，不重复跑全量。

**合并后定向回归（主 checkout `/home/eafen405/projects/rikkahub`）**：

```
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.service.RemoteReceiveControllerTest*' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
  → BUILD SUCCESSFUL in 27s
  → TEST-me.rerere.rikkahub.service.RemoteReceiveControllerTest.xml tests="4" skipped="0" failures="0" errors="0"
```

4 条用例名：`a decision taken between lifecycle callbacks follows the platform, not a remembered copy`、`a refused service start is reported and leaves reception stopped`、`reception starts with the account and stops when it is gone`、`observation runs while the app is in front or its service is`。

日志：`merger-targeted-regression.log`。

边界不变：未做真机/模拟器、Firebase 运行时、真实云服务验收；`RemoteReceiveService` 与 `AndroidRemoteNotifications` 自身仍无 JVM 测试（见上「未完成项与边界」）。
