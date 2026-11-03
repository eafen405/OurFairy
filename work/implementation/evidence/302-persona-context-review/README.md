# #302 Fairy 上下文工程批判：证据目录

2026-11-03。本目录是 [#302](https://github.com/eafen405/OurFairy/issues/302) 立项前的调查产物。
票面正文与验收在 [work/tickets/302/302.md](../../../tickets/302/302.md)（发布权威是 GitHub issue）。

本目录只收录**调查结论与复核方法**。原始语料在
[248-memory-integration-acceptance](../248-memory-integration-acceptance/) 下，本次未复制、未修改。

## 这是什么调查

不读文档，按 `backend/v1-bundle/cordis.patch.yml` 实际挂载的行逐段测量，再用 248 票真实模型运行的
37 条回复做实测。四个只读子调查并行：装配地图、部署人格的代入式批判、插件接缝源码核验、一手资料研究。

**未启动后端、未跑 `npm test` / `npm run build`、未修改任何产品代码。** 全部结论来自读源码与既有语料。

## 文件

| 文件 | 内容 | 方法 |
| --- | --- | --- |
| [01-context-map.md](01-context-map.md) | 一次主人会话的 system prompt 全集与顺序（9 段）、runtime-context 快照、顺序权威归属、第三方注入通道、用户差异的 5 套机制、注入面围栏现状、13 条摩擦带 file:line | 逐包读 `systemPrompt.section`/`context` 注册点 + `git show d80522d` 取锁定提交行号 |
| [02-fairy-testimony.md](02-fairy-testimony.md) | 第一人称的部署人格证词，附工程师复核：结构性 6 条 / 概率性 5 条 / 无效约束 9 条，每条带 file:line 或 JSON 行号；含提示词负担清单与 300 字最短声明 | 逐字读全部 prompt 段 + 37 条回复统计 |
| [03-plugin-seam.md](03-plugin-seam.md) | `system-prompt/assemble` waterfall 的能力边界（能改什么、哪些改写会被覆盖）、`complete:true` 的代价、窄接口草案、与 ADR-0001 的关系、可执行检查建议 | `packages/core/system-prompt` 与 `packages/core/scope` 逐行读 + dsh 自身测试对照 |
| [04-research-summary.md](04-research-summary.md) | 研究摘要：三条可迁移判据与四条证据空白 | 见下一节的研究稿 |
| [HANDOFF-302.md](HANDOFF-302.md) | 交接文档：证据索引、接手先知道的坑、下一步顺序、需要拍板的事 | — |

研究正文在仓库的 [docs/research/2026-11-03-persona-stability.md](../../../../docs/research/2026-11-03-persona-stability.md)
（755 行，43 条唯一来源，26 条固定到 commit/tag，10 条显式证据空白，文末有修正记录）。
该文**尚未登记** `docs/research/README.md` 索引。

## 口径（复现这些数字时按这里）

- **语料基数**：`work/implementation/evidence/248-memory-integration-acceptance/results.json`，
  11 个案例 / 37 条回复 / 8298 字符。`invalidate-rerun.json` 仅 1 例实体、`before-fix.json` 无 reply，
  两者**不计入**比例。
- **段长以运行记录反验为准**：短号 3（无印象）2221 字符、短号 2（含印象块 156）2379 字符，均与
  `results.json` 记录精确相等。做法是把 9 段长度加 7 个 `\n\n` 分隔；Alice 多一段故为 8 个分隔。
  先前一版测量合计 2281（误差 60 字符）已废弃。
- **证据式断言**统一指 `数据显示` / `数据表明` 两个固定短语，共 20 条，不含 `数据确认` / `数据层面` 等变体。
  其中 13 条落在 5 个零工具调用的案例（chit-chat-no-write 2 / volatile-observation 3 /
  passing-preference 2 / maintenance-no-rewrite 4 / cross-user-discretion 2）。
- **dsh 行号基准**：`combo.json` 锁 `d80522d`（rc.2）；本机检出工作树 HEAD 是 `d743267388`（alpha.2，
  与 pin 非祖先）。01 与 03 两文行号基准不同已各自标注；`system-prompt/src` 两版只差 4 行常量，
  `scope/src` 零差异，故装配结论两版通用；`child-agent.ts` 差 59 行，按行号实施前须在 pin 版复核。

## 本目录的可执行性

本次结论**没有**做成自动检查，因此不能防止漂移。`#302` 的验收里要求补的守卫
（assembled prompt 的段清单断言、`complete` 生效即失败、证据判据）尚不存在：
现有 85 个测试套件对 section 顺序零覆盖。这是已知缺口，不是已完成状态。
