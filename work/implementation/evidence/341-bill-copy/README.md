# #341 电费账单文本优化

票面：[GitHub #341](https://github.com/eafen405/OurFairy/issues/341)（本地副本 [`work/tickets/341/`](../../../tickets/341/README.md)）。
账单页出自规格 [#317](https://github.com/eafen405/OurFairy/issues/317)（本地副本 [`docs/specs/fairy-bill.md`](../../../../docs/specs/fairy-bill.md)）。
基线 `main` @ `408e62b`。

## 用户要求

1. 删去账单界面所有小字，一点不留，只留下两个框中的内容。
2. 数字显示不全；超过三位数用 K/M/B 丁尼这类单位，保留一位小数，布局不改。

## 改了什么

**删去页面说明文字。** 账单页原来在三个总量之前有一段开场说明、在走势图之后有汇率说明、口径脚注
（辅助调用不记账、悬挂回合不计入）与「正在刷新…」提示。全部删除；页面只剩两块仪器面板——
三个总量（`bill-totals`）与最近 30 天走势（`bill-chart`）——加上与数字无关的状态文案：未登录
引导、首次读取中、空账单、失败与重试。状态文案不是小字：读不到数字时它们是唯一的信息，删掉
会把「正在读」和「零账单」混为一谈（#322 的既有语义）。

**总量改成紧凑单位。** `billDennyText` 与 `billCountText` 共用一条规则：千位以下维持原样
（丁尼仍是一位小数，token 仍是整数），千位起换成 K/M/B/T 并保留一位小数。取整到一位小数发生在
选单位之前，所以 999,999 读作 `1.0M` 而不是 `1000.0K`；`BillUnits` 是单位与倍率的唯一清单。
数值由 `BigDecimal` 产生，分隔符与手机 locale 无关。列宽、面板与行序未改。

**规格留痕。** `docs/specs/fairy-bill.md` 的「已知的口径缺口」与「标题生成等辅助调用不计入」
两处原本要求把缺口写进账单页脚注；按本票在原文后追加一条 2026-11-10 的呈现修订，说明脚注从页面
移除而缺口本身不变。原文条款保留可追溯。

## 声称与检查

| 事实 | 检查 |
| --- | --- |
| 账单页没有开场说明、汇率说明、口径脚注 | `FairyBillPageTest.the page keeps no small print outside the two panels` 逐个断言三条原文文字的出现数为 0 |
| 千位以上用 K/M/B 并保留一位小数 | `BillFormatTest` 的 Denny 与 token 两组用例 |
| 取整进位换下一单位，不印四位 | `BillFormatTest.rounding to one decimal carries into the next unit instead of printing four digits` |
| 分隔符不随手机 locale 变 | `BillFormatTest.the separator is a dot whatever the phone's locale is`（切到 `Locale.GERMANY`） |
| 三个总量在页面上确实显示紧凑数字 | `FairyBillPageTest.the three totals each show Denny and tokens` 断言 `2.0K`、`60.0K`、`600.0K` |
| 窄屏 + 大字体下数字不被截断 | `FairyPagesTest.the bill's figures fit the narrowest viewport`（320dp、1.3 倍字体）与 `…the bill is two panels and figures in units` 读回 `TextLayoutResult.hasVisualOverflow` 断言为 false |

「小字已全部删除」的可执行检查限于**本票删掉的那三条文字**：页面其余文案按角色保留，测试逐个
断言它们的具体内容与出现次数，而不是断言「页面上没有别的 Text」。

**截图暴露的一条残留问题。** 数字改用单位后，常规 411dp 视口已完整；但 320dp + 1.3 倍系统字体下，
`400.0K 丁尼` 仍会省略。测量后确认原因不是数字本身：三个总量平分面板，该列宽 79px，而一行
"数字 + 全尺寸的『丁尼』" 要 82px。因此补了两处**只改字号、不改布局**的处理——丁尼单位用
`0.62em` 相对字号（跟着数字一起缩），两个数字行改用 `TextAutoSize.StepBased` 在放不下时逐级降一号。
`FairyPagesTest` 的两条用例读回 `TextLayoutResult.hasVisualOverflow` 断言未被截断，而不是只断言
文字存在（省略号仍在 semantics 里保留全文，字符串断言发现不了截断）。

## 门禁

均在本轮最终工作区执行（`android/` 下用 JDK 21 与 SDK `/home/fatfish/tools/android-sdk`；
commit 时 `scripts/precommit.ts` 判定为 full，重跑同样三条命令）。

| 命令 | 结果 |
| --- | --- |
| `./gradlew :app:testDebugUnitTest --tests '…BillFormatTest' --tests '…FairyBillPageTest' --tests '…FairyPagesTest'` | BUILD SUCCESSFUL；BillFormatTest 6、FairyBillPageTest 11 全绿 |
| `./gradlew test lintDebug` | **BUILD SUCCESSFUL**；766 单测 0 失败 0 跳过；lint 仅 1 条既有 `createAndroidComposeRule` 弃用告警 |
| `npm test` | **836 tests / 836 pass / 0 fail**（671.6 s） |
| `npm run combo:verify` | 三行全 ok：`ourfairy`（worktree 即集成分支 tip）、`dsh @ ae2adffd8d67`、`android source @ 460109d1b89b` |
| `node scripts/evidence-index.ts --check` | `evidence index is current` |

## 未完成项

- 真机与模拟器未运行：本轮只到 Robolectric 与构建门禁。截图来自 Robolectric 的 NATIVE 图形模式
  （`FAIRY_UI_SCREENSHOTS` 钩子，411dp 与 320dp 各一张），设备上的实际观感仍需确认。
- 未改后端、`/bill` 形状、汇率常量与其余两处呈现面（会话内 token 小字、Fairy 上下文读数）。

