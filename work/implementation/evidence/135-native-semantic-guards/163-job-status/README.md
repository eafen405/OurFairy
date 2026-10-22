# 163-job-status — 票 #163 证据

票面：本地 [`work/tickets/135/01-job-status.md`](../../../../tickets/135/01-job-status.md)（父票 #135）。
范围：任务状态词表的未知值显式化，并让 pinned dsh `JobStatus` 的增删在测试期失败。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/units.mjs` | 新增 `taskStatusOf(status)`：`TASK_STATUS` 有该键时返回数字，否则返回 `0`（未知）。`tasksAt` 改用它；`TASK_STATUS` 仍是唯一一张表，已知键值未动。 |
| `backend/chat/src/jobs.mjs` | `/chat/jobs/output` 的 `status` 改用同一个 `taskStatusOf(job.status)`，不再有第二处裸查表。 |
| `tests/projection-units.test.mjs` | 新增 1 条：合成 `jobs/lifecycle`（原生状态 `paused`）经 `workDefinition` 折叠后，可用与不可用两种可用性都得到 `status: 0`，活动摘要为 `0`。既有冻结期望未改。 |
| `tests/native-job-status.test.mjs`（新增） | 2 条：`native job status vocabulary matches the projection` 用 TypeScript 编译器 API 读 pinned dsh 的 `packages/jobs/jobs/lib/types/view.d.ts`，把 `JobStatus` 的字符串字面量成员与 `TASK_STATUS` 的键逐项对账；另一条用 adapter 入口驱动 `/chat/jobs/output`，原生状态不在表内时 `status` 字段存在且为 `0`。 |
| `tests/helpers/dsh-peers.mjs` | 为直接 import `jobs.mjs` 补 3 个 anchor：`@deepseek-ai/dsh-jobs`、`@deepseek-ai/schemastery`、`@ourfairy/dsh-identity`（`@ourfairy/dsh-sessions` 的传递依赖）。 |

行为要点：

- 未知原生状态在投影与 `/chat/jobs/output` 中都是数字 `0`（字段存在），不是 `undefined`，也不是任何终态数字。
- `activityAt` 既有的 `unknown` 判定（`task.status === 0 || task.report.status === 6`）现在能看见未知任务，
  因此摘要为 `0`（未知 / 不可收敛），不再落到 `1`（安静）；未知状态也不进入 `reasons` 的 2，因此不会被
  报告成活跃。
- 已知 `running/stopping/completed/killed/failed → 1/2/3/4/5` 不变；`terminal(0)` 为 false，
  不可用任务的既有终态收敛（3/4/5 保留）不变。

## Red / green

Red 1（实现前，`tests/projection-units.test.mjs`）：

```
$ node --test tests/projection-units.test.mjs
✖ an unmapped native job status is explicit unknown, not an absent field or a quiet session
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
    actual: undefined
    expected: 0
ℹ fail 1
```

Green 1（加 `taskStatusOf` 并让 `tasksAt` 使用后）：

```
$ node --test tests/projection-units.test.mjs
ℹ tests 15 / pass 15 / fail 0
```

Red 2（`jobs.mjs` 改动前，`tests/native-job-status.test.mjs` 的 adapter 用例）：

```
$ node --test tests/native-job-status.test.mjs
✖ an unmapped native job status is an explicit unknown in /chat/jobs/output
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  undefined !== 0
```

Green 2（`/chat/jobs/output` 改用 `taskStatusOf` 后）：

```
$ node --test tests/native-job-status.test.mjs
✔ native job status vocabulary matches the projection
✔ an unmapped native job status is an explicit unknown in /chat/jobs/output
ℹ tests 2 / pass 2 / fail 0
```

对账测试是守卫：在正确实现上它必须绿；它的「红」用下面的灵敏度检查证明，而不是靠一次自然失败。

## 灵敏度检查

对账测试读取的是 pinned 声明本身，没有第二份原生成员清单。用两次临时变异证明两个方向都会
失败并指出成员名（改的是本仓库的 `TASK_STATUS`，等价于上游增/删成员；每次跑完立即还原）：

| 变异（模拟的上游变化） | 失败断言与消息 |
| --- | --- |
| 从 `TASK_STATUS` 删掉 `failed: 5`（等价于上游新增 `failed`） | `native job status vocabulary matches the projection`：`native members with no wire status: failed; product keys with no native member: none` |
| 向 `TASK_STATUS` 加 `paused: 0`（等价于上游删除一个成员） | 同一断言：`native members with no wire status: none; product keys with no native member: paused` |

未知状态经折叠的灵敏度：把 `tasksAt` 临时还原为裸查表后，用同一合成日志直接读折叠结果：

```
$ node --input-type=module -e '…workDefinition.apply(jobs/lifecycle status="paused")…'
{"hasStatus":true,"activity":1}
```

即修复前任务对象的 `status` 是 `undefined`（`JSON.stringify` 会丢掉该字段，正是票面描述的漏出方式），
活动摘要落到 `1`（安静）。修复后同一条日志得到 `status: 0`、`activity: 0`，由
`tests/projection-units.test.mjs` 的新用例固定。两次 `TASK_STATUS` 变异与这次临时还原均已恢复，
工作树只含本票预期的改动。

## 验收命令与结果

合并后状态（`080a687`，已合入 `integration/spec-135` tip `3ebc115`，无冲突）：

```
$ node --test tests/projection-units.test.mjs tests/projection-fold.test.mjs tests/projection-units-real.test.mjs tests/native-job-status.test.mjs
ℹ tests 21 / pass 21 / fail 0

$ node --test tests/jobs.test.mjs
ℹ tests 9 / pass 9 / fail 0

$ npm test
ℹ tests 238 / suites 7 / pass 238 / fail 0

$ node --test --test-concurrency=1 "tests/**/*.test.mjs"
ℹ tests 238 / pass 238 / fail 0
```

`npm test` 基线 235 条（合并 167 后），本票新增 3 条（投影 1 + 新文件 2），共 238。
`tests/jobs.test.mjs` 未改动，booted 套件原样通过。

```
$ npm run combo:verify
ourfairy        integration/ourfairy-v1  080a687e05c83489  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  ok
android source  -                        460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

并行负载记录：合并后有一次 `npm test` 只失败 `tests/remote-chat.test.mjs` 的
`all remote paths reject anonymous and foreign owners…`（`artifacts()` 的 hash/mtime 快照与后台会话写入
竞争）。该失败在**未合入本票**的 `integration/spec-135` tip `3ebc115` 上同样复现（同次还失败 PDF、
speech 等 4 条），单独跑 `tests/remote-chat.test.mjs` 9/9 通过；串行全量 238/238 通过，随后并行
`npm test` 也 238/238 通过。结论：共享机器负载下的既有 flake，不是本票引入；未用 `--no-verify`。

## 合并

- `080a687` Merge branch 'integration/spec-135' into ticket/163-job-status（无冲突；带入 167 的
  `tests/remote-chat.test.mjs` 用例与证据目录）。

## 未完成项

- 无。
- 说明：`/chat/jobs/output` 的未知原生状态无法在 booted 后端里制造（原生 registry 只会报告自己的
  成员），因此该路径由 adapter 级用例覆盖；booted 的 `tests/jobs.test.mjs` 保持不动。
