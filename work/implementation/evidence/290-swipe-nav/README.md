# #290 主页与会话页左右划切换、会话页入口收敛与会话列表文案

票：[#290 客户端交互优化](https://github.com/eafen405/OurFairy/issues/290)（含 2026-11-01 的评论）。
分支：`ticket/290-swipe-home`，worktree `/home/eafen405/projects/OurFairy/.worktrees/290-swipe-home`。
开工基线：`integration/fixes-290-291-292` @ `347c966ed423502583bb3c8ac8f980965f4a1f26`（与本分支 HEAD 相同，祖先检查通过）。
提交前集成分支前进到 `a10711ec8d1fac8c1b4a11c190402e15b8d3e2b6`（#293 门禁自检修复），已
fast-forward 合入本分支；合入后重跑下列定向测试仍全绿。合并只改 `tests/precommit.test.mjs` 与
`work/implementation/evidence/293-precommit-merge-index/`，未触碰本票代码。
本目录随票的代码提交一起提交；提交 SHA 用 `git -C <worktree> log -1` 读取，不在此处复写。

## 改了什么

### A. 左右划切页

- 新增 `android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairySwipeNavigation.kt`：
  一个共享的 `Modifier.fairySwipeNavigation(enabled, onSwipeLeft, onSwipeRight)`。
  - 不做拖动中的页面位移：目标页由 host 推入，预先平移的页面在 NavDisplay 过渡开始时才跳；手势在手指横向走过
    72 dp 或快速甩过 400 dp/s 后才提交，随后交给现有的页面过渡。
  - 手势挂在页面外层 Box（可滚动内容之外）；事件在 Initial pass 观察，但只有在横向方向已提交后才消费，垂直滚动、
    点击与按下的控件先拿到未消费的事件；垂直方向先过 touch slop 时直接退出观察。横向 slop 在长按超时之后才越过
    的手势被忽略且不消费——那是文本选择的开始，不是翻页。
  - `FairyPageHost` 的 Final pass 视线观察未改；它对消费不敏感，滑动时眼睛仍跟随手指。
- `FairyConsolePage`：左划复用「进入会话」的同一个目标（`enterConversation`：当前会话，或没有当前会话时打开共享列表）。
- `FairyConversationPage`：右划调用页面自己的 `onBack`（reset 到 Home）。
- 两页都用 `!overlay.isOpen` 作为 `enabled`，共享会话列表打开时手势不参与。

### B. 会话页顶栏

- `FairyWindowTopBar` 去掉 `moreMenuContent`（三点头像/首页/设置下拉整块删除），新增可选 `onOpenSettings`：
  会话页传 `onSettings`，右上角改为齿轮 `HugeIcons.Settings01`，点击直接进设置。
- 新增可选 `onNavigateHome`：会话页把汉堡右侧的 64×44 Fairy 小屏包成可点击区域（test tag
  `fairy-window-home`，content description `首页`），点击等价右划回首页；未传时小屏保持惰性、外观不变。
- GatewayPage / ImpressionPage 不传这两个参数，仍是返回箭头、无齿轮、小屏不可点；测试里固定了这一点。
- 顶栏文件更新的类注释说明两种调用形态。

### C. 会话列表

- 默认视图标题 `会话` → `会话列表`；归档视图仍为 `已归档会话`。
- 底栏 `首页` / `设置` 文本改为 `HugeIcons.Home01` / `HugeIcons.Settings01` 图标；保留
  `session-list-home` / `session-list-settings` test tag 与原点击行为，并各带 content description `首页` / `设置`。

### D. 文案

- `values-zh/strings_identity.xml`：7 条用户可见文案的 `后端` → `服务端`
  （`identity_unreachable`、`gateway_explain`、`gateway_route_api_key_env_hint`、
  `gateway_route_credential_configured` / `_missing`、`gateway_asr_unavailable`、`impression_unreachable`）。
- `values/strings_identity.xml`：对应英文句子的 `backend` → `server`。
- 未改代码注释、文档或内部标识符。

## 测试（TDD）

新增/更新的 Robolectric Compose 用例：

- `FairyPagesTest`（`@Config` 沿用类上的 `zh-rCN-w411dp-h891dp`）新增 6 个滑动用例
  （当前会话左滑、无当前会话左滑、垂直滑动、列表打开时滑动、会话页右滑、共享手势 modifier 的 enabled/方向）
  与 3 个顶栏/文案用例（齿轮与旧下拉、Fairy 小屏回首页、`后端`/`backend` 资源断言）；
  另在 gateway / impression 既有用例里加上「返回箭头在、齿轮与 home shortcut 不在」。
- `IdentitySessionListTest` 新增 1 个用例：标题 `会话列表`、底栏两个图标与 content description、点击仍分别触发
  home/settings、归档视图仍是 `已归档会话`。

### red → green

red（先写测试；随后把实现文件临时还原、保留新的 modifier 以便测试可编译，再跑最终测试）：

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest.<每个新用例>" \
  --tests "me.rerere.rikkahub.ui.identity.IdentitySessionListTest.<新用例>"
```

结果：10 个用例中 7 个失败（滑动/入口 3 个、顶栏 2 个、列表 1 个、文案 1 个），
失败点是「仍有 `后端`」「仍为 Conversation」「找不到 `fairy-window-home`」「标题不是 `会话列表`」等。
3 个用例按预期在改动前也通过：垂直滑动（回归护栏）、列表打开时的滑动（被抽屉/scrim 挡住）、
共享 modifier 自身的 enabled/方向用例（modifier 文件保留）。
原始输出：`work/tmp/290/new-tests-red.log`（按约定不入库）。

green：

| 命令 | 结果 |
| --- | --- |
| `git merge-base --is-ancestor integration/fixes-290-291-292 HEAD` | 成功（基线检查） |
| `:app:testDebugUnitTest --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest" --tests "me.rerere.rikkahub.ui.identity.IdentitySessionListTest"`（改动前基线） | `BUILD SUCCESSFUL`，1m48s |
| 同两条 `--tests` 过滤（最终代码） | `BUILD SUCCESSFUL`；`FairyPagesTest` 62 tests、`IdentitySessionListTest` 6 tests，0 failures/errors/skips |
| `:app:testDebugUnitTest`（整个 app 单元测试） | `BUILD SUCCESSFUL`；63 个测试类、550 tests，0 failures/errors/skips |
| `:app:lintDebug` | `BUILD SUCCESSFUL`，3m2s |
| `git diff --check` | 无输出 |

Red/green 与全量运行的原始 Gradle 日志在 `work/tmp/290/`（本目录不提交日志）。

## 未执行 / 风险

- **真机手势未执行**：没有连接设备或模拟器，未验证手感、真实滚动手势竞争、系统返回手势边缘与不同屏幕密度下的阈值。
  替身测试只能证明阈值/方向/门控与页面跳转接线，不等于真机验收。
- 未做性能测量；「丝滑」只落实为使用现有 NavDisplay 过渡、不在拖动中平移页面，未建立帧率基线。
- 未在设备上复核长按文本选择与横向滑动的竞争；当前以长按超时门控并在注释中说明。
- **无数据库、无 wire 协议、无 manifest、无依赖变更**；未改 `combo.json`，未 push。
