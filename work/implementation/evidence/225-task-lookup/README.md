# #225 T2 任务身份访问：work 单元的窄任务查找

日期：2026-10-25。票面见[工作副本](../../../tickets/225/02-task-lookup.md)，父规格见
[#225](https://github.com/eafen405/OurFairy/issues/225)。开工基线为 `integration/spec-225` 的
`c1c633265e`（含 T1）；收尾合并时该分支 tip 未前进，`git merge integration/spec-225` 为
`Already up to date.`。

## 结论与范围

- `backend/chat/src/units.ts`：任务行投影收敛成一份 `taskRowOf`。完整列表 `tasksAt` 与新增的
  `taskAt(state, ctx, sessionId, taskId)` 都经 `taskRowWithJob` 组装，共用状态映射、报告降级
  （`report.status` 1/2 → 6）、generation 可用性与 live overlay。`taskAt` 返回 `{ task, jobId }`
  或 `null`；`jobId` 仅在行 generation 等于 `ctx.jobs.generation` 且该会话仍持有同名原生 job 时
  为非空 `JobId`。`taskId` 来自不可信 JSON，查找先过 `Object.hasOwn(state.rows, taskId)`，
  `__proto__` / `constructor` 一类继承名不会伪造任务。
- `backend/chat/src/runtime.ts`：新增 `SessionRuntime.taskOf(state, taskId)`；只读 work projection
  unit state 与 `ctx.jobs` 原生注册表，不读 attempt / messages / activity，不调用 `projection`，
  不初始化事件 window。非字符串与不存在的 id 返回 `null`。
- `backend/chat/src/jobs.ts`：`jobOutput` / `jobStop` 改用 `runtime.taskOf` 与返回的原生 `JobId`
  调用 `ctx.jobs.readAt` / `get` / `kill`；删除按 generation 长度切割产品 taskId 的逻辑，不再
  为找一个任务构造整份会话投影。404、不可用输出形状（`availability: 0`、空 `chunks`、既有
  `next`/`lossy`/`status`）、不可用停止 0、可用输出取注册表最新投影、停止进入
  `runtime.barrier`、停止结果 1/2 与未知结果 500 `chat/unknown-stop-outcome` 均保持原样。
- `tests/helpers/chat-world.mjs`：扩展 fake native jobs registry（generation、`list`/`get`/
  `readAt`/`kill`、事件订阅、调用记录、输出与 kill 结果设置）并记录 durability barrier 的
  `sessions.flush`。仍只有这一个 fake native world，未新增第二套世界。
- 未改路由、响应字段、数字编码、SSE、Android、数据库、projection 持久 state 与 `stateVersion`；
  未新增 module、表或持久状态。

## 改动面

- `backend/chat/src/units.ts`：`rowWithReport` / `liveJobsOf` / `taskRowOf` / `taskRowWithJob`，
  新增导出 `taskAt`；`rosterOf`、`tasksAt` 改走同一行投影。
- `backend/chat/src/runtime.ts`：新增 `taskOf`。
- `backend/chat/src/jobs.ts`：两个操作改走查找结果的原生 `JobId`。
- `tests/chat-task-lookup.test.mjs`（新）：6 条经 `runtime.open` + 生产 `installJobs` 的行为用例。
- `tests/helpers/chat-world.mjs`：jobs registry 替身与 flush 记录。
- `tests/native-job-status.test.mjs`、`tests/native-job-stop-outcome.test.mjs`：runtime 替身改为只提供
  `taskOf` 的 `{task, jobId}`，不再构造整份 projection；词表对账保持不变。

## 测试覆盖

`tests/chat-task-lookup.test.mjs` 经 `jobOutput` / `jobStop` 覆盖：

- 任务不存在、非字符串、`__proto__` / `constructor` / `toString` 等非自有行名：既有 404
  `chat/job-not-found`，且 `runtime.taskOf` 返回 `null`。
- 跨会话任务：两个会话各自折叠任务，互相查找均为 404。
- 旧 generation 任务 + 重启后同名 live job：输出降级、停止 0，且不调用 `readAt` / `get` /
  `kill`；同名 job 不被解析。
- 当前可用任务：`readAt` / `get` / `kill` 收到的 id 都是查找返回的原生 `JobId`；
  stop 结果 1 与 2 保留，并进入 durability barrier。
- 当前 generation 但注册表已不持有该 job 的保留任务：降级输出保留既有形状，停止 0 不调用
  `kill`。
- 查找行与列表行同源：可用/不可用两种状态下 `status`、`availability`、`report.status`
  逐字段断言（含报告降级 6）。
- 全部用例在 `sessionQuery.observeSession` 替身处断言 `world.reads.length === 0`，不以
  `state.window` 作证据。

## red-green 与命令结果

红（基线 build 后、实现前，工作树）：

```sh
npm run build
# exit 0

node --test tests/chat-task-lookup.test.mjs
# exit 1；0 pass / 6 fail
# 2 条 TypeError: runtime.taskOf is not a function；
# 4 条 world.reads 断言失败（任务访问经旧 projection 触发 1~2 次 observeSession）
```

红态与最小实现同处提交 `23e0975299`：本仓库 commit hook 要求提交时相关测试为绿，故没有单独的红
提交；红态运行结果按证据协议不把原始日志入库。

绿（实现后）：

```sh
npm run build
# exit 0（tsc --fresh 无诊断）

node --test tests/chat-task-lookup.test.mjs
# 6/6 通过，0 失败

node --test tests/chat-task-lookup.test.mjs tests/native-job-status.test.mjs \
  tests/native-job-stop-outcome.test.mjs tests/projection-units.test.mjs \
  tests/projection-fold.test.mjs tests/chat-read-window.test.mjs
# 40/40 通过，0 失败

node --test tests/jobs.test.mjs
# 10/10 通过，0 失败（真实后端进程 + 真实 HTTP）
```

提交门禁（`.githooks/pre-commit` → `scripts/precommit.ts`）：

- `23e0975299`（work 单元查找 + 新测试 + helper）：`tests/helpers/` 触发 full gate；
  `npm test` 320/320 通过，`npm run combo:verify` 报 `combo: combination verified`。
- `8a2db51b62`（两个词表替身改写）：related gate，5/5 通过，`combo:verify` 通过。

收尾合并后重跑（最终状态）：

```sh
git merge integration/spec-225
# Already up to date.（integration tip 仍为 c1c633265e）

node --test tests/chat-task-lookup.test.mjs tests/native-job-status.test.mjs \
  tests/native-job-stop-outcome.test.mjs tests/projection-units.test.mjs \
  tests/projection-fold.test.mjs tests/chat-read-window.test.mjs \
  tests/jobs.test.mjs
# 50/50 通过，0 失败（含 jobs.test 的 10 条真实后端用例）
```

## 证据性质

- `chat-task-lookup`、`chat-read-window`、`projection-units`、`projection-fold`、
  `native-job-status`、`native-job-stop-outcome` 是**测试替身证据**：原生 Agent / jobs /
  sessionQuery / sessionPersistence 由 fake world 提供，但 projection units、runtime、
  任务行投影与 jobs module 跑的是真实产品实现。零事件读取在 fake `sessionQuery.observeSession`
  seam 上观测，不是对内部 state 的断言。
- `jobs.test.mjs` 是**真实后端进程 + 真实 HTTP** 证据：真实 dsh 原生持久化与真实 jobs
  registry，模型由测试内本地 SSE mock server 提供。它不是官方 DeepSeek 或真实云服务证据。
- `npm run build` 只证明编译与类型检查通过，不等于运行时验收。

## 未完成项与残留风险

- 未知原生停止结果只能由替身构造（真实 registry 只返回自己的成员）；`500
  chat/unknown-stop-outcome` 的覆盖来自 `tests/native-job-stop-outcome.test.mjs`，与改动前一致。
- fake jobs registry 是内存替身：输出环、retention、spill 与跨进程重启语义由 `jobs.test.mjs`
  的真实后端用例覆盖，本次没有复制这些路径。
- 最终提交序列中全量 `npm test` 在 `23e0975299`（helper 改动触发）跑过；其后只有两个词表测试与
  本证据文档，分别经 related / docs gate。按票面未在最终 HEAD 再跑全量 `npm test`，最终集成状态的
  全量门禁由 Lead 收口执行。
- 未执行 Android、真机、官方模型服务或数据库验收（本票无相关改动）。
- 未记录性能数据；「任务访问不初始化事件 window」是本票的行为断言，不构成延迟或内存承诺。
