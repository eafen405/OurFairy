# #239 待机台词：气泡改在 Fairy 屏幕下方向下展开

日期：2026-10-26。票面：<https://github.com/eafen405/OurFairy/issues/239>。
分支 `ticket/239-idle-caption`，worktree `.worktrees/239-idle-caption`，基线 `38278c5a27`（`main`）。
改动只涉及 Android 首页控制台及其页面测试；未改后端、数据、接口、主题 token 或其他页面。

## 问题与改法

票面说待机台词（例如「主人，我正在待机。感谢您赐予了我偷懒的机会。」）的气泡会遮挡 Fairy
本体动画，建议向下渲染扩大而非向上。

改前，`FairyCaption` 是 208dp `FairyScreen` 所在 `Box` 的 `BottomCenter` 子项。气泡以屏幕
底边为锚点，内容越长越向上长，最终盖住屏幕里的眼睛与动画；Reduced Motion 下整段一次显示，
会直接覆盖整块屏幕。

改动只有布局归属：把 `FairyCaption` 移出屏幕 `Box`，放到它之后的 `Column` 流内。气泡顶边落在
屏幕下沿，高度增长向下占据布局，Fairy 屏幕和动画不再被覆盖。`FairyCaption` 的逐段打字、停留、
点击推进、`animateContentSize` 与「Fairy」名字签都不变；没有新增状态、偏好、接口或数据。

为了让页面测试能定位，屏幕与气泡各加一个测试 tag（`fairy-console-screen`、`fairy-caption`）。

## 验证

### 红

先在未改布局的树上加用例：

```sh
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest.idle line sits below the fairy screen' \
  --offline --no-configuration-cache --console=plain
# FairyPagesTest > idle line sits below the fairy screen FAILED
# java.lang.AssertionError
# 1 test completed, 1 failed
```

用例先把 Robolectric 的 `SystemClock` 推进到首句阈值（`FIRST_LINE_MS + 1s`），触发控制台的待机计时（控制台用 `SystemClock`
计闲，Compose 测试时钟不驱动它，需用 `ShadowSystemClock.advanceBy` 推进），再取
`fairy-console-screen` 与 `fairy-caption` 的 `boundsInRoot`，断言气泡顶边不小于屏幕下沿。
改前气泡在屏幕内部，断言失败。

### 绿

改后同一用例通过；控制台门禁在提交上运行了完整客户端测试与 lint：

```sh
cd android && ./gradlew test lintDebug        # pre-commit 门禁实际调用
# BUILD SUCCESSFUL in 2m 11s，130 actionable tasks
# JUnit XML：FairyPagesTest 17 tests, 0 failures, 0 errors, 0 skipped
```

同一提交的门禁还跑了 `npm test`（340 pass / 0 fail）与 `npm run combo:verify`（三行 ok）。

合入 `main` 后又在 `4e6231461b` 上复跑同一组门禁：`npm test` 340/340、`combo:verify` ok、
Android `./gradlew test lintDebug` `BUILD SUCCESSFUL`（3m18s）。

### 截图

Robolectric `captureToImage()`，`zh-rCN-w411dp-h891dp`，经现有 `FAIRY_UI_SCREENSHOTS` 钩子输出，
两张都在 Reduced Motion（`show(reduceMotion = true)`）下渲染：

- [改前](screens/home-idle-before.png)：气泡在屏幕内部向上扩展，覆盖整块 Fairy 屏幕。
  这张是 Reduced Motion 的整段显示，遮挡范围比正常动效逐段播放时更大。
- [改后](screens/home-idle-after.png)：气泡在屏幕下沿之下，信息卡随之下移；这张 411×891 截图里唯一主操作仍在首屏。

台词由现有 `FairyUiMemory` 从 `homePool` 随机选，两张截图的句子不同，也不同于票面示例句；
票面示例句同样在 `homePool` 里，布局行为一致。两张都是 JVM/Robolectric 渲染，不是真机帧。

## 提交

- `d2ba3f6ded` `fix(#239): 待机台词改在 Fairy 屏幕下方展开`（代码、测试与门禁）
- `72bdb2fdc4` `docs(#239): 记录待机台词布局修复与前后截图`（本目录与截图）
- `4e6231461b` `Merge branch 'ticket/239-idle-caption'`（合入并推送 `main`；合入后复跑全量门禁）
- 证据索引已在 [`work/implementation/evidence/README.md`](../README.md) 的「界面微调」登记。

## 未执行

- 未连接设备或模拟器：真机观感、待机台词出现时的页面位移量、滚动与横屏都未验收。
- 未新增更大字号、横屏或待机台词下的窄屏断言；同文件现有窄屏用例随本次门禁通过，但其中没有待机台词。
- 未关闭 issue #239，留待真机/产品确认；票分支远端 `origin/ticket/239-idle-caption` 保留，本地已删除。
