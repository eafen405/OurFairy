# spec #240 对抗性 review：记忆模块落地后的三视角审查

- 日期：2026-11-03
- 审查对象：`main` @ `5a1d481`（`backend/memory` = `@ourfairy/dsh-memory`，1,956 行 TypeScript / 10 模块），规格 [`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md)，模块自述 [`backend/memory/README.md`](../../../../backend/memory/README.md)
- 视角：Fairy（工具使用者）／开发者（架构与工程）／用户（正反馈 vs 负重），外加一轮外部一手资料研究
- 方法：先锚定代码事实（不采信 README 自述），再用可复现的 `node:sqlite` 脚本对抗性证伪，最后与外部一手来源对照
- **本次没有重跑 `npm test` / `combo:verify` / Android 测试**：本机 `combo.json` 的 `localPath`（`/home/eafen405/projects/...`）与当前机器不符，锁定的 dsh 检出未构建。全部结论来自源码、测试源码、证据 JSON 的静态阅读，以及不依赖仓库构建的独立复现脚本。
- 原始分视角报告在 `/tmp/fairy-memory-review/`（`fairy-lens.md` 66KB、`dev-lens.md` 41KB、`user-lens.md` 10KB）与本目录同批的复现脚本；本文件是合并、去重、降噪后的结论。

---

## 0. 一句话结论

**方向成立，骨架应当保留；但有 2 个真 bug、1 个会自锁的失败路径、1 份归属错误的验收证据。**

模块划分是好的（`service.ts` 一个文件吃下「归属推导 / 查询门禁 / 写入上限」三条规则，是真实的 depth）；装配是好的（`index.ts` 全构造参数传递，无隐藏单例）；测试接缝是本仓上限（真实 Loader + 真实产品会话 + 真模型）。问题集中在**三个具体位置**，每个都是几行的改动——不是「抽象不够」，是「三个地方写错了」。

按修复紧迫度：

| 级别 | 含义 | 条目 |
| --- | --- | --- |
| **P0** | 会造成静默数据损坏或不可控成本 | A1 预算 `break` 造成记忆不可达；A2 维护失败无限重试可自锁；A3 验收证据早于交付代码 |
| **P1** | 功能"存在"但实际用不到/用不上 | A4 私密层只写不读；A5 维护子会话正向写入 0 例验证；A6 用户无法核对记忆；A12 隐私边界退到 prompt 层且规则为空 |
| **P2** | 形状/可观测性债 | A7 零日志；A8 1Hz tick 驱动 3 小时时钟；A9 `#active` check-then-act；A10 测试对以上均失明 |
| **P3** | 决策/记录，不是缺陷 | A11 主动调用 vs 被动注入是开放问题；A13 不发布 `MemoryService`（正当 YAGNI） |

---

## 1. Fairy 视角：这工具在我手里顺手吗

### A1（P0）预算 `break` 让记忆变成不可达死行 — **1 行修复**

**【事实】** [`store.ts:192-198`](../../../../backend/memory/src/store.ts)：结果已按 `ORDER BY content_updated_at DESC, id DESC` 排好（`:189`），循环里

```ts
if (characters + size > characterBudget) break   // store.ts:195
```

把「这一条装不下」当成「后面都不必再看」。而排序键是**内容更新时间**，与**长度**完全无关。

**【本机实测】** `[7000, 2000, 14, 14]` 字符四条记忆：`break` 返回 `[id1]`（7000 字符），`continue` 返回 `[id1, id3, id4]`（7028 字符）。两条 14 字符的小记忆仅因中间夹了一条 2000 字符的就被丢弃。

**【事实】为什么这不是"少给几条"**：[`service.ts:230-234`](../../../../backend/memory/src/service.ts) 的 `requireQueried` 规定 `memory_edit`/`memory_delete`/`memory_switch` 只接受本会话 search 返回过的编号。而 [`service.ts:256-263`](../../../../backend/memory/src/service.ts) 自己把这条规则写成了写入上限的依据：

> "The search budget is also a write limit: a memory larger than the whole budget is omitted by every search, so no session could ever see its number and therefore could never edit, delete or switch it."

即**「永不被 search 返回 ⇒ 不可达、不可修改」是本模块显式承认的失败面**。`break` 用一个与长度无关的排序键，把这个失败面从「单条超预算」扩大到「排在一条大记忆之后的任意多条小记忆」。

**【事实】README 的措辞恰恰是 `continue` 的语义**：[`README.md:96-101`](../../../../backend/memory/README.md) 写「A memory that does not fit is omitted whole — its content is never clipped and its number is never returned」。逐条只约束单条，没有任何「必须返回连续前缀」的表述。规格 `:124` 只要求「超出预算时截断并显式报告」；US33（`:61`）的目的是**注入上界**，不是前缀语义。`continue` 同样满足上界；在「A=7000 / B=2000 / C=8 / D=8」这组设计上返回 `[A, D, C]`、`characters = 7016`（本机逐条实算，与 dev-lens 独立复算一致）。

**【事实】现有测试对这个缺陷完全失明**：[`tests/memory-crud.test.mjs:354`](../../../../tests/memory-crud.test.mjs) 用 3 条各 3000 字符、预算 8000 — `break` 与 `continue` 结果完全相同（都是 2 条 / 6000 字符），断言 `[first, third]` 两者都通过。**这就是 bug 活到现在的原因。**

**【核实】副作用逐条为零**：`matched`（COUNT，与循环无关）、`characters`（只累加被选中的，改后更接近上限）、`truncated`（`selected.length < matched`，饥饿场景下两者都是 true）、20 条上限（`:193` 的另一个 `break` 独立生效）——全部不变。`:375-383` 的 8000 字符整条断言在 `continue` 下依然通过（手工复算确认）。

**最小修复**：`store.ts:195` `break` → `continue`，加 1 条测试。测试必须**跨度超过预算一半**，否则又退化成对两者不敏感；且必须包含**可达性断言**（对原本被饿死的 id 执行 `memory_delete` 必须成功）——只测「返回了 C 和 D」证明不了 bug 的实质。

---

### A2（P0）维护失败无限重试：会自锁，且自锁后不会自愈

**【事实】** [`maintenance.ts:53`](../../../../backend/memory/src/maintenance.ts) `RETRY_MS = 2_000`。失败路径在 `:367`、`:397`、`:426`、`:488` 四处设置 `#retryAt`，**只在成功时清除**（`:483`）。没有次数上限、没有退避、没有死信。

**【事实】** 每次重试都是一次**真实模型回合**：`#runResume`（`:405-431`）→ `#resumeChild` → `followup(RETRY_MESSAGE)`，每次向**同一个子会话**追加一条新用户消息（`RETRY_MESSAGE` = 65 字符）。

**【本机实测的算术】** 无退避 = **43,200 次/天**；子会话日志每天增长约 48 MB。更关键的是**请求体超线性**：每次 resume 都把整个子会话日志作为上下文重发，失败 5000 次（不到 3 小时）后单次请求约 **1.36M token——已超 MiniMax-M3.1-Flash 的 1M `contextWindow`**（`v1-bundle/cordis.patch.yml:191`）。此时即便路由恢复，该子会话也**永远无法完成**（每请求必 `CONTEXT_WINDOW_EXCEEDED`），水位不推进，重试继续 —— **自锁死循环**。

**【事实】什么情况下不会发生**：上游 `llm-pi-ai` 的 `retryPolicy: normal` 配 `maxRetries=5`、`maxDelayMs=10_000`，`retryableCodes` 仅含 `EMPTY_RESPONSE / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT`（`/home/fatfish/deepseek-harness/packages/llm/llm/src/retry-policy.ts:14-24`）。所以**瞬时故障**（限流、5xx、超时）会被原生重试在 ~15s 内吸收，内存行几乎看不到。**此时不是故障。**

**【推断】真正咬人的条件**：一次**普通的部署事故**——`OURFAIRY_MINIMAX_BASE_URL` 配错、endpoint 改错、DNS 不通、provider 维护窗口超过几分钟。个人项目部署频率低，但**每次部署都可能是这个窗口**，而一旦进入它不会自愈：日志涨、token 花在注定失败的请求上、且**没有任何日志**（见 A7）让人发现。

**最小修复**（约 30-40 行，单文件，无新表、无新模块、无新配置项）：`#attempts: Map<string, number>` + 指数退避（2s→4s→…→5min 封顶）+ 上限 8 次后写终态并 `logger.warn`。顺带把 A9 的 `#active` 合并（5 行），两者共享同一段代码。

**需要产品拍板的一点**：修后失败会在约 11 分钟进入终态。规格 `:47` 只要求「失败不推进水位、可从同一子会话恢复」，**没有要求「必须成功才停」**。终态后是「留死信等人看」还是「交给下一轮维护重新 claim（`resetMaintenance` 已有，`store.ts:365`）」需要决定；我们倾向后者——失败有界但不永久卡住一个源。

---

### A4（P1）私密层事实上只写不读

**【事实】** `memory_search` 的 `is_private` 默认 `false`（`tools.ts:75`）。5 个工具描述里**只有 `memory_add` 提到 `is_private`**（`memory_search`/`memory_edit`/`memory_delete` 的描述完全没有 "private" 一词）。**426 字符的 `MEMORY_POLICY` 里「私密」出现 0 次**（本机实测）。

**【事实】这不是一直如此**：`git diff 4817b47 2b3608d` 显示原 policy 曾有一句「普通检索只查普通层，只有用户明确询问私密内容时才用深层检索」，在 `2b3608d` 被**删除**，提交说明写作 "Remove the unrequested private-search rule from the owned memory policy"。

**【推断】** 删掉的理由（规格未要求）是正当的收紧，但**代价没有记账**：Fairy 没有任何信号知道何时该搜私密层，于是私密记忆写进去之后**再也不会被检索到**。US7/US8 设计了一个双层隐私模型，实现上退化成「普通层 + 一个只进不出的黑洞」。

**最小修复**：给 `memory_search` 的描述加一句何时该用 `is_private: true`（一行字符串）。**注意**：researcher 的一手证据显示「写清何时使用」的有效性有争议（见 A11），所以这条应该**先测量**而不是直接断言有效——但它至少把「能力存在」变成「能力可发现」。

---

### A5（P1）维护子会话的正向写入能力从未被验证

**【事实】** 逐例统计 `results.json` 的 `childWrites`：**11 例全部为 0**。对照 `before-fix.json` 的 11 条子会话误写，修正是成功的（把「写 11 条错的」调成「不写」）。

**【事实】** 但 11 例里 **0 例**是「子会话应该写」的场景。`maintenance-skip`/`volatile-observation`/`maintenance-no-rewrite` 三例的期望本来就是零写入——**它们 100% 通过不证明任何正向能力**。

**【事实】最典型的反例**：`passing-preference`（「我一直喜欢喝不加糖的美式…这个习惯很多年了」是教科书级稳定偏好）——证据里 `mainWrites` 有 `memory_add`，即**是主会话写的**；子会话的结束语明说 "The only durable fact (the Americano habit) is already stored as memory #5, added in the maintenance material — do not duplicate."。它只测到了「不会重复写」。

**【事实】同样 0 例覆盖的还有**：跨会话召回（所有检索都发生在**写入的那个会话**里，而 US2「跨会话保留」是核心承诺）、措辞失配的召回（`supersede` 里模型搜 `手机号`→0，换 `手机尾号` 才命中，但那是它在**同一会话、知道原文**的情况下试对的）、维护子会话的门禁（`childWrites=0` ⇒ 子会话从未在真实模型下成功 edit/delete 过任何东西）。

**【推断】偏差方向明确指向「漏记」**：误记率修正后为 0，漏记率**无法从这份证据判断**，因为没有一例是「子会话应该写」。

---

### A6（P1）用户无法核对，而纠正路径依赖一个已知会漏的检索

详见 §3 A6。这是三个视角**交叉得出同一个结论**的条目：Fairy 侧（无法枚举）、用户侧（无法核对）、外部研究（小库关键词召回失败是机械必然）三方独立指向同一处。

---

## 2. 开发者视角：架构影响与更优实现

### A3（P0）验收证据跑的不是交付代码

**【事实】时间线**：

| 时间（2026-10-27） | 事件 |
| --- | --- |
| 07:44 | `results.json` 全量真实 MiniMax 验收完成（`finishedAt`） |
| 08:50 | `invalidate-rerun.json` 单例重跑完成 |
| **17:01** | `2b3608d` **改变模型可见行为**：删掉 `memory_add`/`memory_edit`/`memory_switch` 的 `id` 返回（→ `{ok:true}`）、描述从 1817→2143 字符、删除私密检索规则 |

**【事实】** `results.json` 里记录的工具输出是 `{"ok":true,"id":1}`，而交付代码 `tools.ts:67,84,93,102` 全部只返回 `{ok:true}`。**这份证据证明的是 `4817b47` 的行为，不是 `main` 的行为。** `invalidate-rerun.json` 的 `selected: ["invalidate"]`，其余 10 例为 `unexecuted`，时间也在 17:01 之前。

**【推断】这不是造假**——证据纪律本身很好（`before-fix.json` 连失败原文都留着，README 明确写了「`results.json` 保留加强前的全量记录，没有把只重跑一例说成重跑了全部 11 例」）。问题是 **`2b3608d` 是一次有意的行为变更，却只跑了确定性测试**：改了模型看到的工具输出，没有任何真实模型验收在变更后重跑。

**后果**：A5/A6 的所有质量结论都建立在这份证据上。既然它归属错误，**「记忆语义质量已验证」这个说法在 HEAD 上不成立**。

**最小修复**：在 HEAD 上重跑 `npm run acceptance:memory` 全量（约 7 分钟 + token 成本），或在 README 显式标注「本证据对应 `4817b47`，`2b3608d` 后的行为变更未经真实模型复验」。

---

### A7（P2）零可观测面

**【事实】** `grep -rn 'logger' backend/memory/src/` → **0 命中**。同仓 `delivery` 2 处、`identity` 4 处、`chat` 1 处。被 `catch {}` 吞掉的有 7 处（`maintenance.ts:241/331/339/364/389/418/400`），其中 `:389` 与 `:418` 吞掉的是**子会话创建失败、followup 失败、whenIdle 拒绝的全部**。

**【事实】** 本行对一次维护失败留下的唯一痕迹是 `maintenance_state.status = 2` —— 一个数字，没有原因、没有次数、没有时间语义（`updated_at` 被其它写覆盖）。`AGENTS.md`「精简不减保障」明确把「失败恢复及操作溯源」列为必需保障，**「操作溯源」在此不成立**。

**【推断】最小可观测面：3 处约 6 行**，只加在**状态转移**上，不给每个 catch 加日志（那是噪音）：
1. `:388-398`（`#runNew` catch）——一次维护没做成的唯一出口；
2. `:417-426`（`#runResume` catch）——重试路径必须可见，否则 A2 的死循环永远静默；
3. `:481-489`（`#finish` 失败分支）——A2 的 `#attempts` 计数需要出口。

**一个真实的坑**：`#bootstrap`（`:241`）的 catch 目前**故意**静默（注释明说 "must not take the memory row down"），**不要给它加 warn**——一次启动失败会被下一 tick 重试，加日志会在每次重启刷一行。要加就 `debug`。「有意的静默」与「意外的静默」要分开。

---

### A8（P2）1 Hz tick 驱动一个最小 3 小时的时钟

**【事实】** `TICK_MS = 1_000`（`maintenance.ts:51`），`#tick` 对 `#known` 里**每个**源并行 `#evaluate`（`:226`）。冷源走 `#coldToken` → `sessionPersistence.stat`，而 dsh 的 JSONL `stat` 走 `findLog`：**遍历 root 下每个 project 目录**，每个都 `readdir` + `resolveGenerationInDirectory`（再一次 readdir）+ `stat` + 读首行 header（`.../session-persistence-jsonl/src/index.ts:1496-1511`、`:1457-1493`、`:1094-1119`）。

**【实测】** 与 `findLog` 同形的调用在 200 个会话（10 project × 20）上：一次全量 sweep = **83.2 ms**，折合每冷源每秒 0.416 ms ⇒ **200 个已知冷源 ≈ 单核 8.3% 常驻**，与有没有活干无关。

**【推断】成本曲线随「部署以来拥有过 owned 会话的数量」增长**（`#known` 来自永久保留的 `maintenance_state` + `sessionPersistence.list()`，见 A10），而个人项目的会话数只增不减。今天无所谓，200 个会话时是每秒 8%。

**更关键的是形状**：维护门槛的衰减以 `decayHours`（默认 6 小时，最小 3）为单位（`currentThreshold`，`:144-153`），用 **1 秒**轮询驱动**最小 3 小时**的时钟，**分辨率错了 10⁴ 倍**。这是 codebase-design 意义上的 **seam 放错**：本应由事件（`turn/end`）+ 粗定时器驱动的状态机，被做成了纯轮询。

**【推断】但今天不值得单独修**。按 `AGENTS.md`「规模校准」，为它单独重构是用假设的规模换真实复杂度。它排在这里是因为**顺手**：修 A2 必然要碰 `#evaluate` 的触发条件，此时替换边际成本很低。替代形状：`session/event` 过滤 `turn/end` 只评估该源 + 单个 `setTimeout` 重排到下一个衰减边界（正是 dsh 自己 `schedule` 行的形状）。

**注意**：`session/event` 是 fire-and-forget（"observer failures are logged and contained"），**不能纯事件驱动**，粗定时器必须保留作兜底。这一点值得写进注释。

---

### A9（P2）`#active` 是 check-then-act：create 有 DB 兜底，resume 没有

**【事实】** `:251` 检查 `#active.has(sourceId)`，但 `#active.add` 要到 `:359`（`#launch` 内）才发生，中间隔着 `#observe`（含 `await ...stat`）与 `#readEvents`（`await`）。两个入口都不 await 彼此：`watch()` 是即发即忘（`:205`），`#tick()` 是 `Promise.allSettled` 并行（`:226`）。**同一源在同一时刻被两次评估是可达的。**

**【事实】** create 路径**安全**：`claimMaintenance` 在 `BEGIN IMMEDIATE` 里重读 `status`（`store.ts:320-321`），第二次返回 `false`，`:292` `if (!claimed) return`。
**【事实】** resume 路径**没有兜底**：`:253-258` 判断 `status !== 0` 后**直接** `#launch`，无任何事务性 claim。两次并发 `#evaluate` 会同时通过 `#retryAt` 检查 → 两次 `#runResume` → 对**同一个 childSession** 两次 `ctx.agents.resume`。

**【推断】** 第二次 resume 大概率被 dsh 拒绝（同一 session 已有 live handle），但会落入 `catch`（`:418-426`）→ `failMaintenance` + 重置 `#retryAt` → **加速 A2 的重试循环**。所以它是 A2 的放大器，不是独立故障。

**最小修复**：把 `#active.add` 提到 `:251` 的守卫之后立刻执行，try/finally 保证释放。**约 5 行**，与 A2 一起改。

---

### A10（P2）无界持久状态 + 测试缺口

**【事实】** `maintenance_state` 一源会话一行永不清除：`store.ts` 全文只有一处 `DELETE`（`:225`，删 `memories`）；`resetMaintenance`（`:365`）只把列置 NULL。`#retryAt` 只在成功时 delete。

**【推断】不需要"处理"**，因为规模校准：一两百行 SQLite 行是零成本。但**需要一个明确的容量声明**——目前没有任何文字说「这个表会一直长」，未来读到的人会以为是漏了清理。

**【事实】测试真实缺口 4 处**（不是理论项）：
1. **预算饿死完全失明**（A1 的锁）——`tests/memory-crud.test.mjs:354` 区分不出 break/continue。
2. **多源并发从未被测**：`grep 'Promise.all' tests/memory-*.mjs` → 0 命中；9 处 `newSession` 全是串行。`#active` 的竞态（A9）因此从未暴露。
3. **「子会话正在运行时重启」未测**：`memory-maintenance-recovery.test.mjs` 四处 `stopBackend()` 全部发生在子会话**已完成**之后。从未在 `heldChild` 挂起时 kill 后端——而那正对应 `status=1` 的重启恢复，且被强杀的 turn 可能没有 `turn/end` ⇒ `#completed` 永远 false ⇒ 进入 A2 的无限重试。**这条组合路径没有任何测试。**
4. **退避/上限不存在，因此也没有测试**：`failChildRequests` 只用了一次且 `= 1`。修 A2 时必须把上限写进断言。

**【事实】另有一处本行独有的遗漏**：`schema-too-new` 分支（`store.ts:379-381`）在 `tests/memory*.mjs` 里 **0 命中**，而同仓 `tests/identity-store.test.mjs:190,211`、`tests/session-archive-store.test.mjs:124,140` 都测了同类分支。

---

### A13（P3）不发布 `MemoryService` 到 ctx：正当的 YAGNI，但注释的理由是错的

**【事实】** `index.ts:86-89` 直接 `new` 四个实例当参数传递，不 `declare module`。而 `chat`/`identity`/`sessions`/`delivery`/`attachments`/`spaces` **都**发布（`extends Service` + `declare module`）。所以「不发布」在本仓是**偏离既有形状的选择**，不是默认。

**deletion test**：删掉 `MemoryService`（把 CRUD 内联进工具）→ 复杂度**真实回弹**到 7 个 handler 里重复（`sourceOf`、`requireQueried`、`assertContent` 各复制一遍）。所以这个 module **有 depth**。而发布到 ctx → 复杂度**不会消失，会转移**：`GATE`（进程内 Map）与 `STORE` 的失效规则会从**私有不变量**变成**对外契约**，而今天零个调用者。

**结论：正当的 YAGNI，不是 seam 放错。** 但 `service.ts:63-66` 那句「Keeping it off the service registry means the row publishes exactly the surfaces it actually exposes」**不成立**——发不发布与「行暴露什么 surface」是两件事，`tools.register`/`systemPrompt.section`/`mountRoutes` 照常注册。按 `CODING_STANDARDS.md`「声称须可执行」，这条声称给不出会因它失效而失败的检查，应删除或改写。

**翻转条件**（可命名）：当 **#112**（日记/节律/关系/外部感官）需要「读一条记忆的当前内容」或「写一条属于某用户的记忆」时，它只有三条路：(i) 复制 `MemoryStore` 直连 → 违反「权威唯一」；(ii) 走模型层工具 → 它是后端行不是模型；(iii) 让 memory 行发布。第 (iii) 条一旦成为唯一不违规的路，**YAGNI 就到期**，且届时该发布的是一个**窄 interface**（如 `memoryFacts.byOwner(shortId)`），不是整个类。

---

## 3. 用户视角：正反馈还是功能负重

### A6（P1）可见性不对称：召回缺陷被转嫁给了用户

**【事实】用户能看见什么**：只有印象入口，没有长期记忆条目页。规格把它写成显式决定（`:219` Out of Scope、`:35` US13）；设置页照此写死「不包含长期记忆条目」（`FairySettingsPage.kt:150`）；后端只有 `/impression/read`、`/impression/edit` 两条路由（`impression.ts:190-193`），`memories` 没有任何对外读取面。**「用户如何知道 Fairy 记住了什么」的答案是：只能靠问。**

**【事实】而 App 上连工具输出都看不到**：`RemoteTranscript.kt:306` 注释「Only names reach the screen: the request arguments and the tool's output stay in the native session」，渲染处 `:317,325`。用户看到的只是「调用工具 · memory_add」一行。

**【事实】这条唯一通道撞在字面子串匹配上**：`store.ts:181` 的 `instr(content, ?)`。把验收证据里的真实记忆正文灌进 `node:sqlite` 实测（本机复现）：

| 用户自然会说的话 | 命中 / 4 条真实记忆 |
| --- | --- |
| `你记得我什么` / `记得` / `宠物` / `工作` / `猫的名字` / `咖啡` / `爱好` | **0** |
| `猫` / `美式` / `习惯` | 1 |
| `用户` | **4** |

库里明明有「猫叫团子」「每天早上不加糖的美式」「手机尾号 8150」。**唯一 4/4 命中的词是 `用户`——那是 Fairy 写记忆时的第三人称前缀，不是用户会说的话。**

**【推断】完整推理链**：用户问「你记得我有什么习惯吗」→ Fairy 搜 `习惯`/`记得`（后者 0 命中）→ 她能不能答对**取决于是否恰好猜中记忆正文里的字面词**，而不是记忆是否存在 → 她给出一句流利笃定的回答（人设如此：`persona.ts` 禁用语气词、程序化精准；**没有任何 prompt 要求她在 0 命中时声明「这可能是检索失败」**，0 命中返回的是正常空结果）→ 纠正失败时最自然的动作是 `memory_add` 新增（不受门禁），返回 `{ok:true}`，对话上看完全成功 → 库里并存两条矛盾的记忆，**旧的永远删不掉**（门禁挡着），而用户两条都看不到。

**【事实】规格自己承认了风险**：`:156`「维护检索接受常规关键词检索可能漏掉相关旧记忆的已知风险，不增加全库扫描或独立高召回管线」。但那句话的语境是**维护子代理**；同一套 `memory_search` 也是用户纠正的唯一通道，风险因此从「维护偶尔漏记」升级为「**用户纠正可能静默失败**」。

**【事实】而 US12（`:34`）承诺的是**「通过对话询问、纠正或要求删除长期记忆，以便不需要理解数据库结构」——**「不需要理解数据库结构」这个承诺被字面子串匹配打破了**：用户必须先猜中 Fairy 当初写下的措辞。

**【推断】为什么这是 P1 而不是「少个页面」**：系统的已知缺陷（低召回）没有在界面上暴露，而是被吸收进了**用户的错觉**——「我纠正过，它应该改了」。

**【事实】缓解因素**（按规模校准，也要说反向证据）：普通层记忆总量在个人项目里预计很小（数十条量级，粗算：每天 60 回合 × 30 天 ⇒ 120 个维护区间 × 平均 0.5 条 ≈ 60 条）；用户与法厄同在线下也能直接沟通。所以这是「信任结构上的窟窿」，**不是「必须立刻做记忆管理页」**；大厂标准会要求列表页 + 审计 + 撤销，这里不需要。

**最小可做的改善**（都不加功能）：见 §5 建议 3。

---

### A12（P1，代理人侧）隐私边界从 DB 层退到了 prompt 层，而 prompt 层没有规则

**【事实】普通层是全局共享池**：`memories` 表没有 owner 列（`store.ts:33-41`），只有 `source_session`，owner 是**派生**的；`memory_search` 的 WHERE 只有 `is_private` + `instr`，**无 owner 过滤**（`store.ts:181`）。真实证据：Bob 的普通检索命中 Alice 的普通记忆（`results.json` → `cross-user-discretion` → "Bob's ordinary search finds the shared normal memory"，detail 里 `owner_short_id: 2` 即 Alice）。

**【事实】私密层也不跨用户隔离**——**Bob 显式深搜能命中 Alice 的私密记忆**（同一 case："the explicit deep search is the path to the private memory"，detail 返回 `id:7` 的 `私密暗号`）。这一项在验收里记为 **`ok: true` / passed**，即**设计者知情并接受**。`is_private` 隔离的是**检索路径**（普通检索不返回私密层），**不是所有权**。验收 README `:227-229` 自认了这一残余风险。

**【事实】共享本身不是疏漏**：规格 `:7` 明写「多用户场景下，Fairy 需要保持连续的记忆和社交分寸，而不是在切换会话后按用户失忆」；`GLOSSARY.md` 的 `Fairy` 条目定义她是「单 agent 同时与多个用户互动」。所以「一个 Fairy 记得所有人」是**产品设定**。

**【事实】真正的缺口在「什么内容进共享层」没有任何约束**：
- `is_private` 默认 `false`（`tools.ts:63,66`）；
- 主会话 `MEMORY_POLICY` **426 字符里「私密」出现 0 次**（本机实测）；
- 维护子策略（`maintenance.ts:75-83`）同样 0 次；
- 5 个记忆工具描述里**只有 `memory_add` 提 `is_private`**，且仅陈述语法（"The memory is normal unless is_private is true"），**不说何时用**；
- 客户端没有任何 `is_private` 入口（grep 0 命中）。

**⇒ 只有 Fairy 会拨这个开关，而没有任何 prompt 教她何时拨，默认又是全局可见。**

**【事实】** 保护条款只有 `persona.ts` 一句泛泛人设话术「注意保护主人的隐私」，**没有「不得复述他人记忆正文」这条规则**。而规格里的 User Story **没有任何一条从代理人角度要求「别人搜不到我的事」**——US7/US8 是写给 Fairy 的技术性层过滤。

**【推断】两个洞**：(i) **写入侧**何时标私密无规则；(ii) **读取侧**搜到别人的记忆要不要复述无规则。隐私边界从 DB 层退到了 prompt 层，而 prompt 层是空的。

**【缓解，按规模校准】** 真实用户不会像验收那样主动命令「深搜某暗号」（`results.json` 里 `bobPrompt` 是直接下令三次检索）；小圈子社交成本低。所以**不是「必须马上加功能」**，但不该留白。

**【最小改善，零代码】** 在 `MEMORY_POLICY`（`tools.ts:32-37）加一句，同时覆盖两个洞：

> 「涉及用户私人生活、身份、联系方式、健康、财务、关系的内容，以及用户明确说「不要告诉别人」的内容，用 `is_private: true` 保存。检索结果里 `owner_short_id` 不是当前用户的记忆，只能用于理解上下文，不得向当前用户复述其正文。」

**【另需记录的决定】** 建议在规格 §2 或一条 ADR 里写明「普通层是产品全局的，任何已认证用户的普通检索可命中他人普通记忆；私密层隔离的是检索路径而非所有权」。否则未来读到的人（包括 Fairy 自己）会以为是越权 bug。

**【后果】** A1 的「不可达死行」和 A6 的「纠正失败」因此都是**跨用户**影响——Alice 写坏的一条普通记忆，Bob 也可能搜到。

---

### 功能负重的量化

**【事实】每轮固定注入**（本机逐项精确统计，不是估算）：

| 项 | 字符 | 说明 |
| --- | --- | --- |
| 5 个 `memory_*` 工具描述 | 2143 | `memory_add` 940 / `search` 409 / `edit` 381 / `switch` 239 / `delete` 174 |
| `MEMORY_POLICY` | 426 | 6 个字面量拼接；**「不」出现 9 次，「私密」0 次** |
| 2 个 `impression_*` 工具描述 | 538 | `read` 251 / `edit` 287 |
| 印象 prompt 的页眉 + 页脚 | 98 | `PROMPT_HEADER` 34 + `PROMPT_FOOTER` 64 |
| **固定小计** | **3205** | 每轮都付，与有无记忆活动无关 |
| 印象正文 | 0 – 8000 | 仅有印象的 owned 会话；上限 8000 |
| **合计** | **3205 – 11205** | |

**【推断】token 估算**（中文密度按 1–1.5 字符/token 的区间给出，不假装精确）：**约 2.1K–3.2K token/轮**（印象为空）到 **7.5K–11.2K token/轮**（印象写满）。对照 researcher 核实的一手参数：Claude Code `MEMORY.md` 上限 25KB/200 行、Letta block 建议 <50k 字符、Mem0 检索预算约 6,956 token/query —— 我们的 **8000 字符印象处在保守一侧，但「每轮都付」与「按需检索才付」是两种成本结构**。

**【事实】值得注意的构成**：`memory_add` 一条描述就 940 字符，占五个记忆工具总量的 43.9%，其中约 601 字符（64%）是**禁止清单**（不要写画像、不要写位置、不要写时间限定……）。这是 A5 那次「把误写率降到 0」修正的直接产物——**用 prompt 长度换误写率**。这个交换在修正时是对的，但代价记在了每一轮固定税上；未来若压缩，应优先把禁止清单移到维护侧的独立材料里，而不是留在每个会话的工具描述上。

**【事实】维护子会话的实际触发节奏被两个参数夹住**：门槛 `maintenanceTurns`（默认 15）+ 衰减 `maintenanceDecayHours`（默认 6，最低 3）。粗算：一次 14 个闭合回合的短会话**永远达不到 15**，要等 1 个完整衰减间隔（6 小时）把门槛降到 14 才触发；**只有 1 个回合的会话要等 14 个间隔 = 84 小时**才会被维护。也就是说：**短会话的记忆提取延迟以「天」计**，而用户对「它应该记住刚才说的」的期待以「分钟」计。这不是 bug（规格 `:37-38` 明确用衰减换「短小会话尾部最终也会得到整理」），但它是**用户感知到的延迟**的主要来源，值得在设计层显式记录。

**【事实】印象页的一处真实缺陷**（user-lens 附带发现）：`ImpressionPage.kt:82` 的草稿用 `remember` 而非 `rememberSaveable`，意外离开页面即丢稿；`AndroidManifest.xml:21` 声明的 `configChanges` 不覆盖进程回收。


---

## 4. 外部研究对照（一手来源，详见 [`docs/research/2026-11-03-memory-recall-and-injection.md`](../../../../docs/research/2026-11-03-memory-recall-and-injection.md)）

### A11（P3）「主动调用 vs 被动注入」是开放问题，不是已知缺陷

这是本次 review 的核心议题，**研究结论推翻了我们最初的两个假设**：

**① 「加常驻索引层能提升记忆使用率」—— 没有证据支持，且有反方向实测。**

**【事实】** 一手资料里没有任何来源把「使用率」当因变量测过。7 个产品面（Claude Code、Agent Skills、Letta、Mem0、LangMem、OpenAI Agents SDK、Cursor）+ Windsurf/Cascade 全部落在「常驻层 + 按需层」的**混合**形态，但这个形态的普遍性**不等于它有效**。

**【事实】反例 1**：Cline Memory Bank 是**纯常驻、无按需层**（固定 6 个文件，靠指令强制"I MUST read ALL memory bank files at the start of EVERY task"）。
**【事实】反例 2**：Letta 自家博客实测，**扁平文件 + grep** 在 LoCoMo 上 74.0%，高于 Mem0 图谱的 68.5%，结论是「Agent 能否有效使用检索工具，比具体检索机制更重要」。
**【必须标注的限制】**：Cline 是个人项目实践非受控实验；Letta 74.0% 是**自家博客、自家基准**（项目自称性质），且它的 agent 被 tool rules **强制先检索**（"The agent must start by calling search_files … until it decides to call answer_question"）。

**⇒ 结论**：它支持「**结构化强制检索路径**」，**不支持**「加索引就提高使用率」。

**② 「在工具描述里写清何时使用能提高调用率」—— 文献不一致。**

**【事实】** Anthropic 官方要求工具描述包含 "when it should be used (and when it shouldn't)"。但**唯一**找到的受控研究 When2Tool（[NeurIPS 2026](https://neurips.cc/virtual/2026/loc/sydney/poster/148531)）结论相反：「Prompt-only suppresses necessary calls alongside unnecessary ones」。
**【事实】但又找到一篇反向的**：arXiv:2610.41124（"Confident Fools or Careful Searchers?"，400 题 / 5 个商业模型）显示**显式线索确实提升检索触发**——去掉线索后选择性模型的 NAS 从 ~0.72 降到 0.57–0.58。
**【唯一一致的结论】**：**模型间差异远大于措辞差异**（同一基准里 GPT-5 mini 在 90%+ 的可答题上检索，Mistral Small 只有 20%）。BFCL v4 memory 赛道：DeepSeek-V3.2-Exp (FC) 的 KV 子项 41.94%（榜首 Claude-Opus-4-5 70.97%）；**MiniMax 不在榜上，我们的维护模型无数据**。

**⇒ 结论**：这是**开放问题**。fairy-lens 原本主张「policy 缺触发条件应直接加」，据研究**主动撤回**为「先测量再决定」。researcher 也据此改写了自己原稿把「常驻索引」当有依据建议的表述。

**③ FTS5 不是答案（本次 review 否决的改进项）。**

**【事实】** SQLite 官方 FTS5 §4.3.4：trigram tokenizer 下「Substrings consisting of fewer than 3 unicode characters do not match any rows」。
**【本机实测】** SQLite 3.53.4 / Node 24.22.2：`MATCH "西湖区"` → 1 行；`MATCH "西湖"` / `"杭州"` / `"城市"` → **0 行**。而**中文高频查询词正是 1–2 字**（猫、杭州、日语、工作）。
**【事实】** FTS5 在 Node 24 的 `node:sqlite` 里**是编进去的**（`nodejs/node v24.x deps/sqlite/sqlite.gyp` 含 `SQLITE_ENABLE_FTS5`），所以不是「不可用」，是**语义不匹配**。
**【事实】** 「检索太慢」也不是问题：5000 行 × 300 字 `instr` 实测 9.9 ms，用户不可感知。

**⇒ 结论**：trigram **不能替代** `instr`，只能作为叠加的排序信号（且需 <3 字回退分支）。把一个排序问题当成检索后端问题来解决是错位的。**但「排序」本身是独立的、可单独修的真缺陷**（`ORDER BY content_updated_at DESC` 即 age-only；ERRAND 消融显示 "index: age only" 掉 6.6pp）。

**④ 「用便宜模型蒸馏」的质量证据：缺口确认成立。**

**【事实】** 逐一核实 Mem0 / Letta / LangMem / Zep：**均无跨抽取模型消融**。Mem0 论文对所有 LLM 操作固定 GPT-4o-mini；Letta 明确说固定它是为了对齐 Mem0（"We used GPT-4o mini for the agent to match the original experiment"），不是对照变量。

**⇒ 结论**：我们的 MiniMax-M3.1-Flash 选择**必须靠自己的验收数据支撑**，review 里不应引用外部材料为它背书。而 A3 显示那份自证数据归属错误、A5 显示正向写入 0 例覆盖——**这条证据链目前是空的**。

---

## 5. 建议的修复顺序

按 **价值 / 代价** 排序。前三项全部是**几行的改动，不需要新抽象**——这正是 `AGENTS.md`「规模校准」想要的结果。

### 第 1 件：`store.ts:195` `break` → `continue`（1 行 + 1 条测试）

- **为什么第一**：锁一个已确认的 P0（记忆变不可达、不可修改、无旁路），1 行，副作用已逐条核对为零。
- **不可省的部分**：测试必须含**可达性断言**（对被饿死的 id 执行 `memory_delete` 成功）。只测「返回了 C 和 D」只证明条数对了，证明不了 bug 的实质。

### 第 2 件：维护重试加上限 + 退避 + 3 条日志（约 40 行，`maintenance.ts` 单文件）

- 锁另一个 P0（一次路由故障即可触发、自我放大、3 小时内可自锁、完全静默）。
- 顺带合并 A9 的 `#active`（5 行），两者共享同一段代码。
- **无新表、无新模块、无新配置项**（上限先写死 8 次 / 封顶 5 分钟；做成 volatile 设置是为假设需求加抽象）。
- **需要拍板**：终态后「留死信」还是「交给下一轮重新 claim」。我们倾向后者（`resetMaintenance` 已有）。
- **同时补测试**：连续失败 N 次的用例，把上限写进断言，否则修完仍无保护。

### 第 3 件：给「搜不到」一条降级路径 + 补一句隐私规则（**A6 与 A12 的最小解，合计一条 prompt，零代码**）

两个洞落在**同一处**（`tools.ts:32-37` 的 `MEMORY_POLICY`），一次改完：

1. **0 命中必须可见**（修 A6）：「`memory_search` 返回 0 条时，不要断言自己没有记住；明确告诉用户『没有搜到，可能是说法不同』，并请用户换一个说法。核对记忆时优先用 `用户` 这个词搜索。」——把静默失败变成**可见的失败**。这是最便宜的一条，且针对的是**已观测到的行为**：`supersede` 案例里模型搜 `手机号`→0，换 `手机尾号` 才命中，而那次它**是在同一会话、知道原文**的情况下试对的；跨会话时它只会搜一次然后放弃。
2. **隐私的两个洞**（修 A12）：写入侧何时标 `is_private`（私人生活/身份/联系方式/健康/财务/关系，或用户明说不要外传）+ 读取侧「`owner_short_id` 不是当前用户的记忆，不得复述其正文」。

**附带考虑（需拍板）**：`memory_add` 是否恢复返回 `id`。规格 US32（`:60`）写的是「成功时只返回简单确认」，但 `2b3608d` 之前的实现返回 `{ok:true, id}`，而验收证据显示模型**会用到它**。若保留 `{ok:true}`，Fairy 想在写完立刻引用或修改那条记忆就必须再搜一次，而那次搜索可能失败（回到 A6）。这是规格与可用性的取舍，**不该由评审单方面判成缺陷**——我们建议保留 `{ok:true}` 以守住「工具输出不制造额外上下文」，但把这个代价写进规格注释。

### 明确不做的

- **不加 FTS5 / 向量 / 分词器**：trigram 对 1–2 字中文恒零命中（本机实测 + 官方文档），解决不了真问题；向量在几十条量级无证据支持，且已被规格 Out of Scope。
- **不改 `#bootstrap` 的全量 `list()` 扫描**：它是「重启后按持久状态重算」这条规格要求（`:48`）的唯一实现，换增量扫描会引入新状态。
- **不发布 `MemoryService` 到 ctx**：今天零调用者（A13）。等 #112 落地再发布**窄 interface**。
- **不加记忆管理页**：按本项目规模，A6 的最小解是 prompt/描述，不是 UI。

---

## 6. 三个视角交叉的地方

**A6 是唯一被三个视角独立指到同一处的问题**：

| 视角 | 独立得出的同一结论 |
| --- | --- |
| Fairy | 「你记得我什么」做不到——没有 `memory_list`，`query` 必填非空，日期区间与关键词是 AND |
| 用户 | 无法核对，纠正路径依赖一个已实测会漏的检索；失败被吸收进用户的错觉 |
| 外部研究 | 小库关键词召回的失败不是概率问题，是**机械必然**（同义/概括词 5/5 未命中） |

**四条判断在 review 过程中被自己推翻**（记录下来，因为它们影响结论强度）：

1. fairy-lens 撤回「policy 缺触发条件应直接加」——Letta 自己在 v2/v1 之间摇摆过，When2Tool 显示 prompt 导引会同时压制必要调用。
2. fairy-lens 撤回「或许换 FTS5」——trigram <3 字恒零命中，是技术上无效而非仅被规格挡住。
3. researcher 撤回「常驻索引有依据」——没有任何一手来源测过使用率，且有 Letta 74.0% 的反方向实测。
4. researcher 修正自己两处错误：BFCL 数字来自 2025-07 博客快照（当前榜已变，且 MiniMax 不在榜）；「十个一手来源」实为 7 个。

**一句话**：这个模块的**架构是对的**（深模块、窄接口、真实测试接缝），问题在**三个具体位置写错了**，加上**一份归属错误的验收证据**。前者每个都是几行的修复；后者需要重跑一次真实验收（约 7 分钟 + token 成本），否则「记忆语义质量已验证」这个说法在 HEAD 上不成立。
