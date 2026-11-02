> 2026-11-02 状态：日期化记录。本文记录 2026-11-02 的实读结论，不描述当前实现；实现入口以代码与 [`combo.json`](../../combo.json) 为准。

# 记忆检测/维护的现有接缝，与锁定 dsh 的 Skill 机制（2026-11-02）

日期：2026-11-02。本文只回答两件事：**(A)** OurFairy 现在这套记忆检测/维护机制实际落在哪些代码接缝上、哪些能再用；**(B)** 锁定提交的 dsh 是否已经有 skill / 指令包 / 插件安装机制，以及它们与我们的组合（bundle）之间是什么关系。**本文不做产品决策，也不改任何产品代码、`GLOSSARY`、ADR、规格或研究索引。**

## 证据口径

- **【代码事实】** 指我在本仓 `/home/eafen405/projects/OurFairy` 当前工作树（HEAD `5a1d481882`，`main`）里读到的源码与文档，给 `路径:行号`。
- **【外部项目事实】** 指我在 dsh 检出 `/home/eafen405/projects/deepseek-harness` 读到的源码与文档，给 `路径:行号`。该检出 HEAD = `d80522d276dd5a839a2b5ea8afcc78af898b6688`（`Merge branch 'ticket/241-absolute-compaction-threshold' into product/ourfairy-v1`），与 [`combo.json`](../../combo.json) 的 `repos.dsh.productCommit` 完全一致，`git status` 干净。**它是产品提交，不是 `docs/research/README.md` 表里的「dsh 上游基线」`d7432673…`**；本文的 dsh 断言只对这个提交成立。
- **【推断】** 指我据上述事实推出的、没有直接证据的判断，文中逐条标注。
- **【未核实】** 指我明确没能确认的点，不猜。
- 方法：`grep`/`glob` 定位后只读必要文件；没有运行任何测试、没有 `pnpm install`、没有启动后端、没有 boot 组合。因此本文没有运行时结论，所有「现在会怎样」都是源码可读行为。
- 本仓既有研究中的 `docs/research/2026-10-26-context-memory-dreaming.md` 是外部项目（Letta/Mem0/Graphiti/LangMem/SillyTavern）的一手调研，**本文不与它重叠**：那篇回答「外部怎么做」，本文回答「我们已有的是什么形状、dsh 现成能借什么」。
- 按要求**未**在 `docs/research/README.md` 增加索引行。

## 结论（10 条）

1. **【代码事实】记忆维护不是一个「流程引擎」，而是「一个表 + 一个 1 秒定时器 + 每源会话一个原生子 Agent」。** 状态只有一张 `maintenance_state` 表、`status` 三个值（0 空闲 / 1 运行中 / 2 失败），判断逻辑全在 `backend/memory/src/maintenance.ts`（`TICK_MS = 1_000`、`RETRY_MS = 2_000`，`:51`、`:53`）。没有队列、没有调度服务、没有第二个进程。
2. **【代码事实】水位线（watermark）与「冻结切点」（cut）是两个不同字段，这是幂等与并行的关键。** `watermark_seq` 只由「已完成区间」推进（`store.ts:351-359`），`cut_seq` 在认领时冻结（`store.ts:313-334`）。认领与冻结在同一个 `BEGIN IMMEDIATE` 事务里，且 `status !== 0` 时**永不**二次认领（`store.ts:319-333`），所以同一源会话不会出现两个维护子会话。
3. **【代码事实】维护材料是一个纯函数投影，不是「把会话丢给子代理」。** `assembleMaterial()` 只投影 `(watermark, cut]` 区间内的用户消息、Fairy 回复、附件名、四个记忆变更工具调用（`material.ts:74-105`，工具名集合 `:20`），并以纯文本作为子会话的用户消息注入（`maintenance.ts:382-385`）。
4. **【代码事实】「静默」只有一条判据：源会话没有正在跑的回合。** `#quiet()` = 源 Agent 不在线（冷会话）或 `status === 'idle'`（`maintenance.ts:344-348`）；没有超时、没有「多久没说话」的静默窗口。门槛衰减用的是**最新闭合用户回合的时间**（`#observe()` 写 `last_closed_at`，`store.ts:287-304`；`currentThreshold()` `maintenance.ts:144-153`）。
5. **【代码事实】热生效靠 dsh 的 `volatile()` 配置引用，不靠重建行。** 四个维护字段在 `Config` 上声明 `.volatile()`（`index.ts:56-66`），引擎每次判断都重读（`maintenance.ts:122-131`）；网关写设置后「下一次判断」生效（`backend/gateway/src/service.ts:691-728`）。测试把这条行为钉住（`tests/memory-maintenance.test.mjs:473`、`tests/memory-maintenance-recovery.test.mjs:212`）。
6. **【代码事实】维护子会话的工具面是「先清空继承、再自己登记」，不是「给子会话一个白名单」。** `#composeChild()` 调 `agentCtx.tools.restrict({ allow: [] })`（`maintenance.ts:455-463`），而 dsh 的限制**只作用于继承的工具，scope 自己注册的工具豁免**（`docs/subsystems/tools.md:165-168`）。所以记忆工具是记忆行在子会话上自己注册的（`index.ts:111`），而印象提示段/印象工具对无主会话直接不注册（`impression.ts:148-159`）。
7. **【代码事实】Fairy 现在没有任何 skill 概念；「可复用工作流程」在规格里被明确留给 skill 系统，而 skill 系统本身被列为 Out of Scope。** `docs/specs/fairy-memory.md:144` 要求「具体事实或经历进入长期记忆，可复用工作流程进入 skill，不能双写」，`:217` 把「skill 系统的实现」列入 Out of Scope；`docs/specs/ourfairy-v1.md:268` 把「技能能力」列入首版 Out of Scope。`backend/*/src` 没有任何 `skill` 字样。**注意口径**：本文实读期间（2026-11-02 下午）工作树里出现了并行的 `docs/glossary/skill.md` 与 `GLOSSARY-MAP.md:12` 的「技能」条目——那不是本文的产物，本文的结论也不依赖它；本文对「现在没有技能能力」的断言只建立在代码、bundle 行清单与两份 spec 之上。
8. **【外部项目事实】锁定 dsh 有一整套原生 skill 家族，并且「默认基础组合是挂载的」：`dsh-skill`（`ctx.skills` 注册表）、`dsh-skill-filesystem`（本地目录 provider）、`dsh-tool-skill`（会话目录 + `skill` 工具）。三者都在 `packages/bundle/base/cordis.patch.yml:308-315`。
9. **【代码事实】我们的 bundle 是「故意」把这些行排除，并由测试断言缺席。** `backend/v1-bundle/cordis.patch.yml:1-10` 写明不继承 `@deepseek-ai/dsh-base`，因为 base 也挂了 skill/goal/subagent/telemetry/web 等被排除的能力；`tests/baseline-boot.test.mjs:40-80` 的 `FORBIDDEN_ROW_IDS` 明确列出 `skill`、`skill-filesystem`、`tool-skill`（`:63-65`）与 subagent 一族（`:70-76`）。**所以「dsh 有」和「我们能直接用」是两件事。**
10. **【推断】真正能立刻复用的不是 skill 的代码，而是三类接缝**：①每 Agent 的提示段（`ctx.systemPrompt.section`，已被印象/人格/记忆策略用了三次）；②每 Agent 的工具注册 + 继承限制（`ctx.tools.register` / `tools.restrict`）；③原生 Agent 的 create/resume + `setup` 组合（`ctx.agents.create/resume`）。skill 的**代码**（注册表、目录 provider、`skill` 工具）在我们这里是「可挂载但未挂载，且与既有排除决定冲突」的状态；把它说成「复用现有 skill 机制」会是错误表述。

---

## 1. OurFairy 现有记忆机制：入口与接缝

### 1.1 模块与装配

**【代码事实】** 记忆是一个独立的 Cordis 行 `@ourfairy/dsh-memory`，`inject` 八个服务：`tools`、`agents`、`sessionPersistence`、`sessionQuery`、`identity`、`webServer`、`connection`、`systemPrompt`（`backend/memory/src/index.ts:44-45`）。`apply()` 里依次建 `MemoryStore`（自有 SQLite）、`MemoryService`、`ImpressionService`、`MaintenanceEngine`，挂两个印象 HTTP 路由，然后在 `agent/created` 上给每个 Agent 注册工具/提示段并 `engine.watch()`，最后 `engine.start()`（`index.ts:75-131`）。`agent/disposed` 时丢弃按会话记录的门禁状态（`index.ts:122-128`）。

**【代码事实】** 存储是**独立文件** `memory/memory.sqlite`（`backend/v1-bundle/cordis.patch.yml:387-398`），同步单连接、WAL、`meta.schema_version` 版本化（当前 `SCHEMA_VERSION = 2`）、`BEGIN IMMEDIATE` 事务（`store.ts:25`、`:139-153`、`:371-395`、`:415-425`）。四张表：`memories`、`impressions`、`maintenance_state`、`meta`（`store.ts:27-57`）。

**【推断】** 这套形状对「加一个新能力」的含义是：新能力如果也需要「每会话状态 + 后台判断 + 子 Agent」，最小改动是**再加一张表 + 一个 watch/start 循环**，而不是引入通用调度器。这与规格把「跨会话统一维护调度器」列为 Out of Scope 一致（`docs/specs/fairy-memory.md:219`）。

### 1.2 维护触发与门槛

**【代码事实】** 每源会话的触发条件是三个合取项（`maintenance.ts:263-302`）：

| 条件 | 实现 | 出处 |
| --- | --- | --- |
| 有未维护的闭合用户回合 | `facts.turns.filter(t => t.seq > watermark_seq).length` | `:270-274` |
| 待处理数 ≥ 当前门槛 | `currentThreshold()`：`turns - floor(elapsed / decayHours)`，下限 1 | `:144-153`、`:276-277` |
| 源会话静默 | `#quiet()`：无 live Agent 或 `status === 'idle'` | `:344-348` |

**【代码事实】** 门槛的两个数字只有一个权威：`MAINTENANCE_TURNS = {default:15,min:5,max:50}`、`MAINTENANCE_DECAY_HOURS = {default:6,min:3,max:24}`（`backend/memory/src/maintenance-policy.ts:20-23`）。记忆行的 `Config`、引擎的读时校验、网关的手机面校验都从它取（`index.ts:56-66`、`maintenance.ts:122-131`、`gateway/src/service.ts:123-139`）；测试断言「消费者自报数字会挂」（`maintenance-policy.ts:11-14`）。

**【代码事实】** 闭合用户回合的判定是「真实用户开的回合」：`turn/start` 清标记，`source.kind === 'user'` 的 append 用户消息置标记，`turn/end` 且标记在则计入（`material.ts:47-70`）。工具 jobs 报告之类的 `user/message` 因 `source.kind` 不是 `'user'` 而被排除。

### 1.3 维护材料：投影而非转交

**【代码事实】** `assembleMaterial()` 的输入是三个位置 `(events, watermarkSeq, cutSeq)`，输出是子会话的用户消息正文（`material.ts:74-105`）。逐类处理：用户消息 → `[用户] …`、附件 → `[附件] 名称`、Fairy 回复 → `[Fairy] …`、四个记忆变更工具调用 → `[记忆变更] name args`（`:20`、`:90-102`）。区间用「水印独占、切点包含」表达（`event.seq > watermarkSeq && event.seq <= cutSeq`，`:86`）。

**【代码事实】** 材料开头有一句自述边界（`MATERIAL_HEADER`，`material.ts:38-40`），说明附件正文、其他工具输入输出、系统提示、印象与压缩摘要都不在其中。压缩替换消息被 `isAppendSurfaceEvent` 排除，因此摘要不会伪装成对话（`material.ts:8-12`、`:100`）。

### 1.4 水位线、冻结切点与幂等

**【代码事实】** `maintenance_state` 一源会话一行：`watermark_seq`（已完成区间覆盖到的最后位置）、`cut_seq`（活动区间的冻结切点 / 无活动区间时的最新观测闭合回合）、`last_closed_at`（衰减钟）、`child_session`、`status`（`store.ts:48-56`）。

**【代码事实】** 认领（`claimMaintenance`）与完成（`completeMaintenance`）的语义是分开的：认领只冻结 `cut_seq` 并把 `status` 置 1，不动水位；完成把 `watermark_seq = cutSeq` 并置 0（`store.ts:313-334`、`:351-359`）。**零写入也算完成**（`:346-350` 注释与 `:351-359` 实现）。

**【代码事实】** 认领的幂等由事务内的状态检查保证：`if (row !== undefined && row.status !== 0) return false`（`store.ts:321`），且整段在 `#transaction()` 里（`:319`、`:415-425`）。引擎侧还有一层进程内 `#active` 集合防止并发评估（`maintenance.ts:184`、`:251`、`:359-360`）。

**【代码事实】** 重启恢复不依赖进程内状态：`#bootstrap()` 先读 `maintenanceRows()`，再用 `sessionPersistence.list()` 补全所有「有主、且不是维护预设」的会话（`maintenance.ts:230-247`）；失败也被 `catch` 吞掉，留给下一次 tick（`:241-246`）。冷会话的变更探测用持久化 revision 做 token（`:330-333`），live 会话用 `session.seq`（`:309-313`）。

**【推断】** 因此「同一区间被处理两次」在单进程内被两道闸挡住；但 `#active`/`#cache`/`#retryAt` 都是进程内状态，`status` 才是跨进程的唯一权威。若将来真有两个进程打开同一个 `memory.sqlite`，能否正确互斥**取决于 SQLite 的 `BEGIN IMMEDIATE` 争锁行为，本文未验证**，标注为【未核实】。

### 1.5 静默与热会话

**【代码事实】** 「静默」= 没有运行中的回合（`maintenance.ts:344-348`）；冷会话直接视为静默。维护子会话与源会话并行，源码注释明确「no work of the source is awaited」（`maintenance.ts:15-16`，实现 `:358-373` 的 `#launch` 不 await 源）。

**【代码事实】** 设置热生效：`readMaintenanceSettings()` 每次调用都重读字段（`maintenance.ts:110-131`），`Config` 用 `.volatile()`（`index.ts:56-66`）。设置写入不中断正在跑的子会话：测试 `tests/memory-maintenance.test.mjs:473`。

### 1.6 维护子会话的工具限制

**【代码事实】** 子会话的「整个世界」由 `#composeChild()` 定义：`tools.restrict({ allow: [] })` + 一个 `ourfairy:memory-maintenance` 提示段（order 0、`interpolate: false`）（`maintenance.ts:455-463`）。

**【代码事实】** 工具限制的语义（外部项目事实）：`ToolRestriction` 只作用于**继承**的工具（全局层 + 祖先 scope），scope **自己**注册的工具豁免；多个限制取交集；`allow` 是白名单，排除其后未列出的继承工具（`docs/subsystems/tools.md:165-168`）。这与 `maintenance.ts:11-16` 的注释一致。

**【代码事实】** 记忆行因此在**所有** live Agent 上注册五个记忆工具（`index.ts:105-112`，`registerMemoryTools`），但只在**有主**会话上注册记忆策略段（`tools.ts:116-126`，判据 `shortIdOf(agent.session.header.owner) === undefined`）与印象段/印象工具（`impression.ts:148-159`）。维护子会话无主，于是「只能记忆、不能印象」（`maintenance.ts:13-16`、`tools.ts:9-14`）。

**【代码事实】** 生产侧的产品工具面另有一条统一判据 `isUserSession(header)`：有 owner、无 `parentSession`、无 `agentPreset`（`backend/identity/src/session.ts:28-33`），被 `delivery`、`groups`、`search` 用作注册闸（`backend/delivery/src/index.ts:170`、`backend/groups/src/index.ts:67`、`backend/search/src/index.ts:39`）。因为维护子会话同时有 `parentSession` 和 `agentPreset`，它天然被挡在外面。

**【推断】** 如果将来要「给子会话一门新技能」，现有唯一干净的接法是**在子会话的 `setup` 里自己注册**该工具（或提示段），而不是放宽 `restrict`：放宽 `allow` 会连带把全局继承的 `fs`/`bash`/`todo` 等一起放进来。

### 1.7 已有记忆检索与写入

**【代码事实】** 五个模型工具：`memory_add`、`memory_search`、`memory_edit`、`memory_delete`、`memory_switch`（`tools.ts:59-114`），工具描述很长、把「不要写什么」写在 schema 描述里（`:61-114`）。

**【代码事实】** 检索是**字面子串**匹配，不是向量/语义：SQL `instr(content, ?) > 0`，加层级等值条件，加可选的内容更新时间闭区间（`store.ts:180-200`）。排序 `content_updated_at DESC, id DESC`，条数上限 20、字符预算 8000，**整条进或整条不进**，单条超预算即略过并报 `truncated`（`store.ts:190-199`、`service.ts:23-26`、`:139-155`）。日期边界必须成对出现且 `start <= end`（`service.ts:286-298`）。

**【代码事实】** 写入有三条硬规则：`add`/`edit` 要求有主（无主会话直接 403 `memory/missing-owner`，`service.ts:112-125`）、正文 ≤ 8000 字符且不截断（`service.ts:264-273`）、`edit` 的 `old_string` 必须恰好出现一次（`:179-184`，0 次 404、多次 409）。

**【代码事实】** 查询门禁：`search` 把返回的编号记到**调用工具的会话**上（`service.ts:141`、`:249-254`），`edit`/`delete`/`switch` 之前先查这张表，没查过就 403 `memory/not-queried`（`:230-234`）。门禁按会话隔离，`agent/disposed` 时清空（`:210-212`、`index.ts:122-128`）。

### 1.8 来源追踪

**【代码事实】** 每条记忆存 `source_session`（`store.ts:36`），归属用户**不落表**，由该会话不可变的 header 派生（`service.ts:19-20` 注释、`:244-247`）。

**【代码事实】** 普通会话：来源 = 自己，owner 来自自己的 header；维护子会话：来源 = `parentSession`，owner 来自父会话的持久化 header（`service.ts:88-106`）。**模型没有字段可以选择来源或归属**（`service.ts:5-7`、`tools.ts:1-8`）。

**【代码事实】** 编辑会**改写来源**：`UPDATE memories SET content = ?, source_session = ?, content_updated_at = ?`（`store.ts:212-221`），理由写在注释里——「the source session is the session that supports the new content」。层级切换与检索不动这三项（`store.ts:253-266`、`:180-200`）。

**【代码事实】** 删除是物理 `DELETE`，无墓碑；编号由 `AUTOINCREMENT` 单调分配、删除后不复用（`store.ts:159-169`、`:223-228`），依据 ADR-0002（`docs/adr/0002-physical-memory-deletion.md:6`）。

**【代码事实】** 检索结果里的 `owner_short_id` 是**按结果来源会话逐条反查**的（`service.ts:142-148`），不是记忆表里的列。

### 1.9 并发与失败恢复

**【代码事实】** 完成判定不看 `whenIdle()`，只看持久 `turn/end` 的 `reason.kind === 'completed'`（`maintenance.ts:465-477`）；源码注释点明 `whenIdle()` 在失败时也会 resolve（`:17-21`）。`max-tokens`/`blocked`/`aborted`/`interrupted`/`error` 全部算未完成（`:470-471`）。

**【代码事实】** 失败路径分三种，且**都不推进水位**：

| 情形 | 动作 | 出处 |
| --- | --- | --- |
| 子会话从未创建成功 | `resetMaintenance()` 释放冻结切点与 child | `maintenance.ts:389-393`、`store.ts:365-369` |
| 子会话已存在但运行失败 | `failMaintenance()` 保留 cut + child，`status = 2` | `maintenance.ts:394-396`、`store.ts:337-344` |
| 失败后下一次评估 | 用**同一个** child 会话 `agents.resume()`，附一句续跑提示 | `maintenance.ts:404-431`、`:84` |

**【代码事实】** 重试退避是进程内 `#retryAt`，固定 2 秒（`maintenance.ts:53`、`:255`、`:367`、`:397`、`:426`、`:488`）；没有指数退避、没有重试计数上限——失败区间会一直以 2 秒间隔被重新评估。

**【推断】** 这是「少量受邀用户、个人项目」尺度下的合理简化，但它意味着**一个持续失败的子会话会长期占用 `status = 2` 并把该源会话卡在过去**（新回合继续累积，但都进不了已冻结区间之外的处理）。是否有需要人工介入的出口，现在没有实现——只有把所有失败都靠 `resetMaintenance()` 之外的路径重试。

**【代码事实】** 关闭顺序：`engine.close()` 先 dispose 所有 live 子会话 handle 并 `Promise.allSettled` 等所有 run 结束，然后 `store.close()`（`index.ts:99-103`、`maintenance.ts:215-221`）。

---

## 2. Fairy 当前的提示词/工具注入与 bundle 装配

### 2.1 提示段现在是三层，各自由不同行拥有

**【代码事实】** 系统提示是一个「按 scope 注册的具名段」注册表，段可以是静态文本或**每次装配时求值的函数**（`backend/memory/src/impression.ts:152-157` 用函数形态）。当前注册的段：

| 段名 | order | 谁注册 | 何时注册 | 出处 |
| --- | --- | --- | --- | --- |
| `ourfairy:persona` | 0 | chat 行 | 有主会话的 Agent setup（`#resume` 内） | `backend/chat/src/runtime.ts:287-296`、`persona.ts:2` |
| `ourfairy:identity` | 1 | chat 行 | 同上（带认证短号） | `backend/chat/src/runtime.ts:297-298` |
| `ourfairy:impression` | 2 | 记忆行 | 有主会话（无主子会话不注册） | `backend/memory/src/impression.ts:151-159` |
| `ourfairy:memory-policy` | 3 | 记忆行 | 有主会话 | `backend/memory/src/tools.ts:116-126` |
| `ourfairy:memory-maintenance` | 0 | 记忆行 | 维护子会话的 `setup` | `backend/memory/src/maintenance.ts:457-462` |

**【代码事实】** 所有段都显式 `interpolate: false`，即不做模板插值（同上各条）。

**【推断】** 这张表就是「新增一类可注入指令」的最小接入点：一段静态/动态文本、一个具名段、一个判定「谁能拿到」。若未来引入 skill，需要先回答的是「skill 正文走提示段还是走工具结果」，而不是「再加一套注入机制」。

### 2.2 bundle 的装配边界

**【代码事实】** bundle 是 `@ourfairy/dsh-v1-bundle`，patch 只做一件事：两个 loader 原生 group（`kernel` / `plugins`）下的显式行清单（`backend/v1-bundle/cordis.patch.yml:1-40`）。`kernel` 放「一段停掉仍能建立会话、跑一轮、抬起 Web 载体」的东西；`plugins` 放产品能力及其依赖的原生行（`:12-24`）。分组理由与门禁在 `tests/bundle-groups.test.mjs`（patch 注释 `:21-22`）。

**【代码事实】** 明确不继承 `@deepseek-ai/dsh-base`，因为 base 也挂了 `skill`、`goal`、`subagent`、`telemetry`、web 工具，以及默认的全局文件/shell/sandbox 行（`cordis.patch.yml:3-6`、`backend/v1-bundle/README.md:9-12`）。

**【代码事实】** 缺席行由测试断言，不是靠注释：`FORBIDDEN_ROW_IDS`（`tests/baseline-boot.test.mjs:40-80`）包含 `skill`、`skill-filesystem`、`tool-skill`（`:63-65`）、`subagent` 一族（`:70-76`）、`goal`（`:66-69`）、`otel`/`web`（`:77-80`）；门禁在 `:143-149` 断言 `mounted` 为空。

**【代码事实】** 被替换的原生行：`fs-sandbox`、`working-directory`、`bash-sandbox`、`sandbox`、`approval`、`permission`、`pwsh` 一族（`tests/baseline-boot.test.mjs:55-62`），由 `@ourfairy/dsh-spaces` 的四个受限 provider 顶替（`cordis.patch.yml:324-353`）。

**【代码事实】** `ctx.workingDirectory` 在我们的组合里**存在**，但实现是产品子类 `ScopedDirectory extends WorkingDirectoryService`（`backend/spaces/src/directory.ts:14-16`），且**专门处理了无主会话**：无 owner 时返回共享空间根，而不是派生一个不存在的私有目录（`:22-26`）。probe 的能力表把它记作 `['workingDirectory', 'scoped-directory', '@ourfairy/dsh-spaces']`（`backend/probe/src/index.ts:51`）。

### 2.3 插件/依赖的安装形态

**【代码事实】** 启动器每次启动都**重写** profile 的 `package.json`：`dependencies` = 全部产品包的 `file:<repo>/backend/<pkg>`，`dsh.profile.bundles` = 单个 bundle 包名（`scripts/ourfairy-composition.ts:430-447`）。它还会在重装时删掉 profile 的 `node_modules`（`scripts/ourfairy-backend.ts:256-259`）。用户层 `cordis.patch.yml` 只在缺失时写入一个空 `[]`，之后不再覆盖（`ourfairy-composition.ts:448-453`）。

**【推断】** 直接后果：任何「手工在 profile 里 `dsh plugin add` 一个第三方包」的做法，在下次启动器启动时会被重写的 `package.json` + 被删的 `node_modules` 抹掉。要让一个第三方插件长期在场，只能走「加进 bundle 的 `dependencies` + patch 行」这条既有路径。

---

## 3. 锁定 dsh 的 Skill / 指令包 / 插件安装机制

### 3.1 skill 是三个包，不是一个

**【外部项目事实】** 家族定义在 `docs/subsystems/skills.md:3`：服务定义 `dsh-skill`（`ctx.skills`）、本地服务提供者 `dsh-skill-filesystem`、消费者 `dsh-tool-skill`；另有可选的打包 provider（`skill-badge`、`skill-office`、Windows ACL 诊断）。**注册表自己不含任何技能内容**（`packages/skill/skill/README.md:13`）。

**【外部项目事实】** 挂载形态是普通 Cordis 行，最小三行：

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-filesystem'
- name: '@deepseek-ai/dsh-tool-skill'
```

（`packages/skill/tool-skill/README.md:40-44`；base 组合的实现见 `packages/bundle/base/cordis.patch.yml:308-315`。）

**【外部项目事实】** 注册表是 **host + per-scope 分层**的，和 tools 注册表同形：注册落到「调用上下文的 scope 所在的层」，读的时候把全局层与查看 scope 的链合并，最近层直接赢同名（`docs/subsystems/skills.md:17-19`）。运行时技能用 `ctx.skills.register(...)`（`packages/skill/skill/src/index.ts:439`），provider 用 `registerProvider(...)`。

### 3.2 本地发现：目录、优先级、命名

**【外部项目事实】**扫描根按 rank：

| rank | source | 根 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir`（可选） |

（`docs/subsystems/skills.md:64-78`；`packages/skill/skill-filesystem/README.md:57-63`。）项目根是最近的含 `.git` 的祖先，否则用 cwd；`ctx.fs` 可用时通过文件服务探测 `.git`，以免落到宿主边界（`skills.md:80`）。

**【外部项目事实】** 技能形态只有两种：目录包 `<name>/SKILL.md` 或平铺 `<name>.md`，都只在扫描根顶层；**嵌套 `**/SKILL.md` 故意不发现**（`skills.md:85`）。名称是 kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`，`skills.md:85`）。frontmatter 必填 `name`、`description`，可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`（`skill-filesystem/README.md:36-40`）。

**【外部项目事实】** 两个调用控制位：`modelInvocable`（模型面目录与加载器）与 `userInvocable`（人类面命令），4 种组合全部保留（`skills.md:128`）。`disable-model-invocation: true` 的技能只能被 `/name` 手势触发，绝不进模型目录（`tool-skill/README.md:89`）。

**【外部项目事实】** 目录变更靠 chokidar 监听已存在的根；根不存在时逐段向上找最近存在的祖先挂 watcher；watcher 失败让观测变成 incomplete，但不隐藏可直接加载的候选（`skills.md:81`）。

### 3.3 消费者：目录消息 + `skill` 工具

**【外部项目事实】** `dsh-tool-skill` 在每次 `agent/pre-step` 把自己的技能目录与「会话日志里最新可见的 `skill-catalog` 消息」做 **digest 比对**；变了就投递一条**持久 user 角色消息**（完整替换，空目录也会投递以注销旧名字）（`tool-skill/README.md:85`，代码 `packages/skill/tool-skill/src/index.ts:216-245`）。目录模板就是模型看到的那段 `<system-reminder>`+`<available_skills>`（`tool-skill/README.md:118-129`）。

**【外部项目事实】** 目录渲染有一个硬前置：**这个插件注册的那个 `skill` 工具在该 Agent 上可见**（`ctx.tools.get(skillTool.name, agent) === skillTool`，`tool-skill/src/index.ts:222`）；否则 `snapshot` 直接当空目录、什么都不发（`:223-225`）。**这意味着 `tools.restrict({ allow: [] })` 的子会话既看不到 `skill` 工具，也收不到目录。**

**【外部项目事实】** 模型调用 `skill` 拿回完整正文 + 相对资源指引，包在 `<skill_content>` 里，作为普通工具历史保留（`tool-skill/README.md:52`）。`/name` 手势只扫「claimed user messages」里的白名单 token（`:89`）。

**【外部项目事实】** 目录消息的 source 是 `{ kind: 'skill-catalog' }`（`tool-skill/src/index.ts:36`、`:274`），并且 dsh 的会话格式把它列为合法 source kind 之一（`packages/session/session-format-v2-to-v3/src/payload.ts:10`）。

### 3.4 agent preset：按预设组合工具/提示/技能

**【外部项目事实】** `dsh-agent-preset` 用普通 Cordis YAML 声明「一个 Agent 的子插件」，`dsh-agent-preset-registry` 按会话选择，`config.id` 是会话保存的预设身份（`packages/preset/agent-preset/README.md:18-44`）。注册表自述：**通过声明式预设选择 Agent 的工具、提示段与技能**（`packages/preset/agent-preset-registry/README.md:2`）。它自己也随包发四个 `SKILL.md`（`agent-preset/README.md:50`）。

**【外部项目事实】** `agentPreset` 在原生侧只是**会话 header 里的一个字符串**：`CreateAgentOptions.meta` 只有 `origin?: 'subagent'`（闭集）与 `agentPreset?: string`（`packages/core/agent/src/index.ts:73-91`）；session 侧只校验它是字符串（`packages/core/session/src/index.ts:131-132`、`:1190`）。

**【代码事实】** 我们的 bundle **没有**挂 `agent-preset-registry`（`backend/v1-bundle/cordis.patch.yml` 全文无该行，`tests/baseline-boot.test.mjs:40-80` 也未列它——即无人挂载）。所以 `MAINTENANCE_PRESET = 'ourfairy:memory-maintenance'`（`backend/memory/src/preset.ts:12`）在当前组合里**只是一个标记字符串**，它的「组合」完全来自 `ctx.agents.create({ setup })`，不是来自预设注册表。

**【推断】** 这一点很重要：如果有人以为「我们的维护子会话已经在用 dsh 的 agent preset 机制」，那是误读。我们只用了 header 字段作为 id，机制本身没挂。

### 3.5 指令包：`AGENTS.md` / `CLAUDE.md`

**【外部项目事实】** `@deepseek-ai/dsh-agent-instructions` 在首次请求时注入一条持久基线消息：用户全局链（`$DSH_HOME/AGENTS.md` → `<agentsHome>/AGENTS.md`），再是项目链（项目根到会话 cwd，宽到窄）。之后成功的 `read`/`write`/`edit` 到达更深目录时，下一次请求补上新增的指令文件；文件变更替换内容，消失或重复则产生移除通知（`packages/context/agent-instructions/README.md:34`）。配置只有 `maxBytes`（base 组合里是 65536，`packages/bundle/base/cordis.patch.yml:303-306`）。

**【代码事实】** 我们的 bundle **没有**挂这一行。所以当前 Fairy 不读任何 `AGENTS.md`/`CLAUDE.md`；部署级/用户级「指令包」在本产品里目前不存在。

### 3.6 插件安装：profile 是 pnpm 项目，`dsh plugin` 是 pnpm 代理

**【外部项目事实】** profile 是 `$DSH_HOME/profiles/<name>` 下的一个目录：`package.json`（树外插件依赖 + `dsh.profile.bundles` 有序清单）与 `cordis.patch.yml`（用户自己的 patch 层，在**所有** bundle 层之后应用）。组合顺序：按 `dsh.profile.bundles` 顺序把每个 bundle 的 patch 列表叠到空 entry 列表上，再叠 profile 自己的 patch，再叠启动器层（`packages/boot/app-boot/src/profile.ts:1-17`）。bundle 在清单里声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。

**【外部项目事实】** `dsh plugin` 把大部分参数交给 profile 目录里的 pnpm，自己只接管三个版本豁免子命令（`allow-version`/`revoke-version`/`version-exemptions`），并打印 `allowBuilds` 提示（`apps/cli/src/plugin.ts:2`、`:17-76` 版本豁免、`:70-107` pnpm 代理）。也就是说**「安装插件」在 dsh 里的含义是「往 profile 的 pnpm 项目里加一个依赖」**，没有独立的插件注册中心/市场安装协议（市场生成器是另一个包 `apps/plugin-market-generator`，未读）。

**【代码事实】** 我们的启动器把 profile 的 `package.json` 当作**生成物**每次重写（见 §2.3），所以 `dsh plugin add` 的产物不持久。

### 3.7 工具策略（tool policy）

**【外部项目事实】** 两个层次：

1. **per-scope 限制**：`ToolRestriction` 只过滤继承的工具，scope 自己的注册豁免，多限制取交集（`docs/subsystems/tools.md:165-168`）。
2. **权限/审批两侧的「策略」行**：`dsh-permission-presets`（`ctx.permissionPresets`）把 sandbox 模式与 approval policy 打包成命名预设供客户端选择（`docs/subsystems/permission-presets.md:5-9`），`dsh-user-approval` 提供 `ctx.approval` 的 ask/never 每会话策略与审计对（`docs/subsystems/approval.md:5-7`）。**这两族我们的组合都不挂**，且 `approval`/`permission` 在 `FORBIDDEN_ROW_IDS` 里（`tests/baseline-boot.test.mjs:61-62`）。

**【推断】** 因此「技能是否需要审批才能装/改/执行」这件事，在我们现在的组合里没有原生承载力：没有 `ctx.approval`，没有 `ctx.permissionPresets`。要做只能在产品层自建或接受「不做」。

### 3.8 subagent：能力存在，但我们是手写的那个特例

**【外部项目事实】** dsh 有完整 subagent 家族（`packages/subagent/README.md:2`、`:34-35`）：`subagent-spawn-in-process`、`subagent-fork-in-process`、`tool-subagent`、`tool-subagent-control` 等。子 Agent 的工具过滤走 `childCtx.tools.restrict(composition.toolFilter)`（`packages/subagent/subagent/src/child-agent.ts:217`）。

**【代码事实】** 记忆维护**没有**用这套：它直接 `ctx.agents.create({ sessionId, meta, agentOptions, setup })`（`maintenance.ts:434-442`），自己承担子会话 id（`ourfairy-memory-<uuid>`，`:290`）、材料投递（`:382-385`）、完成判定（`:472-477`）与恢复（`:445-452`）。规格把这条写成决定：「不引入完整的通用 subagent 产品面」（`docs/specs/fairy-memory.md:108`）。

---

## 4. 可复用 / 不可复用：逐条分界

**先说口径。** 「可复用」在本文只有两种意思，且必须分开写：

- **可复用代码**：现有的类/函数/行**不改语义**就能承载新需求。
- **可复用接缝/思路**：现有机制提供的位置够用，但**新行为要写新代码**。

我不把「dsh 有 skill 机制」写成「我们能复用 skill 机制」。

### 4.1 现有记忆机制里可直接复用代码的部分

| # | 接缝 | 事实 | 判断 |
| --- | --- | --- | --- |
| A1 | 触发循环形状（1s tick + 每源状态行 + `#active` + 退避） | `maintenance.ts:210-227`、`:358-373` | **可复用代码**：换表、换谓词即可；不需要新框架 |
| A2 | 冻结切点 + 水位 + `BEGIN IMMEDIATE` 认领 | `store.ts:313-334`、`:351-359` | **可复用代码**：新的「增量处理」类需求照抄这一对字段 |
| A3 | 区间材料投影 | `material.ts:74-105` | **可复用代码**：投影是纯函数，容易被新消费者复用或裁剪 |
| A4 | 子会话的「清空继承 + 自注册」组合 | `maintenance.ts:455-463` + `docs/subsystems/tools.md:165-168` | **可复用**：但每加一门能力都要**自己注册**，`restrict` 不能反向放宽 |
| A5 | 完成判定只看持久 `turn/end` | `maintenance.ts:472-477` | **可复用代码**，且是纪律性资产：任何后台子会话都应这么判 |
| A6 | 有主/无主判定 `isUserSession` | `backend/identity/src/session.ts:28-33` | **可复用代码**：新能力的「谁能看到/能用」默认闸 |
| A7 | 具名提示段（含函数求值、`interpolate:false`） | `impression.ts:152-157`、`runtime.ts:296-298` | **可复用代码**：新指令正文可以就落在这里 |
| A8 | 查询门禁（按会话记已见 id） | `service.ts:230-254` | **可复用思路 + 少量代码**：它是「模型不能凭空引用编号」的通用形状，但门禁键是按记忆语义写的，换域要重写 |

### 4.2 现有记忆机制里**不**可复用、也不能硬套的部分

| # | 项 | 为什么不能 | 出处 |
| --- | --- | --- | --- |
| B1 | 记忆的「字面子串 + 20/8000 预算」检索 | 它是为短事实设计的；技能正文通常远超 8000 且需要按名字精确取，不需要模糊检索 | `store.ts:180-200`、`service.ts:23-26` |
| B2 | 印象的「先读后整份替换」 | 那是**有意的人类编辑**语义；技能若自动学习，与其规则相反 | `impression.ts:5-15`、`docs/specs/fairy-memory.md:144` |
| B3 | `Config.volatile()` 的四个维护字段 | 设置树是「记忆 → 维护」专用的；技能设置要不要进同一个树是产品决定，不是复用 | `index.ts:56-66`、`gateway/src/service.ts:691-728` |
| B4 | 维护子会话的「零工具 + 一提示段」 | 一旦子会话要用技能，`restrict({allow: []})` 会让 `skill` 工具不可见，连带**技能目录也不会被投递**（消费者按工具可见性短路） | `maintenance.ts:456`、`tool-skill/src/index.ts:222-225` |
| B5 | 维护的固定 2s 无上限重试 | 对「跑完即结束」的维护够用，对「要交付一次安装/编译」的技能执行不够 | `maintenance.ts:53`、`:397` |

### 4.3 dsh 的 skill 机制：哪些是事实上的「可挂载」，哪些不是

| # | 项 | 状态 | 说明 |
| --- | --- | --- | --- |
| C1 | 三行（`skill`/`skill-filesystem`/`tool-skill`） | **可挂载，且是原生行**：只需在 patch 里加行 + 在 bundle `dependencies` 加包 | 与既有 `FORBIDDEN_ROW_IDS` 直接冲突（`tests/baseline-boot.test.mjs:63-65`），所以是**产品决策**，不是技术障碍 |
| C2 | 本地技能目录（`.agents/skills` 等） | **可挂载但不能直接用**：技能根是**磁盘**，我们没有任何「谁能在服务器上写文件」的产品入口；`scoped-fs` 是按会话归属划的（`backend/spaces/src/fs.ts:66-70`） | 挂上后技能来源就变成「运维往宿主目录里放文件」，与「记忆/印象由用户与 Fairy 维护」的产品语义不一致 |
| C3 | 会话技能目录消息 | **挂上就会进会话日志**（source `skill-catalog`，`tool-skill/src/index.ts:274`）。我们的客户端消息面是否会把它渲染成用户气泡，**未核实** | 【未核实】需要读客户端/投影的消息筛选再定；但注意记忆材料投影只认 `kind === 'user'`（`material.ts:47-50`），所以维护材料**不会**被污染 |
| C4 | `skill` 工具 | **全局注册**（`tool-skill/src/index.ts:163`）→ 所有有主会话自动获得；无主子会话被 `restrict` 过滤掉 | 想要「只有某些会话能加载技能」，得用 scope 内注册或限制，不能靠文件系统 |
| C5 | `/name` 手势注入 | **不可用**：它依赖 dsh 的命令/手势面（`commands` 行），我们的 bundle 不挂命令注册表（patch `:136-139` 注释：无 `command-compact`；`FORBIDDEN` `:48-52`） | 用户显式调用技能的入口在我们这里不存在 |
| C6 | `user-invocable` / `model-invocable` 双位策略 | **可复用思路**：它有现成的「谁能看/谁能调」语义，值得照抄到自己的技能层 | `docs/subsystems/skills.md:128` |
| C7 | 目录摘要的字符上限（`catalogDescriptionMaxLength` 默认 500） | **可复用思路**：给模型可见面设预算的既有先例 | `tool-skill/README.md:48-53` |
| C8 | 技能正文 8192 字符与工具结果裁剪的耦合 | **要小心**：dsh 自带技能特意保持在 8192 以下，否则标准预设的 pruner 会裁（`agent-preset/README.md:50`）；我们的 pruner 阈值是 8192/4096/1024（`cordis.patch.yml:124-129`） | 自造技能若超长会被裁剪，等于静默损坏 |
| C9 | provider 注册表 + per-scope 分层 | **可复用思路，但代价大**：它解决的是「多来源、多作用域」；个人项目只有一个部署，收益不明确 | `skills.md:17-19` |
| C10 | agent preset 声明式组合 | **不可用**：注册表未挂（§3.4）；要用得先加两行原生包并把维护子会话改成预设 | 与「不引入通用 subagent 产品面」的既有决定相邻，需明确表态 |

### 4.4 一句话分界

- **能白拿的**：提示段、工具注册、`restrict` 语义、Agent create/resume + `setup`、`turn/end` 完成判定、`isUserSession`、`volatile` 配置热生效、区间投影、水位/切点幂等形状。
- **要新写的**：技能的**存储权威**（文件？表？）、技能的**生命周期**（谁创建、谁改、谁删、编号与否）、**模型可见面**（目录要不要进会话日志、正文走提示段还是工具结果）、**权限**（谁能装/改/用）、**审计与来源**。
- **不能假装复用的**：说「沿用 dsh 的 skill 机制」——它现在是**未挂载**的；说「维护子会话可以顺便加载技能」——`restrict({allow: []})` 与目录投递的可见性短路会挡住。

---

## 5. 未核实与证据缺口

1. **【未核实】** 客户端（Android）对 `user/message` 的 `source.kind === 'skill-catalog'` 是否显示。本文只确认了该 source kind 在 dsh 会话格式里合法（`session-format-v2-to-v3/src/payload.ts:10`），以及我们的记忆材料投影会排除它（`material.ts:47-50`）。
2. **【未核实】** 两个进程同时打开同一个 `memory.sqlite` 时，`BEGIN IMMEDIATE` 认领是否足以互斥。本文只确认了单进程内的两道闸（`#active` 与 `status`）。
3. **【未核实】** `tool-working-directory` 行在没挂 `working-directory` 原生行时的实际状态。我们的组合挂的是 `tool-working-directory`（`cordis.patch.yml:349`）而原生 `working-directory` 在禁止清单里（`tests/baseline-boot.test.mjs:56`），但 `ctx.workingDirectory` 由 `scoped-directory` 提供（`backend/spaces/src/directory.ts:14-16`、`backend/probe/src/index.ts:51`）——**这三个事实如何共处，我没有 boot 验证**。
4. **【未核实】** dsh 的 skill 目录消息在我们这套 `session-query-sqlite` / 会话列表 / 标题推导里是否会被当成「消息」。`firstHumanMessageText` 只认 `kind === 'user'`（`backend/sessions/src/events.ts:108-111`），但 `hasMessages()` 只判事件类型不判 kind（`:92-94`）——即**目录消息足以让一个会话被判定为「非空」**。这条的后果（会话复用/标题回退）未验证。
5. **【未核实】** dsh 生态里是否有官方/第三方的「技能市场」用于安装（`apps/plugin-market-generator` 存在，未读）；本文不宣称有或没有。
6. **【推断】** 本文对「技能该长什么样」的取舍一律未写死；§4 只给可复用/不可复用的边界。

---

## 6. 需要法厄同决定的问题

1. **技能用哪套存储权威？** 磁盘目录（能白拿 dsh 三行，但来源是运维放文件、没有产品编辑入口、与「用户/Fairy 可编辑」冲突）／业务表（要新写存储、编号、来源、逻辑删除与 ADR 关系）／两者（原生只读 + 产品可写，风险是两份权威）。**这是其余问题的前提。**
2. **要不要接受模型可见的会话内技能目录？** 一旦挂原生 `tool-skill`，每个有主会话都会在首次请求前收到一条持久 user 角色目录消息，且目录变更会**追加完整替换**（`tool-skill/README.md:114`）。这是一条对 KV cache 与客户端呈现都有影响的决定（§5.1 未核实项必须先弄清）。
3. **谁能创建/修改技能？** 只有用户显式（客户端入口？）／Fairy 在会话里写（需要工具 + 与「不自动学习工作流」的 Out of Scope 对齐）／运维。`docs/specs/fairy-memory.md:217` 目前把「工作流经验的自动学习」排除在 v1 外。
4. **技能与记忆的边界怎么执行？** 规格写了「能双写的不能双写」（`fairy-memory.md:144`、用户故事 20 在 `:45`），但没有执行手段。是否需要一条「同一内容只能进一处」的规则，以及谁来判？
5. **维护子会话要不要用技能？** 现在它的全部指令是 `MAINTENANCE_POLICY` 一段常量（`maintenance.ts:74-82`）。把它改成 runtime skill（`ctx.skills.register`）能拿到版本化与复用，但需要同时解决 `restrict({allow: []})` 与目录投递可见性（C4/B4）。**选项：保持常量提示段 / 改成 runtime skill / 挂原生三行并给子会话单独放行 `skill` 工具。**
6. **安装与分发走哪条路？** 继续「bundle `file:` 依赖 + patch 行」（现状，启动器每次重写 profile：`ourfairy-composition.ts:430-447`、`ourfairy-backend.ts:256`）／允许第三方插件进 profile（需要改启动器的 profile 生成语义，否则被抹掉）。若技能要能「装」而不是「编译进 bundle」，这是一个真缺口。
7. **要不要复用 `AGENTS.md` 指令包机制做部署级注入？** 它现成、按项目根到 cwd 的链加载、有 `maxBytes`（`agent-instructions/README.md:34`）；但我们是多用户产品，`$DSH_HOME/AGENTS.md` 会对**所有**用户生效，这是产品语义决定。
8. **技能正文的预算与裁剪冲突怎么定？** 我们的 pruner 是 8192/4096/1024（`cordis.patch.yml:124-129`），dsh 自带技能刻意压在 8192 以下（`agent-preset/README.md:50`）。技能正文上限要不要写在产品策略里、超出时是拒绝还是分段加载？
9. **技能调用要不要来源追踪与审计？** 记忆已经有 `source_session` + 归属派生 + 物理删除（§1.8）。技能若由 Fairy 写入，是否同样需要「来源会话 + 归属」？这直接影响表结构。
10. **要不要给「技能」一条用户面？** 印象有独立的用户端点（`impression.ts:185-188`），长期记忆则**故意**没有客户端条目管理（`docs/glossary/memory.md:9`）。技能属于哪一类，决定客户端工作量。

---

## 附：本文引用的路径清单

**本仓（代码事实）**

- `backend/memory/src/{index,maintenance,maintenance-policy,material,store,service,tools,tool-kit,preset,impression}.ts`
- `backend/identity/src/session.ts`、`backend/chat/src/{runtime,persona}.ts`、`backend/spaces/src/{directory,fs}.ts`、`backend/probe/src/index.ts`、`backend/gateway/src/service.ts`
- `backend/v1-bundle/cordis.patch.yml`、`backend/v1-bundle/README.md`、`backend/v1-bundle/package.json`
- `scripts/ourfairy-composition.ts`、`scripts/ourfairy-backend.ts`、`combo.json`
- `tests/baseline-boot.test.mjs`、`tests/memory-maintenance.test.mjs`、`tests/memory-maintenance-recovery.test.mjs`
- `docs/glossary/memory.md`、`docs/adr/0002-physical-memory-deletion.md`、`docs/specs/fairy-memory.md`、`docs/specs/ourfairy-v1.md`、`docs/research/README.md`
- `backend/sessions/src/events.ts`（§5.4 未核实项）

**dsh 检出 `d80522d276dd5a839a2b5ea8afcc78af898b6688`（外部项目事实）**

- `docs/subsystems/skills.md`、`docs/subsystems/tools.md`、`docs/subsystems/approval.md`、`docs/subsystems/permission-presets.md`
- `packages/skill/skill/{README.md,src/index.ts}`、`packages/skill/skill-filesystem/README.md`、`packages/skill/tool-skill/{README.md,src/index.ts}`
- `packages/preset/agent-preset/README.md`、`packages/preset/agent-preset-registry/README.md`、`packages/preset/agent-preset/skills/`
- `packages/context/agent-instructions/README.md`
- `packages/bundle/base/cordis.patch.yml`
- `packages/boot/app-boot/src/profile.ts`、`apps/cli/src/plugin.ts`
- `packages/core/agent/src/index.ts`、`packages/core/session/src/index.ts`
- `packages/subagent/{README.md,subagent/src/child-agent.ts}`
- `packages/session/session-format-v2-to-v3/src/payload.ts`
