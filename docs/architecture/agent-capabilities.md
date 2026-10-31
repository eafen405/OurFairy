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

本文件不列「agent 种类 × 具体工具名」：除上面两种外还没有第二种 agent 落地，具体工具
由各 row 自己的注册决定，不在这里重复。

## 三类判断不能混用

旧代码把「是不是维护子」当成三个不同问题的代理；现在它们各有名字：

- **工具行问「这是用户自己的会话吗」**：search、groups、delivery 在注册工具前调用
  `isUserSession(agent.session.header)`。不是用户会话就一个工具都不注册。
- **文件与附件行问「这条会话有 owner 吗」**：spaces 的 sandbox 策略、工作目录、文件空间
  prompt，以及 attachments 的 stream/execute 刷新，用 `shortIdOf(header.owner)` 判断。
  这些不是工具授权，只决定私有根、共享根或附件刷新是否存在。
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
  目录仍是 25 个工具。
- [`tests/memory-maintenance.test.mjs`](../../tests/memory-maintenance.test.mjs)：维护子仍
  恰好看到 memory 的五个记忆工具。
- [`tests/row-addressability.test.mjs`](../../tests/row-addressability.test.mjs)：禁用
  delivery 或 groups 行后，对应工具从用户的工具目录消失。
