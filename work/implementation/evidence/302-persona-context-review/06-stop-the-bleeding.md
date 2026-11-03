# 302 · 第一批：删除反向段 + 守卫（实测记录）

2026-11-03。基线见 [05-baseline-refresh.md](05-baseline-refresh.md)。

## 1. 本批只做减法

| 改动 | 文件 |
| --- | --- |
| 删除 `ourfairy:memory-policy` system prompt 段（order 3） | `backend/memory/src/tools.ts`、`backend/memory/src/index.ts` |
| 新增装配段清单守卫 + `complete` 拦截 | `tests/prompt-inventory.test.mjs`、`backend/chat/test-support/prompt-inventory.ts`、`backend/chat/src/prompt-guard.ts` |
| 更正研究稿里把 `complete: true` 当推荐做法的表述 | `docs/research/persona-context-and-injection-resistance.md` |
| 同步 `backend/memory/README.md`、补 `dsh-system-prompt` peerDependency | 同上 |

**人设正文与全部工具描述逐字未动。** 实测确认：`git diff origin/main -- backend/chat/src/persona.ts` 为空；
`memory_add` 描述仍是 940 字符。

### 为什么不再补新句子

第一版曾把中文规则改写成英文塞进 `memory_add` 描述（940 → 1356 字符），并在人设里把
「必须有真实的工具结果或获取到的信息」改写成「依据只能是本轮工具结果；没有这样的依据就明说
『我自己的判断』」。真实模型实测结果是**反向的**：

| 指标 | 基线 | 加了那批措辞之后 |
| --- | --- | --- |
| 助手腔（六词并集） | 9/38 | **15/38** |
| 「数据显示/数据表明」总用量 | 13 | **22** |
| A+B 合计伪造 | 10 | 9（基本没动） |

越强调「要有依据、别编」，她越频繁地说「数据显示」。这与本票的动机（不希望被提示词填满）
方向相反，也与「否定句只能用于禁止行为、不能用于塑造风格」的判据一致。
因此本批回退：**只删掉那段反向文本，不补任何替代句子。**

## 2. 实测效果

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| system prompt（主人） | 2 494 | **1 980**（−514） |
| system prompt（代理人） | 2 498 | **1 984** |
| 人设 | 804 | 804（未动） |
| `memory_add` 描述 | 940 | 940（未动） |
| 工具描述合计 | 10 605 | 10 605（未动） |

删掉的 512 字符本来是「同一套写记忆规则的第二个权威」——同样的规则已经在 `memory_add`
的描述里。这次省下的是**提示词里的重复与反向语气**，不是新增规则。

## 3. `complete` 核弹：已能 fail-closed 拦截

初版结论写「运行时无法预防，只能靠测试发现」，**这个结论是错的**。

- dsh 确实把 complete 的替换放在 assemble waterfall **之后**，所以检查 `next()` 的返回值看不见损失。
- 但 complete 段在 waterfall **之前**的 assembly 里已经存在，而部署提示词是**封闭集合**
  （`ourfairy:*` / `tool:*` / `deployment:*`）。`backend/chat/src/prompt-guard.ts` 据此判断：
  出现任何不在这三个前缀内的段就抛 `PromptHijackedError`。
- 实测（挂 `complete-section.ts` fixture）：**模型请求数 = 0**，`/chat/read` 的 `projection.error`
  返回拒绝原因。会话可见地失败，而不是以别人的身份继续说话。
- 守卫装在 `agent.ctx` 上，ownerless 的维护/学习子 agent 不受影响；禁用 `scoped-bash` 等
  合法缺席也不会误伤（工具行缺席不是失败信号）。

代价是拒绝服务式保护：一旦有第三方注册 complete 段，该用户的回合会失败直到那条段被移除。
对个人项目这是正确取舍——静默换人格比报错难查得多。

## 4. 守卫测试：先红后绿已实测

- 故意把 `ourfairy:persona` 注册成 `complete: true` → 两条守卫测试都失败。
- 还原 → 通过。
- 注：`complete` 的替换在 waterfall 之后，所以断言必须读**模型实际收到的文本**，
  不能读 waterfall 里的 assembly（读 assembly 会在核弹生效时恰好通过）。这条已按实测修正。

**已知缺口**：验收第 1 条要求列出「段名、order、**来源包**、字符数」。当前记录 name 与 characters；
`AssembledSection` 只有 `{name,text,interpolate}`，order 在排序后即丢弃，来源包无字段可读。
所以这条验收**只部分满足**。

## 5. 门禁

| 门禁 | 结果 |
| --- | --- |
| `npm test`（全量） | **654 / 654 通过**（85 个测试文件；基线同环境 474→654 含技能系统新增） |
| `npm run combo:verify` | 三行 ok，combination verified |
| 真实模型验收 | 见 [07-semantic-retest.md](07-semantic-retest.md)：伪造 7→2 条；单次通过数在 62/63–69/69 间抖动，不作判据 |
