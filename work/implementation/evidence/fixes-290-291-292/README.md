# #290/#291/#292 小修批次集成

日期：2026-11-02。集成分支 `integration/fixes-290-291-292`，基线 `347c966ed4`（`main`）。
三票的开工基线都是 `a10711ec8d1fac8c`（#293 门禁自检修复），该提交已在集成分支中，不重复合入。

## 合并

| 票 | 分支 | 提交 | 内容 |
| --- | --- | --- | --- |
| #290 | `ticket/290-swipe-home` | `3b1787889d` | 主页左划进入当前会话/共享列表、会话页右划回首页；会话页顶栏改为齿轮与 Fairy 小屏回首页；会话列表标题与底栏图标；7 条文案「后端」→「服务端」 |
| #291 | `ticket/291-caption-exit` | `9b28ce5f64` | 待机台词气泡退场时高度连续收起，下方卡片与按钮随平移动画回位；`FairyCaptionSlot` 保留最后一句 |
| #292 | `ticket/292-tool-collapse` | `3f1e39f0ee` | 工具调用默认只显示最新一次；箭头展开该步全部调用；单工具无箭头，流式增长保持收起 |

合并方式：octopus merge，集成 tip `e59587b62bcabebe6f7f1d0d7cbe8bb289012973`，父提交为
`a10711ec8d` + 三票 tip。三票在同一批内互不冲突；`FairyConsolePage.kt` 的左右划与台词 slot
由 Git 自动合并，合并后定向测试通过。

## #291 的去重选择

同一张票有两版实现：

- 本地 `ticket/291-caption-exit`（`9b28ce5f64`）；
- PR #294（`agent/standby-dialog-exit-animation-18434fdb132b`，`5dd5944a55`）。

本批次选本地版：`FairyCaptionSlot` 把「保留最后一句」与退场动效收在 `FairyCaption.kt`，页面不持有
第二份台词；`LaunchedEffect` 不在组合期写状态；不修改 `FairyPagesTest`（#290 正在改该文件），并行
冲突面更小；Android 全量与 combo 证据齐全。

PR #294 的 200 ms / `enter = None` 更贴票面，但 `lastCaption` 在组合期写入、页面持有第二份台词、
截图命令缺少 `FAIRY_UI_SCREENSHOTS`；作为重复实现关闭，不并入本批次。

已知差异：本地版把气泡出现也做成 250 ms 的 `expandVertically` + `fadeIn`，票面说「出现的效果是
不错的」。本批次接受这个行为差异；若要严格保留原出现观感，把 slot 的 `enter` 改为
`EnterTransition.None` 即可（PR #294 的做法），退场与 Reduced Motion 不变。

## 最终门禁

合并提交 `e59587b62b` 走 `pre-merge-commit` 全量门禁，未使用 `--no-verify`：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 474 tests / 17 suites，0 fail / 0 cancelled / 0 skipped，`duration_ms` 133446 |
| `npm run combo:verify` | `combo: combination verified`（ourfairy / dsh / android source 三行 ok） |
| `cd android && ./gradlew test lintDebug` | `BUILD SUCCESSFUL in 2m 49s`，134 actionable tasks；JUnit XML 合计 628 tests（app 556、ui 20、highlight 52），0 failures / 0 errors / 0 skipped；`lintDebug` 通过 |

## 未执行 / 遗留

- 真机/模拟器：左右划手感、长按文本选择与横滑竞争、待机气泡 250 ms 退场观感、工具调用箭头点击与
  TalkBack 均未在设备上验收。
- #291 的出现动画差异（见上）。
- PR #294 关闭为重复实现，保留其分支供 superagent 实验记录。
