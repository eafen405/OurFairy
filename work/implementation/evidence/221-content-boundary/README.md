# #221 Fairy 窗口展开时的动态内容边界

日期：2026-10-25。票面见 [221-content-boundary.md](../../../tickets/221-content-boundary.md)。
worktree `.worktrees/221-content-boundary`，分支 `ticket/221-content-boundary`；开工时先合并
`integration/fixes-219-221`，基线从 `db489e07ac` 前进到 `08566185fe`。收口时该集成分支未再前进。

## 结论与范围

- 内容区上边界不再固定为 60dp：眼屏打开时增加 176dp（12dp 顶 + 140dp 屏 + 24dp 底），
  与顶栏覆盖层同步让位；收起回到 60dp。
- `screenOpen` 只有一份来源：`rememberFairyResponding` 提为 internal，新增
  `rememberFairyScreenOpen(window) = window.expanded || rememberFairyResponding(window.awaitingReply)`。
  会话页显式传入；`FairyWindowTopBar` 的可选参数默认仍调用同一函数，`GatewayPage` 不传时行为不变。
- 内容 inset 只在私有 `FairyConversationSurface` 内用 `animateDpAsState` 读取，页面主体不读动画值；
  `AnimatedVisibility`、渐变、`FairyScreen`/HUD 绘制与动画参数未改。
- 只改 [FairyWindowBar.kt](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyWindowBar.kt)
  与 [FairyConversationPage.kt](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt)。
  未改 `RemoteTranscript` 的 LazyColumn/contentPadding、消息投影、发送、阅读位置与空态/失败态文案。
- 内容 inset 与眼屏使用相同的 `tween(350, FastOutSlowInEasing)`；Reduced Motion 下内容用 `snap()`，
  对应顶栏的 `EnterTransition.None`。中间帧一致性未做自动化断言（见未执行项）。

## TDD red-green

测试接缝仍是既有 `FairyPagesTest` 的 Compose／Robolectric 页面边界，使用真实 `AccountSession`、
`RemoteReceiveState` 与测试后端；没有新增截图框架、golden 或私有组件结构断言。

- 先改 [FairyPagesTest.kt](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt)：
  `conversation observes thinking changes without moving the composer` 在思考时断言输入区 top 不变、
  `conversation-messages` bottom 不变、top 下移 176dp，并断言第一条消息 top 不低于展开眼屏下沿；
  收起后（推进 1000ms，覆盖 500ms 宽限）视口恢复原值。
- 新增空会话用例：projection 无消息、`expanded` 打开眼屏时，“此会话还没有消息。” top ≥ 236dp
  （60dp 条 + 176dp 眼屏，按 density 转 px）。
- red：`FairyPagesTest.kt:333`，`expected:<176.0> but was:<0.0>`；13 个用例 1 失败。
  空会话提示在列表内垂直居中，改动前其 top 已高于 236dp，所以该用例是最终位置的下界守卫，
  不是本次 red 的驱动；176dp 让位由思考用例驱动。
- green：同一命令 13/13 通过，0 失败；JUnit XML 为 `tests=13 failures=0 errors=0`。

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest"
```

## 提交

- `567214226c` test(#221): 断言思考时正文顶部随眼屏让位 176dp
- `bec075ccb5` feat(#221): 内容边界随 Fairy 眼屏展开让位
- 本证据 README 随后单独提交。

## Android 门禁

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:lintDebug
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:assembleDebug
```

- `:app:lintDebug`：`BUILD SUCCESSFUL`（2m22s）。
- `:app:assembleDebug`：`BUILD SUCCESSFUL`（20s），debug APK 完成打包。

两个代码提交的 pre-commit 钩子各跑了一次仓库门禁：`npm test` 306/306 通过，
`npm run combo:verify` 为 `combo: combination verified`。

## 未执行项与风险

- 未连接 Android 物理设备，未做真机视觉验收；未对眼屏/HUD 动画帧做逐帧对比或截图人工审查。
  以上是 Robolectric 行为断言、lint 与构建证据，不写成真机结论。
- 测试全部在 Reduced Motion 下运行，只覆盖最终 inset；350ms 过渡期间的“眼屏下沿 = 内容顶”
  没有自动化中间帧断言。
- 小屏 + 键盘：176dp 让位叠加 `imePadding()` 可能把 `RemoteTranscript` 压得很小。
  这是已知体验风险，未在设备上验证；若不可接受，按票面约定另议（如键盘可见时暂不展开眼屏），
  不回退固定 60dp。
