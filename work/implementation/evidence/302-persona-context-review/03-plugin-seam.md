# 03 · 插件化人格装配接缝与 dsh waterfall 可行性核验

状态：只读调查。仓库 `/home/fatfish/OurFairy` 未改动任何文件。
作者：seam-architect。对应 task-3。

---

## 0. 证据版本（先读这一节，否则所有行号都可能对不上）

同一台机器上存在**三个不同的 dsh 版本**，行号不能混用：

| 来源 | 版本 | 位置 | 本文如何使用 |
| --- | --- | --- | --- |
| 只读检点 `deepseek-harness`（工作树，分支 `master`） | `0.2.1-alpha.2` | `/home/fatfish/deepseek-harness` | **默认引用**，行号以此为准 |
| `combo.json` 锁定的产品提交 `d80522d2` | `0.2.1-rc.2` | 同上仓库的 `git show d80522d` | 仅在与 alpha.2 有差异处单独标注 |
| 全局安装 `@deepseek-ai/dsh` | `0.2.1-rc.5` | `/home/fatfish/.npm-global/...` | **不引用**（无源码，仅 lib 产物） |

**关键事实**：`OurFairy/node_modules/@deepseek-ai/dsh-system-prompt` 是指向只读检点的符号链接
（`→ /home/fatfish/deepseek-harness/packages/core/system-prompt`），所以「产品看到的源码」就是
alpha.2 工作树。但 `combo.json` 锁的是 `d80522d`（rc.2），两者**不完全相同**。

已核对差异（`git diff HEAD d80522d`）：

- `packages/core/system-prompt/src/index.ts`：pin 版比工作树多 4 行 —— `CONTEXT_ORDERS` 里多了
  `TEAM_IDENTITY: 125`、`HARNESS_SOURCE: 200`、`WEB_SURFACE: 210`（pin:175-178）。
  工作树的 `HARNESS_SOURCE/WEB_SURFACE` 只作为 **section** 存在于 `SECTION_ORDERS`
  （index.ts:162-163，值 10000/10100）。
- `packages/subagent/subagent/src/child-agent.ts`：59 行差异；pin 版给 `ChildComposition` 增加了
  `agentPreset` 字段，`persona`/`toolFilter` 的语义收窄为「仅冷恢复时重放的历史描述符」。
- `packages/core/scope/`：只有 `package.json` 变化，`src/` 完全相同 —— **scope 语义两版一致**，
  这是本文 (b) 结论最关键的依赖，已单独核对。
- `packages/preset/agent-preset-registry/src/index.ts`：7 行差异，`composeFrom`/`bind` 的行号
  在 pin 版可能位移，引用时请注意。

**因此**：本文对 `assemble()` 行为的所有结论都建立在 `packages/core/system-prompt/src/index.ts`
与 `packages/core/scope/src/{index,store}.ts` 上，前者的差异只是常量表追加、后者 `src/` 零差异，
所以结论对 rc.2 / alpha.2 同时成立。行号默认写 alpha.2 的；pin 版同位置行号在脚注给出。

---

## 1. 结论摘要（一句话版）

**(b) 的答案：能接管，但只能接管「一次装配的全量结果」，不能接管「别人的注册」。**

产品**可以**在自己的插件里，用 `ctx.on('system-prompt/assemble', ...)` 统一改写别的插件注册的
section/context 的顺序、内容，甚至整个删掉 —— 因为 waterfall 的返回值是权威的
（`system-prompt/src/index.ts:673-683`，`ctx.waterfall` 位于 :673-676，返回的 `transformed`
在 :677-683 被采纳）。但它**不能**改变「谁注册了什么」，只能改变「这一次装配输出什么」；
且有一个**绕过点**：一旦有 `complete: true` 的 section 生效，产品在 waterfall 里做的一切
`section` 改写都会被丢弃、只剩那一条（:677-683 的 `[completeSection]` 覆盖）。

推论：把「Fairy 的声线装配」做成接缝是**成立**的 —— 前提是产品**不要**用 `complete: true`，
改用 waterfall 统一编排。这与仓库当前实现一致（产品零个 `complete`），但与
`docs/research/persona-context-and-injection-resistance.md`（该文档 :60、:213 把
「`complete: true` + `includeHarnessIdentity: false`」当作推荐做法）**冲突**。
那段建议若被采信，会抹掉 Fairy 今天全部 5 条工具用法指引（§3.3、§4）。

---

## 2. (b) `system-prompt/assemble` waterfall 到底能改到什么粒度

### 2.1 源码事实

**装配顺序（源码确实如此）** —— `packages/core/system-prompt/src/index.ts:610-684`：

1. `:612` 取 scope 层链 `this.layers.chainLayers(scope)`
2. `:616-625` 合并变量（全局先、scope 链后，近者胜）
3. `:627-628` 合并 section 与 context 名表（`layers.merge`：同名 scoped 遮蔽 global，见
   `scope/src/store.ts:208-217`）
4. `:648` `sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections)`
   —— 排序键 `(order, name)`（`:243-246`），`name` 用 code-unit 比较（`:238-241`），
   与注册先后**无关**（测试 `tests/system-prompt.spec.ts:304-311`）
5. `:664-672` 构造 `assembly`：`sections` / `contexts`（按 order 排序，`:666-669`）/ `tools`
   （`orderTools`，`:670`）/ `variables`
6. `:673-676` **`await this.ctx.waterfall(scopeTarget(this, scope), 'system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))`**
7. `:677` 若无 complete 且未抑制 runtime context → **直接返回 `transformed`**
8. `:679-683` 否则用 `transformed` 打底，但把 `sections` 换成 `[completeSection]`、
   `contexts` 过滤成仅 `required`

**粒度**：`assembly` 是可变对象（`PromptAssembly`，`:124-129`），listener 拿到它、`next()`
之后拿到的是下游结果，返回什么就是什么。因此可以：

| 能做什么 | 依据 |
| --- | --- |
| 改写任意 section 的 `text` | `:125` `AssembledSection.text` 可写；测试 `tests/system-prompt.spec.ts:501-506` 明确 `complete.text = 'mutated'` |
| 删除任意 section | `browser-use-runtime/src/mcp.ts:215-219` 就是 `assembly.sections.filter(s => s.name !== ...)` |
| 追加 section / context | `tests/system-prompt.spec.ts:466`、`tests/scoped.spec.ts:236` |
| 整体重排 sections（数组顺序即渲染顺序） | `renderPrompt` 按数组顺序 map+join（`:286-291`） |
| **不能**重排 contexts（对最终渲染无意义） | `joinContextSections` 也按数组 join（`:310-314`）；但 `assemble()` 的 `:666-669` 已按 order 排过，listener 改顺序会在 `refreshContext` 后失效（见 2.3） |
| 改写 tools 列表、variables | 类型允许（`:127-128`）；`model-selection.ts:82-96` 就改写 `variables` |
| **不能**阻止别人的 section provider 被调用 | 所有 provider 在 `:654-663` 已执行完毕，waterfall 在其后 |

**返回值是否权威**：是，但有两个例外（源码确实如此）：

- **例外 A —— complete section**：`:681` `sections: completeSection === undefined ? transformed.sections : [completeSection]`。
  只要存在一条生效的 `complete: true`，你返回的 `sections` 被**整体丢弃**。
  文档注释也写明（`:22-26`「A registered complete section is restored after this waterfall,
  so listeners cannot add to or replace that scope's system prompt」）。
  测试固定了这一行为：`tests/system-prompt.spec.ts:496-512` —— listener 改了
  `complete.text = 'mutated'` 并 push 了 `late`，最终结果是 `[{name:'complete', text:'Exact prompt.'}]`。
- **例外 B —— runtime context 抑制**：`:682` 若 `runtimeContextSuppressed`，返回的 `contexts`
  被过滤成只剩 `required` 的。测试 `tests/system-prompt.spec.ts:253-270`。

**complete section 何时恢复**：就在 `assemble()` **返回前**（`:677-683`），且恢复的是
**注册时 `:661` 保存的快照** `{...assembled}`，不是 waterfall 里被改过的对象。
即：complete 的快照在 waterfall **之前**拍下，waterfall 之后无条件覆盖回去。

**scoped listener 的过滤条件（源码确实如此）**：

- `assemble()` 用 `scopeTarget(this, scope)` 造 event carrier（`:674`）。
- `scopeTarget`（`scope/src/index.ts:170-185`）生成一个只带 `[Context.filter]` 的 carrier：
  - `:174` 先跑 service 自己的 filter（`Service[symbols.filter]`，`vendor/cordis/src/service.ts:61-63`，
    按 isolate realm 比较）；
  - `:175-176` `scopeOf(ctx) === undefined` 的 listener（**未打 scope 标签的）一律放行** —— 即全局 listener 收到每一次装配；
  - `:177-180` 打了标签的 listener，只有其 key 在**派发 key 向上（to root）的祖先链**上才放行。
- 方向：**事件沿链向上流，不向下**（`scope/src/index.ts:163-165` 注释 + `:37-38`）。
  即：`agent.ctx` 上的 listener 只收到该 agent 的装配；预设层（preset scope）上的 listener
  能收到挂在它下面的每个 agent 的装配；全局 listener 收到所有装配。
- 测试固定：`tests/scoped.spec.ts:229-245` —— `scope.ctx.on(...)` 的 listener 只在
  `assemble({scope})` 时有 `listener:extra`，全局 `assemble()` 时没有。
- **`prepend` 决定链位置**（`vendor/cordis/src/events.ts:112-117`、`:254-256`、`:234-243`）：
  waterfall 的 `_hooks` 数组顺序即嵌套顺序，`prepend: true` 用 `unshift` 插到最外层（最先跑）。
  多个 listener 串联，每个 `await next()` 拿下游结果再加工 —— `tests/system-prompt.spec.ts:457-481`
  断言了「A 先跑、B 后跑且看见 A 的贡献」。

### 2.2 我推断的部分（明确标注）

- **推断 I1**：`complete` 快照「在 waterfall 前拍下」这一实现意味着 —— 如果产品的 waterfall
  listener 想**改写 complete section 的文本**，做不到；想**把 complete 换掉**，也做不到。
  唯一能做的是让那条 `complete` section 注册不生效（用 scoped 遮蔽，见 2.3）。这一点源码没有
  直接测试，是从 `:661`（快照）与 `:681`（覆盖）两处代码组合推断的。
- **推断 I2**：waterfall 里对 `contexts` 的**顺序**改写是易碎的 —— `refreshContext()`
  （`:578-598`）会在 `agent-loop` 每次请求前重跑（`agent-loop/src/agent.ts:407-411`），
  它按 accepted 顺序遍历但会用当前注册顺序的 `required` 补齐（`:590-596`），
  中间插入的顺序可能不保。因此「统一排序」应当只针对 **sections**（渲染顺序已固定），
  不要承诺 contexts 的顺序稳定。**这条是推断，没有测试固定，不要写进接口契约。**
- **推断 I3**：产品若要「接管所有者的排序」，最稳的落点是**全局 listener**
  （未打 scope 标签 ⇒ `scope/src/index.ts:175-176` 无条件放行），因为 `agent.ctx` 上的 listener
  只能看见自己的 agent；而全局 listener 能否影响**特定** agent 的装配，取决于它读 `context.agent`
  / `context.scope` 自己判定（`AssembleContext` 里 `agent` 由 `core/agent/src/runtime-types.ts:19-22`
  扩展进来，`assembleContextFor` 在 `core/agent/src/dispatch.ts:174-176` 同时设 `agent` 与 `scope`）。
  **这条是推断，需要落地时用测试钉住。**

### 2.3 一个必须知道的副作用

`refreshContext()`（`:578-598`）在每次请求前都会跑，参数是「已接受的 assembly」。
它的注释（`:568-576`）写明：**「Contexts added only by the assembly waterfall retain their
accepted values」** 与 **「Sections, tools, and interpolation variables retain the accepted
assembly; their providers and waterfall do not rerun.」**

⇒ 这是 (b) 的一个**限制**：waterfall 每**步**只跑一次（`assemble()` 在 `agent.ts:272`，每 step
一次），不是每次请求；之后同一步内的重试不会重跑 waterfall。但 section 的改写会被带下去
（因为 sections 整体保留），context 的改写也会被带下去（accepted 值沿用）。所以「waterfall
接管」对 **section** 是稳的，对 **context** 也是稳的但顺序可能被 `refreshContext` 的 required
补齐逻辑打乱（推断 I2）。

---

## 3. (a) 今天第三方插件注入的文本落在哪里、什么 order

### 3.1 `SECTION_ORDERS` / `CONTEXT_ORDERS` 常量表

`packages/core/system-prompt/src/index.ts:131-165`（section）与 `:170-175`（context）。
核心值：

```
HARNESS_IDENTITY            -1000   DEPLOYMENT_PERSONA_PREFIX      0
DEPLOYMENT_PERSONA_SUFFIX   10200   PLAN_POLICY                  500
TEAM_POLICY                  600    PTC_ONLY                     800
FILE_REFERENCE               900    TOOL_BASH                   1000
TOOL_READ                   1100    TOOL_WRITE                  1200
TOOL_EDIT                   1300    TOOL_GLOB                   1400
TOOL_GREP                   1500    TOOL_JOBS                   1600
TOOL_PTY                    1700    TOOL_WEB_SEARCH             2000
TOOL_WEB_FETCH              2100    TOOL_LSP                    2200
TOOL_SESSION_QUERY          2300    TOOL_GOAL                   2400
TOOL_WORKFLOW               2600    TOOL_RALPH                  2700
TOOL_SUBAGENT               2800    TOOL_REPORT                 2900  ← 声明但无插件注册
TOOL_COMPUTER_USE           3000    MCP_SERVERS                 3100
TOOLS_SDK                   5000    DELIVERABLE_FILE_REFERENCES 9000
STRUCTURED_OUTPUT           9900    HARNESS_SOURCE             10000
WEB_SURFACE                10100

CONTEXT: WORKING_DIRECTORY 100, SANDBOX_POLICY 110, APPROVAL_POLICY 115, SUBAGENT_DELEGATION 120
（pin 版另有 TEAM_IDENTITY 125、HARNESS_SOURCE 200、WEB_SURFACE 210 作为 context）
```

`getSectionOrder`/`getContextOrder` 是直接索引（`:490-492`、`:499-501`），对已声明 key
永不返回 `undefined`。

### 3.2 注入通道全表（file:line ｜ name ｜ order ｜ 种类 ｜ 层）

**这是 dsh 生态里「可能存在的」通道全集**，不等于 OurFairy 今天挂载的那些 ——
哪些真正生效见 §3.3 的核对表。

| # | 来源 | name | order | 种类 | 层 |
| --- | --- | --- | --- | --- | --- |
| 1 | `system-prompt/src/index.ts:446-450` | `harness:identity` | **-1000** | section | GLOBAL（自身 ctor） |
| 2 | `system-prompt/src/index.ts:452-457` | `deployment:persona-prefix` | **0** | section | GLOBAL（自身 ctor） |
| 3 | `system-prompt/src/index.ts:458-462` | `deployment:persona-suffix` | **10200** | section | GLOBAL（自身 ctor） |
| 4 | `preset/persona/src/index.ts:63-68` | `deployment:persona-prefix` | **0** | section | SCOPED only |
| 5 | `preset/persona/src/index.ts:69-73` | `deployment:persona-suffix` | **10200** | section | SCOPED only |
| 6 | `preset/persona/src/index.ts:67` | （`complete: true` 标志） | — | 标志 | SCOPED |
| 7 | `preset/persona/src/index.ts:74` | `suppressRuntimeContext()` | — | 抑制器 | SCOPED |
| 8 | `mcp/mcp-client/src/server-context.ts:33-38` | `mcp:${server}` | **3100** | section（`interpolate:false`，文本来自活的 `instructions()`） | 挂载它的 ctx（preset/agent/host） |
| 9 | `mcp/mcp-resources/src/index.ts:60-70` | `mcp-resource-servers` | **3100** | section（只列 server 名） | `McpResourceRuntime` ctor 的 ctx |
| 10 | `subagent/subagent/src/child-agent.ts:204-208` | `subagent:delegation` | **120** | **context** | CHILD agent scope |
| 11 | `subagent/subagent/src/child-agent.ts:210-214` | `deployment:persona-prefix` | **0** | section（仅当 `composition.persona !== undefined`） | CHILD agent scope |
| 12 | `subagent/subagent/src/structured.ts:109-113` | `tool:structured_output` | **9900** | section | CHILD agent scope |
| 13 | `subagent/tool-subagent/src/index.ts:372-385` | `tool:${toolName}` | **2800** | section | 挂载 ctx |
| 14 | `experimental/tool-agent-team/src/index.ts:168-172` | `team:policy` | **600** | section | **AGENT scope**（`agent.ctx`，:163-164） |
| 15 | `plan/plan-mode/src/index.ts:216-224` | `plan:policy` | **500** | section | 挂载 ctx |
| 16 | `session/working-directory/src/index.ts:90-95` | `working-directory:current` | **100** | **context**（`required:true`） | 挂载 ctx |
| 17 | `sandbox/sandbox-policy/src/index.ts:142-152` | `sandbox:policy` | **110** | **context** | `ctx.inject` 的 scope |
| 18 | `interaction/user-approval/src/index.ts:163-173` | `approval:policy` | **115** | **context** | `ctx.inject` 的 scope |
| 19 | `context/file-reference-local/src/index.ts:71-76` | `context:file-reference` | **900** | section | AGENT scope（`agent.ctx.inject`） |
| 20 | `boot/app-boot/src/index.ts:1064-1069` | `harness:source` | **10000** | section | 传入的 ctx |
| 21 | `bundle/web-app/src/index.ts:251-256` | `app:web-surface` | **10100** | section | GLOBAL |
| 22 | `core/tools/src/index.ts:857,879-880` | `tools:ptc-only` | **800** | section（仅 `defaultMode !== 'native'`） | GLOBAL + per-scope（`presentAs`，:1005） |
| 23 | `core/tools/src/index.ts:858,899-900` | `tools:sdk` | **5000** | section（同上） | 同上 |
| 24 | 各 `tool-*` 包 | `tool:read`(1100) / `tool:write`(1200) / `tool:edit`(1300) / `tool:glob`(1400) / `tool:grep`(1500) / `tool:bash`(1000) / `tool:jobs`(1600) / `tool:pwsh`(1010) / `tool:pty`(1700) / `tool:web_search`(2000) / `tool:web_fetch`(2100) / `tool:lsp`(2200) / `tool:session-query`(2300) / `tool:goal`(2400) / `tool:workflow`(2600) / `tool:ralph`(2700) / `tool:computer-use`(3000) | 见左 | section | 挂载 ctx |

**不在 section/context 里的两条重要注入通道**（容易漏，且对「语段中间被插入」问题最关键）：

- **Skills 完全不是 section**：`<available_skills>` 目录是 **`agent/pre-step` 里追加的 user 消息**
  （`skill/tool-skill/src/index.ts:215-254`，渲染 :256-280），`/name` 触发的主体同样作为
  instructions 消息注入（:179-213）。只有 `skill` 工具自己的 description 是 schema 文本（:84）。
  ⇒ skill **永远不会**插进 system prompt 的语段中间；它排在 system prompt 之后的 user 轮次里。
- **MCP resources 不是 section**：三个工具的结果（`mcp/mcp-resources/src/tools.ts:33-62`）。
  只有 server 名清单是 section（#9）。

### 3.3 会不会插进 Fairy 语段中间、或顶掉它

**答：不会插进中间，但会「排到后面」，而且今天产品的 0/1/2/3 全部落在原生最小 order 之前。**

产品的实际注册（全部经 `agent.ctx` / inject scope，非全局）：

| name | order | 来源 | 文本种类 |
| --- | --- | --- | --- |
| `ourfairy:persona` | **0** | `backend/chat/src/runtime.ts:296` | 静态 `FAIRY_PERSONA`（`backend/chat/src/persona.ts:2`），`interpolate:false` |
| `ourfairy:identity` | **1** | `backend/chat/src/runtime.ts:297-298` | **注册时求值的模板字面量**（捕获 `owner.shortId`），`interpolate:false` |
| `ourfairy:impression` | **2** | `backend/memory/src/impression.ts:152-156` | 函数 `() => service.promptText(shortId)`，`interpolate:false` |
| `ourfairy:memory-policy` | **3** | `backend/memory/src/tools.ts:119-123` | 静态 `MEMORY_POLICY`，`interpolate:false` |
| `ourfairy:memory-maintenance` | **0** | `backend/memory/src/maintenance.ts:457-462` | 静态，仅在维护子 agent |
| `ourfairy:spaces` | **0**（context） | `backend/spaces/src/index.ts:38` | 函数 `({agent}) => string` |

产品**零次**调用 `getSectionOrder`/`getContextOrder`，**零次** `complete`，**零次**
`system-prompt/assemble`。order 全是硬编码字面量。

⇒ **当前 OurFairy 实际生效的 section 集合**（已逐条核对 `cordis.patch.yml` 的挂载行；
这是本文最容易出错的地方，所以把「不生效」的也列出来）：

```
order  name                       来源                          生效?
-1000  harness:identity           system-prompt ctor            ✗ includeHarnessIdentity:false
   0   deployment:persona-prefix  system-prompt ctor            ~ 注册了但 personaPrefix:'' → 空文本被 renderPrompt 丢弃
   0   ourfairy:persona           chat/runtime.ts:296           ✓
   1   ourfairy:identity          chat/runtime.ts:297           ✓
   2   ourfairy:impression        memory/impression.ts:152      ✓（无 impression 时返回 ''，被丢弃）
   3   ourfairy:memory-policy     memory/tools.ts:119           ✓
 800   tools:ptc-only             core/tools ctor               ✗ tools 行无 mode 配置 → 默认 'native'（:812,:856）
 800   tools:ptc-only             tools.presentAs()             ✗ 产品从不调用 presentAs
1000   tool:bash                  tool-bash（已挂载 :351-352）    ✓
1100   tool:read                  tool-fs（已挂载 :347-348）      ✓
1200   tool:write                 tool-fs                       ✓
1300   tool:edit                  tool-fs                       ✓
1600   tool:jobs                  tool-jobs（已挂载 :356-357）    ✓
5000   tools:sdk                  core/tools ctor               ✗ 同 ptc-only，原生模式不注册
10000  harness:source             app-boot                      ✗ OurFairy 不挂 app-boot/web-app 行
10100  app:web-surface            bundle/web-app                ✗ 同上
10200  deployment:persona-suffix  system-prompt ctor            ~ personaSuffix 未配置 → 空文本被丢弃
```

**核对方法**：`grep -n "name: '@deepseek-ai" backend/v1-bundle/cordis.patch.yml` 得 54 个挂载 id；
其中注册 section 的只有 `tool-fs`、`tool-bash`、`tool-jobs` 三条（`tool-todo` 不注册 section，
`tool-working-directory` 也不注册 —— 它只提供工具）。`tools:sdk`/`tools:ptc-only` 只有在
`mode` 配成 `ptc` 或调用 `presentAs()` 时才出现（`core/tools/src/index.ts:812` 默认 `'native'`，
`:856` 的 `if (this.defaultMode !== 'native')` 是唯一入口）。

⇒ 所以**今天的真实渲染顺序只有 6 段**，且 Fairy 的四段（0/1/2/3）后面紧接 tool 指引（1000+）：

```
deployment:persona-prefix(0,空→丢弃) → ourfairy:persona(0) → ourfairy:identity(1)
  → ourfairy:impression(2) → ourfairy:memory-policy(3)
  → tool:bash(1000) → tool:read(1100) → tool:write(1200) → tool:edit(1300) → tool:jobs(1600)
  → deployment:persona-suffix(10200,空→丢弃)
```

**这对 (c) 是决定性的**：`complete: true` 今天会连带抹掉的**具体**是
`tool:bash` / `tool:read` / `tool:write` / `tool:edit` / `tool:jobs` 这 5 条 —— 正好是
Fairy 唯一能用的 5 个工具的用法说明。不是「一堆工具指引」，是「全部工具指引」。

**「插进中间」风险的真实来源不是 section，而是同 order 的 name 比较**：
`ourfairy:persona`(0) 与 `deployment:persona-prefix`(0) 同 order，靠 code-unit 比较定序
（`:243-246`、`:238-241`）。任何第三方插件只要注册一个 order 0 且名字以 `a`–`n` 开头的
section，就会插到 `ourfairy:persona` **前面**；名字以 `p`–`z` 开头的会插到 persona 与
identity 之间（因为 identity 是 order 1）。这不是理论风险：`§3.2` 表里 #4/#11 两条都以
order 0 存在于不同层，靠 scope 遮蔽而不是顺序解决冲突。

**「顶掉」风险**：只有两种路径。
1. **`complete: true`**（§2.1 例外 A）—— 一旦某 agent scope 里有生效的 complete，
   `ourfairy:persona`/`identity`/`impression`/`memory-policy` **全部消失**，只剩那一条。
   今天只有 `preset/persona` 会设它（`preset/persona/src/index.ts:67`），而 OurFairy
   **没有**挂载任何 preset/persona 行（`cordis.patch.yml` 里只有 `system-prompt` 行，
   无 `dsh-persona`/`agent-preset`），所以今天不会发生。但这是**唯一**能一次性抹掉整条声线的开关。
2. **`suppressRuntimeContext()`** —— 只影响 context，不影响 section。产品自己的
   `ourfairy:spaces` 会因为 `required` 未设而被抑制掉（`:667`）。（产品今天没调用它。）

**结论**：第三方注入**不会**插进 Fairy 语段中间 —— 因为 Fairy 的 4 段是 order 0–3 连续块，
中间只可能被「同为 0 或 1 的第三方 section」挤入，而那种情况今天只来自 preset persona
（产品未挂载）。真正的风险是 **order 0/1 的语义被大量第三方共用**，产品没有
`getSectionOrder` 那样的「中心分配位」。

---

## 4. (c) `complete: true` 的代价与收益

**收益（源码确实如此）**：一条 section 成为**唯一**的 system prompt 文本。
`assemble()` 在 `:649-652` 校验「多于一条 complete 则抛错」，`:661` 快照，`:681` 覆盖。

**抑制什么**（逐项，附行号）：

| 被抑制 | 依据 | 说明 |
| --- | --- | --- |
| **所有其他 section** | `:681` `[completeSection]` | 在 OurFairy 今天的具体后果见 §3.3：`tool:bash`(1000)、`tool:read`(1100)、`tool:write`(1200)、`tool:edit`(1300)、`tool:jobs`(1600) 五条**全部**消失 |
| 其他 complete section | `:649-652` 抛错 | 两条生效 complete 直接让装配失败 |
| **不**抑制 contexts | `:682` 只在 `runtimeContextSuppressed` 时过滤 | 运行时上下文仍然注入（`ourfairy:spaces` 会保留，除非有人调 suppress） |
| **不**抑制 tool schema | `:670` 在 waterfall 之前算好，`:680` `...transformed` 保留 | 工具仍然**可调用**，只是没有用法说明 —— 这正是最坏组合 |
| **不**抑制 variables | `:671`、`:680` | 变量仍可插值 |

注释也确认 cooperative 语义（`:69-75`）：「Assembly still runs the cooperative waterfall so
tools, contexts, and variables can be resolved, then restores this exact section as the sole
prompt section.」

**对第三方插件兼容性的具体破坏**：

1. **工具「可用但不可知」**。工具 schema 保留（`:670`/`:680`），但 `tool:bash`/`tool:read`/
   `tool:write`/`tool:edit`/`tool:jobs` 五条 section 全部消失。`core/tools/src/index.ts:867-877`
   的注释记录了同构故障：模型看到工具却没有用法说明 ⇒ 发出错误调用 ⇒ 得出部署不一致结论。
   **在 OurFairy 今天，这等于抹掉 Fairy 全部 5 个工具的用法**。
2. **`tools:ptc-only`(800) / `tools:sdk`(5000)** —— 今天 OurFairy 是原生模式，两者**都不生效**
   （`core/tools/src/index.ts:812` 默认 `'native'`），所以这条对现状无影响；但若将来切到 PTC
   模式，complete 会让模型看到 `run_code` 却不知道只能用 `run_code`（`core/tools/src/index.ts:867-871`
   直接描述了这一故障）。
3. **`deployment:persona-suffix`(10200) 消失** —— OurFairy 今天未配置 suffix（空），
   但任何**将来**放进 suffix 的收尾约束会静默丢失。
4. **子 agent 继承被破坏**：`child-agent.ts:210-214` 给子 agent 注册
   `deployment:persona-prefix`（order 0）；若父子都有 complete，`:649-652` 直接抛错让
   **子 agent 装配失败**（是抛错，不是降级）。
5. **预设 persona 的 `complete` 会连带抹掉产品的四个 section** —— 就是 §3.3 的「顶掉」路径。

⇒ **判断：`complete: true` 不能用于「让 OurFairy 独占 prompt」这个目的。** 它实现的是
「一条文本取代一切」，不是「我优先」。想独占又想保留工具指引，唯一正确的做法是
**waterfall 统一编排**（§2），而不是 complete。

---

## 5. (d) 窄接口设计

### 5.1 先回答「不注册接口、直接把 `ctx.systemPrompt.section` 暴露给第三方」的后果

这是**今天的事实**（产品零个接缝抽象，第三方直接写 `agentCtx.systemPrompt.section`）。
后果按严重度：

1. **重名即抛，且抛在第三方加载时**。`NamedEntries.insert` 对同层重名直接 throw
   （`core/scope/src/store.ts:43-46`），错误文案（`system-prompt/src/index.ts:403-408`）
   提示「register through that agent's `agent.ctx` instead」。第三方插件与产品抢同一个名字
   会让**装配整个失败**，而不是降级。
2. **order 空间被所有人争抢**。第 3.3 节已证明 order 0/1 今天被三方共用。没有中心分配，
   任何插件选 0 都是合法的，相对顺序只由 name 的 code-unit 决定（`:238-246`）—— 等于
   「声线位置」由插件名的字母序决定，这是产品无法控制的外部变量。
3. **无法统一改写**。每个插件各自注册，产品没有单一落点做「统一排序或统一语气化」；
   想干预只能再挂一个 waterfall listener，而那时要处理的是**已经**五花八门的 section 集合。
4. **`complete` 是公共开关**。任何插件都能设 `complete: true`，一次抹掉所有声线（§4）。
   今天没有机制阻止。
5. **没有 owner 归因**。`AssembledSection`（`:93-100`）只有 `name`/`text`/`interpolate`，
   **没有「谁注册的」字段**。waterfall listener 看到的是扁平列表，无法可靠区分
   「产品的声线」与「第三方材料」—— 想做「只改第三方、不动自己」就只能靠 name 前缀约定。

⇒ 结论：现状让声线**既脆弱又不可治理**。但按「规模校准」，**不要**因此造权限平台；
需要的是一个**很窄的登记函数**，把「第三方材料」与「产品声线」在结构上分开。

### 5.2 接口草案（TypeScript，15 行，含注释）

服务名：`ourfairyVoice`。它只做一件事：**收下第三方材料，并保证它们在 Fairy 语段的一个
固定子区间内、以确定顺序出现**。

```ts
/** 第三方交给 Fairy 装配模块的提示词材料。 */
export interface VoiceMaterial {
  /** 唯一名；同层重复即拒绝并指明冲突者（不抛给装配）。 */
  readonly name: string
  /** 子区间内的相对位置；不决定全局 order。 */
  readonly slot: 'preamble' | 'context' | 'appendix'
  /** 纯文本，注入时按 interpolate:false 处理（不解析 {{}}）。 */
  readonly text: string
}
export interface VoiceSeam {
  /** 登记材料，返回精确 disposer；拒绝时抛 VoiceRejected（带 code）。 */
  contribute(material: VoiceMaterial): () => void
  /** 当前生效材料名（按渲染顺序），用于诊断与测试。 */
  describe(): readonly string[]
}
```

（正文 15 行，含注释行，满足「≤15 行」约束。）

**模块保证什么（这是深模块的实质）**：

1. **固定落点**：所有 `VoiceMaterial` 渲染在 `ourfairy:persona`(0) **之后**、
   `ourfairy:identity`(1) **之前**，由模块自己用 order `0` + name 前缀 `ourfairy:voice:*`
   占一段不与原生 `SECTION_ORDERS` 冲突的子区间。
   **已验证排序**：`deployment:persona-prefix` < `ourfairy:persona` < `ourfairy:voice:*`
   < `ourfairy:identity`（同 order 0 内按 code-unit 比较，`'d' < 'o'`；
   `ourfairy:identity` 是 order 1，必在所有 order 0 之后）。**这一条必须在实现时用
   §7.2 第 2 条测试钉住** —— 它现在依赖字母序，不是设计。
2. **顺序确定**：`slot` 决定三段相对次序，`name` 决定同 slot 内次序（code-unit，与原生一致）。
3. **不设 complete**：模块永不注册 `complete: true`，也拒绝任何带 complete 的材料。
4. **不改别人的**：模块只注册自己的 section，不装 waterfall listener —— 直到有观测到的需求。
5. **可解释**：`describe()` 让产品和测试能列出「当前有哪些第三方材料生效」。

**失败模式（逐条给行为，不给平台）**：

| 失败 | 行为 | 依据/理由 |
| --- | --- | --- |
| **重复名** | `contribute()` **同步抛** `VOICE_DUPLICATE`，消息含冲突的 name 与已有 owner 描述；**不**让装配失败 | 把故障从 `assemble()` 移到注册期，失败是局部的（`NamedEntries.insert` 的重名抛错无法给装配降级，见 `store.ts:43-46`） |
| **未知 kind / slot** | 类型层面拒绝（TS 字面量联合）；运行时再校验并抛 `VOICE_UNKNOWN_SLOT` | 第三方可能绕过 TS（dist 里 JS），一条 assert 的成本极低 |
| **超长** | 单条 `text` 超上限（建议 4000 字符）抛 `VOICE_TOO_LARGE`；**不截断** | 截断会静默产生半句话，比拒绝更糟，且与 `renderPrompt` 的「异常比坏 prompt 好」一致（`:293-300` README 的 strict 原则） |
| **非 UTF-8 / 非法字符** | 不做编码校验（JS 字符串天然 UTF-16）；**但**因 `interpolate:false`，`text` 里的 `{{}}` 不会被解析 ⇒ 天然免疫 `interpolate()` 的三类抛错（`:344-372`） | 这是一条真实的收益：今天第三方若用默认 `interpolate:true` 写了 `{{不存在的变量}}`，会让**整个装配抛错**（`:361-368`） |
| **顺序冲突（同 slot 同名）** | 归入「重复名」；同 slot 不同名按 name 排序，**不报错** | 顺序冲突不需要错误，只需要确定性 |
| **中英混杂 / 语种** | **不校验**（明确不做） | 语种不是失败模式；今天没有任何观测到「第三方材料语种错乱导致声线坏掉」的证据（AGENTS.md「规模校准」：抽象须指名真实故障）。语种一致是**内容规范**，应写在文档里，不是代码里的校验 |

**明确不做**（每一条都对应被否决的抽象）：

- 不做权限/信任分级平台 —— 没有观测到「恶意插件」这一故障，只有「不兼容插件」。
- 不做万能上下文管理层 —— 只处理 section 材料，不碰 context/tools/variables。
- 不做第二套配置系统 —— 材料来自代码里的 `contribute()` 调用，不来自 yml/JSON。
- 不装 waterfall listener 做「统一改写」—— 见 §6 的重新评估条件。

### 5.3 与「用 waterfall 接管」的关系（这是设计里最关键的取舍）

§2 已经证明 **waterfall 能做**统一改写。那为什么不直接做？答案是**顺序问题**：

- waterfall 只能在**别人的 section 已经注册完之后**改写，所以它必须**枚举**所有 section、
  判断谁是第三方、再重排。但 `AssembledSection` 没有 owner 字段（`:93-100`），
  判断只能靠 name 约定 —— 这是脆的。
- `contribute()` 在**注册期**就完成归集，产品在自己的 order 带内生成 section，
  **不需要**再猜谁是第三方。

⇒ **建议：先做 `contribute()`（注册期归集），把 waterfall 留作「已观测到必须改写他人」时的升级路径。**
这一条严格符合「抽象只在当下明确需求或已观测到的失败面前加入」。

---

## 6. (e) 与 ADR-0001 的关系

ADR-0001（`docs/adr/0001-upstream-extension-policy.md`，16 行）三条规则原文：

- :8 「OurFairy 优先保持跟进 dsh 官方更新的能力；社区插件和工具以低集成成本接入，两者冲突时官方更新优先。」
- :10 「产品规则优先通过原生接口在 OurFairy 中实现。原生接口确实缺少必要能力时，允许维护少量职责明确的通用补丁；评估须同时计入外置替换所需复制或持续追随的上游行为。」
- :12 「接缝应集中复杂性。判断成本时检查调用方需要了解的内部细节、受变化影响的消费者，以及协调工作的生命周期和顺序要求。引入浅模块需要说明具体收益与代价；无关职责不因共用一个调度器而集中到一起。」
- :14 重新评估条件：「若一个扩展持续牵动更多无关模块，应重新评估接缝及对应产品行为；权限隔离、数据可靠性等必要保障仍需保留。」

### 6.1 属于「复用原生接缝」（无需额外记录理由）

| 做法 | 复用的原生机制 |
| --- | --- |
| 产品 section 继续用 `ctx.systemPrompt.section()` | 原生注册 API（`:474-483`） |
| 用 `getSectionOrder`/`getContextOrder` 定 order | 原生中心分配（`:490-501`）——**这是产品今天没做、应该补的**（今天全是硬编码字面量） |
| `interpolate: false` | 原生字段（`:68`） |
| `contribute()` 最终展开为原生 `section()` 调用 | 薄封装，不新增机制 |
| 用 waterfall 做编排（若将来启用） | 原生 `system-prompt/assemble`（`:31`、`:673-676`） |
| scoped 遮蔽解决 persona 冲突 | 原生 `ScopedLayers.merge`（`store.ts:208-217`）+ 原生常量 `PERSONA_PREFIX_SECTION`（`:186`） |

### 6.2 属于「产品扩展」，需要记录理由与重新评估条件

| 扩展 | 服务的具体故障 | 重新评估条件 |
| --- | --- | --- |
`ourfairyVoice` 服务（§5.2） | F1：第三方与产品争 order 0/1，相对顺序由 name 字母序决定（§3.3）；F2：`AssembledSection` 无 owner 字段，产品无法区分自己与第三方（§5.1 第 5 条） | 上游给 `AssembledSection`/`PromptSection` 增加 owner/origin 字段，或给 section 增加中心分配的子区间（类似 `SECTION_ORDERS` 已做的那样）⇒ 删掉本服务，直接用原生 order |
| 产品自有 order 常量（如 `ourfairy:voice:*` 前缀约定） | F1 同上：产品需要一段**自己拥有**的 order 带 | 上游在 `SECTION_ORDERS` 里提供 deployment 可扩展的带，或 `personaPrefix` 支持多段 |
| 「永不注册 complete」的约定 | F3：complete 会抹掉所有工具指引（§4 第 1–5 条） | 上游把 complete 的语义从「取代」改为「优先」，或提供「保留工具指引的独占」 |
| 把硬编码 order 0/1/2/3 改为 `getSectionOrder`（**已存在的缺口，不是新扩展**） | F4：产品 order 与原生分配表脱节，上游调整 `DEPLOYMENT_PERSONA_PREFIX` 时产品不会跟随 | 这是修正现状，不是扩展；无重新评估条件，应直接做 |

注意 §6.2 第一、二行是**同一个故障的两个面**（F1），可以合并成一次扩展；按「规模校准」，
如果只做一个，做 `contribute()` 即可，因为它的 order 带是内部细节。

### 6.3 与 `docs/architecture/dsh-ecosystem-boundary.md` 的关系

该文档定义了「保留的产品实现」的三段式模板（`原生有什么 / 缺什么 / 为什么保留 / 重新评估条件`，
:95-150）与「每条声称都要有一个失效即失败的检查」（:11）。**本文的 `ourfairyVoice` 若落地，
必须按同一模板进入该文档第 3 节**，并配一条检查（§7）。该文档也明确「本文不列行清单」（:8-11），
所以行/包仍以 `cordis.patch.yml` 与 `package.json` 为唯一权威 —— 本文不重复它们。

**一个该文档今天没有覆盖的空白**（事实）：它没有任何关于 **system prompt 装配顺序** 的条目
（`grep 提示词|prompt|persona|人格|声线` 在该文档与 `native-capability-dependencies.md`
里零命中）。也就是说「声线装配顺序」目前既不是保留的产品实现，也不是已接入的原生接缝 ——
它是**未登记的**。这本身就是 (e) 的最重要发现。

---

## 7. (f) 可执行检查

### 7.1 现有测试风格（两种，都能用）

| 风格 | 代表 | 机制 | 适合钉什么 |
| --- | --- | --- | --- |
| **A 端到端** | `tests/memory-policy.test.mjs`、`tests/memory-impression.test.mjs`、`tests/remote-chat.test.mjs` | 真 profile + 真 Loader + 外部模型 double（HTTP SSE server）；断言模型**实际收到**的 request body | 「某段文本确实在 prompt 里」，以及「某段文本**不在**子 agent 的 prompt 里」 |
| **B 单元** | `tests/chat-read-window.test.mjs:41-54` | 手搭假 Agent ctx，`systemPrompt` 是空桩 `{ section() {} }` | 只测「有没有调用注册」，**测不到顺序** |

风格 A 的断言写法（`tests/memory-policy.test.mjs:143-157`）：
`systemOf(body)` 把 `body.system` 的 text block 拼成一个字符串，然后
`assert.match(sourceSystem, MAIN_POLICY_MARKER)`、`assert.equal(childSystem.includes(MAIN_ONLY_MARKER), false)`。

**关键缺口（事实）**：**没有任何测试断言 section 的相对顺序。**
`tests/` 里零次出现 `ourfairy:persona`/`ourfairy:identity`/`getSectionOrder`/
`system-prompt/assemble`/`.sections`；零次 import `@deepseek-ai/dsh-system-prompt`；
零次对 prompt 文本做 `indexOf` 位置比较。全部是「某标记是否存在」的子串断言。

### 7.2 用哪种风格钉这套接口与顺序

**建议用风格 A，新增一条测试**（`tests/persona-seam.test.mjs`），因为只有它能看到
**真实渲染顺序**。断言三件事：

1. **产品四段块的相对顺序**：`systemOf(body)` 里
   `indexOf('III型总序式集成泛用人工智能') < indexOf('当前已认证用户短号') < indexOf(<impression 标记>) < indexOf(MAIN_POLICY_MARKER)`。
   这直接钉住 order 0/1/2/3 的语义，且**不依赖任何内部 API**。
2. **第三方材料落在 persona 之后、identity 之前**：用一个测试专用 overlay
   （`tests/helpers/backend.mjs:210` 的 `writeOverlay`）挂一个注册
   `ourfairy:voice:*` 的探针行，断言其标记在 `indexOf` 链里的位置。
3. **complete 缺席**：断言 prompt 里仍然**同时**含有至少一条工具指引标记与 persona 标记。
   可用的具体标记（全部已核对为今天生效的 section 文本）：
   - `tool:bash` → `'Check the [exit code: N] marker on every bash result'`（`tool-bash/src/index.ts:251-254`）
   - `tool:read` → `'Use the read tool — not shell commands like cat'`（`tool-fs/src/read.ts:69-75`）
   若有人给产品加了 `complete: true`，这条会立刻红 —— 因为那 5 条工具指引会全部消失（§3.3）。
   **这是 R1 的守卫，建议优先写这一条。**

`describe()` 的返回也可以直接断言（风格 B 足够），但**顺序必须用风格 A**。

### 7.3 不加检查时，哪一类改动会静默破坏声线

| 静默破坏 | 为什么静默 | 会被 §7.2 的哪条抓住 |
| --- | --- | --- |
| 有人给产品 section 加 `complete: true` | 装配**成功**，prompt 变短，模型仍能回答；只有工具用法消失，表现为「模型偶尔调错工具」 | 第 3 条 |
| 第三方插件注册 order 0 且 name 以 `a`–`n` 开头 | 装配**成功**，只是 persona 被挤到后面；没有任何错误或日志 | 第 1、2 条 |
| 上游调整 `DEPLOYMENT_PERSONA_PREFIX` 的数值 | 产品硬编码 order 0 与原生 0 恰好今天相同；上游一改就错位，但**两版都能装配** | 第 1 条（若改为 `getSectionOrder` 则不受影响） |
| 有人把 `ourfairy:identity` 的 `interpolate:false` 去掉 | 一旦文本里出现 `{{`（比如短号模板被改），装配**抛错**——这个是响亮的，不算静默 | — |
| 第三方 material 用默认 `interpolate:true` 且含 `{{x}}` | 装配抛错（`:361-368`），响亮 | — |
| 上游把 `complete` 的恢复时机改成「waterfall 中也会被覆盖」 | 无法观测，除非有测试像 `system-prompt.spec.ts:496-512` 那样钉住 | 建议在 `contribute()` 的测试里复刻该断言 |

### 7.4 dsh 侧已有的、可直接照抄的测试范式

若要在 dsh 侧（而非 OurFairy）钉住 (b) 的结论，最贴近的是：

- `packages/core/system-prompt/tests/system-prompt.spec.ts:457-481`（waterfall 串联与顺序）
- `:483-494`（不调 `next()` 即短路 —— 即 veto 整个装配）
- `:496-512`（complete 在 waterfall 后恢复，且改写被丢弃）
- `:514-522`（多条 complete 抛错）
- `packages/core/system-prompt/tests/scoped.spec.ts:229-245`（scoped listener 只影响自己的 scope）

OurFairy 的 `tests/` 是 `node:test` + `assert` 风格，不能直接跑 vitest 文件；但可以把
`:496-512` 的**语义**翻译成一条风格 A 的断言（即 §7.3 最后一行）。

---

## 8. 最大风险

**R1（最高）：`complete: true` 是单点、无声、全局的声线开关，而它今天没有被任何东西挡住。**

- 任何第三方插件（或未来一个 preset）只要设 `complete: true`，产品的
  persona/identity/impression/memory-policy **四段同时消失**，且装配**成功**
  （`system-prompt/src/index.ts:677-683`）。
- 同一次里，`tool:bash`/`tool:read`/`tool:write`/`tool:edit`/`tool:jobs` 五条用法指引也一起消失
  （`:681`），而工具 schema 仍然保留（`:670`/`:680`）—— 模型**有工具但不知道怎么用**，
  失败表现是「工具调错」而不是「prompt 报错」，最难诊断的一类故障。
- 今天产品没挂 preset 行，所以是**潜在**风险；但
  `docs/research/persona-context-and-injection-resistance.md` 的正文把
  「`complete: true` + `includeHarnessIdentity: false`」当作**推荐做法**（该文档 :60、:213），
  而代码里产品**零** `complete`（本文已核）。说明书与代码已经不一致，
  这比任何单个 bug 都危险：它会让后续改动朝「加 complete」走，而那正好是唯一能
  一次性抹掉整条声线的开关。
- **缓解**：§7.2 第 3 条测试是这条风险的守卫；并把「永不注册 complete」写进 ADR/边界文档。

**R2（次高）：order 0/1 的共享语义没有中心分配，声线相对位置由插件名字母序决定。**

- 已在 §3.3 证明。`ourfairy:persona`(0) 与 `deployment:persona-prefix`(0) 今天靠
  `'d' < 'o'` 才正确；这是巧合而不是设计。
- 上游 rc.2（pin 版）把 `HARNESS_SOURCE`/`WEB_SURFACE` 同时放进了 **context** 表（125/200/210），
  说明上游正在**调整** order 空间；产品的硬编码 0/1/2/3 会在某次升级后突然错位。

**R3：版本三方不一致，line-number 级的结论会漂移。**
工作树是 alpha.2、combo 锁 rc.2、全局装 rc.5；`system-prompt/src/index.ts` 在两版之间已差 4 行，
`child-agent.ts` 差 59 行。任何「按行号实施」的改动必须先在 pin 版上复核。

**R4（架构摩擦，不是故障）：产品同时存在三套「谁决定 prompt」的机制而互不相识** ——
① `agentCtx.systemPrompt.section`（chat，runtime.ts:296）、② `agent/created` 里补注册
（memory，index.ts:111-118）、③ 无（waterfall 完全没用）。三者没有共享的 order 常量、
没有共享的注册入口、没有共享的测试。这是 `contribute()` 存在的**唯一理由**；
如果只做一个抽象，就做这个。

---

## 9. 一句话建议的窄接口（给 lead 的那一句）

> 「`ourfairyVoice.contribute({name, slot, text})` 收下第三方提示词材料，保证它们在
> `order 0` 的 `ourfairy:voice:*` 区间内、按 `slot`+`name` 确定渲染、一律
> `interpolate:false`、永不 `complete`；重复名在注册期同步拒绝而不是让装配失败。」
