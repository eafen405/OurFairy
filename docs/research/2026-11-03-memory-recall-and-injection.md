> 2026-11-03 状态：日期化记录。本文记录 2026-11-03 的外部一手资料调研与本机实测，服务于记忆插件的 review，不描述 OurFairy 当前实现，也不提出已批准的方案。外部结论以公开一手资料为限；本机实测的部分单独标注。

# 记忆的召回与注入：主动调用 vs 被动注入、中文检索与后台蒸馏

## 范围与证据口径

本篇回答六个问题：别人怎么处理「主动调用 vs 被动注入」的两级形态、SQLite FTS5 对中文能不能用、小库上字面关键词的真实失败模式、后台蒸馏（含便宜模型）的质量证据、模型忘记调用工具的证据、以及库规模与召回质量的关系。

上一篇同类调查（[2026-10-26-context-memory-dreaming.md](2026-10-26-context-memory-dreaming.md)）已经覆盖了 Letta / Mem0 / Graphiti / LangMem / SillyTavern 的**写入、纠正与删除语义**与**默认召回形态分布**。本篇不重复那部分，只在需要对照时引用其结论；本篇的重心是**检索层的可用性**与**注入形态的工程参数**。

**三类陈述的区分**（全文标注）：

- 【事实】——可直接在引用的一手资料中读到的内容（含官方文档原文、源码、release log）。
- 【项目自称】——项目方自己给出的效果声明或 benchmark 数字，本篇只转述，不代为背书。
- 【推断】——本文基于上述事实做出的判断，属于分析结论，不是被验证过的事实。
- 【本机实测】——本文作者在本机跑的命令及其输出，附环境与语料来源。**这类结果可复现，但语料是构造的，不是我们的真实记忆库。**

**证据缺口（先说清楚）**：`help.openai.com` 与 `openai.com` 在本机出口返回 HTTP 403，**ChatGPT 的 memory 机制未能获得一手引文**，下文不以任何形式转述它。

**方法论说明与补正**：本篇首轮成文时 `web_search` 不可用（无 API key），全部外部结论来自直接抓取官方页面、GitHub REST API 与 arXiv API，即只有「已知 URL 的核实」，**没有检索式覆盖**。**2026-11-03 稍后 `web_search` 恢复，已补做一轮有界检索**，结果并入 §1.1.2、§4.3、§4.4、§5.3.1、§5.4、§5.5，并在文末「修正记录」列出被推翻或需限定的原判断。**即便如此，本篇仍不声称是穷尽检索**——补充检索每项只做数次查询，属于定向核实而非系统综述。

**版本与访问日**：外部文档访问日统一为 **2026-11-03**；本机运行时为 **Node.js v24.22.2**，其内置 SQLite 为 **3.53.4**（`SELECT sqlite_version()` 实测）。

---

## 0. 结论摘要

1. **【事实】本次核实到 7 个产品面，其中 6 个是混合形态，1 个不是。** 逐项名单见下表；没有引入任何未核实的来源（ChatGPT memory 因 403 未获一手引文，**不在名单内，全文未引用**）。

   | # | 产品面 | 形态 | 一手来源 |
   | --- | --- | --- | --- |
   | 1 | Claude Code（含 auto memory / `MEMORY.md`） | 混合：常驻 + 工具检索 | <https://code.claude.com/docs/en/memory> |
   | 2 | Agent Skills（progressive disclosure） | 混合：元数据常驻 + 按需正文 | <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>、<https://agentskills.io/home>、<https://code.claude.com/docs/en/skills.md> |
   | 3 | Letta（memory blocks vs archival） | 混合：block 常驻 + archival 工具查 | <https://docs.letta.com/v1-sdk/memory/memory-blocks.md>、<https://docs.letta.com/v1-sdk/memory/archival-memory.md> |
   | 4 | Mem0 | **非混合**：app 侧检索后注入，模型不调工具 | <https://docs.mem0.ai/core-concepts/memory-operations/search> |
   | 5 | LangMem | 混合：hot path 工具写入 or 后台，检索二选一 | <https://langchain-ai.github.io/langmem/concepts/conceptual_guide/> |
   | 6 | OpenAI Agents SDK | 混合：历史+摘要注入 + 工具搜 `MEMORY.md` | <https://openai.github.io/openai-agents-python/sessions/>、<https://openai.github.io/openai-agents-python/sandbox/memory/> |
   | 7 | Cursor（rules） | 混合：四档，含「按描述由 Agent 决定」 | <https://cursor.com/docs/rules> |

   混合的六个（Claude Code、Agent Skills、Letta、LangMem、OpenAI Agents SDK、Cursor）形状高度收敛：**一个硬性封顶的常驻层 + 一个无上限的按需层**。Mem0 是例外——它的检索在应用侧完成、在模型调用前注入，模型不调工具；但它同样有 token 预算（约 6,956 tokens/query）。**所以真正普遍的不是「混合」，而是「常驻/注入层必须封顶」这一条。** 封顶参数：Claude Code 的 `MEMORY.md` 取「前 200 行或 25KB 先到者」、CLAUDE.md 建议 200 行、skill 列表描述截断 1,536 字符、Letta memory block 建议 <50k 字符、Mem0 约 6,956 tokens/query。
2. **【事实】「索引常驻 + 全文按需」有成熟先例，且 Anthropic 把它写成了产品规范。** Progressive disclosure 的第一层是 name+description 元数据，第二层是 `SKILL.md` 正文，第三层是链接文件；Cursor 的规则分类是同一件事的另一种标注（`Always Apply` / `Apply Intelligently` / `Apply to Specific Files` / `Apply Manually`）。
3. **【事实】SQLite FTS5 的 `trigram` tokenizer 能索引中文，但有硬下限：查询少于 3 个 Unicode 字符必然零命中。** 官方原文见 §2。这使 trigram **不能**成为我们 `instr(content, ?)` 子串语义的替代品，只能是一个叠加的相关度信号。
4. **【事实】FTS5 在 Node 24 的 `node:sqlite` 里是编进去的**，不构成 blocking 事实。
5. **【推断】对我们的库规模，检索的瓶颈不是速度，是语义。** 本机实测：500 行 × 2000 字的库上 `instr` 0.88ms；5000 行 × 300 字上 9.9ms。这个量级根本不是用户能感知的。真正的失败是**换了说法就找不到**——构造语料上，同义/概括词查询 5/5 未命中。
6. **【事实】「模型忘记调用记忆工具」有一手记录**，但全部是 issue 形态的非正式自述，且与「记忆被忽略」混淆。
7. **【事实】「把何时使用写进工具描述」是官方明文要求**；但**唯一**找到的受控研究（When2Tool）发现 prompt 层导引会**同时压制必要调用**，方向与直觉相反。
8. **【事实】连 Letta 自己都在两个方向之间摆动过**：v2 提示词写了明确的检索触发条件（"use the tools available to search for more information when the current open files and core memory do not contain enough information or if you do not know the answer"），现行 v1 提示词又退回只描述机制、只留一句 "when needed"。**所以「必须写触发条件」并非这批实现的共识。**
9. **【事实】「后台蒸馏用便宜模型」的质量证据：没找到。** Mem0 论文对所有 LLM 操作固定用 GPT-4o-mini 且无跨抽取器消融；2026-11-03 补充检索后**缺口确认成立**（§4.3）。不应被表述为已确立的取舍。
10. **【事实】2026-11-03 补充检索新增两篇可直接引用的论文。** ERRAND（<https://arxiv.org/abs/2609.29545>）给出「维护调度用闭式算术、调度器零模型调用（40ms/step）」的直接先例，其实测中「用年龄替代信念排序」掉 6.6pp——我们当前 `ORDER BY content_updated_at DESC` 本质就是 age-only。另一篇行为基准（<https://arxiv.org/abs/2610.41124>）量化了「该检索时是否检索」：同为商业模型，OK 题检索率从 20% 到 >90%（§5.3.1、§4.4）。
11. **【事实】「常驻索引提升记忆使用率」这个核心假设，检索后仍无一手证据**，且 Letta 有反方向实测（§5.4）。若 review 要提这条建议，必须标为基于设计惯例的推断。

---

## 1. 「主动调用 vs 被动注入」：别人的形状

### 1.1 常驻层与按需层的硬参数

【事实】下列参数均来自官方文档原文，是可核对的封顶值，不是估计。

| 产品 | 常驻层（每轮/每会话注入） | 封顶参数 | 按需层（工具/文件检索） |
| --- | --- | --- | --- |
| Claude Code | 祖先目录 `CLAUDE.md`、`CLAUDE.local.md`、`MEMORY.md` | `MEMORY.md` 前 200 行或 25KB；CLAUDE.md 建议 <200 行；单文件 >4 MiB 整体跳过；import 递归上限 4 跳 | 子目录 CLAUDE.md 在读到该目录文件时才加载；glob/grep |
| Agent Skills | 每个 skill 的 `name` + `description` | 列表描述截断 1,536 字符；压缩后每 skill 保留前 5,000 tokens，共享 25,000 tokens 预算 | `SKILL.md` 正文、链接文件 |
| Letta | memory blocks（XML 形式 prepend 到 prompt） | 建议 <50k 字符/block，建议 <20 blocks | archival memory，仅工具可查 |
| Mem0 | 检索结果注入（app 侧，非模型调用） | 约 6,956 tokens/query（vendor 口径，top_200 检索预算） | 无——检索在模型调用前完成 |
| OpenAI Agents SDK | 会话历史 + `memory_summary.md` 摘要 | `SessionSettings(limit=N)` 取最近 N 条；raw memory 超 256 条时丢旧的 | 通过工具搜索 `MEMORY.md` 索引 |

来源：Claude Code memory <https://code.claude.com/docs/en/memory>；Skills 工程文 <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>（现服务在 `/research/` 路径）与规范 <https://agentskills.io/home>；skills 数值 <https://code.claude.com/docs/en/skills.md>；Letta <https://docs.letta.com/v1-sdk/memory/memory-blocks>、<https://docs.letta.com/v1-sdk/memory/context-hierarchy>；Mem0 <https://docs.mem0.ai/core-concepts/memory-operations/search>、<https://docs.mem0.ai/core-concepts/memory-evaluation>；OpenAI Agents SDK <https://openai.github.io/openai-agents-python/sessions/>、<https://openai.github.io/openai-agents-python/sandbox/memory/>。

官方原文摘录（Claude Code，<https://code.claude.com/docs/en/memory>）：

> "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation. Content beyond that threshold is not loaded at session start."

> "All discovered files are concatenated into context rather than overriding each other."

> "Imported files can recursively import other files, with a maximum depth of four hops."

> "Size: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."

【事实】注意最后一句：**Anthropic 自己给出了「注入过多会降低遵从度」的因果判断，并据此设了建议上限**。这不是我们的推测。

**这句引文的出处**（review 里引用必须精确，本篇核对过三个位置，措辞有细微差别）：

- **主出处**：Claude Code memory 文档 <https://code.claude.com/docs/en/memory>，"CLAUDE.md files" 一节的 `Size` 条目，原文：`**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence.`
- **同页另一处**（讲路径作用域规则时的变体，措辞是 "may reduce"）："Files over 200 lines consume more context and may reduce adherence. Claude Code skips a file over 4 MiB."
- **不是**出自 context engineering 工程文（<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>）——该文没有这句话。引用时请勿归到那篇。

### 1.1.1 「一条记忆一行、带标识」的目录形态：Claude Code 的 `MEMORY.md` 就是

这是本节对「常驻索引层应该长什么样」最直接的一手先例，值得单独列出。

【事实】Claude Code 的 auto memory 目录结构，官方文档写得很明确（<https://code.claude.com/docs/en/memory>）：

> "The directory contains a `MEMORY.md` index and one topic file per memory:"
> "├── MEMORY.md           # Index, one line per memory, loaded into every session"
> "├── user_role.md        # One memory"
> "├── feedback_testing.md # One memory"

> "`MEMORY.md` acts as an index of the memory directory. Claude reads and writes files in this directory throughout your session, using `MEMORY.md` to keep track of what's stored where."

> "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation."

> "Claude Code doesn't load topic files such as `user_role.md` or `feedback_testing.md` at startup. Claude reads them on demand using its standard file tools when it needs the information."

【事实】超限时的官方指令**就是「一条记忆一行」**：

> "If the file is near a limit, Claude Code reminds Claude to shorten it: keep one line per entry, move detail into topic files, and merge or drop stale entries."

【事实】每条记忆还带一个类型标签与写入时间戳，即「带元数据的条目」：

> "Claude records the kind as a `type` field in the memory file's frontmatter" —— 取值为 `user` / `feedback` / `project` / `reference`
> "When Claude writes a memory file that begins with YAML frontmatter, Claude Code records the write time in a `modified` frontmatter field as an ISO 8601 timestamp."

【推断】这就是我们「常驻索引层」的直接先例，而且是**形态最接近**的一个：一条记忆 = 一个条目，索引里一行，正文在按需文件里。关键差别是 Claude Code 用**文件路径**当标识（`user_role.md`），我们用的是**稳定整数编号**（ADR-0002 要求不复用）。两者都是「稳定、可寻址、与内容分离」的标识，可以直接对应。

### 1.1.2 补充核实的三个产品面（2026-11-03 复检 `web_search` 可用后进行）

【事实】**Windsurf / Cascade**（<https://docs.windsurf.com/windsurf/cascade/memories>，现已迁至 `docs.devin.ai/windsurf/...` 路径）的规则系统有**四档触发**，与 Cursor 同一谱系：

> `always_on` — "Every session"
> `glob` — "When the agent works with files matching globs"
> `model_decision` — "When the agent decides the rule's description is relevant"
> `manual` — "Only when you invoke it"

同页还有一句**直接印证 progressive disclosure 已扩散到第三方产品**：

> "Skills use progressive disclosure: only the skill's name and description are shown to the model by default. The full SKILL.md content and supporting files are loaded only when the agent decides to invoke the skill, or when you invoke it. This keeps your context window lean even with many skills defined."

【事实】**Cline Memory Bank**（<https://docs.cline.bot/best-practices/memory-bank>）是**纯常驻、无按需层**的反例：它要求模型每个任务开始时读完全部记忆文件，用指令强制而非检索：

> "I MUST read ALL memory bank files at the start of EVERY task - this is not optional."

它的结构是固定 6 个文件（`projectbrief.md`、`productContext.md`、`activeContext.md`、`systemPatterns.md`、`techContext.md`、`progress.md`），**不是一个可增长的条目列表**。这说明 Memory Bank 解决的是「跨会话的项目文档」而非「N 条事实的检索」，与我们的问题不同构。

【事实】**Google Gemini 的 Memory**（<https://support.google.com/gemini/answer/16598625>）官方帮助页只描述了**用户可见的行为**（"Remember that I am vegetarian"、在 Settings 里查看/编辑/删除记忆），**没有描述任何注入预算、索引形态或工具调用机制**。

【推断】**Cline 是一个有价值的反例**：它选择「全部常驻 + 指令强制读」而不是「索引 + 按需」，且是官方推荐做法。这削弱了「索引常驻 + 按需全文是唯一形状」的强度——它只是**在记忆条目可增长、需要检索**时才成为形状；对固定数量、固定用途的项目文档，全量常驻是可行的。Gemini 因官方页未描述机制，**不纳入形态统计**。

### 1.2 Progressive disclosure 的准确表述

【事实】Anthropic 工程文原话（<https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>）：

> "At startup, the agent pre-loads the `name` and `description` of every installed skill into its system prompt."

> "This metadata is the **first level** of _progressive disclosure_… The actual body of this file is the **second level** of detail. If Claude thinks the skill is relevant to the current task, it will load the skill by reading its full `SKILL.md` into context."

> "These additional linked files are the **third level** (and beyond) of detail, which Claude can choose to navigate and discover only as needed."

> "This means that the amount of context that can be bundled into a skill is effectively unbounded."

规范侧的等价表述（<https://agentskills.io/home>）：

> "**Discovery**: At startup, agents load only the name and description of each available skill… **Activation**: When a task matches a skill's description, the agent reads the full `SKILL.md` instructions into context."

【推断】这两段合起来定义了我们要找的那个形状：**常驻层不是记忆内容的摘要，而是记忆的「目录」**——每个条目的名字与一句描述。第二层才是条目正文。关键点在于，Anthropic 的设计里第一层的**激活条件写在 description 里**，而不是要求模型「记得有一个记忆系统」。

### 1.3 Anthropic 自己承认这是混合，并点名了污染控制手段

【事实】<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>（现服务在 `/research/`）：

> "Claude Code is an agent that employs this hybrid model: CLAUDE.md files are naively dropped into context up front, while primitives like glob and grep allow it to navigate its environment and retrieve files just-in-time, effectively bypassing the issues of stale indexing and complex syntax trees."

> "context windows of all sizes will be subject to context pollution and information relevance concerns"

> "once a tool has been called deep in the message history, why would the agent need to see the raw result again? One of the safest lightest touch forms of compaction is tool result clearing"

【事实】Cursor 的分类是同一问题的另一种标注（<https://cursor.com/docs/rules>）。注意：`docs.cursor.com/context/rules` 与 `/docs/context/memories` 均已 404，现行页面在 `cursor.com/docs/rules`，**且标签改了**——不是常被引用的 "Agent Requested"/"Auto Attached"：

> "| `Always Apply` | Apply to every chat session |"
> "| `Apply Intelligently` | When Agent decides it's relevant based on description |"
> "| `Apply to Specific Files` | When file matches a specified pattern |"
> "| `Apply Manually` | When @-mentioned in chat |"

> "When applied, rule contents are included at the start of the model context."

【推断】`Apply Intelligently` 就是「第一层常驻 description、由模型决定是否拉正文」；`Always Apply` 就是我们的印象注入。Cursor 与 Anthropic 在同一个谱系上取了不同默认值，说明**这不是二选一，而是一个可调档位**。

### 1.4 对「污染」的唯一硬证据：context rot

【项目自称】Chroma 技术报告（<https://research.trychroma.com/context-rot>，2025-07-14，代码公开但未经同行评议）：

> "Across all experiments, model performance consistently degrades with increasing input length."

> "models do not use their context uniformly; instead, their performance grows increasingly unreliable as input length grows."

报告里与记忆直接相关的一组对照是 LongMemEval 的 focused（约 300 tokens）vs full（约 113k tokens）：

> "Across all models, we see significantly higher performance on focused prompts compared to full prompts"

【推断】这是「被动注入会污染」这一主张目前**最强的可引用证据**，但它来自一个向量数据库厂商的自家评测，且测的是长上下文问答，不是记忆注入。它的方向性（更短更聚焦更好）与 Anthropic 的「建议 200 行」一致，两个独立来源互相支持，因此可以当作工程直觉的依据，但不应引用为「注入 N 字符会掉 X 分」这种精确结论。

---

## 2. SQLite FTS5 对中文到底能不能用

这一节是本篇最硬的部分：全部以 SQLite 官方文档原文为准，并附本机实测。

### 2.1 版本要求

【事实】FTS5 自 **3.9.0**（2015-10-14）起进入 amalgamation；`trigram` tokenizer 需要 **SQLite ≥ 3.34.0**（2020-12-01）。

官方 FTS5 文档 <https://sqlite.org/fts5.html> §2.1：

> "As of [version 3.9.0] (2015-10-14), FTS5 is included as part of the SQLite amalgamation. If using the canonical source tree, FTS5 is enabled by specifying the "--enable-fts5" option when running the configure script."

3.34.0 release log <https://sqlite.org/releaselog/3_34_0.html> 第 7 条：

> "Enhanced [FTS5] to support [trigram indexes]."

【事实】Node 24 的 SQLite 是 3.53.4，远高于门槛。

### 2.2 trigram 的中文行为：能用，但 <3 字符必然零命中

【事实】<https://sqlite.org/fts5.html> §4.3.4 "The Trigram Tokenizer" 的定义：

> "The trigram tokenizer extends FTS5 to support substring matching in general, instead of the usual token matching. When using the trigram tokenizer, a query or phrase token may match any sequence of characters within a row, not just a complete token."

紧接着的 Notes 第一条，是本节最重要的一句：

> "Substrings consisting of fewer than 3 unicode characters do not match any rows when used with a full-text query. If a LIKE or GLOB pattern does not contain at least one sequence of non-wildcard unicode characters, FTS5 falls back to a linear scan of the entire table."

【本机实测】环境 Node.js v24.22.2 / SQLite 3.53.4，表 `fts5(content, tokenize=trigram)`，插入「记忆插件使用说明」：

| 查询 | 字符数 | `MATCH` 结果 |
| --- | --- | --- |
| `咖啡` | 2 | **0 行** |
| `豆豆` | 2 | **0 行** |
| `猫` | 1 | **0 行** |
| `喝咖啡` | 3 | 命中 |
| `周末在` | 3 | 命中 |

【推断】这是中文场景的决定性限制。中文的最小自由语素普遍是 1–2 字（「猫」「豆豆」「咖啡」「香菜」「生日」），而 trigram 对它们的召回率**恒等于零**，与库里有多少数据无关。所以「trigram 替换 `instr`」这个候选**在语义上就不成立**。

### 2.3 绕过办法：trigram 表上的 LIKE 走索引，且 2 字可用

【事实】同一节明文：

> "Unless the remove_diacritics option is set, FTS5 tables that use the trigram tokenizer also support indexed GLOB and LIKE pattern matching."

> "If an FTS5 trigram tokenizer is created with the case_sensitive option set to 1, it may only index GLOB queries, not LIKE."

> "The index cannot be used to optimize LIKE patterns if the LIKE operator has an ESCAPE clause."

【本机实测】同一 trigram 表上 `content LIKE '%咖啡%'` 返回正确行（2 字也工作），而 `MATCH '咖啡'` 返回空。

【推断】如果要两全，形态是：**trigram 表上同时用 `LIKE`（保子串语义与 2 字查询）和 `MATCH`（取 bm25 相关度分数）**，并对少于 3 字的查询退回 `LIKE`。但见 §2.6，这个组合给我们的收益主要是**排序**，不是速度。

### 2.4 `detail=` 会直接禁用多字 MATCH，别用

【事实】<https://sqlite.org/fts5.html> §4.3.4 Notes 第二条：

> "If the FTS5 table is created with the detail=none or detail=column option specified, full-text queries may not contain any tokens longer than 3 unicode characters. LIKE and GLOB pattern matching may be slightly slower, but still works."

§4.6 给出 detail 的语义与体积代价：

> "The detail option may be set to "full" (the default value), "column" or "none"."
> "In one test that indexed a large set of emails (1636 MiB on disk), the FTS index was 743 MiB on disk with detail=full, 340 MiB with detail=column and 134 MiB with detail=none."

【本机实测】`detail=none` 下 `MATCH` 查询 7 字串：

```
fts5: phrase queries are not supported (detail!=full)
```

【推断】detail 是一个「省体积 / 丢能力」的旋钮。只要还想用 `MATCH` 做相关度排序，就必须留 `detail=full`；只有纯粹拿 trigram 表当 LIKE 索引时，`detail=none` 才划算。

### 2.5 `unicode61`（默认 tokenizer）对中文不可用

【事实】<https://sqlite.org/fts5.html> §4.3.1：

> "all unicode characters assigned to a general category beginning with "L" or "N" ... or to category "Co" ... are considered tokens. All other characters are separators."

> "Each contiguous run of one or more token characters is considered to be a token."

【本机实测】默认 tokenizer 建表，插入「记忆插件使用说明」：`MATCH '记忆'` 返回 **0 行**；同一表 `MATCH 'hello'` 对「hello world」正常返回。

【推断】中文汉字属于 `Lo`，全部算 token 字符，且没有空格分隔，因此整段无空格中文被切成**一个超长 token**。后果是「只有整段完全一致才命中」。这与我们当前 `instr` 的差别是：`instr` 至少能做真正的子串匹配。**所以 `unicode61` 比现状更差，不是改进方向。** 用 unicode61 处理中文必须先在应用层分词再以空格喂入，那就引入了分词器依赖。

### 2.6 性能：我们的规模上这不是瓶颈

【本机实测】`instr` vs trigram 表 LIKE/MATCH，三个规模，每项 50 次取均值：

| 规模 | 操作 | 2 字查询 | 3 字查询 | 5 字查询 |
| --- | --- | --- | --- | --- |
| 500 行 × 300 字 | `instr(content,?)` | 0.18 ms | 1.17 ms | 0.70 ms |
| 500 行 × 300 字 | trigram `MATCH` | 0（不支持） | 0.015 ms | 0.014 ms |
| 5000 行 × 300 字 | `instr(content,?)` | 2.07 ms | 9.94 ms | 9.08 ms |
| 5000 行 × 300 字 | trigram `LIKE` | 0.13 ms | 0.011 ms | — |
| 500 行 × 2000 字 | `instr(content,?)` | 0.88 ms | 6.46 ms | 5.42 ms |

【本机实测】索引体积：2000 行 × 约 28 中文字，`dbstat` 统计正表 212,992 B、trigram 索引 241,664 B，约 **1.13×**。

【推断】对一个「几十到几百条事实」的个人记忆库，`instr` 的绝对耗时在**亚毫秒到个位毫秒**，用户完全无法感知。**因此 FTS5 候选的价值不在于「更快」，而在于「能按 bm25 排序」。** 如果把改进目标写成性能，证据不支持；写成排序与召回语义，才成立。

### 2.7 FTS5 在 Node 侧是否可用（不是 blocking 事实）

【事实】Node 24 的 SQLite 编译定义含 FTS5。Node 仓库 <https://raw.githubusercontent.com/nodejs/node/v24.x/deps/sqlite/sqlite.gyp> 中 `defines` 包含：

```
'SQLITE_ENABLE_FTS3',
'SQLITE_ENABLE_FTS3_PARENTHESIS',
'SQLITE_ENABLE_FTS5',
```

【本机实测】`PRAGMA compile_options` 输出含 `ENABLE_FTS3`、`ENABLE_FTS3_PARENTHESIS`、`ENABLE_FTS5`；`CREATE VIRTUAL TABLE ... USING fts5(...)` 成功。

【事实】`better-sqlite3` 同样默认编入 FTS5，其 <https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/deps/defines.gypi> 含 `'SQLITE_ENABLE_FTS5'`。

【推断】**「FTS5 不可用」这个 blocking 顾虑可以排除**，无论走 `node:sqlite` 还是 `better-sqlite3`。`node:sqlite` 在 Node 24 的状态是 Stability 1.2 Release Candidate（<https://nodejs.org/docs/latest-v24.x/api/sqlite.html>），这是另一个独立的风险点，但与 FTS5 无关。

### 2.8 中文分词的其它现实选项

【推断】以下是基于依赖形态的判断，**没有**做包体积实测：

| 方案 | 形态 | 代价 |
| --- | --- | --- |
| `jieba-wasm` | 纯 WASM，无原生编译 | 内置词典，包体积以 MB 计；需自管词典生命周期 |
| `nodejieba` | 原生插件 | 需编译工具链与各平台预编译产物 |
| 自建 bigram 倒排表 | 纯 SQL/JS | 无外部依赖，但多一张表与一套一致性维护 |

【推断】这三条都是在**解决「速度」而不是「语义」**。按 §2.6，我们的库不需要速度。它们也都不解决 §3 的真正失败模式（换了说法找不到）。因此对当前规模，引入分词器的成本收益不成立。

---

## 3. 字面关键词召回在小库上的真实失败模式

### 3.1 失败不是概率问题，是机械必然

【本机实测】构造 26 条中文个人事实（自造语料，非真实用户数据），用与 `store.ts` 等价的 `WHERE instr(content, ?) > 0` 查询：

| 失败类别 | 查询示例 | 应命中 | 实际 |
| --- | --- | --- | --- |
| A 同义/概括词 | `咖啡偏好` | 「用户喜欢晚上喝咖啡」 | 未命中 |
| A | `居住地` | 「用户住在杭州」 | 未命中 |
| A | `宠物` | 「用户的猫叫豆豆」 | 未命中 |
| A | `职业` | 「用户是后端工程师」 | 未命中 |
| A | `饮食禁忌` | 「用户对花生过敏」 | 未命中 |
| B 多词分处不同记忆 | `咖啡 豆豆` | 两条不同记忆 | 未命中 |
| C 语序/插入成分 | `喝咖啡喜欢` | 「用户喜欢晚上喝咖啡」 | 未命中 |

【本机实测】A 类 **5/5 未命中**，B 类 **3/3 未命中**，C 类 **3/3 未命中**。

【推断】这不是「小库所以关键词够用」的问题。语料只有 26 条，检索**零**误召回，失败全部来自**字面不匹配**。库越小，这个失败越纯粹地暴露出来——因为没有人会抱怨「库太大搜不准」，只会抱怨「明明记过却搜不到」。

### 3.2 那个「多词 AND」的直觉为什么救不了

【本机实测】用 trigram `MATCH '喝咖啡 AND 豆豆'` 试图做多词联合召回（两个词分属不同记忆行）——结果为空：

```
MATCH '喝咖啡 AND 豆豆' -> []
MATCH '咖啡 AND 豆豆'   -> []
```

【推断】`MATCH` 的语义是「**同一行**内满足整个表达式」，不是「跨行取并集」。所以 AND 组合能解决的是「同一行里的多个词」，解决不了「用户提到两个实体、分别记在不同行」。要做后者的正确形态是**对每个词各查一次再在应用层合并**，那与 FTS5 无关，是检索编排的问题。

### 3.3 trigram 能不能救「部分失配」：不能

一个具体的部分失配案例（由本队另一位评审在真实代码上提出）：库里存「用户的手机尾号是 8150」，用户问「手机号」。

【本机实测】同一份语料上对比三条路径：

| 查询 | 字符数 | `instr` | trigram `MATCH` | trigram 表 `LIKE` |
| --- | --- | --- | --- | --- |
| `手机号` | 3 | 0 | **0** | 0 |
| `手机` | 2 | 命中 | 0 | 命中 |
| `手机尾号` | 4 | 命中 | 命中 | 命中 |

【推断】这个案例**不是** tokenizer 选择问题，而是**字面匹配本身的语义边界**：库里是「手机**尾**号」，查询是「手机号」，中间隔了一个字，任何基于连续子串的方法（`instr` 或 trigram LIKE）都必然失败；而 trigram 还额外因为「手机号」正好 3 字、三个 trigram 与「手机尾号」的三个 trigram 无一相同而失败。**换成 FTS5 不解决这个案例**，能解决它的是同义/模糊匹配（向量或人工同义词表）。这也再次说明：把改进目标定在「换检索后端」是错位的。

### 3.4 向量检索在这么小的库上还有多少增益

【事实】**没找到**针对「几十到几百条个人事实」这一规模的向量 vs 关键词对照实测。已有的公开评测都是大库：Mem0 的 LOCOMO 口径是「top_200 retrieval budget」（<https://docs.mem0.ai/core-concepts/memory-evaluation>），与百条量级不是同一个问题。

【推断】在百条量级，向量检索**唯一**能解决的是 §3.1 的 A 类（同义/概括词）。这确实是最常见的失败。但代价是引入 embedding provider、维度存储、相似度阈值三项，且**阈值在百条库上极难标定**——太小则全命中，太大则退化成关键词。这是本篇证据最薄的一处，建议实测后再定，不要凭外部材料推断。

---

## 4. 后台蒸馏与提取-更新决策

### 4.1 触发条件与形态

【事实】Letta 的 dreaming（<https://docs.letta.com/configuration/memory>，原 sleep-time-agents 页面重定向至此；概念见 <https://www.letta.com/blog/sleep-time-compute>）：

> "Dreaming uses background subagents to review recent conversations, consolidate useful lessons, and update memory without interrupting your active work."

> "Choose when it runs: after a set number of completed agent steps or when the context window is compacted."

SDK 侧 `trigger: "step-count" // "off" | "step-count" | "compaction-event"`，`stepCount: 25`。

【事实】原始设计意图（<https://www.letta.com/blog/sleep-time-compute>）：

> "the primary agent is not provided with tools to edit its core memory… These tools are attached to the sleep-time agent, which has the ability to manage _both_ the in-context memory of the primary agent as well as its own in-context memory."

【推断】这与我们的做法**结构同形**：都是「主 agent 不写记忆 → 后台子会话写」。差别在触发口径：Letta 按**步数**或**压缩事件**触发，我们按**闭合用户回合数（默认 15）** 加**静默衰减（6 小时减 1）**。两者的共同点是都在用「增量水位 + 独立进程」避免污染主上下文。我们的静默衰减在 Letta 文档里没有对应物——这是我们的设计选择，外部没有背书，也没有反证。

### 4.2 Mem0 的 ADD/UPDATE/DELETE/NOOP：论文与现行产品已经不一致

【事实】这个四操作决策是**论文**里的（<https://arxiv.org/abs/2504.19413>）：

> "The LLM itself determines which of four distinct operations to execute: ADD for creation of new memories when no semantically equivalent memory exists; UPDATE for augmentation of existing memories with complementary information; DELETE for removal of memories contradicted by new information; and NOOP when the candidate fact requires no modification to the knowledge base."

【事实】**现行产品文档已经不是这个形状**（<https://docs.mem0.ai/core-concepts/memory-operations/add>）：

> "Add behavior | ADD-only; memories accumulate"
> "The key architectural decision is **ADD-only extraction**. New facts are stored alongside old ones. Nothing is overwritten or deleted."

【推断】这是一个**重要且容易被引错**的事实。把「Mem0 用 LLM 做 ADD/UPDATE/DELETE/NOOP」当成现行最佳实践来对照我们的增删改，是引用了两年前的设计。Mem0 现在的方向是**只增不改**，把冲突留到读取时裁决。这与我们「物理删除且编号不复用」的选择是**相反**的哲学——但注意，我们上一篇调查已指出 Mem0 平台侧的 Dream 才承担取代语义（见 [2026-10-26-context-memory-dreaming.md](2026-10-26-context-memory-dreaming.md) §7.3）。

### 4.3 「用便宜模型蒸馏」的质量证据：检索后仍未找到，缺口确认成立

2026-11-03 在 `web_search` 可用后**重新检索过一轮**，结论不变，且能说得更精确：

【事实】**Mem0、Letta、LangMem、Zep 均未发布「跨抽取模型」的消融或对比（2025–2026）。** 具体：Mem0 论文对所有 LLM 操作固定 GPT-4o-mini（§4.3 原文已引）；Letta 的 LoCoMo 博客（<https://www.letta.com/blog/benchmarking-ai-agent-memory>）明确说它测的是 **agent 架构与模型能力**，且刻意固定模型为 GPT-4o-mini 以对齐 Mem0 的实验，"We used GPT-4o mini for the agent to match the original experiment"，**没有做抽取模型的对照**；LangMem 文档同理。

【事实】检索命中的「看起来像」的材料，经核对**都不测量抽取模型质量**：
- 多篇 2026 年的评测论文（如 ACL 2026 的 <https://aclanthology.org/2026.acl-long.1607.pdf>）比较的是**记忆系统之间**的分数（LangMem 51.3 vs Mem0 61.3 之类），把强模型（gpt-4o-mini / gpt-4.1-mini）当作**固定的答题模型**，不是被比较的变量。
- 还有一篇 MemoryTax（arXiv:2610.29823）报告 "With GPT-4o-mini, Mem0 scores highest... Mem0 helps GPT-4o-mini but not GPT-6 Luna or Claude Opus 5.5"。这**沾边**但测的是「不同答题模型下 Mem0 是否有增益」，**不是**「抽取/蒸馏阶段换模型的质量差」。且我未能取得该文可核对的一手页面，**故不纳入**。

【事实】首轮成文时的逐项核查细节（保留以存档）：

- Mem0 论文（<https://arxiv.org/abs/2504.19413>）对所有 LLM 操作固定单一引擎："All language model operations utilized GPT-4o-mini as the inference engine." 全文**没有**跨抽取器（extractor）的消融。其 26%/91%/>90% 的收益是**对基线**，不是对更强抽取器。
- Mem0 OSS 配置文档（<https://docs.mem0.ai/open-source/configuration>）默认用 `"model": "gpt-5-mini"`，但只给了一条温度建议（"Keep extraction temperature at or below 0.2 so memories stay deterministic"），**无质量对比**。
- LangMem 抽取指南（<https://langchain-ai.github.io/langmem/guides/extract_semantic_memories/>）示例用 `claude-3-5-sonnet`，提到可后台跑，**无便宜 vs 贵的测量**。
- 最接近的一般性主张是立场论文 <https://arxiv.org/abs/2506.02153>（"Small Language Models are the Future of Agentic AI"），称 SLM 对许多调用"sufficiently powerful, inherently more suitable, and necessarily more economical"——**无记忆抽取数字**。

【推断】**缺口确认成立**：「后台蒸馏用便宜模型」在公开一手资料里没有质量证据支持。我们后台用 MiniMax-M3.1-Flash 是一个**未经外部验证的工程冒险**，而非有据可依的选择——这不意味着它错，只意味着**它必须靠我们自己的验收数据来支撑**，不能引用外部材料为它辩护。这一点应在 review 里如实写出。

### 4.4 【新增】ERRAND：维护调度用闭式算术、不花模型调用的直接先例

【事实】有一篇 2026-09-02 的论文与我们的维护子会话形态直接相关（<https://arxiv.org/abs/2609.29545>，标题 "ERRAND: Budgeted Maintenance of Agent Memory"，South Dakota State University；**经核实真实存在，arXiv 摘要页与 HTML 全文均可访问**）。

其摘要的核心主张：

> "a recheck competes with the task it protects for the same scarce actions, funded only when the value per action of resolving a doubt clears a running wage"
> "The margin sits where the briefing's coverage is thinnest, the shadow price of long-tail knowledge: a small budget, well priced, beats a bigger store that never rechecks."

全文里与**我们 `maintenance.ts` 每 2 秒重试 + 每次追加一条消息**最相关的两句：

> "Everything the scheduler computes is closed-form arithmetic over the retrieved candidates, k per step; scheduling never spends a model call."
> "the scheduler is closed-form arithmetic (40 ms/step, no LLM invocation); Δcalls: extra LLM calls per step versus Errand, shaded by size, whose targeted errands replace repeated failure recovery."

【事实】它有消融实验，且「只用年龄当索引」是明确被点名的弱基线：

> 表格行 "index: age only | 64.7 | 57.0 | 11.0% | ↓6.6" —— 即用年龄代替信念索引，ITT 掉 6.6pp。
> 主表还有 "index: belief only" −5.3pp、"uncalibrated belief" −13.0pp。

【推断】这篇对我们的三条直接含义（都是【推断】）：
1. **它支持「维护调度不该反复调 LLM」**：其调度器 40 ms/step 且零模型调用，靠闭式算术决定「这一轮值不值得检查」。我们每 2 秒重试、每次追加消息的做法，在**成本结构上与该文的结论相反**——它要省的正是这类调用。
2. **"index: age only" 掉了 6.6pp**，对我们有直接参照意义：我们 `memory_search` 现在是 `ORDER BY content_updated_at DESC`，**本质上就是 age-only 排序**。该文的实测表明，用年龄替代更好的排序信号会明显掉分。这为 §7.1「排序可以单独改进」补了一条外部量化支撑。
3. **该文语境是「维护既有记忆的新鲜度」**，不是「召回已存事实」，与我们的问题只部分重叠。**不可外推为「我们的记忆工具应该用闭式算术」**——我们还没有任何信念/新鲜度模型。

## 5. 模型「忘记调用记忆工具」

### 5.1 有一手记录，但都是 issue 形态

【事实】GitHub issue（经 GitHub REST API 核实，非正式自述）：

- <https://github.com/letta-ai/letta/issues/2413>（2025-02-05，已关闭）："It never replaces core memory or adds anything to archival memory, and sometimes it randomly tries to search the same string as my last message within the empty archival memory."
- <https://github.com/anthropics/claude-code/issues/96079>（2026-09-22，仍开放）："the primary purpose of \"memories\" is for Claude to ignore them until ... I ask it again to record a rule ... it spots the existing memory and says \"We already have that rule, I just ignored it.\""
- <https://github.com/anthropics/claude-code/issues/33603>（2026-03-12，仍开放）："Instructions written as explicit hard rules in CLAUDE.md and project memory (MEMORY.md) are loaded into context every session and are consistently not followed."

【推断】这些证据的可靠性有限：都是自述，且**混淆了「工具没被调用」与「记忆被读到但被忽略」**两种完全不同的失败。它们能支持「这个失败模式真实存在」，不能支持「发生率是多少」。

### 5.2 有基准在测「该不该调用」，但权重很低

【事实】Berkeley Function Calling Leaderboard（<https://gorilla.cs.berkeley.edu/leaderboard.html>）确实测「不该调用时不调用」：

> "we also evaluate the model's ability to withhold picking any function when the right function is not available"
> "In function relevance detection ... none of the provided functions are relevant ... We expect the model's output to be no function call."

但 irrelevance 类只占 5088 条评分项中的 1122 条，且"Hallucination Measurement"权重 10%（对比 agentic 40%、multi-turn 30%）。

【事实】v4 的 memory 赛道直接针对本议题（<https://gorilla.cs.berkeley.edu/blogs/16_bfcl_v4_memory.html>）：

> "The primary goal is assessing memory retrieval: the model must explicitly query the memory backend rather than relying on prior dialogue context."

该博文（2025-07-17 发布）自己的分后端数字是：KV Store 最高 Claude 3 Sonnet 53.55%、最低 Command A 7.74%；Vector Store 最高 63.87%、最低 5.16%；Recursive Summarization 最高 67.74%、最低 Llama 4 Maverick 1.29%。

**注意版本差异**：博文是 2025-07 的快照，而排行榜数据文件更新到 2025-12-16。从当前的 `data_agentic.csv`（<https://github.com/HuanzhiMao/BFCL-Result/blob/main/2025-12-16/score/data_agentic.csv>，109 个模型）读取，KV 子项最高已是 **Claude-Opus-4-5 70.97%**，最低是 0.00%（Granite-20b-FC、Hammer2.1-1.5b/7b、Llama-3.1-Nemotron-Ultra-253B-v1）。引用时必须说明是哪一版，不能把 2025-07 的 53.55%/7.74% 说成当前值。

【事实】**DeepSeek 在该榜上，MiniMax 不在**（109 个模型中无 MiniMax 条目）。DeepSeek-V3.2-Exp (FC) 的 Memory KV 为 **41.94%**（总排名 11/109），Prompt+Thinking 形态为 46.45%（17/109）。作为对照，KV 子项的中位区间和最高分（70.97%）见上。

【事实】web search 赛道命名了同一个失败模式（<https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html>）：

> "Failure mode: Avoids Tool Usage — Some models, despite having access to search tools, rely solely on their internal knowledge."

【推断】「模型不主动调用记忆工具」在**不同的模型上差异极大**（KV 子项 0.00%–70.97%，109 个模型）。这意味着插件的可用性强烈依赖底层模型，而不只由插件设计决定。

【事实】我们的模型处境是：**DeepSeek-V3.2-Exp 有数据，Memory KV 41.94%，约为榜首 Claude-Opus-4-5（70.97%）的六成**；**MiniMax 系列完全不在该榜**（109 个模型中无条目）。我们的轻量模型 MiniMax-M3.1-Flash 与主模型的记忆工具调用可靠性，**都还没有第三方数据**。

### 5.3 Letta 的对照：系统提示里写了明确的检索触发条件

这是回答「prompt 里不给触发条件算不算缺陷」的关键对照。Letta 的 MemGPT 系提示词**确实**写了触发条件。

【事实】经典 MemGPT 提示词 <https://github.com/letta-ai/letta/blob/archive/letta/prompts/system_prompts/memgpt_chat.py>，直接声明了「必须显式检索」这一事实：

> "Your archival memory is infinite size, but is held outside your immediate context, so you must explicitly run a retrieval/search operation to see data inside it."

> "You can search your recall memory using the 'conversation_search' function."

> "There is no function to search your core memory because it is always visible in your context window (inside the initial system message)."

【事实】v2 提示词 <https://github.com/letta-ai/letta/blob/archive/letta/prompts/system_prompts/memgpt_v2_chat.py> 新增了 `<context_instructions>` 段，把**何时该检索、何时不该检索都写成条件**：

> "You respond directly to the user when your immediate context (core memory and files) contain all the information required to respond."
> "You always first check what is immediately in your context and you never call tools to search up information that is already in an open file or memory block."
> "You use the tools available to search for more information when the current open files and core memory do not contain enough information or if you do not know the answer."

【事实】现行的 V1 提示词 <https://github.com/letta-ai/letta/blob/archive/letta/prompts/system_prompts/letta_v1.py> 又回到了**只描述机制、不给触发条件**的形态：

> "Memory Blocks: ... remain constantly available in-context."
> "External memory: Additional memory storage that is accessible and that you can bring into context with tools when needed."

【推断】这个演进序列值得注意：Letta 先在 v2 里写了显式触发条件，到 v1 提示词又删掉了，只留一句 "when needed"。**所以「写触发条件」不是这批实现的共识做法**，连 Letta 自己都在两个方向之间摆动过。这条证据同时削弱「必须写触发条件」和「写了就有效」两个方向的主张——它说明**连作者自己都没定下来**。

【事实】另有一个相关设计：Letta memory block 的 `description` 字段被明确定位为「agent 判断如何使用该 block 的主要信息来源」（<https://docs.letta.com/v1-sdk/memory/memory-blocks.md>）：

> "it's crucial to provide a good `description` field that accurately describes what the block should be used for. The `description` is the main information used by the agent to determine how to read and write to that block. Without a good description, the agent may not understand how to use the block."

【推断】注意这里说的是「如何读写」，不是「何时检索」。Letta 把「何时」放在系统提示的策略段，把「怎么用」放在工具/区块描述里——**这是两件不同的事**，不能互相替代。

### 5.3.1 检索后补充：找到第二篇受测量化「何时该检索」的决策

【事实】When2Tool 之外，2026-10-30 有一篇**行为基准**直接测量「该检索时是否检索」（<https://arxiv.org/abs/2610.41124>，Pathirage & Srijomkwan）：

> "Agentic LLM assistants must repeatedly decide whether to answer from memory or to call a tool such as web search. Unnecessary searches cost latency and money; missing ones yield confident but unsupported answers."

> "Across five commercial LLMs with and without their vendors' web search, GPT-5 mini and Grok 4 Fast search on over 90% of OK but only 1% of IK questions, whereas Mistral Small searches on just 20% of OK questions, often abstaining instead of using its tool"

> "Searching is partly triggered by explicit temporal cues: on uncued OK questions, the NAS of the two selective models falls from about 0.72 to 0.57–0.58."

> "The scores thus measure the search triggering of specific products, not metacognition in a strict sense."

【推断】这篇的价值有三点，也有一个重要的适用边界：
1. **它把「该不该检索」做成了可测量**（NAS / KIS 两个 action-level 分数），补上了 When2Tool 只有单点结论的空缺。
2. **它给出了「模型差距远大于提示词差距」的量化**：同为商业模型，OK 题检索率从 20% 到 >90%，差 4 倍以上。这与 §5.2 的 BFCL 结论方向一致。
3. **它证实「显式线索确实会触发检索」**："Searching is partly triggered by explicit temporal cues"，去掉线索后 NAS 从 ~0.72 掉到 ~0.57–0.58。这是**支持**「给触发条件有用」的一手证据，与 When2Tool 的「prompt 层导引同时压制必要调用」并不矛盾——两者测的是不同操作化。
4. **适用边界**：它测的是 **web search**，不是**记忆检索**；作者自己也声明测的是"specific products, not metacognition"。**不能直接外推到 `memory_search`。**

【推断】综上，§5.5 的结论需要限定为：**「加一句何时使用」的效果在文献中不一致**——When2Tool 说会同时压制（对工具调用决策），本篇说显式线索有帮助（对 web search 触发）。**一致的部分只有一条：模型间差异远大于提示词措辞差异。** 因此优化 prompt 措辞的期望收益，低于换用在该维度表现更好的模型。

### 5.4 【重要】检索后补充：常驻索引的收益**未被证实**，且有一个反方向的实测

这是本次 review 的核心决策点，检索结果**不利于「常驻索引层能提升记忆使用率」这一假设**。

【事实】**没有任何一手来源**测量过「常驻索引层（每条记忆一行）vs 无索引纯按需检索」对记忆**实际使用率**的影响。我检索到的所有相关证据，要么测的是检索**准确率**（LoCoMo 等问答基准），要么是**产品设计描述**（§1），没有一篇把「使用率」作为因变量。

【事实】更关键的是，Letta 有一篇**反方向的实测**（<https://www.letta.com/blog/benchmarking-ai-agent-memory>，2025-08-12，标题 "Benchmarking AI Agent Memory: Is a Filesystem All You Need?"）：

> "This simple agent achieves 74.0% on LoCoMo with GPT-4o mini and minimal prompt tuning, significantly above Mem0's reported 68.5% score for their top-performing graph variant."

这个 74.0% 的配置是什么？原文描述得明确——**没有专门的记忆索引，只有文件工具**：

> "When files are attached to a Letta agent, the agent gains access to a set of file operation tools: grep, search_files, open, close"
> "The conversational data is placed into a file, which is uploaded and attached to the agent."

【事实】Letta 自己给出的结论正是「工具能力 > 检索机制」：

> "Whether an agent "remembers" something depends on whether it successfully retrieves the right information when needed. Therefore, it's much more important to consider whether an agent will be able to effectively use a retrieval tool (knowing when and how to call it) rather than focusing on the exact retrieval mechanisms (e.g. knowledge graphs vs vector databases)."

> "simple tools are more likely to be in the training data of an agent and therefore more likely to be used effectively"

【事实】**来源性质与限制必须标清**：这是 **Letta 自家博客、自家基准、自家产品配置**（【项目自称】性质），且有一处与我们的场景不同——它的 agent 是**半自主的**，用 tool rules 强制先搜索：

> "we made the agent only partially autonomous by defining tool rules to limit the agent's tool-calling patterns. The agent must start by calling search_files and continue searching through files until it decides to call answer_question and terminate."

【推断】这个限制很关键：Letta 的成绩是在**强制先检索**的 tool rule 下取得的，恰恰不是「靠模型自发想起来检索」。所以它**支持**「结构化地强制检索路径有效」，**不支持**「加一层常驻索引就能提高使用率」。它同时是一条**反对「必须做索引」**的证据：一个扁平文件 + grep 就够了。

【推断】**对本次 review 的诚实结论**：核心决策点「常驻索引层能否提升记忆实际使用率」——**检索后仍无直接证据，不能支持这个改动**。能支持的最强主张只是「常驻索引是多家产品的共同形态」（§1，属设计惯例，非效果证据）。如果 review 要把这条列为建议，必须标明它是**基于惯例的推断，不是基于实测的结论**。

### 5.5 「把何时使用写进工具描述」：官方要求，但受控研究反向

【事实】官方明文要求。Anthropic 工具定义文档（<https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use>，经平台路径取得；`docs.claude.com` 在本机出口被区域限制）：

> "`description` | A detailed plain text description of what the tool does, when it should be used, and how it behaves."

> "**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance."

要求包含："When it should be used (and when it shouldn't)"；"Aim for at least 3–4 sentences."

【事实】但**常被引用的那篇工程文并没有这么说**。<https://www.anthropic.com/engineering/writing-tools-for-agents>（现服务在 `/research/`）只说：

> "Too many tools or overlapping tools can also distract agents from pursuing efficient strategies."
> "When tools overlap in function or have a vague purpose, agents can get confused about which ones to use."
> "Even small refinements to tool descriptions can yield dramatic improvements."

【推断】「写清何时使用」这条规则只有**一个**权威出处（工具定义文档），工程文并不重复它。引用时不要把两篇混为一谈。

【事实】唯一找到的受控研究给出了反向结果。When2Tool（<https://arxiv.org/abs/2605.09252>）：

> "Prompt-only suppresses necessary calls alongside unnecessary ones, and Reason-then-Act still incurs a disproportionate accuracy cost on hard tasks"

同时报告工具必要性在模型内部可解码，AUROC 0.89–0.96（六个模型）。

【推断】这是本次调研里最反直觉、也最该被写进 review 的发现：**在 prompt 里强调「何时该调用」，会同时压低「不该调用」和「该调用」两类**。净效果取决于基线偏向哪边。对我们的含义是：写清何时使用**不能**被当作提高调用率的保证手段，它改变的是偏差方向，不是无代价的增益。没有任何来源量化过「加一句何时使用 → 调用率提升 X%」。

---

## 6. 库规模与召回质量

【事实】没有找到针对 `<1000 条` 个人记忆库的公开对照实测。所有可引用的检索评测（Mem0 LOCOMO、BFCL memory 赛道）都在完全不同的规模与任务上。

【推断】本节的诚实答案是**证据缺口**，但本机实测可以补一点局部事实（§3.1）：在 26 条自造语料上，字面 `instr` 的失败**全部**来自措辞不匹配，与库大小无关；规模只影响速度（§2.6），而速度在我们的量级上不是问题。因此「小库所以关键词够用」这个说法，在**速度**维度成立，在**召回**维度不成立——它把两个不同的问题混成了一个。

---

## 7. 对 OurFairy 的直接含义

只写有上文证据支撑的。每条注明依据。

### 7.1 检索层

1. **【推断，依据 §2.2/§2.6/§3.1】不要把 FTS5 trigram 当作 `instr` 的替代。** 它在 <3 字查询上召回恒为零，而中文的高频查询词恰恰是 1–2 字。可以在**保留 `instr` 的前提下叠加** trigram 表以取得 `bm25()` 排序，但这是「排序改进」，不是「召回改进」，且需要一条「<3 字退回 `instr`」的分支。
2. **【推断，依据 §2.6】「检索太慢」不是我们的实际问题。** 5000 行 × 300 字的 9.9 ms 不是用户可感知的量级。任何以性能为由引入 FTS5、分词器或倒排表的方案，都应要求先给出真实的库规模数据。
3. **【推断，依据 §3.1】我们的排序（按 `content_updated_at DESC`）是一个独立的、可单独修的问题。** 它不依赖 FTS5：即使继续用 `instr`，也可以在命中集合内按其他信号重排。当前实现把「命中」与「排序」耦合成了「按时间倒序」，这是最便宜的改进面。
4. **【推断，依据 §2.5】`unicode61` 方向不可行**，比现状更差，除非先引入应用层中文分词——而 §2.8 与 §2.6 一起表明，在当前规模，分词器的成本收益不成立。

### 7.2 注入形态

5. **【事实，依据 §1.1.1】「一条记忆一行、带稳定标识的常驻索引」有直接先例**：Claude Code 的 `MEMORY.md` 就是「Index, one line per memory, loaded into every session」，正文在同目录的按需文件里，官方还明确规定超限时的做法是 "keep one line per entry, move detail into topic files"。它与我们的编号制可直接对应（它用文件路径，我们用不复用的整数编号）。
6. **【推断，依据 §1.1/§1.2/§1.3】「常驻索引 + 按需全文」是多家的共同形状**（Mem0 是例外，但它的注入层同样封顶），且我们的印象（8000 字符常驻）已经占了常驻层。Anthropic 的第一层是 `name` + `description` 元数据，不是内容摘要——这与我们「印象是一段散文」的形态不同。
6b. **【重要限定，依据 §5.4】但「加一层常驻索引能提升记忆实际使用率」这个因果主张，检索后仍无任何一手证据支持。** 现有证据只到「多家产品这么做」（设计惯例）。更需注意的是有一个**反方向**的实测：Letta 用**无索引的扁平文件 + grep** 在 LoCoMo 上取得 74.0%，高于 Mem0 图谱配置的 68.5%，其结论是「工具能力比检索机制更重要」。该结果附带一个对我们很关键的条件——它的 agent 被 tool rules **强制先检索**，所以它支持「结构化强制检索路径」，**不支持**「加索引就能提高使用率」。
   → **因此：若 review 要提「加常驻索引层」，必须标为基于惯例的推断，不得表述为有实测收益的改动。**
6c. **【事实，依据 §1.1.2】Cline Memory Bank 是一个反例**：它选择「全部常驻 + 指令强制读完全部文件」（"I MUST read ALL memory bank files at the start of EVERY task"），且是官方推荐做法。说明「索引 + 按需」只在**条目可增长、需要检索**时才是必需形状；对固定少量文档，全量常驻可行。
7. **【事实，依据 §1.1】8000 字符量级的常驻注入是有先例支持的**：Claude Code 的 `MEMORY.md` 上限 25KB/200 行、Letta block 建议 <50k 字符。我们的 8000 字符处在这些参考值的保守一侧。
8. **【事实，依据 §1.1】Anthropic 明确写了「更长文件消耗更多上下文并降低遵从度」，并因此给出建议上限。** 这为「注入预算」提供了官方依据，但注意它说的是 CLAUDE.md 这类**指令**文件，不是记忆内容；把它直接外推到记忆注入属于类比，不是同一结论。

### 7.3 主动调用

9. **【推断，依据 §5.2】「不主动调就记不住」的严重程度主要由**底层模型**决定**（同榜 7.74%–53.55%）。在把问题归因于插件设计之前，应先确定我们的模型在该维度落在哪个区间。目前没有我们的数据。
10. **【推断，依据 §5.5/§5.3.1】不要把「在工具描述里写清何时使用」当作提升调用率的手段。** 官方要求这么写（可读性、可发现性），但两篇文献结论不一致：一篇显示会**同时**压制必要调用，另一篇显示显式线索确实提升检索触发。**唯一一致的是模型间差异远大于措辞差异。** 因此优先级应是「选在该维度表现好的模型」>「结构化强制检索路径」>「优化描述文案」。
11. **【事实，依据 §5.1】「模型忘记调用记忆工具」有一手记录，但都是自述且与「记忆被忽略」混淆。** 如果我们想主张这是我们的主要故障，需要自己的证据，不能引用外部 issue 充数。

### 7.4 后台蒸馏

12. **【事实，依据 §4.3】「用便宜模型做蒸馏」没有外部质量证据。** 这是本次调研最明确的缺口。我们的 MiniMax-M3.1-Flash 选择必须由我们自己的验收数据支撑，review 里不应引用外部材料为它背书。
13. **【推断，依据 §4.1】我们的触发形状（闭合回合门槛 + 静默衰减 + 水位 + 子会话）与 Letta 的 sleep-time dreaming 结构同形，**差别仅在触发口径**。后者按步数/压缩事件，我们按用户回合与静默。这是可辩护的设计选择，但「静默衰减」没有外部对应物，属于我们自己的参数。
14. **【事实，依据 §4.2】不要把 Mem0 引为「LLM 决定 ADD/UPDATE/DELETE/NOOP」的现行先例**——那是论文时代的设计，现行产品是 ADD-only。我们做物理删除 + 编号不复用，属于与现行 Mem0 相反的方向；这在上一篇调查的 Dream 机制里有部分对应物。

### 7.5 明确不成立的说法

- 「FTS5 在 Node 里可能没编进去」——**不成立**（§2.7，两个驱动都编了）。
- 「trigram 能替代子串匹配」——**不成立**（§2.2，<3 字恒空）。
- 「小库用关键词就够了」——**在速度上成立，在召回上不成立**（§6）。
- 「写清何时使用能提高工具调用率」——**证据不一致**（§5.5）：一篇说会同时压制必要调用，另一篇说显式线索有助触发。
- 「便宜模型蒸馏是业界做法所以可行」——**没有证据**（§4.3）。

---

## 附：本文引用的一手来源

**SQLite 官方**
- <https://sqlite.org/fts5.html>（§2.1 编译、§4.3.1 unicode61、§4.3.4 Trigram、§4.6 Detail、§5.1.1 bm25）
- <https://sqlite.org/releaselog/3_34_0.html>（trigram 引入版本）

**Node / 驱动源码**
- <https://nodejs.org/docs/latest-v24.x/api/sqlite.html>（Stability 1.2 Release Candidate）
- <https://raw.githubusercontent.com/nodejs/node/v24.x/deps/sqlite/sqlite.gyp>（`SQLITE_ENABLE_FTS5`）
- <https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/deps/defines.gypi>（`SQLITE_ENABLE_FTS5`）

**Anthropic**
- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/skills.md>
- <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>
- <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- <https://www.anthropic.com/engineering/writing-tools-for-agents>
- <https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use>（经平台路径取得，本机出口对 `docs.claude.com` 有区域限制）
- <https://agentskills.io/home>

**其它产品**
- <https://docs.letta.com/v1-sdk/memory/memory-blocks>、<https://docs.letta.com/v1-sdk/memory/archival-memory>、<https://docs.letta.com/v1-sdk/memory/context-hierarchy>、<https://docs.letta.com/configuration/memory>、<https://www.letta.com/blog/sleep-time-compute>
- 系统提示词源码（`archive` 分支）：<https://github.com/letta-ai/letta/blob/archive/letta/prompts/system_prompts/memgpt_chat.py>、<https://github.com/letta-ai/letta/blob/archive/letta/prompts/system_prompts/memgpt_v2_chat.py>、<https://github.com/letta-ai/letta/blob/archive/letta/prompts/system_prompts/letta_v1.py>
- <https://docs.mem0.ai/core-concepts/memory-operations/add>、<https://docs.mem0.ai/core-concepts/memory-operations/search>、<https://docs.mem0.ai/core-concepts/memory-evaluation>、<https://docs.mem0.ai/open-source/configuration>
- <https://langchain-ai.github.io/langmem/concepts/conceptual_guide/>、<https://langchain-ai.github.io/langmem/guides/extract_semantic_memories/>
- <https://openai.github.io/openai-agents-python/sessions/>、<https://openai.github.io/openai-agents-python/sandbox/memory/>
- <https://cursor.com/docs/rules>
- <https://modelcontextprotocol.io/docs/concepts/tools>

**论文与基准**
- <https://arxiv.org/abs/2504.19413>（Mem0）
- <https://arxiv.org/abs/2605.09252>（When2Tool）
- <https://arxiv.org/abs/2506.02153>（Small Language Models are the Future of Agentic AI）
- <https://research.trychroma.com/context-rot>（Chroma 技术报告，未经同行评议）
- <https://gorilla.cs.berkeley.edu/leaderboard.html>、<https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html>、<https://gorilla.cs.berkeley.edu/blogs/16_bfcl_v4_memory.html>

**GitHub issue（非正式自述）**
- <https://github.com/letta-ai/letta/issues/2413>
- <https://github.com/anthropics/claude-code/issues/96079>
- <https://github.com/anthropics/claude-code/issues/33603>

**2026-11-03 补充检索后新增的来源**
- Windsurf / Cascade Memories：<https://docs.windsurf.com/windsurf/cascade/memories>
- Cline Memory Bank：<https://docs.cline.bot/best-practices/memory-bank>
- Google Gemini Memory 帮助页：<https://support.google.com/gemini/answer/16598625>
- Letta，《Benchmarking AI Agent Memory: Is a Filesystem All You Need?》：<https://www.letta.com/blog/benchmarking-ai-agent-memory>
- ERRAND（arXiv）：<https://arxiv.org/abs/2609.29545>
- Confident Fools or Careful Searchers?（arXiv）：<https://arxiv.org/abs/2610.41124>
- ACL 2026 记忆系统评测（仅用于说明「跨系统比较 ≠ 跨抽取模型消融」）：<https://aclanthology.org/2026.acl-long.1607.pdf>

**未能核实**
- ChatGPT memory（`help.openai.com`、`openai.com` 均返回 HTTP 403）——本文未引用。
- MemoryTax（arXiv:2610.29823）——检索命中但未取得可核对的一手页面，未纳入。

---

## 修正记录

本篇为日期化记录，正文按原样保留当时的判断，被后续核实推翻的部分在此单独列出。修正日期均为 2026-11-03。

1. **「十个一手来源」是计数错误**（§0 摘要第 1 条）。实际核实到 **7 个产品面**，已改为 7 并在摘要中逐项列出名单。ChatGPT memory 因 403 未获一手引文，从未进入名单。
2. **BFCL memory 数字的版本漂移**（§5.2）。原稿引用「7.74%–53.55%」，该区间出自 **2025-07-17 的博客快照**且仅指 KV Store 子项。当前排行榜数据（`2025-12-16`，109 个模型）KV 子项为 **0.00%–70.97%**。已补正并注明两版不可混引。
3. **「我们的模型无数据」说过头了**（§5.2）。核实后：**MiniMax 确实不在榜上，但 DeepSeek 在**——DeepSeek-V3.2-Exp (FC) 的 Memory KV 为 **41.94%**（11/109）。已改为「MiniMax 无数据；DeepSeek 有数据，约为榜首六成」。
4. **「常驻索引能提升使用率」的证据强度被高估**（§5.4、§7.2，最重要的一处）。原稿把它当作「多家收敛出的形状」推向建议；补充检索后发现**没有任何一手来源测量过这个因果**，且 Letta 有反方向实测（扁平文件 + grep 达 74.0%）。已加限定：只能标为基于惯例的推断。
5. **「写清何时使用」的结论需限定**（§5.5 / §5.3.1）。补充检索到第二篇受控行为基准（arXiv 2610.41124），发现显式线索**确实**会触发检索（NAS 0.72→0.57 是去掉线索后的下降）。两篇结论并不一致，一致的部分只有「模型间差异远大于提示词差异」。已把原稿的单向结论改为「文献不一致」。

**未纳入**：MemoryTax（arXiv:2610.29823）虽在检索结果中出现且与抽取模型话题沾边，但未能取得可核对的一手页面，按「核实不了的一律不写」处理。
