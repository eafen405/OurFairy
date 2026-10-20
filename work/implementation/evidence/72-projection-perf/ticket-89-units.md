# #89 投影单元：transcript / tasks+activity 注册到原生 registry

本票新增 `backend/chat/src/units.mjs`，把「每次读取都全量 fold」的两个折叠改为注册在原生
`ctx.sessionProjections` 上的增量单元；读取路径与 wire 形状不变（切换是 #90/#91）。#89 合并时，
旧 `projection.mjs` / `history.mjs` 折叠暂时保留作测试的独立对照；#90 已删除它们，期望值冻结在
`tests/fixtures/projection-expected.json`。本文件保留 #89 当时的记录，当前状态以 #90 与本目录索引为准。

- 单元：`ourfairyTranscript`（transcript 行 + 窄 receipts）、`ourfairyWork`（任务 + 活动，
  一次 fold 两个读函数）。
- 注册：`backend/chat/src/index.mjs` 的 `apply` 调用 `registerProjectionUnits(ctx)`；`inject`
  增加 `sessionProjections`。
- receipt：`service.mjs` 的 `/chat/send` 幂等与 `/chat/receipt` 改从单元 state 取，不再扫描事件日志。
- 依赖：`backend/chat/package.json` 增加普通 `dependencies.zod ^4.4.3`（见研究笔记 §3 的实测）。

## 1. 契约（实现依据）

| 项 | 事实 |
| --- | --- |
| key | `ourfairyTranscript`、`ourfairyWork`（稳定，注册/读取都用它） |
| stateVersion | #89 首版为 `1`；**当前 transcript 为 `3`**（不可变首次出现 + 有序 transitions + move 索引）、**work 为 `2`**（pending 收窄为 id/kind），折叠语义或 state 形状变化时递增 |
| stateSchema | zod；state 为纯 JSON，可被 registry checkpoint |
| apply | 同步纯函数；不关心的事件返回**同一 state 引用**（有测试断言 `Object.is`） |
| wire | 两个单元都**没有** `wire`：只用 `register` / `stateOf`，避免每次变化都做 O(n) 的 `viewSchema.parse` |
| durable | transcript 行、receipts、任务 roster/report、活动 episode/completed/delivery |
| live | `availability`、Agent `running`、attempt 文本、`replyStatus`、`stopping`、`error`、`settledAttempt` 不进 state |
| 截点 | 行记不可变 `first`（首次出现 seq + status）与有序 `transitions`（seq + status + `repositions`），移动行的 transition 进入 `moves`；任意 `throughSeq` 可还原 |

任务与活动共享一个单元的原因写进模块头与 README：活动判定读每个事件后的任务/report 状态，
拆成两个单元会把 report 状态机复制一份，形成第二套权威（spec 明令禁止）。

## 2. 改动文件

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/units.mjs` | 新增：两个单元的 schema、`init`、`apply`、`transcriptAt`、`tasksAndActivityAt`、`receiptFrom`、`registerProjectionUnits` |
| `backend/chat/src/index.mjs` | 注册单元；`inject` 加 `sessionProjections` |
| `backend/chat/src/service.mjs` | receipt 查询改读单元 state |
| `backend/chat/package.json` | `dependencies.zod` |
| `backend/chat/README.md` | 投影单元契约与 durable/live 分界 |
| `tests/helpers/dsh-peers.mjs` | 新增：测试里把 dsh peer 解析到 `combo.json` 锁定的检出 |
| `tests/projection-units.test.mjs` | 新增：固定日志上逐字段对照冻结期望（#89 时直接对照旧 fold） |
| `tests/projection-units-real.test.mjs` | 新增：真实 launcher + 模型替身写出的会话日志上做同样的对照 |

## 3. 实际命令与结果

环境：Node v24.18.0，WSL2（`Linux LAPTOP-45RC44AF 6.6.87.2-microsoft-standard-WSL2 x86_64`）。
dsh 检出为 `combo.json` 锁定的 `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`。

命令在 `.worktrees/89-projection-units`（分支 `ticket/89-projection-units`）执行：

```bash
# 1. 单元测试（基于 ticket 提交，未合集成分支）
node --test tests/projection-units.test.mjs
# → tests 10 / pass 10 / fail 0，142 ms

# 2. 合入集成分支 tip（88c27b0），无冲突
git merge integration/spec-72 --no-edit
# → 13 files changed, 340 insertions(+), 31 deletions(-)

# 3. 单元 + 真实会话日志对照
node --test tests/projection-units.test.mjs tests/projection-units-real.test.mjs
# → tests 11 / pass 11 / fail 0，4.9 s
#   其中 "the units reproduce the full folds over a real session log" 4.51 s

# 4. 已有 chat / 投影回归
node --test tests/remote-chat.test.mjs tests/chat-runtime.test.mjs tests/reconnect.test.mjs tests/projection-fold.test.mjs
# → tests 19 / pass 19 / fail 0，27.6 s
```

`tests/projection-units-real.test.mjs` 走真实 launcher（新装 profile）、认证后的 HTTP/SSE 面与
模型替身，因此同时证明「`backend/chat` 声明普通 `zod` 依赖后 profile 仍可安装并启动」。

## 4. 覆盖的验收点

| 验收点 | 证据 |
| --- | --- |
| 两个单元注册在原生 registry 上（transcript 一个；任务与活动一个单元两个输出） | `tests/projection-units.test.mjs` 的 registry 用例；`registerProjectionUnits` 用公开 `register` |
| 无关事件返回同一 state 引用 | `a unit applies an unrelated event as the same state reference`（`Object.is`） |
| 与改造前 `transcript()` / `projectSession()` 逐字段一致 | `transcriptLog()` / `workLog()` 固定日志对照；真实会话日志对照 |
| receipt 只读单元 state，acceptedSeq 与消息身份不变 | `the transcript unit answers receipts without reading the log` |
| 冷日志与热日志折叠一致 | `a checkpointed state continues the same fold as a cold replay`（checkpoint 经 `stateSchema` 后再前进，与从 `init` 全量重放一致） |
| `zod` 为普通依赖且 profile 可启动 | 真实 launcher 用例（新 home 安装后启动） |
| `stateVersion` 语义写进模块说明 | `units.mjs` 模块头 + `backend/chat/README.md`「投影单元」 |
| 任意截点还原行 seq/status | `every cut of the transcript matches the frozen value for that prefix` |

## 5. 未执行项

- **没有跑全量 `npm test`。** 本票只跑定向文件；全量留给 #95 的最终集成验证。
- **没有切换读取路径。** `/chat/read`、`/chat/observe`、`/chat/page` 在本票仍走旧的全量 fold，
  这是 #90/#91 的范围；本票只钉住两套实现等价。
- **没有性能数据。** 单元注册本身不改变本票可观测的延迟；改造前后对比属 #94。
- **没有真实云服务与 Android 设备。** 全程模型替身；客户端不涉及。
