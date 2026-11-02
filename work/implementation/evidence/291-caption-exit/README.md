# #291 主页待机对话框消失时的平移

日期：2026-11-01。票面：[OurFairy#291](https://github.com/eafen405/OurFairy/issues/291)
（标题含既有错别字「待机对话对话框」，评论只要求改名，未改票面，实现按行为）。

worktree `.worktrees/291-caption-exit`，分支 `ticket/291-caption-exit`。开工基线 `347c966ed4`
（= `integration/fixes-290-291-292` tip）；提交前合并 integration 新 tip `a10711ec8d`
（#293 门禁修复：`tests/precommit.test.mjs` 与证据，与本票文件无重叠，fast-forward 无冲突）。

## 结论与范围

- 待机对话框（`FairyCaption`）的出现与消失改走新接缝 `FairyCaptionSlot`
  （`android/.../ui/fairy/FairyCaption.kt`，`internal`）：`AnimatedVisibility` +
  `expandVertically`/`shrinkVertically` + `fadeIn`/`fadeOut`，`tween(FAIRY_CAPTION_TRANSITION_MS,
  FastOutSlowInEasing)`，时长常量 `internal const val FAIRY_CAPTION_TRANSITION_MS = 250`。
  收缩/展开的是容器高度，下方 `ConsoleInfoCard` 与按钮因此逐帧移动，不再瞬移归位。
- 最后一句在退场动画期间保持组合：slot 记住最近一个非空台词（`lastLine`），显示 `line ?: lastLine`；
  动画结束才移除，面板不会在消失前先变空。出现方向同样用 `expandVertically`，与既有窗口/对话面板
  的时长区间和曲线一致。
- `onFinished` 仍是同一路由：`FairyCaption` 播完即回调，控制台页照旧 `fairy.captionFinished()`；
  模块在台词结束时把 `caption` 置空，slot 不延迟模块状态，不会产生第二句或重播。
- Reduced Motion：`LocalAgoraMotionPolicy.current.allowSpatialTransitions` 为 false 时 enter/exit
  都是 `EnterTransition.None`/`ExitTransition.None`，插入与移除都在一帧内完成，与
  `FairyConversationSurface` 的 `snap()` 语义一致。
- 只改 `FairyCaption.kt`（新增常量与 slot；`FairyCaption` 本身未改）与 `FairyConsolePage.kt`
  （`caption?.let { FairyCaption(...) }` 换成 slot 调用，`fairy.captionFinished()` 路由不变）。
  `FairyInteraction.kt` 的打字、分段、停留、点击与选句规则未动。
- 未改 `FairyPagesTest.kt`（#290 所有）；新测试单独成文件
  `android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyCaptionAnimationTest.kt`。
  `fairy-caption` 标签仍落在对话框面板本身（不是动画容器），页面用例读取的面板 bounds 语义不变。
- 无数据库、wire、manifest 与依赖变更。真机动画未执行（见末节）。

## 测试接缝与 TDD red → green

接缝就是 slot：测试内容为 `FairyCaptionSlot(line = …)` + 其下方一个固定高度 marker `Box`，
断言 marker 的 `boundsInRoot.top`（信息卡/按钮的位置）与 `fairy-caption` 节点。控制台页挂载的
正是同一个 slot、同样的顺序与同一个标签；没有复制 `FairyPagesTest` 的
`AccountSession`/`RemoteReceiveState`/`RemoteChatState` 重夹具，因此没有加页面级集成断言——
页面与 slot 之间只差一层直连调用，动画、保留最后一句与 Reduced Motion 都由 slot 用例覆盖。

测试时钟实测（`mainClock.autoAdvance = false`）：每次 `advanceTimeBy` 只发一帧；测试线程写入
`mutableStateOf` 后要下一帧才进入组合。所以两个用例都先推两帧到过渡的第 0 帧，再按时间采样
（出现/消失各在 100ms 处取中间值，Reduced Motion 在 50ms 处断言已完成）。

- red 1（接缝还不存在，编译失败）：

  ```sh
  cd android
  ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
    --tests "me.rerere.rikkahub.ui.fairy.FairyCaptionAnimationTest"
  ```

  `> Task :app:compileDebugUnitTestKotlin FAILED`，`Unresolved reference 'FairyCaptionSlot'`、
  `Unresolved reference 'FAIRY_CAPTION_TRANSITION_MS'`，`BUILD FAILED in 6s`。

- red 2（接缝先按改动前行为实现：插入/删除都瞬时，页面行为等价于原 `caption?.let`）：

  ```
  FairyCaptionAnimationTest > the caption grows and shrinks over frames and the content below follows FAILED
      java.lang.AssertionError: 待机对话框出现时下方内容应逐帧下移: base=0.0 arriving=64.0 extended=64.0
  2 tests completed, 1 failed
  ```

  即 64px 面板在写入后第一帧就整块出现；同一次运行的 Reduced Motion 用例通过（改动前后都应是
  瞬时，作守卫用）。这条 red 就是票面描述的「直接瞬间出现/删除」。

- green（`AnimatedVisibility` + 保留最后一句 + 控制台页改挂 slot）：

  ```
  BUILD SUCCESSFUL in 10s
  <testsuite name="...FairyCaptionAnimationTest" tests="2" skipped="0" failures="0" errors="0">
  ```

  用例断言：出现时 marker 在 100ms 处严格位于 `base` 与 `extended` 之间且 `extended > base + 20px`；
  消失时 100ms 处 `leaving` 严格位于 `extended` 与 `base` 之间，且此时 `fairy-caption` 与最后一句
  文字仍存在；动画结束后 marker 回到 `base`（±0.5px）、面板移除；Reduced Motion 下 50ms 处已等于
  最终高度/原位。

- 合并 `a10711ec8d` 后复跑同一命令：`BUILD SUCCESSFUL in 12s`，`tests="2" failures="0"`。

- Fairy 包全量（同一次 `:app:testDebugUnitTest --tests "me.rerere.rikkahub.ui.fairy.*"`）：
  135 tests / 0 failures / 0 errors，含 `FairyPagesTest` 53 个（未改动）。

- app 全量 `./gradlew :app:testDebugUnitTest`：64 suites / 542 tests / 0 failures / 0 errors /
  0 skipped，`BUILD SUCCESSFUL in 38s`。

- Android 全量门禁 `./gradlew test lintDebug`（`ANDROID_HOME=/home/eafen405/Android/Sdk`）：
  `BUILD SUCCESSFUL`；JUnit XML 合计 app 542 + ui 20 + highlight 52 = 614 tests，0 failures；
  `lintDebug` 通过（新增文件无告警）。`npm run combo:verify`：三行 ok
  （ourfairy `main`/`a10711ec8d1fac8c`、dsh `d80522d276dd5a83`、android source `460109d1b89b824a`）。

- `npm test` 本机两次实跑分别 6 个与 2 个失败：失败栈都是真实后端启动/probe 的
  `spawnSync /usr/bin/node ETIMEDOUT` 与 profile 安装时 `corepack pnpm@11.28.5` 取包超时
  （300s 的 bundle/probe 用例、维护设置用例 11s、identity-http 的启动钩子），与本票 Android
  改动无关；同失败形态在本仓库既有证据中已记录（#257 review：`npm test` 因 profile 安装取包超时
  未取绿，`main` 上同样复现）。本票改动位于 `android/`，提交门禁会重跑 `npm test`，最终门禁结果
  以提交时的钩子输出为准（交付报告记录）。
- 合并进来的 `a10711ec8d` 只动 `tests/precommit.test.mjs` 与证据，Android 源码树与上面各次
  Android 门禁的输入相同；只有本文件与三条改动路径进入提交。

## 未执行

- 真机动画验收：未在真机上观察 250ms 的出现/消失、信息卡与按钮的跟随，以及 Reduced Motion
  开关下的瞬时表现。本文件的逐帧结论来自 Robolectric + Compose test clock，是替身证据。
- 控制台页级集成断言：如上，未复制 `FairyPagesTest` 的重夹具；页面与 slot 的接线由代码直连与
  既有 `FairyPagesTest` 的 `fairy-caption` 位置用例覆盖（该文件属 #290，未改）。
