# 165-job-stop-outcome — 票 #165 证据

票面：本地 [`work/tickets/135/02-job-stop-outcome.md`](../../../../tickets/135/02-job-stop-outcome.md)（父票 #135）。
范围：`/chat/jobs/stop` 只映射产品认识的原生 `JobRegistry.kill` 结果；未知结果响亮失败，并与
pinned dsh 的 `kill` 返回类型在测试期对账。

基线：`integration/spec-135` @ `cd0c6c7`（`git merge-base --is-ancestor` 通过，工作树干净）。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/jobs.mjs` | 新增 `STOP_OUTCOME = { requested: 1, 'already-finished': 2 }` 与窄映射函数 `stopOutcomeOf(result)`；表外值抛 `ChatError(500, 'chat/unknown-stop-outcome', …)`，消息带 `JSON.stringify(result)`。`jobStop` 的 `result === 'requested' ? 1 : 2` 改为 `stopOutcomeOf(result)`。不可用任务仍提前返回 `0`，不调用 `kill`。 |
| `tests/native-job-stop-outcome.test.mjs`（新增） | 3 条：`native job stop outcome vocabulary matches the adapter` 用 TypeScript 编译器 API 读 pinned dsh `packages/jobs/jobs/lib/types/index.d.ts` 中 `JobRegistry.kill` 的返回联合，与 `Object.keys(STOP_OUTCOME)` 双向对账；`known native stop outcomes keep their numeric wire contract` 用 adapter 入口断言 `requested → 1`、`already-finished → 2`、不可用 → `0` 且不调用 `kill`；`an unknown native stop outcome is a 5xx product error naming it` 断言 `paused` 得到 5xx、`chat/...` 码、消息含 `paused`，而不是 2。 |
| `backend/chat/README.md` | 「后台任务」补充停止结果的未知值契约：只映射 `requested`/`already-finished`，其它原生值 500 `chat/unknown-stop-outcome` 且消息带原始值，不折叠成 2；指向对账测试。 |

行为要点：

- 已知值线契约不变：`requested → 1`、`already-finished → 2`、不可用任务 `→ 0`。
- 表外值（如 `paused`）在 `kill` 与 `barrier` 之后抛 500，`postHandler` 以该状态与产品码返回，
  不再伪装成「已结束」。
- `/chat/jobs/output`、任务状态与 `TASK_STATUS` 未改动（票 #163 范围）。

## Red / green

Red（实现前，adapter 未知值用例）：

```
$ node --test tests/native-job-stop-outcome.test.mjs
✖ an unknown native stop outcome is a 5xx product error naming it
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
ℹ tests 1 / pass 0 / fail 1
```

即旧实现把 `paused` 折叠成 `2` 正常 resolve，测试因「没有抛错」失败。

Green 1（加 `STOP_OUTCOME`/`stopOutcomeOf` 并让 `jobStop` 使用后）：

```
$ node --test tests/native-job-stop-outcome.test.mjs
✔ an unknown native stop outcome is a 5xx product error naming it
ℹ tests 1 / pass 1 / fail 0
```

Green 2（补上对账与已知值契约用例后）：

```
$ node --test tests/native-job-stop-outcome.test.mjs
✔ native job stop outcome vocabulary matches the adapter
✔ known native stop outcomes keep their numeric wire contract
✔ an unknown native stop outcome is a 5xx product error naming it
ℹ tests 3 / pass 3 / fail 0
```

对账测试是守卫：在正确实现上它必须绿；它的「红」由下面的灵敏度检查证明，而不是靠一次自然失败。

## 灵敏度检查

对账测试读取 pinned 声明本身，没有第二份原生成员清单。用两次临时变异证明两个方向都会失败并
指出成员名（改的是本仓库的 `STOP_OUTCOME`，等价于上游增/删成员；每次跑完立即还原）：

| 变异（模拟的上游变化） | 失败断言与消息 |
| --- | --- |
| 从 `STOP_OUTCOME` 删掉 `already-finished`（等价于上游新增成员） | `native job stop outcome vocabulary matches the adapter`：`native members with no wire outcome: already-finished; product keys with no native member: none`；同次运行中已知值用例也失败（`already-finished` 变成 5xx） |
| 向 `STOP_OUTCOME` 加 `paused: 0`（等价于上游删除成员） | 同一断言：`native members with no wire outcome: none; product keys with no native member: paused`；同次运行中未知值用例也失败（`paused` 不再抛错） |

两次变异后均已还原（`diff -q` 确认），工作树只含本票预期改动。

## 验收命令与结果

```
$ node --test tests/native-job-stop-outcome.test.mjs tests/native-job-status.test.mjs
ℹ tests 5 / pass 5 / fail 0
```

```
$ node --test tests/jobs.test.mjs
ℹ tests 9 / pass 9 / fail 0
```

`tests/jobs.test.mjs` 未改动，booted 套件原样通过（已知 `outcome` 1 与不可用 `0` 的既有断言不变）。

```
$ npm run combo:verify
ourfairy        integration/ourfairy-v1  cd0c6c779957fe4e  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  ok
android source  -                        460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

全量 `npm test` 在当前共享机器高负载（load average 21–49，32 核）下多次出现与本票无关的失败：
`tests/remote-chat.test.mjs` 的 `all remote paths reject anonymous and foreign owners…`。该文件
前一用例（`the same request id sent twice in a row produces one message`）发出一条慢速 mock 回复后
没有等待它落盘，下一用例的会话产物快照窗口内仍会收到后台写入，于是 hash/mtime 变化。证据表明
与本票无关：

- `node --test tests/remote-chat.test.mjs` 连续 3 次全绿（9/9）；
- 把本票新增的测试文件移出后跑全量（238 条，与基线测试数相同）仍复现同一失败；
- 基线提交 `cd0c6c7` 的一次全量运行为 238/238 通过，说明它是负载/时序相关的既有竞态，
  不是本票改动或新增用例造成。

`node --test tests/speech.test.mjs` 在隔离运行中同样全绿（2/2）；全量运行时它也曾随高负载失败。

`npm run combo:verify` 单独运行通过（见上）。负载回落后重试提交，pre-commit 钩子在同一工作树
完整跑通两个入口：

```
$ npm test        # pre-commit hook
ℹ tests 241 / suites 7 / pass 241 / fail 0

$ npm run combo:verify   # pre-commit hook
ourfairy        integration/ourfairy-v1  cd0c6c779957fe4e  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  ok
android source  -                        460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

即先前失败是共享机器高负载下的既有竞态，未使用 `--no-verify`。

## 合并后（最终状态）

`git merge integration/spec-135` 无冲突，合并提交 `01c9620` 带入了 #164/#167 的改动，其中
`7f3d979`（`test(chat): settle the accepted turn before the next artifact snapshot`）正是上述
remote-chat 竞态的修复。在合并后的工作树重跑完整入口：

```
$ npm test
ℹ tests 242 / suites 7 / pass 242 / fail 0

$ npm run combo:verify
ourfairy        integration/ourfairy-v1  01c9620bbd3fce4a  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  ok
android source  -                        460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

## 未完成项

- 无。
- 说明：booted 后端无法制造未知的原生 `kill` 返回值（原生 registry 只会返回自己的成员），
  因此未知值路径由 adapter 级用例覆盖，与票 #163 的 `/chat/jobs/output` 做法一致。
- 范围外观察：`tests/remote-chat.test.mjs` 的既有竞态（前一用例发出慢速 mock 回复后未等其落盘，
  下一用例的会话产物快照会看到后台写入）已由集成分支的 `7f3d979` 修复；本票未修改该文件。
