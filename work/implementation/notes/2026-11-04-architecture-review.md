# OurFairy backend deepening 审查（2026-11-04）

按 `/improve-codebase-architecture` 方法论做的一轮架构 deepening 审查。用户要求「参考方法论，不必遵守完整流程」：不产出 HTML 报告、不跑 grilling loop、不中途提问，直接给 Markdown。

词汇严格取自 `codebase-design` skill：**module / interface / implementation / depth / seam / adapter / leverage / locality / deletion test**。全文不使用 component、service、API、boundary 来指代这些概念（引用源码里的类名如 `SkillService`、`GatewayService` 是代码事实，不是在本报告里用它们当设计词汇）。

范围：`backend/` 全部 15 个包，20 957 行 `src/**/*.ts`，对照 `tests/` 101 个测试文件 29 589 行。Android 端只做交叉观察，不单独展开。

**规模校准声明。** `AGENTS.md`「规模校准」要求抽象与防御只在当下明确需求或已观测到的失败面前加入，并指名它服务哪个需求或故障。本报告的每个候选都标了 recommendation strength，其中标 **Speculative** 的项必须同时读到成本那一句；没有具体需求或故障支撑的项一律没写进来。这不是一个「把代码改得更抽象」的清单。

---

## 0. 领域模型先行：一个词决定了五个候选中的三个

按 `domain-modeling` 的做法，先核对代码事实与词汇表是否一致，再谈结构。核对结果直接决定了后面的排序。

`GLOSSARY.md` 的会话级词条写的是「**会话**：归属于一位用户的一次独立对话」；状态机词条写的是「**热会话**：某一会话中模型正在调用或工具命令正在执行，或距上一次调用、执行结束不足 1min」，「**active**：若任意一个会话为热会话，Fairy 即为 active 状态」。

代码里「什么算一个用户自己的会话」的权威判定是 `backend/identity/src/session.ts:28` 的 `isUserSession`，注释写明这是「the one rule the product rows share before they register their per-agent tool surface」，判定三个持久事实：有 `owner`、无 `parentSession`、无 `agentPreset`。

这个词现在是产品里**被复用最广的一条领域规则**——`grep -rn "isUserSession" backend/*/src/` 命中 10 个文件，跨 7 个包：

```
backend/chat/src/prompt-guard.ts:2
backend/delivery/src/index.ts:16
backend/groups/src/index.ts:13
backend/memory/src/index.ts:17, maintenance.ts:27
backend/search/src/index.ts:4
backend/skill-creator/src/tools.ts:19, learning.ts:44, provider.ts:26
```

这条规则被复用得这么广，说明它是领域里承重的一个词，不是实现细节。这点很重要，因为下面三个候选（A、C、D）本质上都是「围绕这个词的一份拷贝已经开始漂移或已经开始缺失」。

**而 `isUserSession` 的闭合性，是它值得承重的真正原因。** 它是一个**默认拒绝**的判定（三个字段任一不满足就 false），所以产品里每新增一种后台 agent，所有 10 个消费者**不需要任何改动**就自动把它排除在外。实测确认：`ourfairy:skill-learning` 这个 preset（`learning-policy.ts:23`，#300 引入）落地在 3 处（`deep-creation.ts:389`、`learning.ts:735`、`learning.ts:816`），而**没有任何一个消费者提到它**——`isUserSession` 直接判 false，memory 的工具也就不会给它。唯一需要写 preset 名字的地方是 `memory/src/index.ts:118` 的**加法**（`isUserSession(header) || header.agentPreset === MAINTENANCE_PRESET`），即「我自己的子也给自己工具」，那是创建者授权，不是产品通用标记。

这个性质反过来解释了候选 C 为什么重要：**既然新增 agent 种类不需要改动任何消费者，那么「每个消费者各自重写一遍注册 Boilerplate」的成本，就不会被新增 agent 的测试暴露出来。** 它只在复制粘贴时静默累积。

（顺带修正 `docs/architecture/agent-capabilities.md` 的一处事实：该文件 `:25-29` 的表与 `:31-32` 的「除上面两种外还没有第二种 agent 落地」，在 #300 之后已不成立——skill-learning 子代理是第三种。这条属 `docs-keeper` 的轴，我只报告不改文档；它不影响本报告的候选排序，因为如上所述第三种 agent 落地的代价是零消费者改动。）

---

## 1. 候选清单

按 recommendation strength 排序。每个候选给出：涉及文件、摩擦、deepen 后的 interface 形状、leverage/locality 收益、测试怎么变好。

### 候选 A：`ClosedTurn` 投影在两个包里各有一份逐字节相同的副本 **（Strong）**

**涉及文件**

- `backend/memory/src/material.ts:22-25`（`ClosedTurn`）、`:47-49`（`messageText`）、`:52-55`（`isHumanMessage`）、`:58-72`（`closedUserTurns`）
- `backend/skill-creator/src/material.ts:24-27`、`:69-71`、`:74-77`、`:80-94`

**摩擦。** 这两个 `material.ts` 是两条独立维护的「把一段会话日志投影成子代理可读材料」的 module。我把三个函数逐字节 diff 过：

```
messageText    IDENTICAL
isHumanMessage IDENTICAL
closedUserTurns IDENTICAL
```

`ClosedTurn` 类型也相同（唯一差别是 `seq: SessionSeq` 与 `seq: number`）。这就是 deletion test 的正面案例反过来用：**删掉任何一份，复杂度既不会消失也不会搬回家，因为另一份已经在了。** 两份都不构成 module——它们的 interface 与 implementation 一样大（各 3 个导出，各 15 行实现），中间没有任何被隐藏起来的知识。

真正被隐藏起来的知识只有一条：**「一个已关闭的人类回合」= `turn/start` 之后、`turn/end` 之前出现过 append-origin 且 `source.kind === 'user'` 的 `user/message`。** 这条规则目前在产品里有第二处、第三处独立表述：

- `backend/sessions/src/events.ts:108-127`：`firstHumanMessageText` 里同样的 `isAppendSurfaceEvent` + `source.kind !== 'user'` 组合
- `backend/skill-creator/src/evolution.ts:230-234`：`userMessageText` 又写了一遍同样的判断
- `backend/skill-creator/src/sharing.ts:54-77`：`requireSharingConsent` 又写了一遍（判定在 `:62`）

**deepen 之后 interface 长什么样。** 一个 module，interface 是「给我一份事件序列，给我这个投影关心什么，我给你一个形状已定的东西」。调用方不再各自组装事件过滤：

```
// 概念形状，不是最终签名
closedHumanTurns(events): Turn[]
projectInterval(events, window, { rows: RowKind[], bound? }): string
```

`material.ts` 的「投影成文本」部分本来就各不相同（memory 关注记忆变更调用，skill 关注工具输出与文件变更摘要），这部分**应该**保留为两个各自的 implementation。要合的是下面那层判定：什么是一个回合、什么是一条人类消息、消息文本怎么取。

**leverage。** 一份实现支付 3（现有调用点）+ N（`firstHumanMessageText`、`userMessageText`、`requireSharingConsent` 可以全部改为读同一个判定，或者至少由它证明自己一致）。这是 `codebase-design` 的「one implementation pays back across N call sites and M tests」的标准情形。

**locality。** 目前的故障模式很具体：如果 dsh 改变 `surfaceOp` 语义或 `source.kind` 的取值，`closedUserTurns` 的两份要同时改，而**没有任何机制会告诉你漏了一份**。改动落在两个包里、由不同的测试文件守着、没有共享的编译期约束。deepen 之后修一次，两边同时正确。

**测试怎么变好（这条最重要，且已被验证）。** 现状：

- 只有 skill 那份有直接 import 的测试面：`tests/skill-learning-material.test.mjs:18` 走 `skill-creator/dist/material.js`
- `grep -rn "memory/dist/material" tests/` → **零命中**。memory 的这份只能通过 `memory-maintenance.test.mjs` / `memory-maintenance-recovery.test.mjs` 的整机启动路径间接覆盖

也就是说，**同一条领域规则，一份有纯函数级测试面，另一份没有。** 这不是「测试写得不够」——是两份拷贝让「一处测试面同时守两份实现」在物理上做不到。deepen 成单一 module 之后，`skill-learning-material.test.mjs` 那类既有测试自动开始守 memory 侧，测试面才可能合一。

**这条是否与 ADR 冲突？** 不冲突，但**与 ADR-0003 的措辞有张力**。ADR-0003 把「个人与共有作用域的适配封闭在创建插件内部，不另拆产品插件」定下来了，理由是「不引入运行时 plugin manager」。本候选不拆插件、不动作用域适配，只把一条**纯 codec**（无状态、无 IO、不依赖 cordis 上下文）提到共享位置。ADR-0001 的「接缝应集中复杂性」明确反对的是「引入浅模块」，而本候选的方向相反：把两份浅拷贝换成一个有真实隐藏知识的 module。不需要重开 ADR。

**成本（必须一起读）。** 新增一个跨包位置。现有先例是 `@ourfairy/dsh-identity/session`（`backend/identity/src/session.ts`，33 行，纯判定，注释自称「a pure codec subpath, like `./owner`」）与 `@ourfairy/dsh-sessions/events`。所以做法不是新造机制，而是**再放一个已有形状的 codec subpath**：把 `closedUserTurns` 放进 `@ourfairy/dsh-sessions/events`（它已经在 `readSessionEvents` 里拥有「读日志」这件事），两个 `material.ts` 改成 import。这一条的落地成本是「改两个 import + 挪三个函数」，不是「设计一个新层」。

---

### 候选 B：`skill_manage` 的七个 action 与 `SkillCreation.create` 的 18 个可选字段之间，缺一层 **（Strong）**

**涉及文件**

- `backend/skill-creator/src/tools.ts:69`（action 枚举）、`:250-302`（create case 校验）、`:360-381`（`registerSkillTools`）
- `backend/skill-creator/src/creation.ts:120-167`（`CreateCandidateInput`，**18 个字段，其中 11 个可选**）、`:1055-1261`（`create`，207 行）、`:1262-1376`（`rollback`，115 行）、`:1691-1837`（`review`，147 行）

**摩擦。** `tools.ts` 的头注释说得很清楚，而且说得对：

> It is a deep interface over the creation module: one action-style call answers the bounded pending/pool view, creates a candidate from the caller's own session, returns the review package with a deterministic display, and records the reviewer's decision. The caller never names an owner, reviewer, landing path, manifest hash or verification result.

这是**模型的** interface 很深。问题是它深得没有地方落：`skill_manage` 之后紧接着就是 `SkillCreation.create`，而 `CreateCandidateInput` 的形状是「把三条完全不同的来源路径塞进一个可选字段集合」：

| 来源 | 哪些字段才有意义 |
| --- | --- |
| 显式创建/修订 | `files`, `focus`, `scope`, `parentVersionId`, `targetBenefit`, `evidence` |
| 地址安装 | `packageDir`, `install`, `license` |
| 后台学习 claim | `background`, `deferVerification` |

`create()` 的 207 行里，前 100 行基本都是在把这些字段的各种非法组合挡回去，例如 `creation.ts:1064-1071`：

```ts
if (input.packageDir !== undefined && input.files !== undefined) {
  throw new SkillError(400, 'skills/invalid-package', 'create accepts either package files or a fetched package, not both')
}
if (input.packageDir === undefined && (!Array.isArray(input.files) || input.files.length === 0)) {
  throw new SkillError(400, 'skills/invalid-package', 'create needs the complete package files, including SKILL.md')
}
if (input.packageDir !== undefined && input.install === undefined) {
  throw new SkillError(400, 'skills/invalid-package', 'a fetched package needs the install source it was fetched from')
}
```

而 `tools.ts:260-270` **又把同一批互斥规则重写了一遍**（`:260` `parentVersionId` 与 `address` 互斥、`:263` `address` 与 `files` 互斥、`:266` `files` 或 `address` 必须有）。这就是 `codebase-design` 里 shallow 的判据：「interface 几乎和 implementation 一样复杂」——只不过复杂的是**入参的合法子集**，而不是方法数量。合法性知识没有藏在模块里，它被摊到了两个 module 的边界上，各写一份。

deletion test 在这里给出的是警告信号：**删掉 `tools.ts` 的那批校验，复杂度不会消失——`create()` 自己的守卫会接住；但删掉 `create()` 的守卫，`tools.ts` 接不住，因为后台 learning 与 deep-creation 也直接调 `create`。** 也就是说 `tools.ts` 里的那份校验是纯冗余，而 `create()` 里那份是承重的。冗余那份的存在本身就是 interface 形状不对的证据。

**deepen 之后 interface 长什么样。** 让「这是一次显式创建 / 这是一次地址安装 / 这是一次后台 claim / 这是一次修订」成为 interface 的一部分，而不是靠可选字段在实现里辨认：

```
// 概念形状
creation.createExplicit({ owner, session, events, name, files, scenarios, focus?, parent? })
creation.createFromInstall({ owner, session, fetched, scenarios })
creation.createFromClaim({ claim, packageFiles, scenarios, deferVerification })
```

三个入口共用同一段 implementation（staging → 校验 → `#verifyAndRecord` → `createDraft`），这段已经写好了：`creation.ts:1095` 的 `#stageCandidate`、`:1472` 的 `#verifyAndRecord` 两个私有方法就是共享实现，`create` 与 `rollback` 已经在共用它们。所以这个候选不是「写新代码」，是**把已经共享的实现从两个入口变成一个 interface 的三个入口**，同时把混合字段的 `CreateCandidateInput` 去掉。

**leverage。** 现在有 4 个已知调用方：`tools.ts:280`（模型）、`deep-creation.ts:612`（后台 claim）。它们各自拿 18 字段的接口去拼出合法的 6-8 个。deepen 后每个调用方只面对自己那条路径的必填字段，`deferVerification` 这种只有后台才用的开关从共享接口里消失。

**locality。** 互斥规则从 2 处变成 1 处（`tools.ts` 那 25 行校验可以**删掉**，类型系统替它工作）。`create()` 的 207 行里至少 60 行是「拒绝不可能的字段组合」，deepen 后这部分由三个入口的签名承载，剩下的才是真正的创建逻辑。

**测试怎么变好。** 目前 `SkillCreation` **没有任何测试直接实例化它**（`grep -rn "SkillCreation(" tests/` 零命中）。它的测试面只有两条路：整机 HTTP（`skill-creation.test.mjs` 856 行，真启动后端）与 `skill-creation-store.test.mjs`（只测 `store`）。这是典型的「interface 太大，无法在 interface 处测」：要测「安装了外部包后同回合不能直接批准」，得跑起整个后端。deepen 成三个入口后，`createFromInstall` 的入口参数不再包含 `focus`、`evidence`、`parentVersionId`，一个纯单元测试可以直接构造它并断言 ADR-0004 的分级判定。

**这条是否与 ADR 冲突？** 不冲突，而且**直接服务 ADR-0003**。ADR-0003 的 Consequences 写的是「创建插件需要把产品用户身份映射到原生技能作用域」，本候选不改变映射，只改变插件内部入口形状。ADR-0004 的「按来源分级」在代码里的落点是 `creation.ts:333` 的 `approvalEvidenceRequired(scope, sourceType)`——**这正是按来源分级的形状**，本候选只是把「来源」从 `CreateCandidateInput` 的一个可选字段，挪到 interface 上。这是让 ADR-0004 的决定在类型层面可见，不是违背它。

**成本（必须一起读）。** 这是本轮工作量最大的候选。`create()` 207 行要拆成 1 个共享实现 + 3 个入口；`tools.ts:250-305` 的校验块可以删；`deep-creation.ts:612` 的调用点要改。**如果按「只服务当下需求」的标准判断，现在还没到必须做的程度**——4 个调用方都能工作，测试也绿。所以我把这条标 Strong 的理由不是「代码难看」，而是：下一轮如果再加第 5 条来源（比如 `seed` 已经在 `seed.ts` 自己 import 了 store，绕过 `create`），互斥规则会变成 3 份。**风险点在「下一轮会加来源」这个已观测到的趋势**，不是假设。

---

### 候选 C：五个按 Agent 注册的工具行各自重写同一套 Boilerplate，其中两个缺 name guard **（Worth exploring）**

**涉及文件与实测对照**

| 文件 | 准入判定 | `agent/created` | `agent/disposed` | `agents.list()` 重放 | name guard |
| --- | --- | --- | --- | --- | --- |
| `delivery/src/index.ts:169-183` | `isUserSession` | ✓ | ✗ | ✓ | ✗ |
| `search/src/index.ts:36-88` | `isUserSession` | ✓ | ✗ | ✓ | ✗ |
| `groups/src/index.ts:66-103` | `isUserSession` | ✓ | ✓ | ✓ | ✓ |
| `memory/src/index.ts:110-134` | `isUserSession` 或 preset | ✓ | ✓ | ✓ | ✓（在 `tool-kit.ts:44`） |
| `skill-creator/src/index.ts:196-221` | `isUserSession`（在 `tools.ts:361`） | ✓ | ✓ | ✓ | ✓（`tools.ts`） |

（`attachments/src/pdf.ts:161-208` 是第六个工具行，但它注册在**全局层**、不按 Agent 分层，且由创建者的 `tools.restrict({ allow: [] })` 决定继承面。见下文——它不是本候选的对象。）

**摩擦。** 这五个按 Agent 注册的行在做同一件事：决定「这个 Agent 该不该拿到本行的工具 → 拿到哪些 → 重放给已经在跑的 Agent → 在它被销毁时清账」。这套流程在每个包里重写一遍，注释也是复制粘贴的（`delivery`、`search`、`groups` 三处一字不差）：

> Only a user's own session gets product tools by default; any other agent gets none until its creator grants them. A scope's own registration cannot be hidden by dsh's tool restriction, so the row enforces it here.

而 `memory/src/tool-kit.ts:44` 的 `toolRegistrar` **已经把其中最有价值的一环（name guard）抽出来了**——注释解释了为什么必须有它：*「Registration can replay on the same Agent (a resumed session runs the same registration flow...), so each name may be offered exactly once.」* dsh 自己的注册表也确实会对同名抛错（`packages/core/tools/src/index.ts:748`：`tool "${name}" is already registered in this scope`）。

也就是说：**已经有 module 证明这个 guard 是必需的，但只有 2 个包在用它，4 个包没有。** `delivery` 与 `search` 是其中风险最直接的两个：它们都有 `for (const agent of ctx.agents.list()) register(agent)`，而 dsh 的 `SessionStartSource` 包含 `'resume'`（`packages/core/agent/src/runtime-types.ts:125`）——重放路径真实存在。

**deletion test。** 删掉 `tool-kit.ts` 的 `toolRegistrar`，复杂度会回到 `memory/src/tools.ts` 与 `impression.ts` 各写一遍 name guard，再复制到另外四个包。所以它确实在挣自己的价值——**它是一个真的 module，只是没被放到该放的位置**（它现在住在 `memory` 包里，于是只有 memory 用得上）。这是 locality 的教科书例子：知识在一处，位置却在错的 seam 上。

**deepen 之后 interface 长什么样。** 一个 module，interface 只说三件事：这是谁的 agent、这个包提供哪些工具、agent 被销毁时怎么清账。准入判定与 name guard 都在 implementation 里：

```
// 概念形状
perAgentTools(ctx, {
  audience: (header) => boolean,   // 默认就是 isUserSession
  contribute: (agent, add) => void,
}): () => void
```

**leverage。** 5 个调用点，每个现在写 15-25 行 Boilerplate。deepen 后每个调用方只写自己的 `contribute`。

**locality。** 准入规则（`isUserSession`）已经统一了；剩下的不统一是这个候选要收的：`attachments/src/pdf.ts:197` 用 `ctx.tools.register`，即**全局层**，而不是按 Agent 的 `agent.ctx.tools.register`。五个按 Agent 注册的行之外，只有它一个这么做。

**关于 `attachments`，我原先的判断是错的，已修正。** 我最初写「PDF 工具会出现在 memory 维护子代理的工具目录里」——**这个推断被实测否定**：

- `memory/src/maintenance.ts:462` 的 `#composeChild` 调 `agentCtx.tools.restrict({ allow: [] })`；`learning-child.ts:55` 同样。
- dsh 的 `ToolLayer.admits()`（`packages/core/tools/src/index.ts:760-766`）对每个 restriction 检查 `allow !== undefined && !allow.has(name)` → 返回 false。空 allow 因此拒绝一切继承来的全局工具。
- `tests/memory-maintenance.test.mjs:355` 直接断言 `assert.deepEqual([...child.tools].sort(), MEMORY_TOOLS)`（5 个记忆工具），`:400` 重复一次。

所以**全局层工具不会泄漏进后台子代理**：`restrict({ allow: [] })` 是那道闸，而且有测试守着。`docs/architecture/agent-capabilities.md` 的「per-agent 注册与 global layer」一节已把这条写清楚：「#274 已把 attachments 的 pdf 工具放在 row 的 global layer，它们的继承面由 agent 创建时的 `tools.restrict` 决定」。

**这对候选 C 的影响：** `attachments` 不是「漏了准入判定」，而是**刻意选择了不同的 seam**（全局层 + 由创建者 `restrict` 决定继承面），且这个选择被文档与测试固定。候选 C 因此收窄为：**五个按 Agent 注册的行里，`delivery` 与 `search` 缺 name guard**；`attachments` 从本候选剔除，不列入任何改动建议。

**测试怎么变好。** `tests/scoped-provider-rows.test.mjs` 已经在用「禁用 row → 断言工具目录里没有这个工具」的真实模型路径做这件事（`tests/delivery-row.test.mjs:144` 断言 `catalog.includes('deliver_message') === false`）。deepen 之后，五个包的准入判定可以合成一条「重放两次不产生重复工具」的性质测试，而不用每个包各写一遍。

**这条是否与 ADR 冲突？** **contradicts ADR-0003 的字面措辞，但值得重开。** ADR-0003 的理由是「个人与共有作用域的适配封闭在创建插件内部，不另拆产品插件，也不引入运行时 plugin manager」——注意它反对的是**产品插件**与**运行时 plugin manager**。本候选既不拆插件也不加 manager，只是把 `memory/src/tool-kit.ts` 里已经存在的 `toolRegistrar` 提到一个中性位置（或复用 `@ourfairy/dsh-http/http` 的既有先例，那个模块已经是「不 import 任何产品包」的中性 seam）。**值得重开的理由很具体**：`toolRegistrar` 已经独立存在、已经被验证必需、已经有两个消费者；把它从 `memory` 挪出来的收益不需要新的架构决定，ADR-0003 的措辞只是恰好也覆盖了它。

**成本（必须一起读）。** 5 个包各改 15-25 行，外加一条新的性质测试。**这条我标 Worth exploring 而不是 Strong，因为规模校准：** 现在只有 `delivery` 与 `search` 两个包缺 guard，而它们的重放路径（`agent/created` + `agents.list()`）在当前测试里没有触发过同名重复注册——`delivery-row.test.mjs` 与 `conversation-search.test.mjs` 都是单次启动。**这是一个已观测到的空缺，不是已观测到的故障。** 如果下一轮再加一个工具行，成本会线性叠加，那时这条会变成 Strong。

---

### 候选 D：三个「后台引擎」共用一套生命周期骨架，第三个是拷贝了第一个的 **（Worth exploring）**

**涉及文件**

- `backend/memory/src/maintenance.ts:179-257`（`MaintenanceEngine`，497 行）
- `backend/skill-creator/src/learning.ts:274-356`（`LearningEngine`，1030 行）
- `backend/skill-creator/src/deep-creation.ts:104-183`（`SkillCreationEngine`，724 行）

**摩擦。** 三个引擎结构逐段对应。我逐方法比过：

```
方法名              memory   learning
#createChild          11       24
#forgetIfCold           7        9
#launch                76      248
#quiet                  6       14
#resumeChild           10       27
#tick                 (5)      (13)
#bootstrap            (21)     (19)
```

其中三个函数是**逐字节相同**的：

| 函数 | memory | learning | 是否相同 |
| --- | --- | --- | --- |
| `#quiet` | `maintenance.ts:351-354`（4 行） | `learning.ts:535-538`（4 行） | **逐字节相同**（已 diff） |
| `#tick` | `maintenance.ts:229-232`（4 行） | `learning.ts:327-335`（9 行） | learning 版多一层 `#ticking` single-flight（注释解释了原因：慢评估不能叠加） |
| `#bootstrap` | `maintenance.ts:235-253`（19 行） | `learning.ts:338-354`（17 行） | 仅 store 方法名与注释不同（已比对） |
| `TICK_MS = 1_000` | `maintenance.ts:52` | `learning.ts:84`、`deep-creation.ts:66` | 三处各定义一次 |

`learning-child.ts` 已经在做一半的工作——它抽出了 `ChildRuns`（active/running/retry 记账）与 `learningChildSetup`（restrict → register → prompt section 的三步顺序），头注释写明理由：*「Keeping those four facts in this narrow module means the two engines cannot drift on what a learning child is or on when its turn counts as complete.」* **这正是本候选要扩大的东西，而且它已经验证过这个方向是对的。**

**摩擦的具体形状。** 现在骨架里有三件事各自复制：
1. tick + bootstrap + `#known` 集合（重启扫描 `sessionPersistence.list()` 并套 `isUserSession`）
2. `#quiet` 判定（`agents.get(id) === undefined || status === 'idle'`）
3. 「一批 source，每个 source 一个 fire-and-forget run」的调度

第 1 项是纯重复；第 2 项是纯重复；第 3 项已经有 `ChildRuns` 了，但只在 skill 侧用。

**deletion test。** 删掉 `learning-child.ts`，复杂度会回到 `learning.ts` 与 `deep-creation.ts` 各写一遍 `ChildRuns` 与 setup 顺序——这两份引擎目前在 `grep -rn "ChildRuns"` 里确实都在用它，所以它是承重的。同样的推理适用于 tick/bootstrap/quiet：这三个函数目前各两份，删掉任一份都不会使复杂度消失。

**deepen 之后 interface 长什么样。** 一个「watched sources 引擎」module，interface 只说：怎么判断一个 source 值得看、看到一个 source 该做什么、跑完怎么结算。tick / bootstrap / quiet / ChildRuns / close 都在 implementation 里：

```
// 概念形状
new SourceEngine(ctx, {
  store: () => Row[],              // 重启扫描的数据来源
  evaluate: (sourceId) => Promise<void>,
  tickMs?: number,
}).start()
```

`memory` 的 implementation 是「闭回合数到阈值就开维护子代理」；`learning` 的是「有工具调用就开检测子代理，然后 settle 信号」；`deep-creation` 的是「扫 claim 表」——第三个的 `#tick` 实现已经明显不同（它扫 `creationJobs()` 而不是 `#known`），所以它可能只共用 `ChildRuns`，不该硬套。

**leverage。** 3 个引擎共用 1 份 tick/bootstrap/quiet。

**locality。** 「重启后怎么恢复」这个知识现在有三份。这个知识很贵——`maintenance.ts:235-255` 的 catch 写着「a failed listing must not take the memory row down」，`learning.ts:338-356` 对应位置写着同样意思的话。这类失败语义一旦漂移，症状是「重启后台学习静默停了」，很难查。deepen 之后这份知识只有一处。

**测试怎么变好。** `memory-maintenance-recovery.test.mjs` 与 `skill-learning.test.mjs` 现在各写一套「重启后从持久状态恢复」的验证。deepen 之后这套验证变成对共享 module 的一次性测试，两个包各自只测自己的 `evaluate`。

**这条是否与 ADR 冲突？** 不冲突。ADR-0003 管的是技能运行时与创建插件的作用域，不涉及后台引擎的骨架。ADR-0001 的「接缝应集中复杂性」**支持**这条：它明确说「判断成本时检查调用方需要了解的内部细节、受变化影响的消费者，以及协调工作的生命周期和顺序要求」——tick/bootstrap/恢复语义正好是「协调工作的生命周期和顺序要求」。

**成本（必须一起读）。** 这是本轮**风险最高**的候选。`LearningEngine` 1030 行、`MaintenanceEngine` 497 行，两者都已有大量整机测试守着（`skill-learning.test.mjs` 1233 行、`memory-maintenance.test.mjs` 732 行）。在这两个模块上做大范围重构，回归风险与收益相比不划算。**所以我把这条的推荐范围收窄到只做两件最便宜的事：**

1. `#quiet`（6 行 × 2 份，逐字节相同）→ 移进 `learning-child.ts` 已有的共享位置，或者干脆移进 `@ourfairy/dsh-identity/session` 旁边作为「这个 source 现在是否安静」的判定
2. `TICK_MS`（三处各一行）→ 一个常量

**这两件事的成本是「改 5 行 + 加 1 个导出」，收益是消掉 2 处重复。** tick/bootstrap 的合并我标 Speculative，理由写在下面。

---

### 候选 E（Speculative）：`_supported` 之外的「bwrap 执行适配器」重复，判断依据不足

**涉及文件**

- `backend/spaces/src/bwrap.ts:90`（`buildBwrapArgv`，真 module）
- 三个适配器：`backend/spaces/src/sandbox.ts:20-28`、`backend/attachments/src/pdf.ts:109-118`、`backend/skill-creator/src/verify.ts:163-172`

**事实。** `buildBwrapArgv` 是一个够深的 module：interface 是 `(bwrapPath, spec, argv) → string[]`，implementation 是 120 行内核挂载决策（`RUNTIME_DIRS`、`RUNTIME_FILES`、`--unshare-all`、`--clearenv`、符号链接解析、`mounted` 去重）。三个调用点各自传不同的 `BwrapSpec`，这**正常**——spec 就是 seam 上的参数，三个调用方本就需要不同的挂载集。

但**执行**那一步三个调用点各写一遍，且各写一遍进程终止语义：

- `attachments/src/pdf.ts:117-134`：`ctx.subprocess.spawn` + `AbortSignal.timeout(10000)`，终止判定是 `outcome.exitCode === 137 || outcome.exitCode === 152 || signal === 'SIGXCPU'`，注释花 3 行解释 128+signal 的推导
- `skill-creator/src/verify.ts:176-228`：`node:child_process.spawn` + 手写 `killTimer`/`graceTimer`，`detached: true` 然后 `process.kill(-child.pid, 'SIGKILL')` 杀进程组
- `spaces/src/sandbox.ts`：不自己 spawn，返回 `ConfinedArgv` 交给原生执行器

**为什么标 Speculative。** 这三处的差异是**真实的**：pdf 是同步超时 + 资源限额（`prlimit --as=536870912`、`--cpu=5`、`--nofile=64`），verify 是可中断的用户回合 + 进程组，sandbox 是原生执行器。它们的终止语义不同是因为需求不同，不是因为懒得抽。合并它们需要先发明一个能同时表达「资源限额」「进程组」「原生执行器」的 interface——那是为假设的复用设计的抽象，正是 `AGENTS.md`「规模校准」禁止的。

**具体让我刹车的观察：** `pdf.ts:124` 那行注释里的知识（`prlimit` 的 SIGXCPU 是 152，SIGKILL 升级与 OOM 是 137）**是唯一一份**，而它只被 `pdf-worker-cancel.test.mjs` 与 `pdf.test.mjs` 的整机路径覆盖。这个知识确实该有更窄的测试面，**但那是测试问题的答案是「把这个判定抽成纯函数」**——`processOutcome(outcome) → 'resource-limit' | 'worker-unavailable' | 'ok'`——不是「把三个执行器合并」。前者成本约 20 行，后者成本远大于收益。

**结论：** 如果只做纯函数抽取，这条升到 Worth exploring；做执行器合并，Speculative，且不该在本轮做。

---

## 2. 明确**不**推荐的重构（列出并解释为什么不）

按 `AGENTS.md`「限制范围」与「规模校准」，这些看起来像候选但证据不足，列出来是为了避免下一轮重复讨论。

| 看起来像候选 | 为什么不做 |
| --- | --- |
| **拆 `backend/identity` 的四张表**（users / groups / uploads / deliveries） | `interfaces.ts:5-15` 已经给出结论与理由：「deliberately share one SQLite file, one synchronous connection and one migration ladder... splitting the tables back into four stores would move the complexity rather than remove it」。这是 deletion test 的**反面**结论（删掉共享 store，复杂度会搬到四个 store + 跨表事务丢失），且 ADR `dsh-ecosystem-boundary.md` §3.1 已记录为「保留的产品实现」。不要重开。 |
| **把 `RemoteChat`（`chat/src/service.ts`，207 行，13 个方法）合进 `SessionRuntime`** | 我本来怀疑它是纯 pass-through，实测**不是**：13 个方法里只有 2 个是一行委托（`activeReplies`、`withReplyGuard`），其余 11 个各自有校验、错误码映射或事务。`chat/src/runtime-facade.ts` 又已经做了正确的事——用 `RUNTIME` symbol 把 `SessionRuntime` 挡在 facade 后面，注释写明「Holding the `SessionRuntime` behind a module-private symbol makes that the entire reachable surface」。这是本仓库里**已经做对的 deepen 范例**，不需要再动。 |
| **把 `SkillStore`（1602 行，50 个方法）按表拆成多个 store** | 与 identity 同理，且 `store.ts` 的 `cancelLearning`/`claimLearning`/`settleLearning`/`failLearning`/`abandonLearning` 是**同一个状态机的转移**，拆开会让「一个 interval 只能被一个 child 认领」这条不变式跨模块。真正的 friction 在 `SkillCreation`（候选 B），不在 store 的宽度。 |
| **给每个包都加 `agent/disposed` 清理** | `delivery` 与 `search` 没有 `agent/disposed`，但它们的 `register` 不持有 per-agent 状态（没有 `Map<Agent, …>`），所以没有需要清的账。加一个空 handler 是纯噪声。真正缺的是 name guard（候选 C），不是 disposed。 |
| **把 `spaces/src/fs.ts`（641 行）拆小** | 它是 `LocalFileSystem` 的 adapter，interface 由原生 `FsProvider` 定义，implementation 的复杂度来自 fd 绑定与 TOCTOU 防护（`/proc/self/fd` 核对）。这是「大 adapter 小 implementation」的反面——它的深度来自满足一个已有的窄 interface。`dsh-ecosystem-boundary.md` §3.3 已把「读隔离 + 无会话拒绝 + 路径替换语义」列为必要保障。没有可删的东西。 |

---

## 3. 跨 seam 泄漏核实（审查项 3）

任务点名了两个具体怀疑。用 grep 核实，**两个都不成立**，但核实过程发现了别的东西。

### 3.1 `backend/memory` 的 `MAINTENANCE_PRESET`：没有泄漏

`memory/src/preset.ts` 的 `MAINTENANCE_PRESET` **只被 memory 包自己 import**：

```
memory/src/service.ts:13, :90
memory/src/index.ts:24, :118
memory/src/maintenance.ts:32, :444
```

全仓 `grep -rn "dsh-memory/preset"` → **零命中**（除了 `package.json` 的 `exports` 声明本身）。它的头注释说的正是这件事：「It is memory's private fact... Product tool rows do not compare this id; they register only for a user's own session」。**这是一条做对了的 seam**：`isUserSession`（共享判定）与 `MAINTENANCE_PRESET`（私有事实）被刻意分开，注释明确写了理由。

唯一的小瑕疵：`memory/src/maintenance.ts:464` 把 section 名 `'ourfairy:memory-maintenance'` 写成字面量，而 `:444` 用的是 `MAINTENANCE_PRESET` 常量。同一个字符串在同一个文件里两种写法。成本 1 行，收益小，**不值得开一个候选**——列在这里是为了说明我查过了。

### 3.2 `skill-creator` 对 `chat` 的依赖：是 type-only，没有运行时耦合

实测所有 `@ourfairy/*` 的 import（`backend/*/src/**/*.ts`，非 test），`skill-creator` 对 chat 的三处全是 `import type {}`：

```
backend/skill-creator/src/index.ts:53        import type {} from '@ourfairy/dsh-chat'
backend/skill-creator/src/tools.ts:32        import type {} from '@ourfairy/dsh-chat'
backend/skill-creator/src/review-open.ts:29  import type {} from '@ourfairy/dsh-chat'
```

这是 cordis 的 service 类型增强约定（`import type {}` 把 `Context` augmentation 带进来，不产生运行时依赖）。`skill-creator/src/index.ts:53-54` 的注释写明：「The imports are type-only, so they add no runtime dependency」。

**真正的运行时依赖在别处，而且是单向的、正确的**：`skill-creator → chat` 只经由一个刻意做窄的 interface——`ChatRuntimeFacade`（`chat/src/runtime-facade.ts`，55 行，**3 个方法**：`appendOnce` / `runDelivery` / `promptOnce`）。`review-open.ts:88` 只调 `promptOnce`。这个 facade 的注释说明了为什么它值得存在：

> Delivery needs one at-most-once session append that resolves durable, and one outgoing-delivery queue; the review entry needs one system-context message that starts a real turn without pretending the user typed it. **Nothing else.** Holding the `SessionRuntime` behind a module-private symbol makes that the entire reachable surface.

**这是本仓库里最干净的一处 deepen，值得当范例引用**：55 行 facade 挡住了 782 行的 `SessionRuntime`，两个消费者（delivery、skill-review）各自只用到其中 1-2 个方法。

### 3.3 核实过程中发现的真实耦合（不在任务点名的两处）

**`gateway → memory/maintenance-policy` + `gateway → speech/policy`：正确的做法。**

```
backend/gateway/src/service.ts:14  import { MAINTENANCE_DECAY_HOURS, MAINTENANCE_TURNS } from '@ourfairy/dsh-memory/maintenance-policy'
backend/gateway/src/service.ts:15-17 import { DEFAULT_API_KEY_ENV, isPositiveInteger, SPEECH_ENDPOINT_PATTERN, ... } from '@ourfairy/dsh-speech/policy'
```

一开始这看起来像越界（gateway 为什么要读 memory 的常量？）。查了 `maintenance-policy.ts` 的头注释，它自己回答了：

> The gateway, memory-maintenance and recovery suites derive their expectations from it, so a consumer that declares its own numbers fails them once the two differ. **The module imports nothing**: the gateway reads it without loading the memory row's runtime graph.

这是**用 seam 换掉常量副本**的正确用法：两行数字（15/5-50，6/3-24）是产品决定，被三个消费者读（memory 的 Config、memory 的 `readMaintenanceSettings`、gateway 的 `maintenanceView`/`saveMaintenance`），而 `tests/gateway-maintenance-settings.test.mjs:36` 直接 import 同一份常量来算期望值——**测试与应用共享权威，不是复制权威**。这个模式应该被复制，不是被清除。

**`attachments → spaces/bwrap` 与 `skill-creator → spaces/bwrap`：跨包用了一个未在对方 `exports` 里声明的意图。**

```
backend/attachments/src/pdf.ts:8    import { buildBwrapArgv } from '@ourfairy/dsh-spaces/bwrap'
backend/skill-creator/src/verify.ts:25  import { buildBwrapArgv, probeBwrap } from '@ourfairy/dsh-spaces/bwrap'
```

`spaces/package.json` 的 `exports` 确实声明了 `./bwrap`，`tsconfig.references` 也都有 `../spaces`（`attachments/tsconfig.json`、`skill-creator/tsconfig.json`）。所以**不是非法依赖**。

但语义上有个缝：`bwrap.ts` 是「怎么在一个受限命名空间里跑命令」，这在产品概念上属于**空间隔离**（`spaces`），却被 PDF 工具与技能验证器直接使用——后两者都不是「用户的某个空间里的文件操作」。`dsh-ecosystem-boundary.md` §3.3 把 bwrap 定位为「scoped 文件系统与 sandbox provider」的实现细节。**结论：不做改动。** 三个调用点需要不同的 spec（pdf 无网络 + 资源限额、verify 有网络 + writable、sandbox 按会话派生），共享 `buildBwrapArgv` 是合理的；如果为了「语义纯净」把 bwrap 提到中立包，只是把 120 行挪个位置。这属于「列出每个理论上不完美的地方」，按用户指令不写进候选。

---

## 4. 「为测试抽出的纯函数，bug 藏在调用处」核实（审查项 2）

这是任务里最尖锐的一条怀疑。我按「纯函数有测试面，但真正的不变式在调用点」这个形状找，结果是**混合的**。

### 4.1 正例：`approvalEvidenceRequired` —— 抽对了，但调用点有一个洞

`creation.ts:333`：

```ts
export function approvalEvidenceRequired(scope: number, sourceType: number): boolean {
  return !(scope === SKILL_SCOPE.personal && sourceType === SOURCE_TYPE.explicit)
}
```

ADR-0004 的核心决定在这个 3 行纯函数里，被 3 处调用（`creation.ts:1039`、`:1545`、`:1782`）。这是正确的做法：决定集中在一处，三处调用都被它守。

**但调用点有一个值得记录的不对称。** `review()` 在 `:1782` 用 `approvalEvidenceRequired` 决定是否要求 `approvalMessageId`，然后 `:1787` 处：

```ts
if (events === undefined || sessionOwnerShortId !== shortId) {
  throw new SkillError(409, 'skills/approval-confirmation-invalid', '...')
}
```

（`:1767` 的增长确认分支是同样的形状。）

`events === undefined` 意味着**调用方忘了传日志**。`tools.ts:307` 传了（`const { events } = await readSessionEvents(deps.ctx, agent.session.id)`），所以正常路径没问题。但如果新增一条调用路径（比如候选 B 拆分后的第三个入口）忘了传，症状是「批准时得到 409，说用户的消息不在日志里」——一个指向用户行为的错误，而实际原因是调用方少传了一个参数。这不是 bug，是**错误信息把调用方缺陷伪装成用户行为**。成本：`events === undefined` 单独抛一个 `skills/internal` 或直接断言。**这条太小，不单独开候选，但建议随候选 B 一起做。**

### 4.2 正例：`taskStatusOf` —— 抽对了，且有测试面

`chat/src/units.ts:105`：

```ts
export function taskStatusOf(status: string): number {
  return Object.hasOwn(TASK_STATUS, status) ? TASK_STATUS[status as keyof typeof TASK_STATUS] : 0
}
```

未知原生状态返回 `0`（unknown）而不是 `undefined`，注释解释了为什么（`undefined` 会让字段从投影里消失，从而**隐藏**一个未收敛的任务）。这是「为测试抽纯函数」做得完全正确的案例：`tests/native-job-status.test.mjs` 直接与 pinned dsh 的声明对账，`dsh-ecosystem-boundary.md` §4 把它登记为可执行检查。**没有 bug 藏在调用处**——两个调用点（`chat/src/jobs.ts:55`、`chat/src/units.ts:805`）都只是使用返回值。

### 4.3 反例（真实缺口）：`attachments/src/pdf.ts` 的终止判定

`pdf.ts:126-129`：

```ts
const terminated = deadline.aborted || callerSignal?.aborted === true
  || outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' || outcome.signal === 'SIGXCPU'
  || outcome.exitCode === 137 || outcome.exitCode === 152
if (terminated || output.lossy) return failure('resource-limit')
```

这段知识（bwrap 把被杀的 payload 重抛成 128+signal、`prlimit` 的 SIGXCPU 是 152、SIGKILL 升级与 OOM 是 137、服务自己的终止是 SIGTERM）**写在一个 async 函数体内**，且该函数还负责：mkdtemp、chmod、pipeline 写文件、spawn、读回 readFrom、映射三种 failure、finally 里 rm 目录。

`grep -rn "137\|152\|SIGXCPU" tests/*.mjs` 的命中里，`pdf.test.mjs:213` 的 `[137, 80, 78]` 是 PNG magic bytes，不是这个判定。也就是说**这个判定没有纯函数级的测试面**，只能通过 `pdf-worker-cancel.test.mjs` 的整机路径（真跑 bwrap + 真 prlimit）覆盖。

这是「为测试抽纯函数」的**遗漏**，不是抽错了。形状很清楚：

```
processOutcome(outcome, { deadline, callerSignal }) → 'resource-limit' | 'worker-unavailable' | 'ok'
```

**成本约 20 行 + 一个测试文件；收益是那段 128+signal 的知识第一次可被单测固定。** 因为它与候选 E 是同一个东西的两半（判定 vs 执行器），我把它们算作一条：**做纯函数抽取（Worth exploring），不做执行器合并（Speculative）。**

**分类标准的修正（`test-quality` 指正，我接受）。** 我原先按「有无直接 importer」给模块分类，但那个标准在这里是错的：`learning.ts`（1030 行）也没有直接 importer，却有很强的整机覆盖，不需要纯函数面；而 `pdf.ts` 这个判定同样没有直接 importer，却**应该有**。两者差别不在导入关系，在于：

> **这段知识是否只存在于注释里，以及写错它会不会有任何东西变红。**

`137` 写成 `1370` 不会有任何编译期或运行期约束触发——`pdf-worker-cancel.test.mjs` 走的是真 bwrap 真 prlimit 的路径，它验证的是「超时能被取消」这个行为，不是「137 和 152 这两个魔数代表什么」。这条判定是**下游工具的退出码契约**，不是产品规则，正因如此它更需要一个被固定下来的、可读的表述。所以抽取的理由不是「提高覆盖率」，而是「给一段无约束的魔数一个唯一权威」。

同一标准下，`learning.ts` 的整机覆盖是**恰当的**（它验证的是跨会话信号收集与子代理协作这类真实行为，不是魔数），不需要为它补直接测试面。

### 4.4 结论修正

任务假设「为测试抽出的纯函数，bug 藏在调用处」。实测下来这个仓库的**主要**形状不是那样——`approvalEvidenceRequired`、`taskStatusOf`、`maintenance-policy` 都是抽对了的。更准确的结论是：**真正的问题不是「纯函数抽多了」，而是「该抽的没抽」（pdf 判定）与「抽了但有第二份拷贝」（候选 A）**。这两条都比「过度抽象」更符合 `AGENTS.md` 的规模校准。

---

## 5. 未测试或难以通过现有 interface 测试的部分（审查项 4）

`grep` 扫了 `backend/*/src/*.ts` 里没有任何测试文件直接 import 的模块，按规模排序前几名：

| 模块 | 行数 | 覆盖方式 | 判断 |
| --- | --- | --- | --- |
| `skill-creator/src/learning.ts` | 1030 | `skill-learning.test.mjs`（1233 行，真启动 + model double 区分主会话与子代理） | **覆盖充分**，不是缺口 |
| `spaces/src/fs.ts` | 641 | `spaces.test.mjs`（整机，含符号链接与越权用例） | 覆盖充分 |
| `attachments/src/service.ts` | 390 | `attachments.test.mjs` + `attachment-download-abort.test.mjs` | 覆盖充分 |
| `skill-creator/src/tools.ts` | 381 | 经 `skill-creation.test.mjs` 的整机路径 | **间接**，且这个文件本来就是 interface 层（候选 B） |
| `sessions/src/service.ts` | 365 | `owned-sessions.test.mjs`、`session-archive.test.mjs` 等 | 覆盖充分 |
| `memory/src/service.ts` | 298 | `memory-crud.test.mjs`（430 行） | 覆盖充分 |
| **`memory/src/material.ts`** | **107** | **无直接 importer** | **真实缺口**（见候选 A） |
| `skill-creator/src/sharing.ts` | 188 | 经整机路径 | 可接受 |
| `skill-creator/src/provider.ts` | 171 | 经 `skill-runtime.test.mjs` | 可接受 |
| `memory/src/preset.ts` | 15 | 无（纯常量） | 无问题 |

**两个真正的缺口，都源于「没有单一 interface 可测」：**

1. **`memory/src/material.ts`** 的 `closedUserTurns` 没有纯函数级测试面，因为它有第二份拷贝住在 skill 包里，而测试只守了 skill 那份（候选 A）。
2. **`attachments/src/pdf.ts` 的终止判定**没有纯函数级测试面，因为判定和执行写在一个 async 函数体里（候选 E 的一半）。

**关于第 1 条的重要限定（`test-quality` 提出，我采纳）。** 「没有直接测试面」在这里是**正确的状态**，不是要修的缺口：

> **不要在合并成单一 module 之前给 `backend/memory/src/material.ts` 补直接测试面。** 那等于把一份即将删除的副本固定在测试里，是负资产。

所以候选 A 的收益必须按「合并完成之后」计量：合并前补测试是错的，合并后测试面自动合一。这条限定很关键——否则本报告第 1 条会被误读成「补测试」的许可。

**一个需要说明的观察：** `SkillCreation`（`creation.ts:1005`）**没有任何测试直接实例化它**。`grep -rn "SkillCreation(" tests/` 零命中。它只经两条路被覆盖：整机 HTTP（`skill-creation.test.mjs`）与 `skill-creation-store.test.mjs`（只测 `store`）。这是「interface 太大所以只能在系统边界测」的典型——`CreateCandidateInput` 有 18 个字段，其中 11 个可选，构造一个合法的输入本身就需要理解三条来源路径。**这是候选 B 的测试侧论据，也是我把它标 Strong 的原因之一。**

### 5.1 比测试面更硬的同源证据：门禁选不中这些测试

`test-quality` 给了一条我认为比「有无直接 importer」更有解释力的证据，我独立复算并确认：

改动 `backend/skill-creator/src/*.ts` 时，`scripts/precommit.ts` 的 related-gate 通过两个 needle 选测试（`:206`、`:212`，`:217` 处做匹配）：`backend/<pkg>/` 路径串，或 `@covers backend/<pkg>` 声明（`:163`）。skill 系列共 14 个测试文件，**实选 9 个，漏 5 个**：

```
SELECTED (9):  skill-creation-store  skill-evolution-display  skill-install
               skill-learning-material  skill-learning-store  skill-learning
               skill-package  skill-runtime  skill-verify
NOT-SEL  (5):  skill-creation  skill-evolution  skill-install-product
               skill-sharing  skill-review-entry
```

漏掉的 5 个恰好是**最重的整机套件**（`test-quality` 实测合计约 164 s：`skill-evolution` 103 s、`skill-creation` 19.8 s、`skill-sharing` 19.5 s、`skill-install-product` 12.0 s、`skill-review-entry` 9.1 s）。

我核对了它们为何漏：这 5 个文件 `@covers` 全部为 0；`skill-evolution`、`skill-install-product`、`skill-creation` 里虽有字符串 `'skill-creator'`，但那是**技能名**（`tests/skill-evolution.test.mjs:1010` 的 `nativeLoad(..., 'skill-creator')`），不是 needle 要的 `backend/skill-creator/` 或 `@ourfairy/dsh-skill-creator`。

**这条为什么支撑本报告的中心论点：** 这 5 个测试与包之间的关联**只存在于「启动器 + HTTP」这条隐式路径里**——它们全都不 import 包内任何模块，所以「body 里出现包路径」这条 needle 看不见它们；它们也没有 `@covers` 声明。也就是说，**它们测试的是一个没有写进任何 interface 的关系**。deepen 的收益因此不止「测试面合一」：它还会让「这个测试属于哪个包」从隐式惯例变成可声明的事实，related-gate 才可能选得准。

（这同时说明为什么「给它们补 `@covers`」不是正解：那只是把隐式关系写成注释标签，包与测试之间的 interface 仍然不存在。真正的修法在候选 B——把整机路径背后那个大 interface 收窄成可在单元层构造的入口。）

---

## 6. Top recommendation

**推荐做候选 A（`ClosedTurn` 投影去重）。**

理由，按重要性排：

1. **它是唯一一个「已经确认发生」的重复，而不是「即将可能发生」。** 三个函数逐字节相同，我验证过。其余候选都涉及「下一轮可能加来源」「可能加工具行」这类推断。
2. **它的收益同时落在 leverage、locality 和测试面上，三者都不需要额外论证。** 一份实现服务 3 个现有调用点；修一次两边同时正确；`memory` 侧第一次获得纯函数级测试面。这在 `codebase-design` 的三个目标上都是净收益。
3. **成本是已知的、有先例的、不需要新决定。** 目标位置已经存在（`@ourfairy/dsh-sessions/events` 已经拥有 `readSessionEvents`，`@ourfairy/dsh-identity/session` 已经证明「纯 codec subpath」这个形状可用）。动作是「挪三个函数 + 改两个 import」，不是设计新层。
4. **不与任何 ADR 冲突。** 它不拆插件、不动作用域适配、不引入 manager，ADR-0003 的措辞张力极小且已经解释过。

**实施顺序建议：**

1. **候选 A**（`ClosedTurn` 去重）—— 最小、最确定、测试面净增
2. **候选 E 的纯函数那一半**（`pdf.ts` 的 `processOutcome`）—— 20 行，固定一段当前只存在于注释里的知识
3. **候选 D 收窄版**（`#quiet` + `TICK_MS`）—— 5 行，消 2 处重复
4. **候选 B**（`skill_manage` → `create` 的三入口）—— 等下一个触发条件（新增第 5 条来源，或需要为 ADR-0004 分级写单元测试时）。**现在做不划算。**
5. **候选 C**（五个按 Agent 注册行的 Boilerplate）—— 等下一个触发条件（新增工具行，或观测到重放导致的重复注册）

**如果在 1-3 与 4-5 之间只能选一边：做 1-3。** 前三项加起来约 60 行改动，零架构决定，三项都直接消掉已确认的重复；后两项各自需要一个新决定（入口怎么切分、guard 放哪），而触发条件还没到。

### 收口裁决（2026-11-04，Lead 定，本报告据以收敛）

- **候选 C：本轮不做。** ADR-0003 的边界是「不另拆产品插件」，而 `toolRegistrar` 是 20 行纯函数、无插件、无 lifecycle，**不触该 ADR 的授权边界**，保留为 Worth exploring 是恰当的。但改动它会碰到 5 个工具的注册行为，属需要独立验证范围的改动，放到下一轮，不在本次「审查 + 维护」批次里扩散。
- **`combo.json`：已裁定为清理，不进架构待办。** `repos.ourfairy.localPath` 删除；`repos.dsh.localPath` 保留但改语义为「默认检出位置提示」，并在 durable 文档补 `OURFAIRY_DSH_DIR` 覆盖说明（该覆盖此前在 durable 文档里一次未出现）。交 `docs-keeper` 执行。
- **第 7 节的三处文档漂移 + 我补的第 4 处：归 `docs-keeper` 收，本报告不碰文档。**

因此本报告实际进入实施的是 **1–3 项**（候选 A、E 的纯函数那一半、候选 D 收窄版）。

---

## 7. 与 `docs-keeper` 的交接：三条文档事实漂移（属文档轴，不进本报告的候选）

`docs-keeper` 报来三处架构事实漂移，我逐条实测，**全部确认**。它们不属于 deepening 候选（都是「文档说的是旧事实」，不是「interface 形状不对」），但其中第一条与本报告第 0 节直接相关，所以登记在此以免丢失。

| # | 位置 | 文档说 | 实测 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `docs/architecture/agent-capabilities.md:25-32` | 「除上面两种外还没有第二种 agent 落地」，表是两分法 | 已有第三种：`SKILL_LEARNING_PRESET`（`learning-policy.ts:23`），落地 3 处（`deep-creation.ts:389`、`learning.ts:735`、`learning.ts:816`），#300 引入 | 见下 |
| 2 | 同文件 `:59` | 用户主会话工具目录「仍是 26 个工具（含 #297 的 `skill_manage`）」 | **27 个** | `tests/model-double.test.mjs:64-92` 的 `deepEqual` 列表逐条数过 = 27 |
| 3 | `docs/agents/domain.md:28-44` 文件树 | 2 个 ADR / 2 个 glossary | 4 个 ADR（0001–0004）/ 3 个 glossary（`external-senses`、`memory`、`skill`） | `ls docs/adr/*.md` = 4；`docs/glossary/*.md` = 3 |

**第 1 条我补一个同段落里的第三处漂移**：同文件 `:38-39` 说「search、groups、delivery 在注册工具前调用 `isUserSession(agent.session.header)`」，但实测 import 者是 **7 个包 10 个文件**（`chat`、`delivery`、`groups`、`memory`、`search`、`skill-creator` 六个包 + `identity` 自己是定义方）。文档少列了 `memory`、`skill-creator`、`chat/prompt-guard`。

**这三条我为什么建议由 `docs-keeper` 收、而不并入本报告：** 它们不是 interface 形状问题。修它们不需要任何架构决定，只需要把文档对齐到代码（第 1、2 条）或对齐到目录实况（第 3 条）。

**一条与我报告结论相关的观察**（供 docs-keeper 判断第 1 条的严重性）：第三种 agent 落地**没有付出任何消费者改动**——`isUserSession` 是闭合判定，skill-learning 子代理直接被判 false，10 个消费者一处都不用改。所以第 1 条是**文档滞后**，不是**架构缺口**。这个区分影响修复的紧急度：它是「读到的人会以为只有两种 agent」的误导，不是「代码里有未处理的种类」。

**边界确认：** `docs/architecture/dsh-ecosystem-boundary.md` 我这个候选清单里**没有任何一项要动它**。它的两个机器守卫我核实过：`tests/ecosystem-boundary.test.mjs:29-142`（对账它引用的每个测试标题仍存在、并核对它不复制 row/包集合）与 `tests/route-inventory.test.mjs:175-183`（断言它的路径行必须点名 inventory）。**这篇文档是「声称须可执行」的样板，不是可精简对象**——我同意 `docs-keeper` 的判断，而且本报告的候选 A–E 都不触及它。

**关于 `combo.json` 的 `localPath`：** `scripts/combo.ts:101-103` 与 `:106-117` 已核实——`isSelfEntry()`（`:101-103`）判定 `lock === 'integration-branch'` 的条目直接 `return root`，**`repos.ourfairy.localPath` 从不被读取**，是纯残留。这属于「配置里有一份从不生效的权威」，是清理而非 deepening（没有 interface 要改、没有 seam 要挪）。我不把它列进候选，建议交 Lead 收口时决定。

---

## 附：本次审查的核实方法

为了让结论可复查：

- **import 图**：`grep -rn "@ourfairy/" --include=*.ts backend/*/src/ | grep -v '\.test\.'`，逐条读过，区分值 import 与 `import type {}`（cordis 的 Context augmentation）。全文引用的每一处跨包依赖都带真实行号。
- **deletion test**：对每个候选问「删掉它，复杂度是集中还是搬家」，答案写在各候选里。判为 shallow 的必须给出「interface 约等于 implementation」的具体位置。
- **重复判定**：对 `material.ts` 的三组函数、两个 `closedUserTurns`、`#quiet` 都做了字面 `diff`，不是凭阅读印象。
- **规模对照**：`find backend -name '*.ts' -path '*/src/*' | xargs wc -l` → 20 957 行；`wc -l tests/*.mjs` → 29 589 行 / 101 个文件。
- **ADR 冲突**：逐条读了 `docs/adr/0001`–`0004` 与 `docs/architecture/dsh-ecosystem-boundary.md`（后者比 ADR 更细，逐节对照过 §1.2、§3.1、§3.3、§4）。
- **dsh 上游行为**：读 `/home/fatfish/dsh-d80522d2` 的 `packages/core/tools/src/index.ts:744-750`（同名注册抛错）、`packages/core/agent/src/runtime-types.ts:125`（`SessionStartSource` 含 `'resume'`）、`packages/core/agent/src/index.ts:415-421`（`resume` 走工厂）。
- **未做**：没有跑全量 `npm test`（Lead 在后台跑），没有启动后端，没有改任何源码，没有 `git add` / `git commit`。
- **与 `test-quality` 的交叉核对**：它独立复核了我的 `material.ts` diff 结论与「零 importer」判断，并纠正了我的分类标准（见 §4.3 末尾与 §5 的限定）；它给的门禁证据（9/14 选中的实测数字）我按 `scripts/precommit.ts:163`、`:206`、`:212`、`:217` 的选取逻辑独立复算，**9 个选中 / 5 个漏掉完全吻合**，且逐个核对了那 5 个文件缺 needle 的具体原因（技能名字符串被误认为包路径）。

### 一处相邻但不同轴的发现（属 `test-quality`，登记备查）

`tests/groups-row.test.mjs:99` 与 `tests/row-addressability.test.mjs:408` 是**几乎同标题的同一场景**：

- `groups-row`：`disabling the groups row removes the group tools and roots, not the file spaces or scripts`
- `row-addressability`：`disabling the groups row removes its tools and roots, not the file spaces or scripts`

只差 `the group` → `its`，所以按标题去重扫不出来。实测耗时 15.4 s 与 59.6 s。

这是**测试侧的拷贝**，不是实现侧的——与本报告候选 A（实现侧拷贝）是两个不同的问题，修法也不同（删掉弱的那份，而不是合并 module）。我把它登记在此以免丢失，判断与处置权归 `test-quality`。
