# Android 客户端界面审查：信息密度与 HDD 视觉风格（2026-11-04）

以「客户端使用者」视角对 `android/app/src/main/java/me/rerere/rikkahub/ui/` 做的一轮纯静态审查。
基线 `main` = `0e4a961`（本地 HEAD 另有 `aa7b0e8` 文档提交）。**未跑 gradle，未改任何 Android 源码**，
本文件是本轮唯一写入。

用户提的三条要求是审查的标尺，逐条对应：

1. **读着清爽，不要堆砌过多元素、不要过多信息平铺** → 第 1–3 节（逐站元素清单）+ 附录 B（逐页元素数汇总）
2. **主要看点：Fairy 的大眼睛动画 + 对话框里的对话内容** → 第 4 节（视觉主导性，用光通量算）
3. **风格符合绝区零 HDD 基本风格** → 第 5 节（token 一致性审计）

方法说明：能算的都算了，不写「感觉偏挤」。

- 所有几何量来自 `dp` 常量与其 Compose 父子关系推导；
- 光通量（relative luminance × 面积）用已有证据截图 `work/implementation/evidence/239-idle-caption/screens/home-idle-after.png`（411×891，density 1）与 `work/implementation/evidence/ui-215/screens/conversation-padding-360dp.png`（360×800）逐像素测得，脚本口径见附录 A；
- 对比度用 WCAG 2.1 相对亮度公式算；
- 字体字形覆盖直接读 TTF 的 `cmap` 表判定。

**截图时效声明。** 两张截图分别提交于 2026-10-26（`72bdb2f`）与 2026-10-24（`db3d5e5`），而
`ui/fairy` 的 token 化重构 `752aeb7` 是 2026-10-27 —— 截图早于重构。因此凡是截图与当前代码可能不一致的点
（最主要的是主按钮底色：截图是纯 `#EAF0FF`，当前代码是 `#A5E7FF→#72D7FF→#49A9C9` 渐变），
我都会同时给出「截图实测」和「按当前代码推算」两个数。

---

## 0. 一句话结论

界面不脏，但**主线被两样东西压住了**：一是首页那块 116dp 高的 H.D.D 字标加一颗近白主按钮，两者的有效光通量
分别是眼睛的 **1.89 倍和 2.56 倍**；二是**替 Fairy 说话的那层文字**（副标题、待机台词、伪终端日志）——
它们体量大、字数多，而且其中相当一部分不是后端事实。眼睛本身画得很克制，问题不在画，在**周围挤**。

---

## 1. 走一遍：冷启动 → HDD boot → 待机主页

### 站 1：进程启动（0 – 不确定）

| 项 | 值 |
|---|---|
| 屏幕上有什么 | 居中一个 `CircularProgressIndicator`，无文字 |
| 元素数 | 1 |
| 视线落点 | 屏幕正中，唯一的动的东西 |
| 时长 | 无上限（等于凭据恢复）— `RouteActivity.kt:195`，`ui/identity/IdentityNavigation.kt:20-25` |

**多余的东西**：无。这一站反而是全应用最干净的一屏，也说明「不堆砌」是做得到的。

### 站 2：CRT 开机（420 ms）

`FairyCrtPowerOn.kt:19` `POWER_ON_MS = 420`，分界 `LINE_PHASE = 0.3f`（`:20`）→ 前 126 ms 横线展开、
后 294 ms 纵向拉开。屏上从 3 个元素（黑底 + 辉光线 + 白芯线，`:54/:57/:58`）到 5 个（多出上下黑遮片与淡蓝闪
`:64-66`）。**无文字**。Reduced Motion 下整段不绘制（`:39`）。

**评价**：这是整套 HDD 语言里最到位的一处 —— 光、线、黑场，没有文案，没有假装在做什么。总时长 420 ms
也在耐受限内。

### 站 3：HDD boot 逐字打印（≈ 1558 ms）

`FairyHddBoot.kt:38-61` 的 `HddBootHeader` 是 **22 行 C++ 头文件**（含刻意保留的 "Insitute" 拼写），
合计 **701 字符**，速率 `TYPE_CHARS_PER_MS = 0.45f`（`:70`）→ **1557.8 ms**。

同时屏上的东西：

| 层 | 内容 | 数值 |
|---|---|---|
| 终端玻璃 | 1dp 边框 `fairyBlue@50%`、14dp 圆角、2dp 步进扫描线 `white@3.5%`、HUD 四角 | `FairyHddBoot.kt:132-143` |
| 正文 | 22 行 `10.5sp / 15sp` 行高，`softWrap = false` | `:147` |
| 光标 | `" █"` | `:178` |
| 跳过提示 | `TAP TO SKIP` 10sp / 字距 1sp / `textMuted@60%` | `:150-153` |
| 页头 | `H.D.D // PROXY TERMINAL` 9sp/1.2sp + `01` 9sp + `H.D.D.SYSTEM` 38sp + 启动轨 16dp + `percent%` 20sp/2sp | `IdentityPages.kt:93-137` |
| 背景 | 渐变 + `HDD` 水印（宽×0.36，alpha 0.035）+ `HOLLOW DEEP DIVE SYSTEM`（宽×0.03，alpha 0.06）+ 24dp 网格 alpha 0.03 + 3dp 扫描线 alpha 0.012 + 左上径向光 alpha 0.055 | `FairyBackground.kt:39, 76-90, 98-118` |
| 做旧 | 颗粒 alpha 0.75 + 径向暗角 0.38 + 纵向暗角 0.22/0.26（+ 滚动带、闪烁） | `FairyAgedOverlay.kt:31-47` |

**视线落点**：不是终端。页头那块 38sp 的 `H.D.D.SYSTEM`（`IdentityPages.kt:113`）和它下面那条 16dp 启动轨
是唯一有运动的强对比块，22 行 10.5sp 的暗蓝伪代码只是噪点。

**多余的东西（这条我认为是本轮最值得改的地方之一）**：

1. **22 行伪代码与用户要做的任何事都无关。** 它既不是产品叙事也是不是错误诊断 —— 后端登录接口只返回
   `IdentityUser`，没有 progress/step 通道；`> ... LOADED / STANDBY / AWAITING PROXY CREDENTIALS`
   三行是常量 `HddReadyLines`（`FairyHddBoot.kt:64-68`），在打字结束时一次性整体替换（`:114-116`），
   不是被查询回来的状态。实测全仓后端 grep `AWAITING PROXY|deep_dive_prototype|Helios Research`
   除本文件外无命中。
2. **进度条演的是打字进度，不是加载进度。** `rail.snapTo((typed * 0.90f))`（`IdentityPages.kt:178`）
   → 日志打完只到 90%，然后 `animateTo(0.99f, tween(520))`（`:175`）纯补间推到 99%，
   请求在飞时 `animateTo(0.994f, tween(900))`（`:184`）读数四舍五入仍是 99%，只有成功才 `snapTo(1f)`（`:195`）。
   画法本身也承认这是仪表表演：`p = (progress*100).roundToInt()/100` 整百分比跳步、
   `p>=0.99 && p<1 → 0.99` 强制驻留（`FairyBootProgress.kt:70-71`）。
3. **首次可用输入被推后 ~1.9 s。** 登录面板 `AnimatedVisibility(visible = booted)`（`IdentityPages.kt:225-228`），
   也就是打进第一个字符之前，用户拿不到任何输入框；410 ms 开机 + 1558 ms 打字 = **约 1.97 s**。
   每进程一次（`FairyHddBoot.kt:76-78`），但用户对首帧慢的容忍恰恰只在冷启动。

**建议（数值）**：把 `HddBootHeader` 从 22 行裁到 6–8 行（保留 `// Copyright`、`#ifndef`、`class`、
`}` 与三行 `ready` 状态），速率提到 `1.2` 字符/ms → 约 **300 ms**；或保留全文但把 `TYPE_CHARS_PER_MS`
提到 `2.4`（≈290 ms），并让登录面板与打字**同时**淡入而不是等 `booted`。删掉那个假百分比，
启动轨只在 `busy` 时出现、只表示「请求在飞」（这一条它本来就是真的）。

**一个正面观察**：`FairyHddBoot` 的排版本身是对的 —— `softWrap = false` + 10.5sp/15sp 行高 +
`body = #D6E2FA`、注释 `textMuted`、关键字 `fairyLink` 加粗的三色分层（`:163, :167-175`），
读起来确实是终端而不是一堆彩字。要砍的是**行数**，不是这套排版。

### 站 4：待机主页（控制台）

411×891 实测纵向分带（`home-idle-after.png`，y 为 px = dp）：

| 带 | y 范围 | 高度 | 元素数 |
|---|---|---|---|
| H.D.D 字标（主行 + 符文行） | 0 – 148 | 148 | 2 行路径字形 |
| 眼屏 | 148 – 356 | 208 | 1 屏 + HUD（`HDD // FAIRY` 10sp、`STANDBY` 13sp、3 点、9 条电平表、4 角标） |
| 待机台词 | 357 – 441 | 84 | 2 行 15sp 正文 + `Fairy` 名字签 12sp |
| 信息卡 | 457 – 633 | 177 | `PROXY`/`AGENT`/`CURRENT SESSION`/`SESSIONS` 6 个标签 + 4 个值 + 1dp 分隔线 |
| 主按钮「进入会话」 | 654 – 709 | 56 | 15sp + tag 9sp |
| 次按钮「全部会话 / 设置」 | 722 – 788 | 67 | 各 15sp + tag 9sp |
| 空白 | 789 – 891 | 103 | — |

**同时可见元素：约 26 个文本/图形节点，7 个视觉带。** 页内可点目标 3 个 + 整页手势 1 个（左划进会话，`FairyConsolePage.kt:150-153`，
`FairySwipeNavigation.kt:15` 阈值 72dp、`:18` 400dp·s⁻¹）。

**视线先落在哪（实测）**：不是眼睛。「进入会话」那颗近白实心键在截图里是 371×56 dp 的纯 `(234,240,255)`，
区域平均相对亮度 **0.821**，光通量占全页 **44.4%**；眼屏整块 371×208 dp 平均亮度只有 **0.0597**，
占 **17.3%**；字标占 **32.8%**。按当前代码（主按钮改成 `#A5E7FF→#72D7FF→#49A9C9` 渐变，
`FairyPanel.kt:88`，面平均 L≈0.568）重算：主按钮仍是眼屏的 **2.56 倍**，字标是 **1.89 倍**，
两者合计 **4.45 倍**。眼睛自己也只占它那块屏的 **11.2%**（直径 = 22.5/48 × 112dp = **105dp**，
面积 8659 dp²，屏 77168 dp²），占全页 **2.36%**。

**多余的东西**：

1. **字标是第二大发光体。** 411dp 屏上 `FairyHddWordmark` 算出来 **116 dp 高**（侧缩 10%、`CAP=100` 单位、
   符文行 `mainUnit×0.26`，`FairyHddWordmark.kt:340-356`），占屏高 13%，压在眼睛**上方**。
   360dp 屏 103dp。建议裁到 `mainUnit × 0.55`（≈64dp）或把字标移到眼屏**下方**、与信息卡并列 ——
   理由是 HDD 的观感来自字形的切削而非字号。
2. **主按钮现在有两份入口。** #290 已合入左划进会话（`eb…` 见 §7），加上「进入会话」键和「全部会话」抽屉，
   同一个目的地有 3 条路。既然手势已经有了，「进入会话」可以降级为次级键（高度 56→48dp、
   面用 `tokens.panel` 而非 signal 面），把页面唯一的高亮让给眼睛。
3. **信息卡 6 个标签把两件事说成了六件。** `PROXY` + 名字 + `#shortId` + `ADMIN/AGENT` 是一件事（我是谁），
   `CURRENT SESSION` + 标题 + `SESSIONS` + 数量 是第二件事（我在哪、有多少）。而名字与短号在设置页
   `账号` 组摘要里又出现一次（`FairySettingsPage.kt:136` 与 `:141-142`），是这一轮的重复项之一。
4. **待机台词把按钮顶下去。** `FairyCaptionSlot` 是 Column 里的兄弟节点（`FairyConsolePage.kt:195-199`），
   高度被 `animateContentSize(tween(200))` 带着走（`FairyCaption.kt:122`），退场再 `shrinkVertically`
   250 ms（`:57, :169-175`）。按 `FairyLines` 实际文本、411dp 屏 339dp 文本宽、15sp/21sp 换算：

   | 台词 | 字符 | 行数 | 台词块高 |
   |---|---|---|---|
   | 第 2 段（`ZZZ` 推荐） | 55 | 3 | **105 dp** |
   | 第 4 段第 3 句（三连「我是不会有怨言的」） | 54 | 3 | **105 dp** |
   | 其余多数段 | 19–43 | 1–2 | 63–84 dp |

   即**每说一次台词，下方 177dp 信息卡 + 3 个按钮整体上下平移 84–105 dp**，一轮 3 段约 11.4 s 内还会因段落
   差再抖 21 dp。用户在按「进入会话」时目标在动。
   411×891 上 3 行台词让内容高 **846 dp**、可用 843 dp → **溢出 3 dp**；
   393×851 溢出 16 dp；**360×800 上 2 行就溢出 57 dp、3 行溢出 78 dp** —— 也就是说在小屏上
   「全部会话 / 设置」直接掉到首屏外，要滚动才点得到（该页是 `verticalScroll`，`FairyConsolePage.kt:163`）。

   **建议**：把台词从「撑开布局」改成「浮层压在页面上」（这是 #239 修复前的形态，但那次修的是**遮挡眼睛**）；
   或者给台词槽一个固定 96 dp 高度 + 内部滚动，让下方永不移动。任一都比现在的「整体平移」安静。

### 站 5：睡着（`TAP TO WAKE`）

3 分钟无操作 → `asleep`（`FairyInteraction.kt:16` `SLEEP_AT_MS = 180_000`），屏上多一行
`TAP TO WAKE` 11sp / 字距 1.5sp / `fairyLink@85%`（`FairyConsolePage.kt:181-187`），眼睛瞳孔变宽
（`SLEEP_PUPIL = 1.12f`）、转盘降到 20 s/圈，HUD 状态词 `STANDBY` 换成 `SLEEP`（`:176`）。
这一层是**对的**：只用一处小字和一个状态词，没有弹窗、没有遮罩。

---

## 2. 走一遍：进入对话 → 发消息 → 长回复流式 → 切后台 → 回前台

### 站 6：进入对话（常态）

360×800 实测（`conversation-padding-360dp.png`）：

| 带 | y | 高 | 内容 |
|---|---|---|---|
| 窗口条 | 0 – 56 | 60 | 汉堡 48dp + mini 眼屏 64×44 + `Fairy` 18sp/22sp + 副标题 11sp/14sp 斜切 8° + 齿轮 48dp |
| Fairy 对话面板 | 59 – 201 | 143 | 说话人名 12sp + 4 行 14sp 正文，面板宽 322dp（x 19–340） |
| 用户气泡 | 212 – 351 | 140 | 说话人名 12sp + 正文，宽 320dp（x 20–339） |
| 空白 | 352 – 727 | 376 | — |
| 输入区 | 728 – 791 | 64 | 4 个 22dp 图标 + 输入框 |

**眼睛在这里只有 36dp。** `FairyWindowTopBar` 常态渲染 mini 屏 `64×44 dp / eyeSize = 36 dp`
（`FairyWindowBar.kt:205-212`），眼直径 = 36 × 0.9375 = **33.75 dp**，占屏 **0.98%**。
只有「思考中」或空会话时窗口才展开成 176dp 高的全宽眼屏（`FairyScreenOpenHeight = 12 + 140 + 24`，`:74-75`），
此时 `eyeSize = 88 dp`（直径 82.5dp）。

**代价**：展开时 `FairyConversationSurface` 的 `padding(top = 60 + 176)`（`FairyConversationPage.kt:219-221`），
800dp 设备上消息视口从 **628 dp 压到 452 dp（−28%）**。

**多余的东西**：

1. **空会话时为一行灰字付 176 dp。** `window.expanded` 的条件是「已连接 + 有投影 + 0 条消息 + 无输出」
   （`FairyInteraction.kt:265-266`），此时列表里只有一句 `此会话还没有消息。`
   （`RemoteTranscript.kt:102-108`，`bodyMedium` 14sp，`padding 16dp`）。176dp 的眼屏换一句话，不划算。
2. **窗口条副标题是界面在替 Fairy 说话。** `FairyConversationPage.kt:185-194` 的 6 分支 `when`
   把连接态与活动态翻成中文短语：`正在打开会话… / 会话不可用 / 连接中… / 连接已断开 / 正在思考… /
   正在工作… / 同步中… / 已连接`。后端只给 `status ∈ {0,1,2}` + `reasons ⊆ {1,2,3,4}`
   （`backend/chat/src/units.ts:874-876`：`status: reasons.some(r => r !== 4) ? 2 : unknown ? 0 : 1`）。
   两处失真：
   - **`status == 0` → 「同步中…」**。后端的 `0` 是「存在 unknown task / report」，语义是**未知**，
     不是「正在同步」。这一点与 issue #256 用户故事 10「后端活动未知时不被显示成安静」是同源问题，
     只是方向相反：现在它被显示成**一个不存在的进行时**。
   - **`status == 2 && awaitingReply` → 「正在思考…」**。实测（`end-user` 的 25 段采样）里一轮用户消息
     对应 **3 次串行工具往返**（`memory_search` ×2 + `memory_add` ×1），模型自己几乎从不自报进行态
     （1/25，且是比喻「正在失去可靠性」）。所以「正在思考」在事实上偏错 —— 它在**执行**，不是在思考。
     这同时解释了「她反应慢」的体感：等待时间里她在干活，而界面把干活说成了思考。
     同源的 `end-user` 证据：客户端 8 类自造词在 25 段回复里**0 次被模型复述**，
     后端代码里也 grep 不到这些词，即**没有泄漏进模型上下文**；
     不一致点是「客户端替模型说话」，不是「模型复述客户端」。
3. **两个裸 Material3 按钮。** 失败态用 `TextButton("重试")` / `TextButton("选择会话")`
   （`FairyConversationPage.kt:173-174`），是这个页面上唯一两处未走 `SignalButton` 的控件。

### 站 7：发消息（最坏情况下状态块吃掉半屏）

Composer 是 `InstrumentPanel(RECESSED, contentPadding = 4.dp)` 里一行：
`+`(22dp) + `TextField`(weight 1f, maxLines 5) + 麦克风(22dp) + 发送/停止(22dp)，附件区
`heightIn(max = 140.dp)` 竖滚（`RemoteChatPanel.kt:483-545`、`:488-499`）。

但它**上面**最多会叠 5 个状态块（`RemoteChatPanel.kt:203-251`）：

| 块 | 触发 | 估算高 |
|---|---|---|
| `ConnectionHeader` 卡 | 未连接 / 有 failure / 有后端 error | 52 dp + 每条错误 8+16 |
| 「重试同步」TextButton | failure 且 syncing | 40 dp |
| `PendingCommand` 卡 | 有未决发送 | 16+16+8+(4+20)+8+12+40+16 ≈ **140 dp** |
| `attachmentNotice` | 附件提示 | 24 dp |
| 「正在下载附件…」行 | downloading | 26 dp |
| `任务 · N` TextButton | 有任务 | 40 dp |

最坏组合 ≈ **300 dp** 的状态块压在 452–628 dp 的消息视口上 —— 也就是说「断网 + 有待确认发送 + 有任务」时，
消息区只剩三分之一。**这是用户说的「平铺堆砌」在对话页的具体形态。**

**建议**：把 `PendingCommand` / `ConnectionHeader` 从消息流上方的堆叠改成窗口条副标题 + 输入区上方一行
（同一时刻只允许一个状态行，后来的替换先来的），或折叠进一个「⚠ 1」胶囊点开。

### 站 8：长回复流式

#237（流式刷新频率）已修：`streamingPrefix` 每帧至少推进
`STREAMING_MIN_CODEPOINTS_PER_FRAME = 4` 个码点，且 `remaining / 16` 帧内追平
（`RemoteTranscript.kt:586-614`）。80 字符的到达块 ≈ 20 帧 ≈ 333 ms 呈现完，与 333 ms 的到达间隔正好吻合，
观感是打字机而不是跳行。

呈现语义也对：流式期间 `remoteAttemptFormat() = PLAIN`（`data/remote/RemoteChatState.kt:117`），
定稿后才切 Markdown（`remoteMessageFormat`，`:115-116`），且 `documentToShow` 会在用户离开尾部阅读时
**推迟**当前可见行的重排（`RemotePresentation.kt:71-77`）—— 不打断阅读位置。

**工具调用行**（#292 已合入）默认 `tools.takeLast(1)` + 展开箭头（`RemoteTranscript.kt:629-655`），
只在 `tools.size > 1` 时给箭头（`:643`）。**残留缺口**：展开状态按 **message 行**记
（`expandedToolRows[row.key]`，`:116, :231-234`），所以一轮里若有 3 条 assistant 消息各带工具，
页面上仍然是 **3 行「调用工具 · X」**，各自带一个箭头。issue #292 原文要的是「本次行动的所有工具调用」
折叠成一行 —— 跨 message 的「一次行动」聚合没做。配合实测一轮 3 次工具往返，这仍然是 3 行噪音。

### 站 9：切后台 → 回前台

`rememberFairyPageHost` 的 `DisposableEffect` 在 `ON_START` 读**当前**运行时（不是上次组合）
调 `fairy.foregrounded(...)`，并在 `ON_STOP` 调 `pageExit(presentation)`（`FairyPageHost.kt:86-107`）。
`foregrounded` 置 `catchingUp = true`（`FairyInteraction.kt:357-362`），因此离开期间落地的输出/投递
**只结算、不重播**。这一段是对的，也与 #256 用户故事 7、8、14 一致。

一个观感细节：回到前台时眼屏**不会**张开（`awaitingReply` 与 `expanded` 只看当下事实），
所以「切出去再回来」看到的几乎是一张静止截图 —— 只有瞳孔在动。这是设计选择，但和用户
「主要看点是眼睛动画」的期待有落差。

---

## 3. 走一遍：技能页 → 待审入口 → 设置页

### 站 10：技能页

窗口条（同对话页，mini 眼 36dp）→ 说明段 `skills_explain`（`bodySmall` 12sp，约 3 行）→
待审 chip → `选择池` 标题 → 搜索框 → 最多 **5 个组头**（在目录 / 被遮蔽 / 已禁用 / 已归档 / 未知，
`SkillsPage.kt:286-323`）→ 每行技能 → `待审核` 段 → `最近审核结果` 段。

**首屏同时可见 ≥ 10 个不同视觉元素**，全页可数节点在已载入态约 **28–35** 个
（见附录 B 的清单）。最密的是技能行，单行最多 **8 个纵向元素**（`SkillsPage.kt:419-498`）：

`名称` + `个人/共有` + `Switch` + 描述（截 96 字符，`:63, :509-516`）+ `有待审修订` chip +
`与个人技能「X」同名…` + `归档/恢复范围：所有用户` + `归档（所有用户）` 按钮

**重复项（实测 4 处）**：

1. 待审数量出现 **3 次**：页顶 chip（`:126`）、`待审核` 段标题（`:184`）、每行 `待审核` 文字（`:606`）。
2. **「归档范围」说两遍**：`:469-477` 的 `归档/恢复范围：所有用户` 与 `:485`/`:493` 按钮文字 `归档（所有用户）`。
3. 范围标签 `个人/共有` 在池行、待审行、结果行各出现一次（`:432, :549, :600`）。
4. 设置页的待审 chip 与技能页的待审 chip 是**两次独立的 `/skills/list` 请求**
   （`FairySettingsPage.kt:87-95` vs `SkillsPage.kt:98-100`），无共享权威，数字可能不一致。

**建议**：删掉 `:469-477` 那一行（按钮已经说了范围），删掉行内 `待审核`（段标题已经说了），
把描述从 96 字符收到 48 或改成单行 `maxLines = 1`。

### 站 11：待审入口（从设置进去要 5 步）

实测路径：`首页 → 设置 → 技能组 → 技能选择池 → 技能页「待审核」段 → 候选行 → 审核对话`，
即设置页需要**展开一次 + 点两次 + 页面跳转两次 + 点候选**，共 5 次点击。
通知入口 `ACTION_OPEN_SKILLS` 是 1 步（`RouteActivity.kt:125-139`）。

**这是本轮我最想提的可用性一条**：#290 的评论明确要求「会话页右上三个点改成齿轮 → 设置」，
已经做了（`FairyWindowBar.kt:281-292`，`onOpenSettings`）；但**待审**这个「有时效、有徽标、要人去处理」
的入口，仍然埋在两级折叠里。建议在窗口条副标题位置直接给一个 `待审 3` 的 `StatusChip`
（点进技能页的待审核段），这样对话页 1 步可达。

### 站 12：设置页

`screenshot` 无（本轮无模拟器），按代码：`FairySettingsPage.kt` 是**唯一不用 `FairyWindowTopBar` 的页面**
—— 它自绘 `Row(返回 IconButton + "设置" 26sp)`（`:111-122`）。

| 项 | 设置页 | 技能 / 印象 / 网关页 |
|---|---|---|
| 顶栏 | 自绘 Row，无 mini 眼屏 | `FairyWindowTopBar`，有 64×44 mini 眼屏 |
| 标题字号 | **26 sp** | 18 sp（栏内）+ 11 sp 副标题 |
| 顶距 | 16 dp（`statusBarsPadding` 后直接 `padding(16.dp)`，`:109`） | 60 dp（`FairyWindowBarHeight`） |

**眼睛在设置页完全消失。** 对一个「主要看点是大眼睛」的产品，最常停留的配置页把主角删掉了。

**元素数**：标题行 2 + `SYSTEM CONFIGURATION` 10sp/字距 2sp 1 + 7 个折叠组（非管理员）×
（标题 16sp + tag 9sp + `+`/`−` 18sp + 摘要行 12sp）**28** + 页脚 `HOLLOW DEEP DIVE SYSTEM · BUILD 1`
9sp/字距 1.5sp 1 = **约 32 个文本节点**，而页面内容其实只有 7 个可折叠组。

**重复项**：`身份名 · #短号` 在折叠摘要（`:136`）与展开后的 `身份`/`编号` 两行（`:141-142`）各一遍；
`待审 N` 在 chip（`:182`）与提示行（`:191`）各一遍；`当前版本 X`（`:238`）与展开后的
`已安装版本 X`（`RemoteAppUpdate.kt:231`）各一遍；`显示` 组摘要「聊天字体与字号」（`:228`）
与展开后两个按钮文字同义。

**缺陷 1（触控目标）**：`退出登录` 显式 `height(46.dp)`（`FairySettingsPage.kt:156`），
而 `SignalButton` 自身是 `heightIn(min = 48.dp)`（`FairyInstrument.kt:93`）—— 46 < 48，
低于 Material 的最小触控目标，且是该页唯一的危险操作。

**缺陷 2（假加载态）**：`AgentRoster` 在无 token 时 `LaunchedEffect` 直接 return（`:392-393`），
`names` 恒 null、`unavailable` 恒 false → 永久显示 `正在读取…`（`:410`）。后端返回空列表时渲染空白面板（`:404-407`）。

**缺陷 3（失败被吞成 0）**：`pendingSkills` 用 `runCatching { ... }.getOrDefault(0)`（`:93`），
请求失败显示为「无待审」而不是「未知」。

---

## 4. 视觉主导性：数值化的「谁在抢戏」

### 4.1 光通量（relative luminance × 面积）

411×891，截图实测；括号内为按当前代码 token 重算的值。

| 区域 | 面积 dp² | 平均相对亮度 | 光通量占比 | 相对眼屏倍数 |
|---|---|---|---|---|
| 主按钮「进入会话」 | 20 776 | 0.821（现码 0.568） | **48.5%（现码 44.4%）** | **3.70×（现码 2.56×）** |
| H.D.D 字标 | 43 036 | 0.203 | **25.2%（现码 32.8%）** | **1.94×（现码 1.89×）** |
| 眼屏（整块 371×208） | 77 168 | 0.0597 | **14.2%（现码 17.3%）** | 1.00× |
| ↳ 其中眼睛本体（105dp 直径） | 8 659 | — | （占眼屏 11.2%） | — |
| 待机台词 | 36 168 | 0.051 | 5.2% | 0.40× |
| 信息卡 | 72 747 | 0.021 | 4.3% | 0.33× |
| 次按钮 ×2 | 27 537 | 0.034 | 2.6% | 0.20× |

**结论：字标 + 主按钮合计是眼睛的 4.45 倍光通量。** 用户说「主要看点是眼睛」，但眼睛是全页**第三亮**的东西，
且只占全页 2.36% 面积。这不是画得不好 —— 眼睛的绘制（`drawFairyEye`，`FairyEmblem.kt:312`）用了
105dp 直径、白环 `21.75/4.5`、Q 环 `15.4/9.8`、瞳孔 `8.6`、高光 `3.2`、眼睑 `19.5/15.9/18`，
比例是对的；问题是**周围比它亮**。

### 4.2 对话页：用户气泡比 Fairy 面板亮 3.64 倍

| 面 | 色 | 相对亮度 L | 说明 |
|---|---|---|---|
| Fairy 对话面板 | `#0B1524 → #060C16`（`FairyDialogPanel.kt:48-49`） | **0.0073** | 全应用**最暗**的面 |
| `pill` token | `#101C2E`（`FairyTokens.kt:36`） | 0.0114 | |
| `panelTop` token | `#142238`（`:33`） | 0.0158 | |
| 用户气泡 | `white@12%` over `#08111F` = `#262E3A`（`:49`） | **0.0267** | 是 Fairy 面板的 **3.64 倍** |

同时**用户气泡比 Fairy 面板更宽**：Fairy 面板 `fillMaxWidth` + 14dp 内距 → 360dp 屏上 292dp 正文宽；
用户气泡 `widthIn(max = 340.dp)` + 12dp 内距 → 316dp 正文宽（`RemoteTranscript.kt:194-200`）。

**即：Fairy 的话更暗、更窄、字号相同（都是 14sp `bodyMedium`）；用户的话更亮、更宽。** 这与「主要看点是
对话框里 Fairy 的对话内容」正好相反。**建议**：Fairy 面板底色抬到 `panelTop`（L 0.0158）或直接用
`FairyTokens.panel`；用户气泡降到 `white@8%`（L≈0.018）并可用 `widthIn(max = 300.dp)`。
两处都是 token 改动，不动结构。

### 4.3 一张表看清「谁在动」

| 页 | 持续动的东西 | 数量 | Reduced Motion 后的静态帧 |
|---|---|---|---|
| 控制台 | 眼屏呼吸 + 扫线 + 滚带 + 瞳孔 + 转盘 + 台词打字 | 6 | `breathAt(0.5)` 静止帧（`FairyWindow.kt:261-262`） |
| 对话（常态） | mini 眼 33.75dp 里的瞳孔 | 1 | 同上 |
| 对话（思考） | 全宽眼屏 88dp | 1 | 同上 |
| 设置 / 技能 / 印象 / 网关 | **0**（设置页连眼屏都没有） | 0 | — |

---

## 5. HDD 风格一致性：token 审计

### 5.1 好的部分

`FairyTokens` 把 21 个颜色、8 个尺寸、4 个字族收在一处（`FairyTokens.kt:21-77`），
`FairyAppTheme` 固定深色（`:111` `LocalDarkMode provides true`）、`surfaceTint = Transparent`（`:57`）
避免 M3 色调叠加污染海军蓝面板 —— 这两条是很关键的工程决定，让整套视觉不随系统主题漂移。
`FairyChamferShape`（`:27-51`）的切削路径也写得干净：cut 会 `coerceAtMost(min(w,h)/3)`，短行不会变八边形。

### 5.2 不一致的地方（按影响排序）

**① 切削语言只用了 1 处。** `FairyChamferShape(cut = 10.dp)` 只有 `ConsoleInfoCard` 一个调用点
（`FairyConsolePage.kt:243` `chamfered = true`）。其余全部是圆角矩形：

| 面 | 形状 | 位置 |
|---|---|---|
| 信息卡 | **切角 10dp** | `FairyConsolePage.kt:243` |
| 设置组 ×7–8 | `panelShape` = 圆角 6dp | `FairyInstrument.kt:40` |
| 输入区 | 圆角 6dp | 同上 |
| 对话面板 | 圆角 6dp | `FairyDialogPanel.kt:44` |
| 按钮 | 圆角 4dp | `FairyTokens.kt:61` |
| 状态胶囊 | 圆角 4dp | 同上 |
| 眼屏 | 圆角 6dp | `FairyTokens.kt:62` |

ZZZ HDD 的形状语言是**切削直角 + 细描边**，不是 4–6dp 圆角。现状是「一页里 1 个切角 + 10 个圆角」——
那个切角反而是异类。**建议**：要么把 `consoleShape` 铺到所有 `InstrumentPanel(RAISED)`（设置组、
信息卡、composer），至少让大面板统一；要么全弃切角、只用圆角，别留孤例。

**② Fairy 的对话面板不在 token 体系里。** `FairyDialogPanel.kt:48-51` 自己定义了 4 个私有色
（`DialogFillTop`/`DialogFillBottom`/`DialogBorder`/`DialogBorderActive`），
不读 `LocalFairyTokens`。后果就是 §4.2 那个「Fairy 面比所有 token 面都暗」。
另外 `DialogBorder@30%` 在 `#0B1524` 上的对比只有 **2.21:1**（低于 3:1 的非文本对比建议），
所以静止态的对话面板几乎没有边界。

**③ 三处硬编码色绕过 token。** `StatusTone.WARNING -> Color(0xFFF0B35E)`（`FairyInstrument.kt:125`）、
主键渐变两端 `#A5E7FF` / `#49A9C9`（`FairyPanel.kt:88`）、闪白 `#BFD6FF`（`FairyCrtPowerOn.kt:66`）。
前者是语义色，应该进 token；后两者是绘制中间值，可以留。

**④ 两个 token 是死的。**
- `FairyTokens.primary = #EAF0FF`（`:46`）**全仓无读取**（唯一命中是 `OwnedSession.primary` 这个布尔）。
- `FairyTokens.labelFontFamily = LabelFamily`（`:76`）**全仓无读取**；`label_black.ttf` 因此是
  45 KB 死资源。且该 TTF 内部 `nameID4 = "Outfit Thin"` 而 `FairyTypography.kt:11` 把它绑成
  `FontWeight.Black`，`OS/2.usWeightClass` 却是 900 —— 名字与字重声明自相矛盾。

**⑤ `FairyEmblem.kt` 的 2 个 `@Composable` 入口无调用点。** `fun FairyEmblem(...)`（`:59`）与
`internal fun FairyEmblem(...)`（`:85`）在整个 `android/app/src` 里都没有使用者；同文件里真正被用的
是 `drawFairyEye`（`FairyWindow.kt:277`）、`eyeDiscPath`（`:250`）、`discPath`（`FairyEmblem.kt:485`）。
485 行的文件里，对外可组合的入口是死的，绘制函数是活的 —— 名字会误导下一个读者。

### 5.3 字体角色：中文被排进了没有中文字形的字族

`FairyAppTheme.kt:90` 把 `labelMedium` 和 `labelSmall` 的字族换成 `TelemetryFamily` = **JetBrains Mono**
（`:91` 还把 `labelSmall` 定成 11sp/15sp）。我直接读了 `jetbrains_mono.ttf` 的 `cmap`：
1094 个码段，`U+4F60 你` → **无**，`U+5BA1 审` → **无**，`U+76EE 目` → **无**。即**零 CJK 覆盖**。

于是这些中文全部走系统 fallback（字形与字距都不受控）：

| 文本 | 层级 | 位置 |
|---|---|---|
| `你` / `Fairy`（说话人标签） | `labelMedium` 12sp | `RemoteTranscript.kt:210` |
| `已停止` / `回复失败` | `labelSmall` **11sp** | `RemoteTranscript.kt:247` |
| `调用工具 · {name}` | `labelSmall` **11sp** | `RemoteTranscript.kt:637-639` |
| `主会话` | `labelSmall` **11sp** | `IdentitySessionList.kt:182` |
| `待审 N` / `有待审修订` / `需确认增长` | `StatusChip` **10sp** + `telemetryFontFamily` | `SkillsPage.kt:126, :455, :593` → `FairyInstrument.kt:145-147` |

7 处。**建议**：中文一律走 `functionFontFamily`（MiSans Heavy，`title_heavy.ttf`，我确认它有 CJK）；
`telemetryFontFamily` 只留给纯拉丁的遥测读数（`PROXY`、`SESSIONS`、`STANDBY`、`H.D.D // FAIRY`），
这也是 token 注释里本来就写明的分工（`FairyTokens.kt:73-76`）。

---

## 6. 可读性：具体数值

### 6.1 字号阶梯有 6 档，其中 3 档低于 12sp

| 层级 | 字号 / 行高 | 用在哪 | 调用点数 |
|---|---|---|---|
| `bodyMedium` | M3 默认 **14 / 20** | 对话正文、待机台词（覆盖成 **15 / 21**，`FairyCaption.kt:125`）、技能行 | 多 |
| `bodySmall` | **12 / 16** | 说明段、摘要、错误 | `ui/` 合计 91 处 `bodySmall`+`bodyMedium` |
| `titleSmall` | M3 默认 14（MiSans） | 技能名、行标题 | — |
| `labelSmall` | **11 / 15**（主题覆盖，`FairyAppTheme.kt:91`） | 工具行、状态、`主会话` | — |
| `StatusChip` | **10 sp**，字距 0.6sp | 待审 / 增长 / 角色 | `FairyInstrument.kt:146` |
| 手写 `fontSize` | **9 / 10 / 10.5 sp** | 14 处（`FairyInstrument.kt:83`、`FairySettingsPage.kt:262, :305`、`FairyWindowBar.kt:271`、`IdentityPages.kt:95, :103, :357` …） | 14 |

9sp 在 2.75× 密度的手机上物理高度约 3.3 pt。Android 平台建议正文不低于 12sp。
**34 处文本（10sp 及以下 14 处 + 11sp 的 labelSmall + 10sp 的 chip）低于 12sp。**

### 6.2 对比度：全都够，反而是「没有层级」

| 前景 × 背景 | 对比度 |
|---|---|
| `textPrimary` `#EAF3FF` on `bgTop` `#08111F` | **16.90 : 1** |
| `textPrimary` on `bgBottom` `#030711` | 18.00 : 1 |
| `textMuted` `#A9B8D8` on `bgTop` | 9.49 : 1 |
| `fairyLink` `#8FB8FF` on `bgTop` | 9.43 : 1 |
| `signal` `#72D7FF` on `bgTop` | 11.60 : 1 |
| `danger` `#FF5A4E` on `bgTop` | 6.15 : 1 |
| `StatusTone.WARNING` `#F0B35E` on panel | 9.92 : 1 |
| `onPrimary` `#0A1633` on 主键顶/中/底 | 13.16 / 10.96 / 6.64 : 1 |

**没有一处不达标**（最低是 danger 6.15:1，AA 正文要求 4.5:1）。问题在另一头：
**主色与次色的亮度差不够**，`textPrimary` 与 `textMuted` 的对比度只差 1.8 倍，视觉权重接近，
于是层级只能靠**字号**和**alpha 二次衰减**表达 —— 而 alpha 衰减把小字压到临界：

| 衰减用法 | 实际色 | 对比度 |
|---|---|---|
| `textMuted @ 0.7`（`FairyWindowBar.kt:274`） | `#7987A3` | 5.09 : 1 |
| `textMuted @ 0.65`（`FairySettingsPage.kt:307`） | `#717F9A` | 4.56 : 1 |
| `textMuted @ 0.60`（`FairySettingsPage.kt:264` 页脚 9sp） | `#697691` | **4.03 : 1** ← 正文 AA 不合格 |
| `textMuted @ 0.55`（`SignalButton` 禁用态，`FairyInstrument.kt:63`） | `#616E88` | 3.59 : 1 |

**9sp 的字 + alpha 0.6 的灰色 = 4.03:1**，正好卡在失败线上。建议：9–10sp 的装饰性标签不再叠加 alpha
（直接用 `textMuted`，9.49:1），或用 `fairyLink` 保持与信号的区分。

### 6.3 长文本处理

| 场景 | 处理 | 位置 |
|---|---|---|
| 对话正文 | 不截断，靠 LazyColumn 滚动；`items` 间距 12dp | `RemoteTranscript.kt:171-175` |
| 「查看全文」弹窗 | `heightIn(max = 560.dp)` + 竖滚 + `SelectionContainer` | `RemoteTranscript.kt:125-131` |
| 技能描述 | 截首句，超 96 字符加 `…` | `SkillsPage.kt:509-516` |
| 会话标题 | `maxLines = 1` + Ellipsis（栏内 + 行内两处） | `FairyWindowBar.kt:245-246`、`IdentitySessionList.kt:355-356` |
| 待机台词 | **不截断、不滚动**，直接把布局撑开 | `FairyCaption.kt:115-142` ← 见 §1 站 4 |
| 技能审核面板 | 分 9 段，`验证详情`/`详情` 默认折叠，`⚠` 阻塞行**强制展开** | `RemoteTranscript.kt:377-491` ← 这一处设计是对的 |

### 6.4 字号设置只作用于一个地方（可用性缺口）

`DisplayPreferences.fontSizeRatio`（`data/datastore/DisplayPreferences.kt:8`）全仓**只有 1 个读取点**：
`MessageBody` 的 `base.fontSize * settings.fontSizeRatio`（`RemoteTranscript.kt:703`）。
即 1.0 / 1.15 / 1.3 三档**只放大对话正文**；上面那 91 处 `bodySmall`/`bodyMedium`
（设置页、技能页、错误提示、待机台词 15sp、窗口条副标题 11sp）全部不跟随。
用户在「设置 → 显示」把字号调到 130%，设置页和技能页还是原样 —— 而这个功能的存在理由恰恰是「看不清」。

**建议**：把 `fontSizeRatio` 提升成 `LocalFairyTokens` 的量（例如 `val textScale: Float`），
在 `FairyAppTheme` 里按比例放大 typography 的 6 个 body/label 档位；绘制层的固定 sp（HUD、tag）
保持不动即可。

### 6.5 深浅色

固定深色（`FairyAppTheme.kt:111`），不跟随系统 —— 与产品定位一致，不存在浅色下对比度崩掉的问题。
状态栏/导航栏显式声明 `isAppearanceLightStatusBars = false`（`:101-104`），是对的。
唯一遗留：`EnableEdgeToEdge` + 各页 `statusBarsPadding()` 齐全，没有内容压到状态栏下。

---

## 7. 与后端事实的关系：客户端在哪里替后端说了话

`GLOSSARY-MAP.md` 的关系条写的是「客户端不定义语义，只呈现后端事实」。逐条核下来，**大部分是守住的**，
但有 4 处越界：

### ✅ 守住的部分（值得记一笔）

- **当前表现完全由 module 合成，页面不自己推导**：`FairyInteraction.window(facts)`（`FairyInteraction.kt:252-269`）
  是唯一合成点，页面只渲染 `state.window`。活动未知（`status == 0`）→ `CONNECTING` 而不是 `IDLE`，
  符合 #256 用户故事 10「未知不被显示成安静」。
- **工具只呈现名字**：`ToolCallLines` 只渲染 `"调用工具 · $name"`（`RemoteTranscript.kt:637`），
  后端 `toolNamesOf` 也只投影 name（`backend/chat/src/units.ts:123`），参数与输出永不出现。
- **技能页只呈现 `/skills/list` 推出来的事实**：scope、pool state、`pendingCount`、`shadowedBy`、
  每个生命周期动作的 `actions.archive/restore` 作用域、`pendingRevision`、`growthExceeded`
  全部读后端字段，页面明写「never computes a winner, an archive or a review result itself」
  （`SkillsPage.kt:71-86`）。`技能审核面板` 甚至把后端 display 按固定前缀分段后**原样保留每行**，
  未识别的行进 `other` 兜底而不是丢弃（`RemoteTranscript.kt:301-367`）。
- **错误文案优先用后端原文**：`ConnectionHeader` 只把传输哨兵 `UNREACHABLE` 换成本地词
  （`RemoteChatPanel.kt:401-410`），技能页只映射 7 个已知 code（`SkillsPage.kt:636-644`），
  其余保持 `code: message`。
- **「已连接」等状态词没有泄漏进模型上下文**：`end-user` 实测 25 段真实回复（人格验收 16 + 记忆验收 9），
  8 类客户端自造词 **0/25 复述**；后端代码里也 grep 不到这些词 —— 它们只在输出侧。
  完整实测见 [`2026-11-04-end-user-persona-eval.md`](./2026-11-04-end-user-persona-eval.md)。

### ⚠️ 越界的 4 处

| # | 客户端在说什么 | 后端实际给了什么 | 证据 |
|---|---|---|---|
| 1 | 副标题 `status == 0` → **「同步中…」** | `status = 0` 表示「存在 unknown task 或 report status」，语义是**未知**，不是进行时 | `FairyConversationPage.kt:192` vs `backend/chat/src/units.ts:875` |
| 2 | 副标题 `awaitingReply` → **「正在思考…」** | `reasons` 里 `1` = running。实测一轮用户消息对应 **3 次串行工具往返**，模型自己在 1/25 回复里提过进行态且是比喻 —— 它在执行，不是在思考 | 同上 + `end-user` 25 段采样 |
| 3 | 启动进度条 **99%** + `LOADED / STANDBY / AWAITING PROXY CREDENTIALS` | 登录接口只返回 `IdentityUser`，无 progress/step 通道；三行是常量 | `IdentityPages.kt:175, :184`、`FairyHddBoot.kt:64-68` |
| 4 | 设置页页脚硬编码 **`HOLLOW DEEP DIVE SYSTEM · BUILD 1`** | 应用 `versionName = "2.5.11"`、`versionCode = 196`（`app/build.gradle.kts:53-54`）；「BUILD 1」是凭空的构建号 | `FairySettingsPage.kt:260` |

另有一类**不越界但让人误解**：`reasons` 里的 `2`（有任务在跑）、`3`（有报告在推进）、`4`（已投递）
客户端一个都没呈现，只呈现 `1`。于是「她真的在跑任务」和「她只是在生成正文」在界面上都是「正在工作…」。

**建议**（都不大）：
- `status == 0` 改成 `连接状态未知`（或干脆不显示副标题，让眼睛单独表达）；
- `awaitingReply` 改成 `正在执行…` 或按 `reasons` 分档（`1` → `正在生成`、`2/3` → `正在执行任务`）；
- 删掉假百分比与 22 行伪代码（§1 站 3），或把它明确做成一次性的品牌动画而不是「加载」；
- `BUILD 1` 改成 `BuildConfig.VERSION_NAME`。

---

## 8. 五个 issue 的落地核查（对照正文，不是标题）

| issue | 状态 | 代码事实 | 残留 |
|---|---|---|---|
| **#292** 工具调用默认折叠 | **已合入** `3f1e39f` | `tools.takeLast(1)` + 展开箭头（`RemoteTranscript.kt:629-655`），`tools.size > 1` 才给箭头（`:643`） | **跨 message 的「一次行动」没聚合** —— 3 条 assistant 消息各带工具仍是 3 行 |
| **#290** 左右划切页 + 收敛入口 | **已合入** `3b17878` | `fairySwipeNavigation`（72dp / 400dp·s⁻¹，`FairySwipeNavigation.kt:15, :18`）；手势与视线跟随不打架（划动在 Initial 消费、眼睛读 Final，`FairyPageHost.kt:117-126`）；齿轮进设置（`FairyWindowBar.kt:281-292`）；mini 屏做首页键（`:214-230`）；「前端/后端」措辞已统一为「服务端」 | 无 |
| **#291** 待机台词退场动画 | **已合入** `9b28ce5` | `FairyCaptionSlot` 保留最后一句参与 `fadeOut + shrinkVertically(250ms)`（`FairyCaption.kt:57, :167-175`），Reduced Motion 瞬间移除 | **只修了「消失」**；出现/段落变化仍会顶开下方 84–105dp（§1 站 4） |
| **#239** 待机台词布局 | **已合入** `d2ba3f6` | 气泡移出眼屏 `Box`、放到 Column 流内（`FairyConsolePage.kt:195-199`），顶边贴屏幕下沿 | **改对了遮挡，但引入了溢出**：360×800 上 2 行台词溢出 57dp |
| **#237** 流式渲染 | **已合入** `1d162b2` | `streamingPrefix` 每帧 ≥4 码点、16 帧追平（`RemoteTranscript.kt:586-614`）；定稿后直接全文替换 | 无（真机复测仍待 `end-user`/`vivo S50`） |

**结论**：五条 issue 的实现都在 `main` 上，issue 正文已经过期；**但 #292 与 #291/#239 各留了一个
边界情况没覆盖**，而这三个恰好都是「信息密度」相关 —— 建议这一轮不要只看 issue 标题就关票。

---

## 9. 建议清单（按性价比排序，全部不动结构）

### P0 — 直接影响「眼睛是主角」

1. **把字标从 116dp 收到 ≤ 64dp**（`FairyHddWordmark.kt:340-356` 调 `mainUnit` 系数），或移到眼屏下方。
   光通量从 1.89× 降到 ≈1.0×。
2. **主按钮降级为次级键**：既然 #290 已有左划，「进入会话」改 `SignalButtonVariant.SECONDARY`、
   `heightIn(min = 48.dp)`。光通量从 2.56× 降到 <0.3×，页面唯一高亮回到眼睛。
3. **Fairy 对话面板抬亮、用户气泡压暗**：面板底色 `#0B1524` → `tokens.panelTop`（L 0.0073 → 0.0158）；
   用户气泡 `white@12%` → `white@8%`（L 0.0267 → 0.018）。两者亮度差从 3.64× 收到 1.1×。

### P1 — 减少堆砌

4. **台词槽改固定高度或浮层**，让下方 177dp 信息卡 + 3 个按钮永不平移（`FairyCaption.kt:115-142`）。
   顺带解决 360dp 屏的 57–78dp 溢出。
5. **对话页状态块单行化**：`ConnectionHeader` + `PendingCommand` + 附件提示 + 下载行 + 任务按钮
   合并成「同一时刻一条状态行」（最坏 300dp → ≤48dp，`RemoteChatPanel.kt:203-251`）。
6. **技能行去掉重复**：删 `归档/恢复范围：…` 行（`:469-477`）、删行内 `待审核`（`:606`）、
   描述改 `maxLines = 1`。单行元素 8 → 5。
7. **空会话不展开 176dp 眼屏**（`FairyInteraction.kt:265-266` 去掉 `messages == 0` 这一支），
   只在 `awaitingReply` 展开。
8. **待审入口进窗口条**：对话页副标题位放一个 `待审 3` chip，5 步 → 1 步。

### P2 — token 与字体一致性

9. **`consoleShape` 铺到所有 RAISED 面板**，或全弃切角 —— 现在「1 个切角 vs 10 个圆角」。
10. **中文一律离开 `TelemetryFamily`**：7 处（§5.3 表）。
11. **清理死 token 与死资源**：`tokens.primary`、`labelFontFamily` + `label_black.ttf`（45 KB）、
    `FairyEmblem` 的 2 个 `@Composable` 入口。
12. **`StatusTone.WARNING` 进 token**（`FairyInstrument.kt:125`）。
13. **`fontSizeRatio` 提到主题层**，让 91 处 body 文本跟随（§6.4）。
14. **设置页改用 `FairyWindowTopBar`**（找回 36dp 眼睛，标题 26sp → 18sp 与其余子页统一）；
    `退出登录` 46dp → 48dp（`FairySettingsPage.kt:156`）。

### P3 — 后端事实的表述

15. `status == 0` 的「同步中…」→ 「连接状态未知」；`awaitingReply` 的「正在思考…」→「正在执行…」
    或按 `reasons` 分档（`FairyConversationPage.kt:185-194`）。
16. 启动阶段砍到 ≤300 ms，删假百分比（`FairyHddBoot.kt:70, :96`、`IdentityPages.kt:167-196`）。
17. `BUILD 1` → `BuildConfig.VERSION_NAME`（`FairySettingsPage.kt:260`）。
18. `AgentRoster` 的无 token 假加载态 + `pendingSkills` 的 `getOrDefault(0)` 吞错
    （`FairySettingsPage.kt:93, :392-410`）。

---

## 附录 A：测量口径

- **相对亮度 / 对比度**：WCAG 2.1 定义，`L = 0.2126R + 0.7152G + 0.0722B`，通道线性化
  `c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4`；对比度 `(L₁+0.05)/(L₂+0.05)`。
- **半透明合成**：源色按 alpha 在 sRGB 上线性插值到背景色，再算亮度（与 Compose 的 `Modifier.background(alpha)` 观感一致）。
- **光通量**：区域平均相对亮度 × 区域面积（dp²），用截图 `home-idle-after.png` 逐像素累加（step = 1 px，
  411×891、density 1，故 1 px = 1 dp）。分带边界由「行内最大亮度 > 26/255」判定。
- **字标高度**：按 `FairyHddWordmark.kt:340-356` 公式代入字形 advance（`H 96 / . 32 / D 100 / GAP 6`，
  符文行 20 字形 + `runeGap 36`）→ 411dp 屏 116.1 dp，360dp 屏 100.1 dp，393dp 屏 113.5 dp。
- **台词行数**：按 `FairyCaption` 的 15sp 正文、页面 20dp × 2 + 面板 16dp × 2 内距 → 411dp 屏文本宽 339dp、
  360dp 屏 288dp；CJK 记 1 em、ASCII 记 0.52 em 贪心折行。
- **眼直径**：`drawFairyEye` 外环半径 `22.5` 单位（`FairyEmblem.kt:312` 起），`unit = eyeSize / 48`
  → 直径 = `2 × 22.5 / 48 × eyeSize = 0.9375 × eyeSize`。控制台 112dp → 105dp；展开 88dp → 82.5dp；
  mini 36dp → 33.75dp。
- **字体字形**：直接解析 TTF 的 `cmap`（format 4 / 12），判定码点是否存在。

## 附录 B：逐页元素数汇总

| 页面 / 状态 | 同时可见元素数 | 可点目标数 | 备注 |
|---|---|---|---|
| 进程启动 | 1 | 0 | |
| CRT 开机 | 3 → 5 | 0 | |
| 登录页（打字中） | **≥ 10** | 0 | 含 22 行伪代码 |
| 登录页（booted） | 11 | 2 | |
| 注册页 | 9 | 2 | 无面板外框、无做旧层 |
| 控制台（待机） | **≈ 26**（7 个视觉带） | 3 + 1 手势 | |
| 控制台（台词 3 行） | ≈ 28 | 3 | 360dp 屏溢出 78dp |
| 对话页（常态） | 6 个带 / ≈ 14 节点 | 5（汉堡/mini/齿轮/麦克风/发送）+ 输入框 | |
| 对话页（思考） | ≈ 15 | 5 | 眼屏 176dp，消息视口 −28% |
| 对话页（最坏状态） | **≈ 26** | 8 | 300dp 状态块压住消息 |
| 对话页（空会话） | 4 | 5 | 176dp 眼屏换一行灰字 |
| 技能页（已载入） | **≥ 10 首屏 / 28–35 全页** | 每技能行 2–3 | 单行最多 8 元素 |
| 技能页（未登录） | 3 | 1 | 最干净 |
| 待审入口 | 5 次点击（应用内） | — | 通知入口 1 步 |
| 设置页（默认） | **≈ 32 文本节点 / 7 组** | 10+ | **无窗口条、无眼屏** |
| 网关页（已载入） | 8 顶层 / 30+ 节点 | 6+ | 4 层内距叠加 |
| 印象页（已载入） | 6–7 | 2 | 三段解释性文字 |
| Fairy 互动 module（非页面，附此备查） | — | — | `FairyEmblem` 两入口无调用点 |

---

## 附录 C：本轮不做的事

- 未跑 gradle（另有队友跑全量 Android 测试），因此**没有新的截图**；所有像素数据来自仓库内既有两张，
  时效已在开头声明。
- 未改任何 Android 源码、未 `git add`、未 `git commit`。
- 后端只读，用于核对「客户端是否在替后端说话」。
