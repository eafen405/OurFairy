# #124 文档收口：实施票与任务图

父票：[#124 文档收口：以「两个仓库」为准的事实纠偏与减法整理](https://github.com/eafen405/OurFairy/issues/124)。
票面本体的 Web 权威在上面这个链接；本目录是工作副本，编号对应见 `published.json`。

子票（互不阻塞，可并行）：

| 文件 | 票号 | 内容 |
| --- | --- | --- |
| `01-topology.md` | #125 | 两仓事实的拓扑纠偏：根文档与 android 快照文档 |
| `02-docs-navigation.md` | #126 | docs/ 导航：索引页与归档迁移 |
| `03-specs-and-boundary.md` | #127 | 规格与边界收口：消除冲突条款、逐条核验声称 |
| `04-dated-records.md` | #128 | 日期化记录的状态标注与研究基线收敛 |
| `05-conventions-and-notes.md` | #129 | CONVENTIONS 瘦身与 work/ 失效入口清理 |

---

## Problem Statement

这个仓库的文档在几轮并行开发之后已经和代码对不上，而读文档的人（新接手的维护者、被派去干活的代理、做验收的审查者）没有可靠办法分辨哪句还算数。

具体的失真有三类：

1. **拓扑是错的。** 文档在多个地方仍把客户端描述成外部的第三个仓库：`android/AGENTS.md` 让人去读"相邻 `../OurFairy/`"，`android/README.md` 说产品"由 OurFairy 管理"并链到本仓库自己的 URL。事实上只有两个仓库：本仓库（后端 + `android/` 客户端）与 dsh fork。
2. **路径和数字是死的。** `backend/chat/src/history.mjs`、`activity.mjs`、`projection.mjs`、`delivery.mjs`、`backend/bundle` 都已被 #72/#73/#99 删掉或搬走，但仍有文档把它们写成现行模块；测试条数、包个数这类由代码决定的事实被抄成散文（133 / 151 / 172 / 185 / 234 同时存在）。
3. **已废弃的决定还站着一等公民的位置。** 例如"首版共用模型显式配置为 deepseek-official/deepseek-flash"（实际是 `minimax-cn` / `MiniMax-M3.1-Flash`）、"优先复用 dsh HTTP unary 与 WebSocket stream"（实际自建 SSE `/chat/observe`）、"将 resync 时取共用默认值，尚未实现每轮跟随共用选择"（实际每轮都重读）。

叠加的第二个问题是**入口太多且互不同步**：根 `README.md`、`AGENTS.md`、`work/implementation/CONVENTIONS.md`（自称"唯一入口"）、`docs/` 下 36 个没有索引的文件、`GLOSSARY-MAP.md`，同一个事实（拓扑）至少写在四处。读者要么读到错的，要么不知道该信哪一个。

维护者为此付的代价是每次合并都要重新判断"这段还算不算数"；代理付的代价是照着过期指令干活。

## Solution

以**两个仓库**为准，对文档做一次减法整理，而不是校验工程。

- **只有两个仓库**：OurFairy（产品仓，含 `android/`）与 dsh fork。任何把客户端描述成外部仓库、任何"跨仓集成"的说法都是错的，删掉。
- **分三档**：现行（今天必须为真）、日期化记录（保留原文，只许加一行状态）、冻结历史（不追改）。判据是"这个文件是不是在描述当前状态"。
- **删，不缝补**：作用为零或为负的文字直接删除。不为保住一句话去补断言，也不新增一套文档检查机制。（配合"项目是个人项目、面向少量受邀用户"的规模校准：这次清理的产出是可读的现状，不是监控体系。）
- **一个事实一个家**：拓扑写进根 `README` 的一段，其余位置只放指针；读者不再在四处拓扑描述之间猜。
- **`docs/` 变成可导航的**：新增索引页，把提案与讨论类文件移到 `docs/archive/`，日期化调查留在原地但标注状态。
- **`work/` 只清入口**：证据与票面是历史，不动；只删除那些仍在冒充"现行指令"的协调文档。

整理完成后，一个新人打开根 `README` 应当能回答：这是什么、装了什么、怎么跑、去哪读细节；一个代理照着 `AGENTS.md` 与 `CONVENTIONS.md` 干活不应撞上过期指令。

## User Stories

1. 作为第一次打开仓库的维护者，我希望根 `README` 用一段话讲清"两个仓库、谁是谁"，以便不必在四份文档里拼出拓扑。
2. 作为第一次打开仓库的维护者，我希望 `docs/` 有一页索引说明每个目录放什么，以便不再逐个文件点开猜。
3. 作为刚接手的维护者，我希望看到的所有现行文档都只描述当前事实，以便不用每次先判断"这句是不是过期的"。
4. 作为维护者，我希望唯一的外部依赖是 dsh 且以锁定提交表述，以便复现一次构建时不必打听第三个检出。
5. 作为维护者，我希望读到"客户端在 `android/`"，而不是"客户端在另一个仓库"，以便不会去找不存在的路径。
6. 作为维护者，我希望失败时的报错能指向文件，以便删除或更新的是真文件而不是记忆里的旧路径。
7. 作为维护者，我希望不再看到"三仓""跨仓""配套 fork"这类词，以便拓扑只有一种说法。
8. 作为代理人，我希望 `AGENTS.md` 只包含仍然成立的规则，以便我按它办事不会踩到已废弃的约定。
9. 作为代理人，我希望 `CONVENTIONS.md` 不再让我去读已过期的交接文档，以便上下文压缩后的恢复路径是真的。
10. 作为代理人，我希望文档里的模块路径都还在，以便我不会去改一个已经被删掉的文件。
11. 作为代理人，我希望"该去读哪个文件"有明确指针，以便不必扫 36 个文档才能开始。
12. 作为审查者，我希望每份现行的架构与规格文档都只陈述仍成立的事实，以便评审时不用先做考古。
13. 作为审查者，我希望已废弃的决定有明确状态（现行 / 已被哪张票取代），以便能区分"当时为什么这么定"与"现在是什么"。
14. 作为审查者，我希望日期化的调查记录标明"不描述当前状态"，以便不会被当作实现依据引用。
15. 作为审查者，我希望提案与讨论类文档已归档，以便 `docs/` 顶层只留现行材料。
16. 作为审查者，我希望归档不是删除，以便需要追溯设计过程时仍能找到原文。
17. 作为验收者，我希望父规格仍然是可以引用的需求权威，以便行为验收仍有依据。
18. 作为验收者，我希望父规格里与现状矛盾的地方已经改掉或被取代，以便引用它时不会引到过时要求。
19. 作为验收者，我希望证据目录里的历史记录保持原样，以便"当时跑了什么"不会被后人改写。
20. 作为验收者，我希望票面副本保持原样，以便票据与证据能对应上。
21. 作为验收者，我希望这次整理的每一处删除都有记录，以便仍能回答"那句为什么要删"。
22. 作为客户端读者，我希望 `android/` 里的拓扑句指向本仓库，以便不会去相邻目录找 `../OurFairy/`。
23. 作为客户端读者，我希望知道 `android/` 是导入的快照、不跟随上游，以便不会尝试例行合并。
24. 作为客户端读者，我希望客户端文档里过期的过程报告不再以"本轮说明"的身份被引用，以便不会拿旧数字当现状。
25. 作为维护者，我希望客户端业务代码在这次整理中一行都不变，以便快照的完整性不受文档整理影响。
26. 作为维护者，我希望术语表只保留仍在使用、且与实现一致的词，以便 `GLOSSARY.md` 不是一份历史沉积。
27. 作为代理人，我希望术语分域的地图指向真实存在的词汇文件，以便不会继续往根词汇表堆词条。
28. 作为维护者，我希望不再有文档自称"唯一入口"却指向过期内容，以便入口名实相符。
29. 作为维护者，我希望测试条数、包个数这类会变的事实不再以硬编码数字出现在现行文档里，以便它们不会再次腐烂。
30. 作为维护者，我希望本次整理之后 `docs/` 的日常改动很少，以便下一次不需要再做一次这样的清理。
31. 作为维护者，我希望这次整理的改动可以按文件归属拆开并行，以便不必等一个人把所有文档读完。
32. 作为维护者，我希望每张子票交付一份"删了什么、为什么留什么"，以便删文这种工作也能被复核。
33. 作为维护者，我希望整理结束后全量测试仍是绿的，以便确认这次只动了文字。
34. 作为维护者，我希望仓库里没有断链，以便归档迁移没有把任何指针弄坏。

## Implementation Decisions

### 分档与文件归属

**现行（必须今天为真，可删可改）**：根 `README.md`、`AGENTS.md`、`GLOSSARY.md`、`GLOSSARY-MAP.md`、`CODING_STANDARDS.md`、`work/implementation/CONVENTIONS.md`、`docs/README.md`（新增）、`docs/specs/`、`docs/architecture/`、`docs/adr/`、`docs/agents/`、`docs/glossary/`、`work/implementation/evidence/README.md`（索引本身），以及 `android/` 中与两仓事实矛盾的拓扑描述。

**日期化记录（保留原文，只许加一行状态）**：`docs/decisions/`、`docs/research/`。

**冻结历史（不追改）**：`work/implementation/evidence/**`（除索引页）、`work/tickets/**`、`work/implementation/notes/**`（只允许移出或加状态头，不改正文）。

### 两仓原则

只有两个仓库：本仓库（后端 + `android/` 客户端，版本由本仓库一个提交表达）与 dsh fork（按提交锁定，`combo.json` 是唯一权威）。这条事实的事实源是根 `README` 的一段；`AGENTS.md`、`CONVENTIONS.md`、父规格不再各写一份，只放指针。

`android/` 是导入的快照，不跟随上游；取上游修复走手工挑选。来源提交只写在 `combo.json` 的 `androidSource` 与 `android/ourfairy-source.json`，其他文档不另抄。

### 一个事实一个家

| 事实 | 唯一位置 |
| --- | --- |
| 仓库拓扑、两个入口、许可证与来源 | 根 `README.md` |
| 给代理的规则 | `AGENTS.md` |
| 协作协议、worktree 流程、证据协议 | `work/implementation/CONVENTIONS.md` |
| 证据目录的索引 | `work/implementation/evidence/README.md` |
| 产品词汇 | `GLOSSARY.md`（分域由 `GLOSSARY-MAP.md` 指） |
| 模块边界与未采用的原生接缝 | `docs/architecture/dsh-ecosystem-boundary.md` |
| 需求与约束 | `docs/specs/ourfairy-v1.md` |
| 难逆的取舍 | `docs/adr/` |
| 日期化决策与调查 | `docs/decisions/`、`docs/research/` |
| `docs/` 的目录导航 | `docs/README.md`（新增） |

包清单、行清单、模型选择、测试条数这类可由代码或配置推导的事实，现行文档不重复声明，只指向 `backend/v1-bundle/` 与测试入口。

### 归档判据

只有"描述当前状态"的文件留在 `docs/` 顶层与子目录。提案、讨论、一次性调查报告、已被后续票取代的方案，移到 `docs/archive/` 并在文件头加一行"归档于 2026-10-20，原因：…，现行见 …"。

`docs/research/` 已按日期命名且被大量证据引用，**留在原地**，每篇文件头加一行"日期化调查，不描述当前状态"。移动它们会打断历史引用，收益不抵成本。

### 声称与检查

现行文档里每一句"A 由 B 派生""X 已被保证""清单由 Y 决定"，必须能指出在它失效时会失败的具体命令或测试（`CODING_STANDARDS.md`「声称须可执行」）。**指不出的，删除该声称，不为它补断言。** 本次不新增任何文档检查机制。

### 子票切分

按文件归属切，五张，互不阻塞、可并行：

1. [#125 两仓事实的拓扑纠偏：根文档与 android 快照文档](https://github.com/eafen405/OurFairy/issues/125)
2. [#126 docs/ 导航：索引页与归档迁移](https://github.com/eafen405/OurFairy/issues/126)
3. [#127 规格与边界收口：消除冲突条款、逐条核验声称](https://github.com/eafen405/OurFairy/issues/127)
4. [#128 日期化记录的状态标注与研究基线收敛](https://github.com/eafen405/OurFairy/issues/128)
5. [#129 CONVENTIONS 瘦身与 work/ 失效入口清理](https://github.com/eafen405/OurFairy/issues/129)

### 完成判据

每张子票交付一份**删除清单 + 保留理由**：删了哪些段落/文件、各为什么（零价值、负价值、已被取代、重复权威），以及保留下来的文档各自"一句话定位"。不做"重读并签字"这种无法区分的仪式。

### 已知漂移清单（本次要处理的起点）

拓扑类：`android/AGENTS.md:3`、`android/README.md:34`、`android/docs/references/fairy-client-runtime.md:3,62`、`work/implementation/notes/73-execution.md:11,35-36,66`、`73-review-findings.md:129-131,216-220`、`spec71-boundary.md:9`、`stage-*-handoff.md` 中"三仓"表述、`CONVENTIONS.md:9,48,106,135-139`。

失效路径类：`notes/73-boundary.md:12,16,25`、`notes/73-execution.md:57`、`notes/73-row-plan.md:14,55-58`、`notes/stage-t16-t19-handoff.md:5`、`notes/stage-t13-t15-handoff.md:9`。

已废弃决定类：`docs/decisions/v1-implementation-route.md:15,34,58`、`docs/decisions/upstream-compatibility-calibration.md:45`、`docs/specs/ourfairy-v1.md:189`（与 `docs/architecture/dsh-ecosystem-boundary.md:24,30-33` 冲突）。

失效数字类：`notes/73-execution.md:34,64`、`notes/73-review-findings.md:95,123-125,214`、`stage-*-handoff.md` 中的旧条数、`CONVENTIONS.md:77`（Gradle 缓存大小）、`android/docs/references/fairy-client-runtime.md:62`、`android/README.md:38`（把 0966502 写成"研究基线"容易被读成来源）。记录在 `notes/` 与证据里的旧数字是历史，不追改；只处理**现行文档**里的。

权威重复类：研究 SHA 清单在 `docs/specs/ourfairy-v1.md:307`、`CONVENTIONS.md:32-34`、`notes/client-access-seams.md:3`、`notes/dsh-ownership-seams.md:3` 各写一份；`CONVENTIONS.md:25-28` 的仓库表与 `combo.json` 的 `repos` 同值但未声明后者为准；`backend/v1-bundle/README.md:67-70` 在声明"bundle 是模型唯一权威"的同时又抄了一遍模型值；"来源只写两处"这条规则本身写在 `README.md:53` 与 `CONVENTIONS.md:41-42` 两处。

**勿误删（审计核过，仍然正确）**：`docs/decisions/upstream-compatibility-calibration.md:59` 的 `6/6`（`tests/text-delivery.test.mjs` 仍是 6 个用例）、`android/docs/references/fairy-client-runtime.md:59` 的 275（app 202 + ui 20 + highlight 53）、同文件 `:43` 的 86/10 文件数。这些不是漂移，删了反而失真；但它们仍有"会腐烂"的性质，按日期化记录处理（见子票 4），不当作现行数字引用。

`work/implementation/evidence/stage-71-73/README.md` 记录过 #123 的汇合交接项漏执行（已补），本票不重新追改该证据；但 #123 票面"全仓库不再把 rikkahub 描述成当前第三个仓库"这句验收，因 `android/` 被排除而实际未满足，本票子票 1 负责补齐。

## Testing Decisions

**本次不新增测试。** 文档整理的正确性靠人核验，判据见"完成判据"。理由：项目规模是个人项目、面向少量受邀用户；上一轮已经证明"靠人发现漂移"是可行的，而新增一套文档检查机制属于为假设的需求过度设计。

唯一仍在起作用的机械网是现有的 `tests/docs.test.mjs`（全仓 Markdown 相对链接必须可解析）。它是**归档迁移的安全网**：把文件移进 `docs/archive/` 后，所有指向它的链接必须同步修正，否则这条测试会红。这是本次唯一可执行的验收信号。

每张子票完成的机械底线（同样是现有检查，不新增）：

- `npm test` 保持全绿（当前 234 条）；
- `npm run combo:verify` 三行 ok；
- `git diff --check` 对改动范围无空白错误（`android/` 快照自带的既有空白不算）。

**已经可执行的声称，不必重复声称**。下面这些事实已经有测试盯着，现行文档提到时只需指向测试，不再复述取值：两仓循环与来源声明（`tests/android-source.test.mjs`）、bundle 行与包集合一致及已安装集合（`tests/bundle-packages.test.mjs`）、模型单一权威与 probe 报告（`tests/bundle-manifest.test.mjs`）、原生能力四类存在与失败文本（`tests/native-capabilities.test.mjs`）、插件 semver peer 与 locale（`tests/plugin-compatibility.test.mjs`）、边界文档必须点名接缝且禁止抄行/包清单（`tests/ecosystem-boundary.test.mjs`）、故事矩阵与票归属（`tests/story-coverage.test.mjs`）、共享选择下一轮生效（`tests/gateway.test.mjs`）。反过来，**拓扑、测试条数、包个数、文档是否过期这几类没有测试**——这正是本次要靠人核验的部分。

人工核验的三条口径：

1. **两仓**：全文搜索"三个仓库""三仓""跨仓""配套 fork""客户端不在本仓库"，现行文档中命中即不合格（日期化记录在状态头之后出现不算）。
2. **指针**：删除或移动文件后，指向它的每一处引用都要么同步改，要么一并删除。
3. **声称**：指不出失效检查的声称，删掉而不是改写。

## Out of Scope

- 代码：`backend/`、`scripts/`、`tests/`、`android/` 的业务代码一行不改；本次只动 Markdown（以及为归档而必要的路径移动）。
- 冻结区正文：`work/implementation/evidence/**` 的证据正文、`work/tickets/**` 的票面正文、`docs/research/**` 的正文，一律不改。
- 已发布票据：GitHub 上已关闭的 issue 不追改；如发现票面与现状冲突，记录不修正。
- 新检查机制：不新增文档检查测试、不引入文档生成、不建立"禁用词"扫描。
- 结构改造：不合并 `backend/` 下的包、不调整 bundle 行、不做 dsh 升级。
- 客户端构建与真机验收：不属于文档整理的验收范围。

## Further Notes

- 本次整理的起点是 2026-10-20 合并 #71/#72/#73/#123 之后的工作树（`integration/ourfairy-v1`）。上一轮已就地修正的两处（`docs/architecture/dsh-ecosystem-boundary.md` 的"客户端不在本仓库"、父规格 §8 的三仓表述与"配套 fork"措辞）不在本票重复范围，只作为先例。
- 调查用的漂移清单来自一次只读审计，覆盖拓扑（A）、失效路径（B）、失效数字（C）、权威重复（D）、废弃决定（E）五类；本票面已并入 A/B/E 的具体条目，C/D 在执行时按同样的口径补齐，不另立清单。
- 判断"某段是否算负价值"用一条测试：如果删掉它，读者会做错事或找不到东西吗？会 → 保留并修正；不会 → 删。
- 子票之间没有阻塞关系；但因为子票 2 会移动文件、子票 1/3/4 会改链接，若并行执行，合并时以"链接必须解析"（`tests/docs.test.mjs`）为冲突仲裁。
