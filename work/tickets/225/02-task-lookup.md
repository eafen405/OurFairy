## Parent

[#225 会话读取：完整页操作与任务身份访问](https://github.com/eafen405/OurFairy/issues/225)

## Blocked by

- [T1 页读取：SessionRuntime 完整页操作](https://github.com/eafen405/OurFairy/issues/226)
  （共享 fake native world helper 由 T1 抽取）

## What to build

在现有 work projection unit 内形成窄任务查找 interface；任务列表与单任务查找复用同一套行投影与
live overlay。

- `backend/chat/src/units.ts`：把任务行投影收敛成一份实现（状态映射、报告降级、generation
  可用性、live overlay），供完整列表与单任务查找共用；新增按产品任务标识查找、返回
  `{ task, jobId }` 或 `null` 的读取函数，`jobId` 只在当前 generation 的原生任务可用时非空。
- `backend/chat/src/runtime.ts`：增加窄任务查找操作（如 `taskOf(state, taskId)`）；只读 work
  projection unit state 与 `ctx.jobs` 原生注册表，不读 attempt / messages / activity，不调用完整
  `projection`，不初始化事件 window。
- `backend/chat/src/jobs.ts`：`jobOutput` / `jobStop` 使用查找结果里的原生 `JobId` 调用
  `readAt` / `get` / `kill`；删除从产品 `taskId` 切割 generation 与原生 id 的字符串逻辑，不再构造
  整份会话投影。

## Acceptance

- [ ] 单任务查找与完整列表共用同一套任务行投影、状态映射、报告降级与 generation 可用性判断。
- [ ] 查找结果只有三种：`null`、任务 + `null` jobId、任务 + 有效 jobId。
- [ ] 任务访问不调用 `observeSession`，首次输出/停止不初始化无关事件 window；不新增持久状态、
      module 或表。
- [ ] 旧 generation 任务不会被解析为重启后的同名任务。
- [ ] 既有 404、降级输出、停止结果 0、1/2/整体 500、输出偏移/输出环、重启身份、权限回归通过。
- [ ] `tests/native-job-status.test.mjs` 与 `tests/native-job-stop-outcome.test.mjs` 的替身改为
      新的任务查找 seam，不构造整份 projection。
- [ ] `npm run build` 与相关测试通过；证据写
      `work/implementation/evidence/225-task-lookup/README.md`。

## Baseline

- worktree：`.worktrees/225-task-lookup`；分支：`ticket/225-task-lookup`；基线：
  `integration/spec-225`（含 T1）。
- 完成后把 `integration/spec-225` tip 合入本分支并报告冲突处理。
