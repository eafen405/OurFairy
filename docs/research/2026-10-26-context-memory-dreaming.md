> 2026-10-26 状态：日期化记录。本文记录 2026-10-26 的外部一手资料调研，不描述 OurFairy 当前实现，也不提出实现方案。全部结论以公开一手资料为限，未在本项目内实测。

# 上下文治理、长期记忆与 DREAMING：外部成熟项目一手资料调研

## 范围与证据口径

本篇只覆盖**外部项目**。dsh 插件形态与旧 Fairybot 记忆库／DREAMING 实现由其他代理核查，本篇不重复；只在必要处引用 [`GLOSSARY.md`](../../GLOSSARY.md) 的既有术语（法厄同／代理人／Fairy／DREAMING／投递消息）以便对齐，不重述其内容。

**一手来源口径**：只采用项目官方文档、官方源码、官方论文与官方包元数据。二手博客、对比评测文章、厂商软文一律不作为依据——检索过程中命中过大量此类材料（例如各类 "Mem0 vs Letta vs Zep" 选型文章），已全部排除。官方自建文档站（`docs.letta.com`、`docs.mem0.ai`、`help.getzep.com`、`docs.sillytavern.app`、`langchain-ai.github.io/langmem`）视作官方一手资料。

**版本固定**：每个外部项目固定到可复查的 release／tag／文档版本，访问日期统一为 **2026-10-26**。仓库源码引用尽量锚到具体文件路径。

**未做的事**：未读取任何凭据、密钥或真实用户会话；未调用任何真实模型；未运行任何外部项目的服务；未做本项目内的效果实测。因此本文**不声称**任何方案在 OurFairy 场景下有效。

**三类陈述的区分**（全文标注）：

- 【事实】——可直接在引用的一手资料中读到的内容（含源码行为）。
- 【项目自称】——项目方自己给出的效果声明、benchmark 数字或产品定位，本篇只转述，不代为背书。
- 【推断】——本文基于上述事实做出的对 OurFairy 的判断，属于分析结论，不是被验证过的事实。

**术语提示**：本文用 "召回" 指"把历史内容取回放进上下文"这一动作；用 "巩固" 指"离线／后台把原始记录加工成更少但更可用的形态"；用 "压缩" 指"同一次会话内的历史折叠"。三者在本篇严格区分，理由见 §7.4。

---

## 0. 结论摘要

1. **上下文增长的最直接答案不是 RAG，而是"每次注入多少 token"的显式预算与可回滚的摘要层。** 三个独立成熟项目在这一点上给出了方向一致的事实：Letta 当前产品线的长期记忆默认**不建向量索引**（`docs.letta.com` MemFS 页）；LangGraph 的存储层默认**关闭语义检索**（LangGraph `BaseStore` 源码 docstring）；SillyTavern 官方文档明确写 "does not guarantee a better chatting experience or improved memory of any sort"（Chat Vectorization 页首免责声明）。
2. **"DREAMING 类离线巩固"在两个项目里有可直接对照的成品实现**：Letta V1 的 `SleeptimeMultiAgentV4`（按回合计数触发 + 水位线 + 后台 `Run`），以及 Letta Code 的 `dreaming`（后台子代理，按步数或压缩事件触发，用 git worktree 隔离并发写）。二者的共同形状是"**后台进程 + 输入增量水位线 + 产物落在可版本化的存储里**"，与向量检索无关。
3. **"可审计的纠正"目前只有两条成熟路线**：Mem0 Platform 的 Dream（supersede / merge，**不删数据、保留被取代项、以链接回指证据**）与 Letta Code 的 MemFS（git 版本化 + `memory-citations` 引用 + `memory-conflict-repair` 冲突修复）。LangMem 走的是"默认不删"（`enable_deletes=False`）。SillyTavern 走的是"人工可编辑 + 可回滚到上一版摘要"。
4. **现实成本差异极大**：Mem0 的 TS OSS SDK 是唯一"TypeScript + Apache-2.0 + 本地 SQLite 单文件"的可复用库候选；Graphiti 与 LangMem 均为 Python 库；Letta Code 是 TypeScript 但它是**完整 harness 而非可嵌入库**；SillyTavern 是 AGPL-3.0 的完整应用。
5. 【推断】对"少量受邀用户"的 OurFairy，**引入 Neo4j / FalkorDB 这类图数据库与常驻摄取管线，是与规模不相称的运维复杂度**；值得借的是图方案的**失效语义**（bi-temporal、supersede 而非删除），不值得借的是它的**存储与摄取基础设施**。

---

## 1. 调研对象一览

| 项目 | 性质 | 首选语言 / 包 | 许可证 | 本篇锚定的版本（访问日 2026-10-26） |
| --- | --- | --- | --- | --- |
| Letta（原 MemGPT） | 完整 agent 记忆产品 + 开源 harness + 托管云 | TS harness `letta-code`；Python 服务端（已归档） | Apache-2.0 | `letta-ai/letta-code` v0.34.24（2026-10-25）；`letta-ai/letta` 主仓 + `archive` 分支（V1 服务端） |
| Mem0 | 可复用记忆库（Python/TS OSS）+ 托管平台 | Python `mem0ai`；Node `mem0ai`（含 `/oss` 子路径） | Apache-2.0 | Python tag `v2.2.1`、TS tag `ts-v3.3.1`（均 2026-09-25）；npm `mem0ai@3.3.1` |
| Zep / Graphiti | 图方案：开源库（Python）+ 托管服务 | Python `graphiti-core`；TS 客户端仅托管版 `@getzep/zep-cloud` | Apache-2.0 | `graphiti-core` 0.31.2（2026-10-20）；`@getzep/zep-cloud` 4.0.1（2026-10-20） |
| LangMem | 可复用记忆库（Python，绑定 LangGraph 生态） | Python `langmem` | MIT | PyPI `langmem` 0.0.30；`langchain-ai/langmem` main |
| SillyTavern | 完整 AI companion 应用 | Node/Express | **AGPL-3.0** | `SillyTavern/SillyTavern` 1.19.0（2026-09-14） |

许可证与包元数据来源：GitHub API 的 `license.spdx_id`、npm registry `dist-tags`/`license`/`time`、PyPI JSON API 的 `info.license` 与 `info.license_expression`。

---

## 2. Letta / MemGPT

### 2.1 它到底是什么

【事实】Letta 是**完整 agent 记忆产品**，不是一个可嵌入的记忆库。当前形态分三层：

- **Letta Code**（`letta-ai/letta-code`，Apache-2.0，TypeScript，npm `@letta-ai/letta-code`）：开源 agent harness，自带 CLI、App Server、channels、工具执行、记忆文件系统。它是"整套 agent"，不是"一个记忆模块"。
  - 来源：<https://github.com/letta-ai/letta-code>、<https://www.npmjs.com/package/@letta-ai/letta-code>
- **Letta 平台 API / Letta Cloud**：托管运行（`docs.letta.com` 文档站，入口 <https://docs.letta.com/quickstart>）。
- **V1 服务端（已归档）**：原 `letta-ai/letta` 仓库的 `archive` 分支。仓库 README 明确："The current source code lives in `letta-ai/letta-code`… The `archive` branch contains the retired Letta V1 API server."（<https://github.com/letta-ai/letta>）。
  - 【事实】因此**MemGPT 时代那套"core memory blocks / archival memory / recall memory"的 API 形态属于已退役代码**，现存于 `archive` 分支，只能作为机制参考，不能作为现成依赖。

学术源头是官方论文：MemGPT: Towards LLMs as Operating Systems，arXiv:2310.08560（2023-10-12）——提出 "virtual context management"，即在有限上下文窗口内模拟分层内存的数据搬移。来源：<https://arxiv.org/abs/2310.08560>。

### 2.2 写入、更新、遗忘与来源追溯

**V1 时代（已归档代码，`archive` 分支）**【事实】：

- 记忆以 **block** 为单位，挂在 system prompt 上，agent 可通过工具自改。工具集见 `letta/functions/function_sets/base.py`：`core_memory_append`、`core_memory_replace`、`memory_replace`、`memory_insert`、`memory_apply_patch`、`memory_rethink`、`memory_finish_edits`——即**针对 block 内容的字符串级增删改**，不是整份重写。
  - 来源：<https://github.com/letta-ai/letta/blob/archive/letta/functions/function_sets/base.py>
- 归档记忆（archival）是**独立存储**：每条 passage 带 `text`、`metadata_`、`tags`、`embedding`（可空）。Postgres 用 `pgvector` 的 `Vector(MAX_EMBEDDING_DIM)`，SQLite 用 `CommonVector`；源码注释明写 "nullable for text-only search"。
  - 来源：<https://github.com/letta-ai/letta/blob/archive/letta/orm/passage.py>
- **embedding 是可选的**：`letta/schemas/embedding_config.py` 中 `EmbeddingConfig` 覆盖 20 种 provider，但 `letta/settings.py` 里 `default_embedding_handle: Optional[str] = None`——默认不开。
  - 来源：<https://github.com/letta-ai/letta/blob/archive/letta/schemas/embedding_config.py>、<https://github.com/letta-ai/letta/blob/archive/letta/settings.py>

**当前 Letta Code（MemFS）**【事实】：

- 长期记忆 = **git 版本化的 Markdown 文件仓库**（MemFS）。根目录文件（如 `persona.md`、`human.md`）每轮注入 system prompt；子目录带自己的 `MEMORY.md` 索引，**不进上下文**，需要时 agent 按文件名索引去读。记忆按路径寻址，"选标签就是选记忆住在哪里、是否常驻上下文"。
  - 来源：<https://docs.letta.com/concepts/memfs/index.md>
- **每次记忆编辑都提交到 MemFS 的 git 仓库**，"This provides version history, conflict resolution, and a clear boundary between saved memory and uncommitted changes."——来源追溯由 git 提供，而非由数据结构提供。
  - 来源：<https://docs.letta.com/concepts/memfs/index.md>
- 文档还公开了 `memory-citations` mod：每次工具读取记忆文件时记录 `path` / `toolName` / `observedAt` / `evidence` / `confidence`，最多 8 条引用（`MAX_CITATIONS = 8`）。
  - 来源：<https://github.com/letta-ai/letta-code/blob/main/docs/examples/mods/memory-citations.ts>
- 并发写的失败模式被显式处理：`src/agent/memory-conflict-repair.ts` 处理 git `MERGE_HEAD` / `REBASE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD` 造成的冲突态，用带 token 的"领取—执行"记录保证只有一个 worker 能推进修复。
  - 来源：<https://github.com/letta-ai/letta-code/blob/main/src/agent/memory-conflict-repair.ts>

### 2.3 召回方式

【事实】当前 Letta Code 的召回**默认不是向量**：

> "MemFS does not include a semantic or vector index by default. Agents find memory in its Markdown files with normal file-search and read tools. For keyword search and optional semantic or hybrid search, install the MemFS Search mod… Keyword search works without additional dependencies. Semantic and hybrid modes require QMD to be installed and indexed over `$MEMORY_DIR`."

（<https://docs.letta.com/concepts/memfs/index.md>）

会话历史检索与 MemFS 分离：云端 `letta messages search` 支持全文／向量／混合；**本地后端目前只有全文匹配**。（同上页）

V1 时代的归档检索是"有 embedding 用 embedding，没有就退回 SQL 子串匹配"：`search_agent_archival_memory_async` 中 `use_embedding_search = agent_state.embedding_config is not None`；非向量路径由 `build_agent_passage_query` 生成 `ilike %query_text%` 条件。
- 来源：<https://github.com/letta-ai/letta/blob/archive/letta/services/agent_manager.py>、<https://github.com/letta-ai/letta/blob/archive/letta/services/helpers/agent_manager_helper.py>

### 2.4 DREAMING 类离线巩固

【事实】存在，且有两种可对照形态：

**当前 Letta Code 的 dreaming**（<https://docs.letta.com/configuration/memory/index.md>）：

> "Dreaming uses background subagents to review recent conversations, consolidate useful lessons, and update memory without interrupting your active work."
> 触发条件二选一：**完成若干 agent 步数之后**，或**上下文被压缩时**。
> 可选 "Agent reviews before applying"：再开一次后台对话审阅并修订拟议的记忆更新，"This uses more model tokens and does not ask you for approval."

【事实】并发隔离方式：记忆子代理（dreaming、memory doctor）**用 git worktree**，"so they can update memory concurrently without blocking the main agent"。（<https://docs.letta.com/concepts/memfs/index.md>）

**V1 的 sleeptime agent**（已归档代码）——【事实】`SleeptimeMultiAgentV4.run_sleeptime_agents` 的形状：

- 触发：`group.sleeptime_agent_frequency` 非空且 `turns_counter % frequency == 0`；
- 输入：`last_response_messages` + `last_processed_message_id`（**水位线**，避免重复处理）；
- 执行：创建后台 `Run`（`run_type = "sleeptime_agent_send_message_async"`），用 `safe_create_task` 起后台任务，异常不回灌前台。
  - 来源：<https://github.com/letta-ai/letta/blob/archive/letta/groups/sleeptime_multi_agent_v4.py>
- V1 还有更早的 `sleeptime_multi_agent.py` v1–v3 演进版本，以及 `letta/prompts/system_prompts/sleeptime_v2.py` 等提示词文件。
  - 来源：<https://github.com/letta-ai/letta/tree/archive/letta/groups>、<https://github.com/letta-ai/letta/tree/archive/letta/prompts/system_prompts>

【事实】官方还发布过 "Sleep-time Compute: Beyond Inference Scaling at Test-time" 论文（arXiv:2504.13171，2025-04-17），摘要定义："allows models to 'think' offline about contexts before queries are presented: by anticipating what queries users might ask and pre-computing useful quantities"。配套复现代码在 `letta-ai/sleep-time-compute`。
- 来源：<https://arxiv.org/abs/2504.13171>、<https://github.com/letta-ai/sleep-time-compute>
- 【项目自称】论文报告在 Stateful GSM-Symbolic / Stateful AIME 上"达到同等精度所需测试时算力减少约 5 倍"，扩展 sleep-time 算力可再提升准确率 13% / 18%。这是论文自述的特定推理任务结果，与"长期记忆是否更好用"不是同一个问题。

### 2.5 多用户 / 多会话 scope

【事实】当前形态：一个 **agent** 拥有身份 + **长期记忆 + 多个 conversation**；"every conversation uses the same agent identity and long-term memory"，记忆跨会话共享。需要独立记忆时应开**不同 agent**，需要并行话题时应开**不同 conversation**。
- 来源：<https://docs.letta.com/concepts/stateful-agents/index.md>、<https://docs.letta.com/concepts/conversations/index.md>

【事实】V1 的 group 机制（`ManagerType.sleeptime` 等）把"前台 agent + 若干后台 agent"组织成一个 group——这是**功能维度**的分组，与用户维度的 scope 是两件事。（`letta/groups/sleeptime_multi_agent_v4.py`）

【事实】当前 Letta Code 另有**组织级**的共享记忆：shared memory repository 由组织拥有、可挂给多个云端 agent；文档同时指出"Older Letta API guides use shared memory blocks … The legacy memory block API still supports this pattern, but users should migrate to shared memory repositories instead."（即"共享 memory block"是旧形态，"共享 git 仓库"是新形态，两者共享粒度都是组织而非单个用户。）
- 来源：<https://docs.letta.com/concepts/shared-memory/index.md>

### 2.6 数据库与第三方依赖

【事实】当前 Letta Code 本地模式（`--backend local`）不需要 Postgres 或向量库：agent 状态、消息、记忆全在本地磁盘，MemFS 仓库位于 `~/.letta/lc-local-backend/memfs/<agent-id>/memory`，可用 `LETTA_LOCAL_BACKEND_DIR` 隔离。
- 来源：<https://docs.letta.com/self-hosting/index.md>

【事实】自托管 App Server 的官方部署方式只有 Docker Compose / Railway / Fly.io 三例，持久卷挂 `/root/.letta`，健康检查 `/readyz`。（同上）

### 2.7 对 OurFairy 的含义【推断】

- Letta Code **不适合做 adapter**：它是完整 harness（自带 agent loop、CLI、工具、模型接入、渠道），与 dsh 插件形态重叠且会争夺控制权。真正值得借的是三件事：**git 版本化的记忆存储**（天然解决"这条记忆哪来的、谁改的、能不能回滚"）、**后台巩固子代理 + 水位线**、**worktree 式并发写隔离**。
- Letta 当前产品线**主动放弃向量索引**这一事实，对"用户怀疑 RAG 效果"是有分量的旁证：它说明在有成熟替代（文件 + 关键词 + 目录索引）的情况下，成熟团队并不把向量检索当作默认答案。
- Letta 的 `Context Constitution`（CC0-1.0，<https://github.com/letta-ai/context-constitution/blob/main/constitution/CONSTITUTION.md>）明写 "The context window is a precious resource that must be actively managed"，并区分"上下文里已有的历史"与"存在但不在上下文里的记忆"——这正是 §7.4 要展开的那条界线。CC0 许可意味着可自由引用其原则表述。

---

## 3. Mem0

### 3.1 它到底是什么

【事实】**可复用库 + 托管平台**双形态，官方文档显式区分并逐条标注 `[Platform]` / `[OSS]` / `[Both]`（<https://docs.mem0.ai/llms.txt> 开头）。OSS 部分有 Python 与 TypeScript 两个 SDK；平台部分只有托管 API。

【事实】**OSS 的图记忆已被移除**。官方迁移文档写：

> "**Graph memory moved to Platform**: The external graph store integration is removed from OSS; graph memory is now a built-in, always-on Mem0 Platform feature."

并且 Python 包 `v2.2.1` 的 `mem0/` 目录下**已无 `graphs` 模块**（现为 `client/ configs/ embeddings/ exceptions.py llms/ memory/ proxy/ reranker/ utils/ vector_stores/`）。
- 来源：<https://docs.mem0.ai/migration/oss-v2-to-v3>、<https://github.com/mem0ai/mem0/tree/v2.2.1/mem0>

### 3.2 写入、更新、遗忘与来源追溯

【事实】**当前默认抽取是"只增不删"**。Python `v2.2.1` 的 `mem0/memory/main.py` 中 `_add_to_vector_store` 走 "V3 PHASED BATCH PIPELINE"：Phase 0 取上下文 → Phase 1 用向量检索召回既有记忆（top_k=10）→ Phase 2 单次 LLM 抽取 → Phase 3 批量 embedding。系统提示词 `ADDITIVE_EXTRACTION_PROMPT` 明确：

> "Your sole operation is ADD: identify every piece of memorable information and produce self-contained, contextually rich factual statements."
> "Use these ONLY for deduplication and linking — do NOT extract new memories from Existing Memories."
> 并且通过 `linked_memory_ids` 把新记忆与既有记忆关联起来；既有记忆以**序号→UUID 映射**喂给模型，源码注释称之为 anti-hallucination。

- 来源：<https://github.com/mem0ai/mem0/blob/v2.2.1/mem0/memory/main.py>、<https://github.com/mem0ai/mem0/blob/v2.2.1/mem0/configs/prompts.py>

【事实】`add()` 的返回事件已收窄为只有 `ADD`（迁移表：`add()` events 旧为 `ADD`/`UPDATE`/`DELETE`，新为 only `ADD`）。**更新与删除变成显式 API 调用**：`update(memory_id, text/metadata/expiration_date)`、`delete(memory_id)`、`delete_all(user_id/agent_id/run_id)`。
- 来源：<https://docs.mem0.ai/migration/oss-v2-to-v3>、<https://github.com/mem0ai/mem0/blob/v2.2.1/mem0/memory/main.py>

【事实】**变更留痕**：每次 add/update/delete 都写 history（默认 SQLite `~/.mem0/history.db`），OSS 侧有 `history(memory_id)` 方法，Platform 侧有对应的 history API。
- 来源：<https://docs.mem0.ai/open-source/overview>、<https://github.com/mem0ai/mem0/blob/v2.2.1/mem0/memory/main.py>、<https://docs.mem0.ai/api-reference/memory/history-memory>

【事实】**Platform 的 Dream 是最完整的"可审计失效"实现**，三个动作：

| 动作 | 行为 | 何时运行 | 可用性 |
| --- | --- | --- | --- |
| Synthesis | 把记忆蒸馏成"模式记忆"（高层规律），**与原记忆并存**，每条模式记忆**链接回它的来源记忆** | 后台定时 | Pro+ |
| Supersede | 新事实与旧事实矛盾时，把旧记忆标记为 superseded 并**链接到取代它的新记忆** | 每次 add | 全档位 |
| Merge | 近似重复折叠为一条 canonical，被合并项标 merged 并链接到 canonical | 每次 add | 全档位 |

读取语义：默认返回 active + superseded（superseded 带标记），隐藏 merged；`latest_only=true` 只返回 active；`include_merged=true` 全返回。
官方反复强调 "**Nothing Dream does is destructive**"、"Every change is recorded and reviewable"，并在 Dashboard 提供"最近合成运行、产生的模式及其来源记忆、被 supersede/merge 的记忆"的审阅界面。
- 来源：<https://docs.mem0.ai/platform/features/dream>

【事实】Platform 另有 **Profiles**：按用户自定义 JSON Schema 生成的"始终最新的结构化用户档案"，新记忆到达时重建，异步生成（读时返回 `status` 而非报错）。文档给出的定位对比很贴切："Search answers 'what did this user say about X'. A profile answers 'who is this user', in one read, with no query to write."
- 来源：<https://docs.mem0.ai/platform/features/user-profiles>

### 3.3 召回方式

【事实】**当前 OSS 是混合检索，不是纯向量**。官方迁移文档：

> "**Retrieval**: Multi-signal hybrid search (semantic + BM25 keyword + entity matching)"
> "**Entity matching**: Automatic entity extraction feeds a third scoring signal in hybrid search, boosting memories that share entities with the query"

TS 侧实现可见 `mem0-ts/src/oss/src/utils/scoring.ts`：BM25 原始分经 sigmoid 归一到 [0,1]，加法合成 `semanticScore + BM25 + entityBoost`，`ENTITY_BOOST_WEIGHT = 0.5`；`utils/lemmatization.ts` 做词形归并，`utils/entity_extraction.ts` 做实体抽取。
- 来源：<https://docs.mem0.ai/migration/oss-v2-to-v3>、<https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/src/oss/src/utils/scoring.ts>

【事实】**TS OSS 的默认向量库是"内存"实现 = 单个 SQLite 文件**：`mem0-ts/src/oss/src/vector_stores/memory.ts` 用 `better-sqlite3`，表为 `vectors(id TEXT PRIMARY KEY, vector BLOB, payload TEXT)`，余弦相似度在 JS 里算，BM25 也是内联计算（"Compute BM25 scores inline"）。默认维度 1536。
- 来源：<https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/src/oss/src/vector_stores/memory.ts>

【事实】Platform 另有 **Memory Decay**：检索期软性排序偏置（刚访问 ≈1.5×，闲置数月 ≈0.3×），"**never a filter**"，默认关闭、按项目开启、只作用于 v3 检索。
- 来源：<https://docs.mem0.ai/platform/features/memory-decay>

### 3.4 DREAMING 类离线巩固

【事实】**OSS 侧没有与 Dream 等价的巩固层**；Dream 是 Platform 功能，且 **Synthesis 需要 Pro 及以上**、每用户至少 20 条记忆才纳入、Pro 每 7 天一次 / Enterprise 每天一次（可配置）、开启时设**前向边界**（历史记忆不批量重跑）、合成结果**延迟约 24 小时**才可见。
- 来源：<https://docs.mem0.ai/platform/features/dream>

【事实】Dream 的 synthesis **只处理"仅带 `user_id`"的记忆**；同时带 `agent_id` / `run_id` / `app_id` 的记忆被排除在合成之外，以免跨 agent/run/app 交叉引用。
- 来源：<https://docs.mem0.ai/platform/features/dream>

【推断】这条规则对 OurFairy 有直接参考价值：它把"用户维度合成"与"会话/运行维度记忆"隔离开，避免巩固过程把不同 scope 的事实混在一起。是否采用同样的隔离规则属于 scope 设计，本文不代为决定（见 §9）。

### 3.5 多用户 / 多会话 scope

【事实】scope 标识为 `user_id` / `agent_id` / `run_id` / `app_id`，写入与查询共用同一组 filter；v3 起这些 ID **必须放在 `filters` 对象里**（顶层 kwargs 会抛 `ValueError`），并有实体 ID 校验（去空白、拒绝内部空格、空串报错）。
- 来源：<https://docs.mem0.ai/migration/oss-v2-to-v3>、<https://docs.mem0.ai/platform/features/entity-scoped-memory>

### 3.6 数据库与第三方依赖

【事实】**OSS 库模式的默认组件**（官方表）：LLM = OpenAI `gpt-5-mini`；Embeddings = OpenAI `text-embedding-3-small`；向量库 = 本地 Qdrant（`/tmp/qdrant`）；历史库 = SQLite `~/.mem0/history.db`；reranker 默认关闭。
- 来源：<https://docs.mem0.ai/open-source/overview>

【事实】**TS OSS 的默认组件**（源码 `mem0-ts/src/oss/src/config/defaults.ts`）：embedder = openai / `text-embedding-3-small`；**vectorStore = `provider: "memory"`（SQLite）**；llm = openai / `gpt-5-mini`；historyStore = sqlite（`memory.db`）。
- 来源：<https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/src/oss/src/config/defaults.ts>

【事实】**自托管服务端模式**（Docker Compose 栈）默认向量库换为 Postgres + pgvector。
- 来源：<https://docs.mem0.ai/open-source/overview>

【事实】TS 包的可选 peer dependency 覆盖约 25 个向量库客户端（qdrant、pgvector、chroma、redis、elasticsearch、opensearch、turbopuffer、supabase、weaviate 等），全部 optional。
- 来源：<https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/package.json>

### 3.7 benchmark 声明

【项目自称】官方迁移文档写新算法带来 "**+20 point improvement on LoCoMo** (71.4 → 91.6)" 与 "**+26 point improvement on LongMemEval** (67.8 → 93.4)"，同时抽取延迟约减半。
- 来源：<https://docs.mem0.ai/migration/oss-v2-to-v3>
- 【推断】需要谨慎解读：这是**项目方对自身新旧版本**的对比，基线是它自己的上一版；LoCoMo / LongMemEval 衡量的是"从对话历史中回答问题"的准确率，不等于"agent 与用户长期相处时行为更好"。本文不把它当作 OurFairy 选型依据。

### 3.8 对 OurFairy 的含义【推断】

- Mem0 TS OSS 是本轮调研中**唯一现实可用的"做 adapter"候选**：Apache-2.0、TypeScript、可全本地 SQLite、无强制外部服务（embedder 与 LLM 均可换）。但它的默认路径仍要求一个 embedding provider——不配 embedding 就退化到 BM25 + 实体匹配，需要确认这条路是否被官方支持到可用程度。
- 值得单独抄的是**写入侧的形态**：ADD-only 抽取 + `linked_memory_ids` 关联 + 序号→UUID 映射防幻觉 + 显式 `update`/`delete` + history 表。这套"LLM 只增、删除必须显式"的边界，正好对上 OurFairy 需要的**可审计纠正**。
- 不值得抄的是它的**托管依赖**：Dream（巩固）、Profiles（结构化档案）、Graph Memory（图）全在付费 Platform，OSS 无对应实现。

---

## 4. Zep / Graphiti

### 4.1 它到底是什么

【事实】两件东西：

- **Graphiti** = 开源"时序知识图谱框架"（`getzep/graphiti`，Apache-2.0），PyPI 包 `graphiti-core` 0.31.2，Python `>=3.10`。官方描述："Graphiti is the open-source framework for building temporal knowledge graphs — Context Graphs — for AI agents, with incremental updates and hybrid retrieval."
  - 来源：<https://github.com/getzep/graphiti>、<https://pypi.org/project/graphiti-core/>、<https://help.getzep.com/graphiti/getting-started/overview>
- **Zep** = 托管服务，"unified context layer for enterprise data"，用 Graphiti 派生时序图产物，运行在 Zep 的托管图数据库服务上；提供 Python / TypeScript / Go SDK。
  - 来源：<https://help.getzep.com/v4/overview>、<https://help.getzep.com/v4/install-sdks>

【事实】TS 接入路径：托管 SDK `@getzep/zep-cloud`（npm 4.0.1，2026-10-20，仓库 `getzep/zep-js`）。`graphiti-core` 本身是 Python 包；仓库自带的 MCP server 也是 Python（`mcp_server/.python-version`、`mcp_server/src/config/schema.py`）。
- 来源：<https://www.npmjs.com/package/@getzep/zep-cloud>、<https://github.com/getzep/graphiti/tree/main/mcp_server>

### 4.2 写入、更新、遗忘与来源追溯

【事实】**双时态模型**是 Graphiti 的核心。`EntityEdge` 同时带：

- `created_at`（事务时间：何时写入库）
- `valid_at`（事实生效时间）
- `invalid_at`（事实失效时间，注释："datetime of when the fact stopped being true; soft deadlines are not invalid_at"）
- `expired_at`（软性截止）
- `episodes`（来源 episode 列表——**溯源链**）

- 来源：<https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/edges.py>

【事实】**矛盾处理 = 时序失效，不是删除**。`graphiti_core/utils/maintenance/edge_operations.py` 中：

- `resolve_extracted_edges(...)` 返回 `invalidated_edges`（"Edges that were invalidated/contradicted by new information"）；
- `_apply_temporal_invalidation(...)`：若新边有 `valid_at` 而旧候选有更早的 `valid_at`，则把新边的 `invalid_at` 设为候选的 `valid_at`；
- `resolve_edge_contradictions(...)` 决定哪些旧边需要被"expire"。

判定本身由 LLM 参与：`graphiti_core/llm_client/decision_prompts.py`（含 "FACT INVALIDATION CANDIDATES" 结构）与 `openai_decisions_client.py`。
- 来源：<https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/utils/maintenance/edge_operations.py>、<https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/llm_client/decision_prompts.py>

【事实】官方文档把这一项直接与 GraphRAG 对比："**Contradiction Handling**: GraphRAG = LLM-driven summarization judgments；Graphiti = **Temporal edge invalidation**"。
- 来源：<https://help.getzep.com/graphiti/getting-started/overview>

【事实】**来源追溯 = episode 溯源**：数据以离散 episode 摄入，维护 provenance 并支持增量抽取；官方对比表写 "Episodic Processing: Ingests data as discrete episodes, maintaining data provenance and allowing incremental entity and relationship extraction."
- 来源：<https://help.getzep.com/graphiti/getting-started/overview>

### 4.3 召回方式

【事实】检索方法枚举（`graphiti_core/search/search_config.py`）：`EdgeSearchMethod` / `NodeSearchMethod` ∈ {`cosine_similarity`, `bm25`, `bfs`}；`EpisodeSearchMethod` 只有 `bm25`。重排器：`rrf`（reciprocal rank fusion）、`node_distance`、`episode_mentions`、`mmr`、`cross_encoder`。
- 来源：<https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/search/search_config.py>

【事实】**官方明确"无 LLM 在环重排"**："Combines vector similarity and BM25 retrieval, reranked using Reciprocal Rank Fusion"；Overview 页原文："Hybrid Search: Combines vector similarity, BM25 full-text, and graph traversal into a single ranked answer, **with no LLM-in-the-loop reranking**."
- 来源：<https://help.getzep.com/graphiti/working-with-data/searching>、<https://help.getzep.com/graphiti/getting-started/overview>

【事实】**16 个预置检索配方**（`search_config_recipes.py`），覆盖 edges / nodes / communities × RRF / MMR / node_distance / episode_mentions / cross_encoder。
- 来源：<https://help.getzep.com/graphiti/working-with-data/searching>

【事实】**节点距离重排**可用于"实体特化"查询（以某实体为中心节点，优先其邻近事实）。
- 来源：<https://help.getzep.com/graphiti/working-with-data/searching>

### 4.4 DREAMING 类离线巩固

【事实】**Graphiti 没有与 DREAMING 对应的离线巩固层**。它的"时间推进"是**增量摄入**——每次 `add_episode` 立刻抽取实体/边并即时落库，矛盾立即以 `invalid_at` 表达。
- 来源：<https://help.getzep.com/graphiti/core-concepts/adding-episodes>

【事实】**Zep 托管版有**与巩固接近但不同的东西：Observations（"durable, evidence-backed patterns Zep derives from a Context Graph — recurring loops, preferences, commitments, and state transitions across many facts"）与 User Summary（用户基线描述）、Thread Summaries（每线程增量摘要）。它们是**读取侧派生视图**，不是后台重写记忆。
- 来源：<https://help.getzep.com/v4/observations>、<https://help.getzep.com/v4/user-summary>、<https://help.getzep.com/v4/thread-summaries>

### 4.5 多用户 / 多会话 scope

【事实】Graphiti 用 **`group_id`** 做命名空间隔离，所有图查询与写入都带 `group_id`；`get_default_group_id(driver.provider)` 提供默认组，并有 `validate_group_id`。
- 来源：<https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/graphiti.py>

【事实】Zep 托管版有更细的一层：user graph（每人一张图）与 shared Context Graph（按项目/产品/领域共享），文档称 "Build a user graph and an account Context Graph, ingest data into the correct scope"。
- 来源：<https://help.getzep.com/v4/how-to-share-context-across-users-using-graphs>、<https://help.getzep.com/v4/create-graph>、<https://help.getzep.com/v4/users-and-user-graphs>

### 4.6 数据库与第三方依赖

【事实】`graphiti-core` 0.31.2 的**硬依赖**：`pydantic>=2.11.5`、`neo4j>=5.26.0`、`openai>=1.91.0`、`tenacity`、`numpy`、`python-dotenv`、`posthog`、`certifi`。
**可选 extras**：`anthropic`、`groq`、`google-genai`、`voyageai`、`falkordb`、`falkordblite`（内嵌 FalkorDB）、`kuzu`（**已标注弃用**："the upstream Kuzu project is unmaintained"）、`neo4j-opensearch`、`neptune`、`sentence-transformers`、`gliner2`、`tracing`。
- 来源：<https://github.com/getzep/graphiti/blob/v0.31.2/pyproject.toml>

【事实】存储后端驱动：`graphiti_core/driver/` 下有 `neo4j/`、`falkordb/`、`kuzu/`；文档列出 "Pluggable Backends: Runs on Neo4j, FalkorDB, or Amazon Neptune"。
- 来源：<https://github.com/getzep/graphiti/tree/v0.31.2/graphiti_core/driver>、<https://help.getzep.com/graphiti/getting-started/overview>

【事实】`openai` 是硬依赖，且抽取、去重、矛盾判定都需要 LLM 调用；embedding 由 `LLMClient` / 独立 embedder 提供。

### 4.7 对 OurFairy 的含义【推断】

- **图数据库与摄取管线对少量受邀用户是过重的**：`neo4j` 硬依赖 + LLM 逐 episode 抽取 + 实体解析 + 社区摘要，每一项都是持续运维与持续 token 开销。
- **值得借的是失效语义**：bi-temporal 字段（`valid_at` / `invalid_at`）、"矛盾 = 标失效而非删除"、以及"旧事实链到新事实"。这与 Mem0 Dream 的 supersede 语义同构，两者可互相印证。
- **值得借的是"检索不带 LLM 在环"**：RRF 融合 BM25 + 向量 + 图遍历，是可以在无向量时退化为 BM25 的结构。
- **Graphiti 的 episode 溯源模型值得对照 OurFairy 的会话消息**：它把"这条事实是从哪几条原始记录抽出来的"显式建成图边。

---

## 5. LangMem

### 5.1 它到底是什么

【事实】**可复用的记忆库（Python）**，MIT，PyPI `langmem` 0.0.30，Python `>=3.10`；**没有 npm 包**。官方 README 定位：

> "It offers both functional primitives you can use with any storage system and native integration with LangGraph's storage layer."

三大能力：hot path 记忆工具、background memory manager、以及与 LangGraph 长期记忆存储的原生集成。
- 来源：<https://github.com/langchain-ai/langmem>、<https://pypi.org/project/langmem/>

### 5.2 写入、更新、遗忘与来源追溯

【事实】**记忆类型三分**：Semantic（事实与知识）、Episodic（过往经历）、Procedural（系统行为）；对应两种存储形态——**collection**（可搜索的独立记录）与 **profile**（严格 schema 的单一文档，新信息到达时**更新同一份**而非追加）。
- 来源：<https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md>

【事实】**默认不删**：`create_memory_manager(..., enable_updates: bool = True, enable_deletes: bool = False)`；工具层另有 `actions_permitted` 参数可以限制 agent 允许的动作集合。
- 来源：<https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/extraction.py>、<https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/tools.py>

【事实】**每个记忆操作遵循同一模式**（官方原话）："1. Accept conversation(s) and current memory state 2. Prompt an LLM to determine how to expand or consolidate the memory state 3. Respond with the updated memory state."
- 来源：<https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md>

【事实】抽取提示里对**过时信息**的处理是显式的："If an existing memory is incorrect or outdated, update it based on the new information."
- 来源：<https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/extraction.py>

【事实】**溯源粒度**：`ExtractedMemory` 带 `id` 与 `content`；collection 形态下每条记忆独立可寻址，可单独更新／删除（`store.aput` / `store.adelete(namespace, key=id)`）。
- 来源：<https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/extraction.py>、<https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/tools.py>

### 5.3 召回方式

【事实】**召回由存储层决定，不是 LangMem 自己决定**。它把记忆存进 LangGraph 的 `BaseStore`，用 `store.search(namespace, query=...)` 检索。LangGraph `BaseStore` 的源码 docstring 明确：

> "Some implementations may support semantic search capabilities through an optional `index` configuration. … **Without this configuration, semantic search is disabled** and any `index` arguments to storage operations will have no effect."

同时 TTL 也是默认关闭的（"TTL (time-to-live) support is disabled by default"）。
- 来源：<https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/store/base/__init__.py>

【事实】LangMem 官方示例中带语义检索的 store 需要显式配 index：`InMemoryStore(index={"dims": 1536, "embed": "openai:text-embedding-3-small"})`；生产建议换 `AsyncPostgresStore`（LangGraph 的 Postgres 存储实现）。
- 来源：<https://github.com/langchain-ai/langmem#readme>

【事实】官方也承认**相关度不只是语义相似度**："Recall should combine similarity with 'importance' of the memory, as well as the memory's 'strength', which is a function of how recently/frequently it was used."——但这是设计指引，不是内置实现。
- 来源：<https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md>

### 5.4 DREAMING 类离线巩固

【事实】**background memory manager 就是它的巩固层**，且明确区分 hot path 与 background：

> "Memories can be created in two ways: 1. In the hot path: the agent consciously saves notes using tools. 2. In the background: memories are 'subconsciously' extracted automatically from conversations."

- 来源：<https://github.com/langchain-ai/langmem/blob/main/docs/docs/background_quickstart.md>

【事实】**延迟处理 / 去抖**由 `ReflectionExecutor` 提供：提交后延迟 `after_seconds` 才处理；期间新消息到达会**取消旧任务并重新排期**（合并进新消息），避免处理碎片化的中间态；官方示例建议 30–60 分钟。

**一个与 OurFairy DREAMING 语义直接相关的限制**（官方警告）：

> "**Serverless Deployments**: Local threads terminate between serverless function invocations. Use the LangGraph Platform's remote executor instead."

即：延迟巩固需要**常驻进程**才能成立，serverless 环境下线程会被杀掉。
- 来源：<https://github.com/langchain-ai/langmem/blob/main/docs/docs/guides/delayed_processing.md>

### 5.5 多用户 / 多会话 scope

【事实】**scope = namespace 元组**。namespace 可以是固定元组，也可以是模板字符串含运行时占位符，例如 `("project_memories", "{langgraph_user_id}")`——工具在运行时从 `config` 填充，得到 `("project_memories", "user-123")`。嵌套 profile 也只是多一级元组：`("memories", "<uuid>", "user_profile")`。
- 来源：<https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/tools.py>、<https://github.com/langchain-ai/langmem/blob/main/docs/docs/guides/dynamically_configure_namespaces.md>

### 5.6 数据库与第三方依赖

【事实】存储可插拔：`InMemoryStore`（进程内，重启丢失）、`AsyncPostgresStore`（生产）；语义检索需 embedding provider（示例用 OpenAI）；LLM 需任一 provider（示例 Anthropic / OpenAI）。**LangMem 自身不绑定数据库。**
- 来源：<https://github.com/langchain-ai/langmem#readme>

### 5.7 对 OurFairy 的含义【推断】

- LangMem 是**算法与流程参考**，不是可 adapter 的依赖：Python-only，且强绑定 LangGraph 的 `BaseStore` 抽象与 LangGraph Platform 的远程执行器。
- 值得借的三点：**（a）collection 与 profile 两种记忆形态的分工**（profile = 严格 schema 的"始终最新的单一文档"，天然对应 OurFairy 的"印象"类结构化记忆）；**（b）"LLM 只能增删改、删除默认关闭"的权限边界**；**（c）延迟巩固的去抖语义**（新输入到达则取消旧任务并合并），这比"固定时间窗跑批"更贴近真实交互。
- 它的 `ReflectionExecutor` 关于 serverless 的警告，直接对应 OurFairy 侧"sleeping 状态才触发 DREAMING"的既有定义所隐含的进程常驻要求。

---

## 6. SillyTavern

### 6.1 它到底是什么

【事实】**完整的 AI companion 前端应用**（"LLM Frontend for Power Users"），Node/Express，**AGPL-3.0**，release 1.19.0（2026-09-14）。它不是记忆库，但它是本轮唯一纳入的**非纯向量、面向陪伴场景**的成熟项目，且官方文档对向量化的效果有罕见的直白表述。
- 来源：<https://github.com/SillyTavern/SillyTavern>、<https://docs.sillytavern.app/readme>

### 6.2 写入、更新、遗忘与来源追溯

【事实】**Summarize 扩展（默认内置）就是它的"长期记忆"**。官方页首即给出限定：

> "This extension allows you to create, store, and utilize automatically generated summaries based on the events happening in your chats. Summarization can help with outlining general details of what is happening in the story, which *could* be interpreted as a long-term memory, **but take that statement with a grain of salt**. Since the summaries are generated by language models, the outputs may lose some important details or contain hallucinations, so you're always advised to keep track of the summary state and correct it manually if needed."

机制要点：

- 摘要状态**写进 chat 文件的 metadata**，绑定到"生成摘要时最后一条在上下文内的消息"；
- **删除或编辑带摘要的那条消息，会把状态回退到上一个有效摘要**；
- 有 "Restore Previous" 按钮主动回滚，"This is useful if the summarizer does a poor job at any given point."；
- "Pause" 可暂停自动更新，或手工填入自定义摘要；
- 注入位置可配（before / after main prompt / in-chat 指定深度），并有 `{{summary}}` 宏。

- 来源：<https://docs.sillytavern.app/extensions/summarize>

### 6.3 召回方式

【事实】**Chat Vectorization 是 RAG，但作用是"重排上下文"而不是"另建记忆"**：

> "Chat vectorization searches for messages in your current chat history that seem relevant to your most recent messages. It **temporarily shuffles** the most relevant messages to the beginning or end of the chat history. … The messages at the start and end of the chat history tend to have the greatest impact on the model's reply."

并且它承认这就是 RAG（Retrieval / Augmented / Generation 三段解释），检索查询是"最近 2 条消息"，被检索对象是"其余所有消息"，每条消息单独存一个向量，长消息按 400 字符切块。

页首免责声明（官方原文）：

> "The use of this extension does not guarantee a better chatting experience or improved memory of any sort. Only use if you understand all the implications of vector database utilization."

另一条对上下文成本直接相关的警告：

> "**Prompt Caching Compatibility**: Like any dynamic prompt source (World Info, Summarization, etc.), Chat Vectorization restructures the prompt prefix between the LLM calls, which can lead to frequent cache misses. When used with caching, vectorization is often counter-productive, as the modified prompts rarely hit the cache – effectively making caching useless. You have to choose one or the other, but not both."

- 来源：<https://docs.sillytavern.app/extensions/chat-vectorization>

【事实】**World Info（Lorebook）是纯关键词触发的注入**，条目按关键词 / 正则命中后插入提示，递归扫描可级联触发，并且有 token 预算控制。官方在讲向量替代方案时补了一句：

> "Since the retrieval quality depends entirely on the outputs of the embedding model, it's impossible to predict exactly what entries will be inserted. **If you want deterministic and predictable results, stick to keyword matching.**"

- 来源：<https://docs.sillytavern.app/usage/worldinfo>

【事实】**向量存储本身默认关闭**，且需要外部 embedding provider；实现用 Vectra 库，向量以 JSON 文件存在用户数据目录的 `/vectors` 下；官方提醒 "Embeddings are only usable when they are retrieved using the same model that generated them."；免费本地来源包括 transformers.js / Ollama / vLLM / LM Studio / llama.cpp / Extras(SentenceTransformers)，API 来源均需 key。
- 来源：<https://docs.sillytavern.app/usage/characters/data-bank>

### 6.4 DREAMING 类离线巩固

【事实】**没有**。SillyTavern 的巩固是**同会话内的增量滚动摘要**：按 "Update every X messages" 或 "Update every X words" 触发，摘要本身进入下一轮提示；摘要可 blocking 或 non-blocking 生成（non-blocking 模式不阻塞聊天生成）。
- 来源：<https://docs.sillytavern.app/extensions/summarize>

### 6.5 多用户 / 多会话 scope

【事实】SillyTavern 的 scope 是**本地单用户**：一个实例一个人，chat 文件按角色/角色名分目录保存，persona 是本地个人身份，World Info 与 vector storage 都在本地用户数据目录。
- 来源：<https://docs.sillytavern.app/usage/personas>、<https://docs.sillytavern.app/usage/characters/chatfilemanagement>、<https://docs.sillytavern.app/usage/characters/data-bank>

### 6.6 数据库与第三方依赖

【事实】存储极轻：chat 文件（JSONL）+ vector JSON 文件（`/vectors`）+ 本地用户数据目录；向量库用 Vectra；embedding 需外部 provider；摘要是可选的 Extras BART 服务（上下文约 1024 tokens，官方承认能力有限）。
- 来源：<https://docs.sillytavern.app/usage/characters/data-bank>、<https://docs.sillytavern.app/extensions/summarize>

### 6.7 许可证现实

【事实】**AGPL-3.0**（copyleft，含网络服务条款）。仓库 LICENSE 首行为 "GNU AFFERO GENERAL PUBLIC LICENSE Version 3"。若 OurFairy 需要以非 copyleft 许可分发，将不能直接复用其代码，只能参考机制。
- 来源：<https://github.com/SillyTavern/SillyTavern/blob/1.19.0/LICENSE>

### 6.8 对 OurFairy 的含义【推断】

- SillyTavern 证明了一件事：**一个面向陪伴场景、成熟运营的产品，其"记忆"默认形态是"可编辑的滚动摘要 + 关键词触发的静态设定"，向量检索是可选增强**。这对 OurFairy 的"上下文增长"目标是最贴近的反例参照。
- 它的两个可操作结论：**（a）摘要是人工可编辑、可回滚的**（对应可审计纠正）；**（b）动态重排上下文与 prompt cache 互斥**——如果 OurFairy 依赖提示缓存省 token，引入向量重排会先把缓存打穿。这一点对"控制每次模型调用的上下文增长"是直接的成本约束。
- 许可证决定了它只能"借机制"，不能"做 adapter"。

---

## 7. 横向比较：四个重点问题

### 7.1 非 RAG / 混合路线：成熟项目的实际分布

| 项目 | 默认召回形态 | 是否纯向量 | 一手依据 |
| --- | --- | --- | --- |
| Letta Code | 文件搜索 + 读文件；关键词（QMD mod 为可选）；本地会话历史仅全文 | **否** | <https://docs.letta.com/concepts/memfs/index.md> |
| LangMem | 由 `BaseStore` 决定；`index` 未配置时**语义检索关闭** | **否** | <https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/store/base/__init__.py> |
| Mem0 OSS | 混合：语义 + BM25 + 实体匹配 | **否** | <https://docs.mem0.ai/migration/oss-v2-to-v3> |
| Graphiti | 混合：向量相似度 + BM25 + 图遍历，RRF 融合，**无 LLM 在环重排** | **否** | <https://help.getzep.com/graphiti/working-with-data/searching> |
| SillyTavern | 关键词触发（World Info）为主；滚动摘要；向量重排可选且默认关闭 | **否** | <https://docs.sillytavern.app/usage/worldinfo> |

【事实】**没有一个被调研项目的默认配置是纯向量检索。**向量在各处都是"可选加挂的一路信号"，不是记忆系统本身。

【推断】对 OurFairy 的意义：把 RAG 当作默认方案，等于默认引入 embedding provider、向量库、相似度阈值调参这三项成本，而收益在项目方自己的口径里都没有被保证（SillyTavern 直接不保证；Mem0 的收益声明是自家新旧版本对比）。更稳的起点是"**关键词 / 结构化字段命中 + 明确的召回预算**"，把向量留作可插拔的一路。

### 7.2 无 embedding 基线：四种已实现的形态

| 形态 | 谁在用 | 具体做法 | 一手依据 |
| --- | --- | --- | --- |
| 纯文件 + 关键词 + 目录索引 | Letta Code（MemFS） | 根目录文件常驻上下文，子目录靠 `MEMORY.md` 索引按需读取；无向量索引 | <https://docs.letta.com/concepts/memfs/index.md> |
| 命名空间键值 + 无 index 的 store | LangGraph `BaseStore` | 不配 `index` 则语义检索关闭，检索退化为 namespace 列举 | <https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/store/base/__init__.py> |
| SQL 子串回退 | Letta V1 | `embedding_config` 为空时 `ilike %query_text%` | <https://github.com/letta-ai/letta/blob/archive/letta/services/helpers/agent_manager_helper.py> |
| BM25 / 全文为主 | Graphiti（`bm25` 为独立检索方法）、Mem0（BM25 为混合信号之一）、SillyTavern（关键词触发） | 见 §7.1 | 同上各项目 |

【推断】"无 embedding 基线"并不是"退而求其次"，而是这批项目里**三个有明确产品形态的项目（Letta Code、LangGraph store、SillyTavern）默认就在跑**的形态。差别只在于召回质量的天花板与实现复杂度，而不是"能不能工作"。

### 7.3 可审计的纠正与删除：五种已实现的语义

| 方案 | 机制 | 数据是否被删 | 审计凭据 | 来源 |
| --- | --- | --- | --- | --- |
| Mem0 Dream | supersede（旧项标记 + 链接到新项）/ merge（折叠到 canonical）；默认读取返回 active + superseded | **否**（"Nothing Dream does is destructive"） | Dashboard 可查每次合成运行、模式及其来源记忆、被 supersede/merge 的项 | <https://docs.mem0.ai/platform/features/dream> |
| Letta Code MemFS | 每次记忆编辑提交 git | 否 | git 历史、提交边界、worktree 隔离、`memory-citations` 的 path/tool/observedAt/evidence | <https://docs.letta.com/concepts/memfs/index.md>、<https://github.com/letta-ai/letta-code/blob/main/docs/examples/mods/memory-citations.ts> |
| Graphiti 时序边 | `valid_at` / `invalid_at` / `expired_at` + `episodes` 溯源 | 否（旧边被标记失效） | episode 溯源链 + 时间戳 | <https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/edges.py> |
| LangMem | 默认 `enable_deletes=False`；工具可限权 | 默认否 | 逐条 `ExtractedMemory.id` 可寻址 | <https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/extraction.py> |
| SillyTavern Summary | 人工编辑摘要；编辑/删除带摘要的消息 → 回退上一版；"Restore Previous" | 否 | chat 文件 metadata 中的摘要状态 | <https://docs.sillytavern.app/extensions/summarize> |

【推断】三条不依赖付费平台的共同点是：**（1）纠正以"标记 + 链接"表达，而不是抹除；（2）每条可被纠正的对象都有稳定标识与时间戳；（3）纠正动作本身留有可查的痕迹。**这三点比"用了什么检索"更接近 OurFairy 需要的"可审计"。

### 7.4 为什么"上下文压缩"不等于"长期记忆"

【事实】Letta 官方文档把两者分得很清：

- 压缩（会话内）："As it approaches the model's context limit, **compaction happens automatically**: Letta summarizes older messages while keeping recent messages in the active context, so the thread can continue without a manual reset."，并且明说 "**A compaction summary can omit exact wording or provenance.** The message history remains available, and the agent can use conversation search to recover relevant earlier context."
  - 来源：<https://docs.letta.com/concepts/conversations/index.md>
- 长期记忆（跨会话）："Long-term knowledge belongs to the agent's MemFS memory, **not one conversation**. Durable lessons saved there remain available across conversations."
  - 来源：<https://docs.letta.com/concepts/conversations/index.md>

【事实】Letta 的 `Context Constitution`（CC0）从另一侧确认这条界线：

> "You have **infinite full-resolution storage**: every 'input' (or experience) is logged in a database and available for on-demand retrieval. Your **memory bottleneck lies in the context window itself** — the only thing you 'know' at any given point in time is precisely limited to the information contained in your weights … and information contained in your context window."
> "Context that was formed in the past, or represents the past … is just as much a part of the Letta agent as context that is currently in the context window."

- 来源：<https://github.com/letta-ai/context-constitution/blob/main/constitution/CONSTITUTION.md>

【事实】Mem0 侧亦有对应表述（其存储是"记忆库"，而非会话摘要）：检索是对**事实库**的检索，与"把本轮上下文摘要一下"是两种操作；Dream 更明确是"memory set 的后台整理"。
- 来源：<https://docs.mem0.ai/platform/features/dream>

【推断】四条可分辨的判据：

1. **生命周期**：压缩的产物随会话结束而失效（Letta：compaction summary 挂在消息线程上）；长期记忆跨会话、跨话题存活（Letta：MemFS 属于 agent 而非 conversation）。
2. **可追溯性**：压缩摘要会丢措辞与出处（Letta 官方原话），因此不能作为"事实"的权威来源；长期记忆需要逐条可寻址、可溯源、可被纠正。
3. **失效方式**：压缩是"为了塞进窗口"的必要之恶，它不回答"这条信息是否还成立"；长期记忆必须回答"这条事实是否被更新的事实取代"（Mem0 supersede / Graphiti `invalid_at`）。
4. **成本性质**：压缩降低**单次调用**的 token；长期记忆降低的是**未来需要重放旧信息**的次数与噪声。一份摘要能压住 token 增长，但压不住"摘要里丢掉了那条关键事实"。

【推断】因此，"控制 Fairy 每次模型调用的上下文增长"与"建立长期记忆"是**两个不同的问题**，前者至少有三种成熟解法（滚动摘要 + 可回滚、显式注入预算、按需按路径读取文件），后者需要额外的机制（写入决策、失效语义、溯源、巩固）。把压缩当作记忆会同时得到两者的缺点：既丢事实，又无法纠正。

---

## 8. 面向决策的比较

### 8.1 三档分类

| 分类 | 候选 | 判断依据 |
| --- | --- | --- |
| **值得做 adapter（可作为依赖接进 dsh 插件）** | **Mem0 TS OSS（`mem0ai/oss`）** | Apache-2.0；TypeScript；默认可全本地（SQLite 向量表 + SQLite history）；embedder / LLM / 向量库均可替换；返回结构含稳定 `id` 与 `event`，写入侧是 ADD-only + 显式 update/delete + history。风险：默认路径仍要 embedding provider；语义质量未经本项目实测。 |
| | **（次选）Letta Code 的 MemFS 相关思路** | 不是库而是 harness，不能直接依赖；但其存储形态（git 版本化 Markdown + 目录索引 + 关键词搜索）可用少量自研代码复刻，且许可宽松（Apache-2.0）。**以"借机制并自建薄实现"落地，而不是引入依赖。** |
| **只值得借机制（不引依赖）** | **Letta（dreaming / sleeptime 水位线 / worktree 并发 / git 溯源 / citations）** | 机制形状清晰、与存储无关、可在既有 dsh 插件内实现；Letta Code 本身是 harness，引入即冲突。 |
| | **LangMem（collection vs profile、默认不删、延迟去抖、namespace scope）** | Python-only 且绑定 LangGraph `BaseStore`；但四类机制均可移植为 dsh 插件内的形状。 |
| | **Graphiti（bi-temporal 失效语义、episode 溯源、RRF 混合检索无 LLM 在环）** | 图数据库与摄取管线对少量受邀用户过重；失效语义与检索结构值得照抄形状。 |
| | **SillyTavern（滚动摘要 + 人工可编辑 + 关键词触发 + 向量重排的缓存代价）** | AGPL-3.0，不可复用代码；机制（尤其"向量重排与 prompt cache 互斥"）必须知道。 |
| | **Mem0 Platform（Dream / Profiles / Graph Memory）** | 全部为托管付费功能，OSS 无对应实现；可作为**语义参考**读，不可作为依赖。 |
| **运维复杂度与少量受邀用户不相称** | **Graphiti 全套（Neo4j / FalkorDB / Neptune + 逐 episode LLM 抽取 + 实体解析 + 社区摘要）** | 需要常驻图数据库与持续摄取成本；`neo4j` + `openai` 是硬依赖；Kuzu 后端已被官方标注弃用（上游不再维护）。 |
| | **Zep 托管服务（Context Lake / Context Block / 治理面）** | 面向企业数据统一上下文，与"小规模受邀用户的个人 agent 记忆"不是同一量级与同一治理需求。 |
| | **Mem0 Platform 的图记忆与合成** | 图记忆已从 OSS 移除，是 Platform always-on 功能；Synthesis 需 Pro 及以上（按计划分档）。两者都意味着"记忆交给第三方托管 + 持续付费"。 |
| | **向量检索作为默认召回** | 三个有产品形态的项目默认都不用它；SillyTavern 官方直接不保证收益；且动态重排会打穿 prompt cache。 |

### 8.2 若最终落在 1–3 个 dsh 插件形态上，外部证据支持的能力分工

【推断】以下是外部机制与 OurFairy 目标的映射结论，**不是方案决定**（scope 与人格学习留待法厄同，见 §9）：

- **插件 A：上下文预算与召回面（in-context surface）**
  - 外部依据：Letta MemFS 的"根目录常驻 + 子目录按需读"、LangGraph store 的"无 index 即无语义检索"、SillyTavern 的"关键词触发 + 可预测"。
  - 形状：一次调用前显式决定"注入什么、注入多少 token"，而不是让模型自己在窗口里翻。
- **插件 B：记忆写入与失效（memory write & supersede）**
  - 外部依据：Mem0 的 ADD-only + `linked_memory_ids` + 显式 update/delete + history；Graphiti 的 `valid_at` / `invalid_at`；LangMem 的默认不删。
  - 形状：LLM 只负责"增"与"提议改"，删除与取代必须走显式、可留痕的路径。
- **插件 C：离线巩固（consolidation / DREAMING）**
  - 外部依据：Letta V1 sleeptime（回合计数 + 水位线 + 后台 Run）、Letta Code dreaming（后台子代理 + 步数/压缩事件触发 + git worktree 隔离）、LangMem `ReflectionExecutor`（去抖：新输入取消旧任务并合并）、Mem0 Dream（合成只处理 user-only scope、设前向边界、延迟可接受）。
  - 形状：后台执行 + 增量水位线 + 产物落在可版本化存储 + 失败不影响前台。

【推断】这三个插件的形状可以**全部在无 embedding 的前提下成立**（召回用关键词 / 字段 / 结构化索引，向量作为可插拔增强），这与 §7.1、§7.2 的横向事实一致。

---

## 9. 留给法厄同决定的问题（本文不代决）

1. **记忆共享范围**：个人记忆是否跨会话共享、是否跨代理人共享、是否存在"共同记忆"层。外部证据只提供了三种已实现的 scope 形状（Letta：agent 级记忆 + 多 conversation；Mem0：`user_id`/`agent_id`/`run_id`/`app_id` + "合成只看 user-only scope"；Graphiti：`group_id` + user graph / shared graph），**不构成对 OurFairy 的建议**。
2. **人格学习**：Fairy 是否从交互中改变自身设定，以及这种改变是否需要法厄同确认。外部材料中，Letta 的 `Context Constitution` 讨论了"身份连续性 vs 用户指令"的张力，Mem0 的 Profiles 是"用户档案"而非"agent 人格"，SillyTavern 的 persona 是人工静态设定——三种取向都存在，本文不选。
3. **DREAMING 的触发与并发语义**：`GLOSSARY.md` 记载的旧语义（sleeping 触发、与 active 冲突时延后、DREAMING 期间会话信息不得影响它、并发安全）是否直接沿用到新骨架，属于产品决定；本文只提供了外部可对照的触发与隔离机制。
4. **是否引入任何付费托管记忆服务**：Mem0 Platform 的 Dream / Profiles / Graph Memory 与 Zep Cloud 都把巩固与图能力放在付费侧。

---

## 10. 限制与证据缺口

1. **未实测**：本篇没有在本项目或任何外部服务上运行过任何流程。所有"效果"类陈述都标注为【项目自称】或【推断】，不能当作 OurFairy 场景下的验证结论。
2. **Letta 的两代形态差异大**：V1（`archive` 分支）的 core/archival/recall memory 与当前 Letta Code 的 MemFS 是两套设计。本篇对 V1 的描述只用于说明"机制曾经长什么样"，当前可用的是 Letta Code 形态。
3. **Mem0 版本跨度大**：本篇的写入/检索事实锚定在 `v2.2.1` / `ts-v3.3.1`（2026-09-25）与官方迁移文档描述的 "v3" 算法；更早版本是"LLM 自主 UPDATE/DELETE"的旧模型，官方迁移文档已列为 breaking change。跨版本结论不可直接套用。
4. **Zep 托管版与开源 Graphiti 的能力不对等**：本文未逐项核对托管版的检索与治理特性，只在 §4.4 记录了官方文档描述的 Observations / User Summary / Thread Summaries。
5. **LangMem 版本较旧**：PyPI `langmem` 最新为 0.0.30；本文按 `langchain-ai/langmem` main 分支源码与文档核对，`create_memory_store_manager` 与 `ReflectionExecutor` 的具体签名可能随版本变化。
6. **未覆盖的候选**：本次未纳入 Zep 之外的其它图记忆方案（如 Microsoft GraphRAG——官方文档已将其定位为静态文档摘要，与"动态关系失效"目标不同）、也未纳入托管型 AI companion 记忆服务（属外部服务，与"自持 + 可审计"目标冲突）。如需扩大范围应另开研究票。
7. **未读取旧 Fairybot 记忆库与 dsh 源码**：按分工这两项由其他代理核查；本篇与它们的衔接点（MemFS 式版本化记忆、sleeptime 式水位线巩固、`memory_search` 工具面）尚未做源码级比对。
8. **未修改本仓库任何其他文件**：按任务范围，本篇是唯一新增文件；`docs/research/README.md` 的索引未更新。

---

## 附：本文引用的一手来源清单

**Letta**
- <https://github.com/letta-ai/letta>（README，说明代码迁至 letta-code、V1 在 `archive` 分支）
- <https://github.com/letta-ai/letta-code>（v0.34.24，2026-10-25）
- <https://github.com/letta-ai/letta-code/blob/main/src/agent/memory-conflict-repair.ts>
- <https://github.com/letta-ai/letta-code/blob/main/docs/examples/mods/memory-citations.ts>
- <https://github.com/letta-ai/letta/blob/archive/letta/groups/sleeptime_multi_agent_v4.py>
- <https://github.com/letta-ai/letta/blob/archive/letta/functions/function_sets/base.py>
- <https://github.com/letta-ai/letta/blob/archive/letta/orm/passage.py>
- <https://github.com/letta-ai/letta/blob/archive/letta/services/agent_manager.py>
- <https://github.com/letta-ai/letta/blob/archive/letta/services/helpers/agent_manager_helper.py>
- <https://github.com/letta-ai/letta/blob/archive/letta/schemas/embedding_config.py>
- <https://github.com/letta-ai/letta/blob/archive/letta/settings.py>
- <https://docs.letta.com/configuration/memory/index.md>（dreaming）
- <https://docs.letta.com/concepts/memfs/index.md>（无默认向量索引、git 溯源、worktree）
- <https://docs.letta.com/concepts/conversations/index.md>（compaction 与 provenance 损失）
- <https://docs.letta.com/concepts/stateful-agents/index.md>
- <https://docs.letta.com/self-hosting/index.md>
- <https://github.com/letta-ai/context-constitution/blob/main/constitution/CONSTITUTION.md>（CC0-1.0）
- <https://github.com/letta-ai/sleep-time-compute>
- <https://arxiv.org/abs/2310.08560>（MemGPT）
- <https://arxiv.org/abs/2504.13171>（Sleep-time Compute）

**Mem0**
- <https://github.com/mem0ai/mem0>（Apache-2.0；tag `v2.2.1`、`ts-v3.3.1`）
- <https://github.com/mem0ai/mem0/blob/v2.2.1/mem0/memory/main.py>
- <https://github.com/mem0ai/mem0/blob/v2.2.1/mem0/configs/prompts.py>
- <https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/src/oss/src/config/defaults.ts>
- <https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/src/oss/src/vector_stores/memory.ts>
- <https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/src/oss/src/utils/scoring.ts>
- <https://github.com/mem0ai/mem0/blob/ts-v3.3.1/mem0-ts/package.json>
- <https://docs.mem0.ai/migration/oss-v2-to-v3>（ADD-only、混合检索、图记忆移入 Platform、benchmark 声明）
- <https://docs.mem0.ai/open-source/overview>（默认组件）
- <https://docs.mem0.ai/platform/features/dream>
- <https://docs.mem0.ai/platform/features/user-profiles>
- <https://docs.mem0.ai/platform/features/memory-decay>
- <https://docs.mem0.ai/platform/features/entity-scoped-memory>
- <https://docs.mem0.ai/platform/features/graph-memory>

**Zep / Graphiti**
- <https://github.com/getzep/graphiti>（v0.31.2，2026-10-20）
- <https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/edges.py>
- <https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/utils/maintenance/edge_operations.py>
- <https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/llm_client/decision_prompts.py>
- <https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/search/search_config.py>
- <https://github.com/getzep/graphiti/blob/v0.31.2/graphiti_core/graphiti.py>
- <https://github.com/getzep/graphiti/blob/v0.31.2/pyproject.toml>
- <https://pypi.org/project/graphiti-core/>
- <https://help.getzep.com/graphiti/getting-started/overview>
- <https://help.getzep.com/graphiti/working-with-data/searching>
- <https://help.getzep.com/v4/overview>
- <https://help.getzep.com/v4/install-sdks>
- <https://help.getzep.com/v4/observations>
- <https://help.getzep.com/v4/users-and-user-graphs>

**LangMem**
- <https://github.com/langchain-ai/langmem>（MIT）
- <https://github.com/langchain-ai/langmem/blob/main/docs/docs/concepts/conceptual_guide.md>
- <https://github.com/langchain-ai/langmem/blob/main/docs/docs/background_quickstart.md>
- <https://github.com/langchain-ai/langmem/blob/main/docs/docs/guides/delayed_processing.md>
- <https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/extraction.py>
- <https://github.com/langchain-ai/langmem/blob/main/src/langmem/knowledge/tools.py>
- <https://pypi.org/project/langmem/>
- <https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/store/base/__init__.py>

**SillyTavern**
- <https://github.com/SillyTavern/SillyTavern>（1.19.0，2026-09-14；AGPL-3.0）
- <https://github.com/SillyTavern/SillyTavern/blob/1.19.0/LICENSE>
- <https://docs.sillytavern.app/extensions/summarize>
- <https://docs.sillytavern.app/extensions/chat-vectorization>
- <https://docs.sillytavern.app/usage/characters/data-bank>
- <https://docs.sillytavern.app/usage/worldinfo>
