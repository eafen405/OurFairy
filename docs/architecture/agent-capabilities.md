# Agent 能力面

## 默认规则

**只有用户自己的会话默认拿到产品工具面；其它 agent 什么都不给，由创建者显式授予。**

一条会话是否属于用户自己，由三个持久 header 事实决定：

| 事实 | 用户自己的会话 | 含义 |
| --- | --- | --- |
| `owner` | 有 | `SessionHeader.owner` 指向一位用户 |
| `parentSession` | 无 | 它不是从另一条会话派生的子 |
| `agentPreset` | 无 | 它不是按某个 agent preset 组合出来的 agent |

判定在 [`@ourfairy/dsh-identity/session`](../../backend/identity/src/session.ts) 的
`isUserSession(header)`。它只读上述三个字段，不挂载任何插件，与 `./owner` 一样是纯 codec
子路径；缺少 header、无 owner、有 parent、有 preset 都返回 false。

「有 owner、无 parent、无 preset」就是用户会话的定义，不是可选的分类。将来若某个 agent
属于某位用户、但不是用户自己发起的顶层会话（例如定时任务），它必须通过 `parentSession`
或 `agentPreset` 表明这一点；否则按定义它就是用户会话，会拿到产品工具面。

## 谁默认拿到什么

| agent 种类 | 有 owner | 有 parent | 默认工具面 | 谁授权 |
| --- | --- | --- | --- | --- |
| 用户自己的会话 | 有 | 无 | 产品工具面 | 各产品 row 在 agent 创建时注册 |
| 记忆维护子 | 无 | 有 | memory 授予的记忆工具 | memory（创建者） |
| 将来的非用户 agent | 由创建者决定 | 由创建者决定 | 空 | 创建者显式授予 |

本文件不列「agent 种类 × 具体工具名」：具体工具由各 row 自己的注册决定，不在这里
重复。当前落地的非用户 agent 有三种——记忆维护子、技能学习检测子、技能深创子；前两种
各有自己的 complete 段和工具面，第三种沿用创建模块的完整 Skill Creator 正文。

## 三类判断不能混用

旧代码把「是不是维护子」当成三个不同问题的代理；现在它们各有名字：

- **工具行问「这是用户自己的会话吗」**：注册工具前调用
  `isUserSession(agent.session.header)`，不是用户会话就一个工具都不注册。这条判定的
  消费者是全部需要工具面的行，不止 search、groups、delivery 三行：`tests/agent-capabilities-doc.test.mjs`
  从源码数出调用它的包，与本文件列出的数量比对。
- **文件与附件行问「这条会话有 owner 吗」**：spaces 的 sandbox 策略、工作目录、文件空间
  prompt，以及 attachments 的 stream/execute 刷新，用 `shortIdOf(header.owner)` 判断。
  这些不是工具授权，只决定私有根、共享根或附件刷新是否存在。
- **skill-creator 的注册也问它**：`skill_manage` 只注册在用户会话上。它的学习检测、
  学习审查与深创三个子代理都不该看见这个工具，判定它们是不是用户会话就够了。
- **chat 的装配守卫问同一个问题**：`prompt-guard` 只在用户会话上拒绝别的包用 complete 段
  顶掉部署提示——内部子代理本来就可以有自己的完整提示，拦它会拦错。
- **memory 问「这是不是我创建的维护子」**：`MAINTENANCE_PRESET` 留在 memory 内部。维护子由
  memory 创建，memory 对它注册自己的记忆工具并跳过仅属于用户的 policy/impressions；这是
  创建者给自己的子授权，不是产品通用标记。其它产品包不再导入这个常量。

## per-agent 注册与 global layer

产品工具仍按 agent 在创建时注册（默认拒绝）；本规则没有把任何工具推到 global layer。
#274 已把 attachments 的 pdf 工具放在 row 的 global layer，它们的继承面由 agent 创建时的
`tools.restrict` 决定；memory 维护子在 `#composeChild` 里 `restrict({ allow: [] })`，
因此只看见 memory 注册的工具。新增非用户 agent 时，创建者仍要为自己的继承面负责。

## 可执行检查

- [`tests/agent-capabilities.test.mjs`](../../tests/agent-capabilities.test.mjs)：用户会话、
  维护子、有 owner 且有 parent、无 owner 且无 preset 等 header 形状都锁在判定上。
- [`tests/model-double.test.mjs`](../../tests/model-double.test.mjs)：用户主会话的模型工具
  目录是 `model-double` 里那张手写清单，由测试与装配比对。主人比普通代理人多一个
  `group_create`：它只在 `shortId === 1 && isAdmin` 时注册。
- [`tests/memory-maintenance.test.mjs`](../../tests/memory-maintenance.test.mjs)：维护子仍
  恰好看到 memory 的五个记忆工具。
- [`tests/row-addressability.test.mjs`](../../tests/row-addressability.test.mjs)：禁用
  delivery 或 groups 行后，对应工具从用户的工具目录消失。
- [`tests/prompt-inventory.test.mjs`](../../tests/prompt-inventory.test.mjs)：真实装配的段
  清单、每段字符数与合计，从 `system-prompt/assemble` 的 waterfall 读出来，与模型实际收到
  的文本比对。段清单的权威在那里与各包源码，不在本文件的散文里。
- [`tests/agent-capabilities-doc.test.mjs`](../../tests/agent-capabilities-doc.test.mjs)：
  本文件里凡以数字或行名表述的主张，都与源码派生值比对。
