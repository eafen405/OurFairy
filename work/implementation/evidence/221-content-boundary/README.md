# #221 Fairy 窗口展开时的动态内容边界

日期：2026-10-25。票面见 [221-content-boundary.md](../../../tickets/221-content-boundary.md)。
worktree `.worktrees/221-content-boundary`，分支 `ticket/221-content-boundary`；开工时先合并
`integration/fixes-219-221`，基线从 `db489e07ac` 前进到 `08566185fe`。收口复跑与最终门禁见
[219-221-closeout](../219-221-closeout/README.md)。

## 结论与范围

- 内容区上边界不再固定为 60dp：眼屏打开时增加 `FairyScreenOpenHeight`（12dp 顶 + 140dp 屏 +
  24dp 底 = 176dp），与顶栏覆盖层同步让位；收起回到 60dp。`FairyWindowBar.kt` 中三个只在本文件
  使用的几何常量收窄为 `private`；`FairyWindowBarHeight` 与 `FairyScreenOpenHeight` 保持
  `internal`，供会话页与测试读取。
- 打开/收起时长收为共享常量 `FAIRY_SCREEN_TRANSITION_MS = 350`（`internal const val`）：顶栏的
  `windowSpec`/`fadeSpec` 与内容 inset 的 `animateDpAsState` 读同一值，不再各写一个 350。
- `screenOpen` 只有一份来源：`rememberFairyResponding` 提为 internal，新增
  `rememberFairyScreenOpen(window) = window.expanded || rememberFairyResponding(window.awaitingReply)`。
  会话页显式传入；`FairyWindowTopBar` 的可选参数默认仍调用同一函数。`GatewayPage` 仍走可选参数的
  默认值；本票未为它加页面测试。
- 展开的眼屏块带测试接缝 `Modifier.testTag("fairy-screen-overlay")`（与 `conversation-messages`
  同风格）。标签落在展开块的 `AnimatedVisibility` 容器上，`boundsInRoot` 因此在过渡期间跟随真实
  高度，而不是固定为完全展开后的高度；渐变与 `FairyScreen`/HUD 绘制未改。
- 内容 inset 只在私有 `FairyConversationSurface` 内用 `animateDpAsState` 读取，页面主体不读动画值；
  `AnimatedVisibility`、渐变、`FairyScreen`/HUD 绘制、动画曲线（`FastOutSlowInEasing`）与时长均未改。
- 只改 [FairyWindowBar.kt](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyWindowBar.kt)
  与 [FairyConversationPage.kt](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt)。
  未改 `RemoteTranscript` 的 LazyColumn/contentPadding、消息投影、发送、阅读位置与空态/失败态文案。

## TDD red-green

测试接缝仍是既有 `FairyPagesTest` 的 Compose／Robolectric 页面边界，使用真实 `AccountSession`、
`RemoteReceiveState` 与测试后端；没有新增截图框架、golden 或私有组件结构断言。

- 思考中用例：断言输入区 top 不变、`conversation-messages` bottom 不变、视口 top 下移
  `FairyScreenOpenHeight`，并以 `fairy-screen-overlay` 的 `boundsInRoot.bottom` 为下界断言第一条
  消息 top 不低于它（不再用 176dp 字面量推算）。
- 空会话用例：同样以 `fairy-screen-overlay` 的 bottom 断言“此会话还没有消息。”的 top（替换
  字面 236dp）。
- 新增过渡期用例 `content stays below the eye screen while it opens`：`show(reduceMotion = false)`
  让 `ProvideAgoraMotionPolicy(appReduceMotion = false)` 生效，并在用例内断言解析出的
  `LocalAgoraMotionPolicy` 确实允许空间动效；`mainClock.autoAdvance = false`，进入思考后每 16ms
  推进一帧、共 25 帧（400ms），每帧断言第一条消息 top ≥ overlay.bottom − 1dp；另断言至少采到
  一帧中间高度、结束时高度等于 `FairyScreenOpenHeight`（±1px）。Robolectric 实测采到 24 帧，
  眼屏高度逐帧为 `0/0/1/4/9/19/…/174/175/176/176dp`，未出现中间帧失败，故保留该用例。
- red：`FairyPagesTest.kt:333`，`expected:<176.0> but was:<0.0>`；13 个用例 1 失败。
  空会话提示在列表内垂直居中，改动前其 top 已高于 236dp，所以该用例是最终位置的下界守卫，
  不是本次 red 的驱动；176dp 让位由思考用例驱动。
- green：同一命令 13/13 通过，0 失败；JUnit XML 为 `tests=13 failures=0 errors=0`。收口时同一
  命令 16/16（含过渡期用例与 #220 的页面用例），JUnit XML 为 `tests=16 failures=0 errors=0`。

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest"
```

## 提交

- `567214226c` test(#221): 断言思考时正文顶部随眼屏让位 176dp
- `bec075ccb5` feat(#221): 内容边界随 Fairy 眼屏展开让位
- 收口补强（与 #219/#220 收口同一提交）：共享 `FAIRY_SCREEN_TRANSITION_MS`、overlay 测试接缝、
  以真实边界与逐帧推进替代 176dp/236dp 字面量；提交 SHA 见
  [219-221-closeout](../219-221-closeout/README.md)。

## Android 门禁

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:lintDebug
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:assembleDebug
```

- `:app:lintDebug`：`BUILD SUCCESSFUL`（2m22s）。
- `:app:assembleDebug`：`BUILD SUCCESSFUL`（20s），debug APK 完成打包。

两个代码提交的 pre-commit 钩子各跑了一次仓库门禁：`npm test` 306/306 通过，
`npm run combo:verify` 为 `combo: combination verified`。收口时在同一分支重跑
`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`，结果见 closeout 证据。

## 未执行项与风险

- 未连接 Android 物理设备，未做真机视觉验收；未对眼屏/HUD 动画帧做真机逐帧对比或截图人工审查。
  以上是 Robolectric 行为断言、lint 与构建证据，不写成真机结论。
- 过渡期一致性现在由上面的逐帧用例覆盖：它断言的是布局几何关系（第一条消息 top 不低于眼屏
  下界），不是像素级渲染或渐变 alpha 的对比；也没有在真机上逐帧验证。
- 小屏 + 键盘：176dp 让位叠加 `imePadding()` 可能把 `RemoteTranscript` 压得很小。
  这是已知体验风险，未在设备上验证；若不可接受，按票面约定另议（如键盘可见时暂不展开眼屏），
  不回退固定 60dp。
