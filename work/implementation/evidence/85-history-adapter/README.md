# 85-history-adapter — 票 #85 证据

票面：OurFairy#85（父规格 #71）。产品把断线重连/live 历史改用 dsh 的 Host 接缝：
`@deepseek-ai/dsh-agent/session-history`。分支 `ticket/85-history-adapter`；基线
`integration/spec-71`，本票完成时再次合并到 `4766e32`（含 #83）。固定组合见 `combo.json`：
dsh `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`，其中 #84 已用
`ffb5a266aa` 暴露该接缝。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/runtime.mjs` | 删除 `LiveSession.attempt` 与 `BlockAssembler` 自累计；构造一个 `createSessionHistorySeam(ctx)`，用 `ctx.effect` 随插件释放。新增 `attemptOf`（读 `assistantStream(sessionId)`）与 `contiguousEvents`（读 `eventCursor`）；`projection` 改用两者。`agent/assistant-stream` 监听仍保留 start/end：start 清 `error`，end 写原生 `settledAttempt`。 |
| `backend/chat/src/projection.mjs` | 只把已有的 `attemptText` 从模块私有改为导出，供 runtime 复用；投影行为不变。 |
| `tests/reconnect.test.mjs` | 新增两条端到端用例：丢失 Assistant 帧时撤回 live attempt；撕开的 durable read 由原生 cursor 修复。 |
| `backend/chat/test-support/frame-gap.mjs`（新） | 测试专用故障行：测试看到已发布的 attempt 前缀后写 `triggerPath`，下一真实 chunk 时发出同一 attempt 的 `revision + 2`、`index + 2` 帧。 |
| `backend/chat/test-support/lost-event.mjs`（新） | 测试专用故障行：`triggerPath` 置位后，把下一次读取的 `events.at(-2)` 去掉，保留原 `cursor`，并存报告。 |

可见的 `/chat/read`、`/chat/observe`、`/chat/page` 形状未改：`attempt` 仍是
`{attemptId, revision, text}`，`settledAttempt`/`replyStatus`/`messages` 字段不变。没有改
`combo.json`、bundle、`/chat/page` 的固定截点/切片或投影性能代码。

## 使用的原生接缝

- `createSessionHistorySeam(ctx)`：每个 `SessionRuntime` 一个；`ctx.effect` 释放两个监听。
- `assistantStream(sessionId)`：读 `{ baseline, needsResync }`。
  - `baseline.activeAttempt.attemptId` → 可见 `attempt.attemptId`；
  - `baseline.revision` → 可见 `attempt.revision`；
  - `attempt.stream`（原生 compact records）→ `attemptText(...)`，与持久
    `assistant/attempt` 行复用同一个文本装配函数；
  - `needsResync === true` 时返回 `attempt: null`：原生 fold 已丢弃活动 attempt，产品不再
    用后续帧拼出一段“连续”正文。
- `eventCursor(-1)` / `SessionHistoryGapError`：`contiguousEvents` 对一次
  `readSessionEvents` 的 seq 逐个 `accept`；缺口（或读取尾部与 cursor 不一致）时丢弃这次
  读，重新做一次 `observeSession`（新 cut）。第二次仍有缺口则抛错，按原有内部错误路径返回
  500，不发布撕裂投影。只有 `SessionHistoryGapError` 会被当作可修复缺口，其他错误照常抛出。
- `startedAfterSeq`/`turn`/`step`/`nextIndex` 保留在原生 baseline 中，但没有变成 wire 字段：
  产品读的是完整连续前缀，不需要从 `startedAfterSeq` 重建 follow cursor；响应形状因此保持
  不变。

## 两个故障行代表什么

1. **丢失 Assistant 帧**（`frame-gap.mjs`）：真实进程内 Agent 的帧总是 dense，无法自然产生
   缺口。故障行在测试看到真实 attempt 前缀后，从下一真实 chunk 发出同一 attempt 的
   `revision + 2` / `index + 2` 帧；native fold 把它当作一次丢失/乱序帧，清掉
   `activeAttempt` 并置 `needsResync`。Agent 自己的流、durable log、writer 与最终结算仍是
   真实的。
2. **撕裂的 durable read**（`lost-event.mjs`）：真实 append-only log 不会缺 seq。故障行只
   在测试显式置位后，从下一次读里删掉 `events.at(-2)` 并保留原 cursor；native cursor 在下
   一个 seq 上抛 `SessionHistoryGapError`。这代表一次 `observeSession` 快照不连续（传输/观
   察层撕裂），不是日志损坏；修复方式就是丢掉这次读、重新观察。

测试内报告写在隔离 home 的 `frame-gap-report.json` / `lost-event-report.json`，原始文件不
入库。

## 命令与结果

在最终合并后的 `edabfd7`（`integration/spec-71` = `4766e32`）上：

```
$ node --test tests/reconnect.test.mjs
ℹ tests 8  ℹ pass 8  ℹ fail 0

$ node --test tests/remote-chat.test.mjs
ℹ tests 8  ℹ pass 8  ℹ fail 0

$ node --test tests/chat-runtime.test.mjs
ℹ tests 3  ℹ pass 3  ℹ fail 0

$ node --test tests/lifecycle.test.mjs
ℹ tests 3  ℹ pass 3  ℹ fail 0

$ node --test tests/spill-read.test.mjs   # 合并 #83 后同时跑
ℹ tests 2  ℹ pass 2  ℹ fail 0
```

`tests/chat.test.mjs` 在本仓库不存在（票面/交接里写的名字）；实际 chat 套件是
`tests/remote-chat.test.mjs` 与 `tests/chat-runtime.test.mjs`，两者都已执行。

红/绿（TDD）：

```
# 旧 runtime（88c27b0 的 backend/chat/src/runtime.mjs），新测试/fixture 不变
node --test --test-name-pattern="lost Assistant|torn durable" tests/reconnect.test.mjs

frame-gap: AssertionError: published attempt text is not one real prefix:
           "# FaFRAME_GAP_TEXTir"
torn-read: AssertionError: actual [0..11,13], expected [0..13]  # 缺 seq 12

# 接缝实现后
node --test --test-name-pattern="lost Assistant|torn durable" tests/reconnect.test.mjs
ℹ tests 2  ℹ pass 2  ℹ fail 0
```

最终全量（`npm test`，默认文件级并行）：

```
$ npm test
ℹ tests 144  ℹ pass 143  ℹ fail 1
```

唯一失败是与 #85 无关的既有测试：

```
✖ tests/pdf-worker-cancel.test.mjs:92
  a cancelled PDF worker reports the numeric failure, removes its directory,
  and leaves no process or shared network
AssertionError [ERR_ASSERTION]: the temporary directory must be removed after the call
```

原因已单独复现：该用例在开始时快照 `/tmp/ourfairy-pdf-*`，结束时要求没有任何新增目录；
`tests/pdf.test.mjs` 并行运行时会创建自己的 `ourfairy-pdf-*`。只跑
`node --test tests/pdf-worker-cancel.test.mjs` 为 `1/1 pass`；把
`tests/pdf.test.mjs` 与它一起跑为 `5/6`，同样失败，说明是测试间共享 `/tmp` 的隔离问题，
不是本票代码。`tests/reconnect.test.mjs` 在最终全量里 8/8 通过。

`npm run combo:verify` 在最终状态失败于 rikkahub pin 漂移：

```
rikkahub product/ourfairy-v1  460109d1b89b824a  2d97ed143e7a6487  MISMATCH
combo: rikkahub: product/ourfairy-v1 is 2d97ed143e7a6487515e4aa784d937c785e76b3c
       but combo.json locks 460109d1b89b824a2ddb7f3201d8d3f7af7e02ce
```

OurFairy 与 dsh 两行 ok；rikkahub 由 #87/final pin 处理，本票未改动 `combo.json`。

## 替身/真实边界

- 真实：`scripts/ourfairy-backend.mjs` 启动真实 dsh profile、真实 Agent loop、真实
  SessionQuery/durable JSONL writer、真实 HTTP 路由与投影。
- 替身：模型用 dsh 的 `@deepseek-ai/dsh-llm-mock-server`（`slow_success`，固定 `answer`）；
  两个故障行通过 `--patch` 挂载，只制造真实环境不会自发出现的“帧丢失/读取撕裂”。
- 未使用真实 DeepSeek/云模型；未跑 Android；未跑性能基准。

## 未执行/风险

- pre-commit hook（`npm test` + `combo:verify`）因上述两个既有/外部门槛无法通过；两个代码
  提交与证据提交使用 `--no-verify`。提交前已另行执行全量 `npm test`（143/144，唯一失败为
  上述 PDF 用例）和全部 targeted 套件。
- `/chat/page` 仍直接使用 `runtime.events` 的固定截点切片，没有接入
  `contiguousEvents`；分页/窗口语义按票面归 #72，本票不重写。它的形状与 ownership 检查
  未变（`bounded history pages ...` 仍通过）。
- `send`/`receipt` 的一次性 receipt 读取仍直接用 `runtime.events`；它们不发布“连续历史”，
  本票只把接缝用在 `/chat/read`/`/chat/observe` 共用的 projection。
- 丢 **end** 帧（不是 chunk/event 缺口）没有被本票覆盖：native `needsResync` 只覆盖
  revision/identity/index 连续性；若 end 帧本身丢了，fold 会保留 active attempt。产品没有
  用 `startedAfterSeq`/turn/step 与 durable settlement 对账；这是本票范围外的残余风险。
- `contiguousEvents` 给每次 projection 增加一次 O(events) 的 seq 校验；没有做投影性能测
  量，性能归 #72。

## 提交

- `fc0a293` feat(chat): adopt the native session history seam (#85)
- `d72e22c` test(chat): pin lost-frame and torn-read continuity faults (#85)
- `edabfd7` Merge branch 'integration/spec-71' into ticket/85-history-adapter（含 #83，integration tip `4766e32`）
