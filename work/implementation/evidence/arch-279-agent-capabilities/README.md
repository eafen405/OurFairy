# #279 用「是否用户会话」与「是否有 owner」替代散落的 maintenance preset 判断

日期：2026-10-31。票面：[#279](https://github.com/eafen405/OurFairy/issues/279)。
分支 `ticket/279-agent-capabilities`，worktree `.worktrees/279-agent-capabilities`，
基线 `9426ca59ea`（main）。

`header.agentPreset === MAINTENANCE_PRESET` 原先有 12 处比较、散在 9 个文件，另有 7 条
`@ourfairy/dsh-memory/preset` import。本票把比较翻译成它们真正在问的两类问题，只把 memory
自己的子识别留给 preset：

- **有 owner 吗**（6 处，文件/附件行）：`shortIdOf(header.owner)`。
- **这是用户自己的会话吗**（3 处，工具行）：`!isUserSession(header)`。
- **这是我的子吗**（3 处，memory 私有）：保持 `MAINTENANCE_PRESET`。

## 新判定放在哪里

[`backend/identity/src/session.ts`](../../../../backend/identity/src/session.ts)，通过
`@ourfairy/dsh-identity/session` 导出（与 `./owner` 同族的纯 codec 子路径）：

```ts
export type UserSessionHeader = Pick<SessionHeader, 'owner' | 'parentSession' | 'agentPreset'>

export function isUserSession(header: UserSessionHeader | undefined): boolean {
  return header !== undefined
    && header.owner !== undefined
    && header.parentSession === undefined
    && header.agentPreset === undefined
}
```

放 identity 的理由：

- identity 已是 search、delivery、spaces 的 peer；groups、attachments 本次补上 peer 声明。
  新增的只是 identity 的一个纯子路径，不新建包，也不增加 bundle 行。
- `./session` 不挂载 identity 插件，和 `./owner` 一样只做 codec；search/groups 的
  `inject` 列表没有变化，只多一个模块导入。
- 只接受 `owner` / `parentSession` / `agentPreset` 三个 header 字段；传 `SessionHeader`
  或同形状的持久 header 快照都可以。缺少 header 返回 false（默认拒绝）。

按票面定义，`owner` 取的是**字段存在性**，不是 `shortIdOf` 的格式校验；owner 值是否可读仍由
`shortIdOf` 负责（owner 类站点和 memory 的 source 解析都用它）。

## 12 处站点逐条对照

改前行号取自基线 `9426ca59ea`。

| # | 站点 | 改前 | 改后 | 类别 | 现有两种 agent 的行为 |
| --- | --- | --- | --- | --- | --- |
| 1 | `spaces/src/policy.ts:22` | `request.session?.header?.agentPreset === MAINTENANCE_PRESET` | `request.session !== undefined && shortIdOf(request.session.header?.owner) === undefined` | owner | 等价；sessionless 请求经前置守卫仍拒绝 |
| 2 | `spaces/src/directory.ts:23` | `session.header?.agentPreset === MAINTENANCE_PRESET` | `shortIdOf(session.header?.owner) === undefined` | owner | 等价 |
| 3 | `spaces/src/directory.ts:28` | `agent.session.header?.agentPreset === MAINTENANCE_PRESET` | `shortIdOf(agent.session.header?.owner) === undefined` | owner | 等价 |
| 4 | `spaces/src/index.ts:42` | `agent.session.header?.agentPreset === MAINTENANCE_PRESET` | `shortIdOf(agent.session.header?.owner) === undefined` | owner | 等价 |
| 5 | `attachments/src/index.ts:103` | `child?.header?.agentPreset === MAINTENANCE_PRESET` | `child !== undefined && shortIdOf(child.header?.owner) === undefined` | owner | 等价；无 live session 的请求仍走原拒绝路径 |
| 6 | `attachments/src/index.ts:119` | `exec.agent.session.header?.agentPreset !== MAINTENANCE_PRESET` | `shortIdOf(exec.agent.session.header?.owner) !== undefined` | owner | 等价 |
| 7 | `search/src/index.ts:39` | `agent.session.header?.agentPreset === MAINTENANCE_PRESET` | `!isUserSession(agent.session.header)` | 工具行 | 等价；语义收紧（见下） |
| 8 | `groups/src/index.ts:67` | `agent.session.header?.agentPreset === MAINTENANCE_PRESET` | `!isUserSession(agent.session.header)` | 工具行 | 等价；语义收紧（见下） |
| 9 | `delivery/src/index.ts:162` | `agent.session.header?.agentPreset === MAINTENANCE_PRESET` | `!isUserSession(agent.session.header)` | 工具行 | 等价；语义收紧（见下） |
| 10 | `memory/src/maintenance.ts:202` | `header.owner === undefined \|\| header.agentPreset === MAINTENANCE_PRESET` | 不变 | memory 私有 | 不变 |
| 11 | `memory/src/maintenance.ts:236` | `header.owner === undefined \|\| header.agentPreset === MAINTENANCE_PRESET` | 不变 | memory 私有 | 不变 |
| 12 | `memory/src/service.ts:90` | `header.agentPreset !== MAINTENANCE_PRESET` | 不变 | memory 私有 | 不变 |

### 哪处是纯改名、哪处是语义收紧

- **#1–#6 是纯改名（对现有两种 agent）**：维护子是 ownerless，用户会话有 owner；把
  「是不是维护子」换成「有没有 owner」在现有输入上结果相同。文件根、prompt 上下文和附件刷新
  问的本来就是 owner，不是 preset。
- **#7–#9 是语义收紧**：旧条件只排除 maintenance preset；新条件排除所有非用户会话。
  今天不存在的「有 owner 且有 parent」或「无 owner 且无 preset」agent 以前会注册
  search/groups/delivery 工具，现在默认不注册，必须由创建者显式授予。这正是票面要的默认值变化。
- **#10–#12 不动**：memory 用 preset 识别自己创建的维护子，并据此在 `maintenance.ts` 里跳过
  ownerless 的 source、在 `service.ts` 里从 `parentSession` 解析 owner。改成 `isUserSession`
  会让维护子失去 memory 工具（`tests/memory-maintenance.test.mjs` 的五工具断言会红）。

## import 收敛

`backend/*/src` 里从 `@ourfairy/dsh-memory/preset` 的 import 已为 0；只剩 memory 自己：

```
backend/memory/src/maintenance.ts:31:import { MAINTENANCE_PRESET } from './preset.js'
backend/memory/src/service.ts:13:import { MAINTENANCE_PRESET } from './preset.js'
```

同时删掉五个包对 `@ourfairy/dsh-memory` 的 peer 声明与 tsconfig 引用
（spaces、attachments、search、groups、delivery），并给 groups、attachments 补上
`@ourfairy/dsh-identity` peer，给 attachments 补上 identity 的 project reference。
这些包不再需要 memory 来回答问题。

## 行为差异

**现有的用户会话与维护子没有行为差异**：

- `tests/model-double.test.mjs` 的主会话工具目录仍是 25 个名字（`deepEqual`）。
- `tests/memory-maintenance.test.mjs` 的维护子仍恰好看到 memory 的五个工具；
  维护子的 tool restriction、material、owner 解析都没有改。
- owner 类站点的两种现有 agent（有 owner 的用户会话 / 无 owner 的维护子）走的分支与改前相同。

**默认值的语义收紧**（票面要求的变化）：将来出现非用户 agent 时，search/groups/delivery
不再默认注册；它必须先被创建者显式授予。当前没有这种 agent，所以线上目录不变。

**两处 sessionless 边缘保持了原行为**：

- `spaces/policy.resolve()` 无 session 时，改前 `scope.owner(undefined)` 抛
  `FS_PERMISSION_DENIED`；改后由 `request.session !== undefined` 守卫继续走同一拒绝。
- `attachments` 的 `llm/stream` 在 `options.sessionId === undefined`（或 session 不在 live
  store）时，改前在 `ourfairySpaces.session(undefined)` 抛错；改后由 `child !== undefined`
  守卫继续走同一路径。只有 live 的 ownerless session 会进入「跳过刷新」分支。

也就是说，owner 判断只对「存在一条无 owner 的 session」放宽；对「没有 session」不改变拒绝。
当前组合里没有 mounted row 会发出 sessionless 的 `resolve()` 或 `llm/stream`。

## 实际命令与统计行

```
$ npm run build
（无输出）exit 0

$ node --test tests/agent-capabilities.test.mjs
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 48.493136

$ node --test tests/memory-maintenance.test.mjs tests/model-double.test.mjs tests/row-addressability.test.mjs
ℹ tests 18
ℹ pass 18
ℹ fail 0
ℹ duration_ms 24211.997405

$ node --test tests/docs.test.mjs tests/owner-codec.test.mjs
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 325.258759

$ node --test tests/spaces.test.mjs tests/attachments.test.mjs tests/groups.test.mjs \
    tests/conversation-search.test.mjs tests/text-delivery.test.mjs
ℹ tests 31
ℹ pass 31
ℹ fail 0
ℹ duration_ms 7864.994589

$ node --test tests/bundle-packages.test.mjs tests/plugin-compatibility.test.mjs
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ duration_ms 324992.422934
```

`bundle-packages` / `plugin-compatibility` 覆盖本次 peer 与 project-reference 变更：
bundle 仍是 12 个声明包、17 个 row 挂载；14 个安装包对 pinned dsh 兼容。

首次 boot 前用最终 `npm run build` 后的 product-source hash
`04f0dbab9937417485fb6e114705c3e7dc4c72e64913bb3de0ff6d4b6341e71a` 预热了
`.ourfairy-template/04f0dbab9937417485fb6e114705c3e7dc4c72e64913bb3de0ff6d4b6341e71a-11.28.5`
（doctor 一次，exit 0）。模板是 gitignore 产物，不入库。

## 新增文档

[`docs/architecture/agent-capabilities.md`](../../../../docs/architecture/agent-capabilities.md)：
默认规则、agent 种类 / owner / parent / 默认工具面 / 授权者表，以及 owner 判断、工具判断、
memory 私有判断三者的边界。没有枚举「种类 × 具体工具名」——第二种非用户 agent 还不存在。

## 没有执行的 / 未覆盖项

- 未跑全量 `npm test`、`npm run combo:verify` 与 Android 门禁：按任务要求留给收口。
- **未 push**。
- 未改动 `MAINTENANCE_PRESET` 的值、`maintenance.ts` 的 child 创建逻辑，也未把任何工具推到
  global layer（#274 的 pdf pilot 保持原样）。
- 新增的「无 owner、无 preset 的会话拿不到产品工具」由 `tests/agent-capabilities.test.mjs`
  的判定用例锁住；当前没有真实 agent 可做端到端断言。
- 模型与网络走替身；不涉及真机或真实云模型。
