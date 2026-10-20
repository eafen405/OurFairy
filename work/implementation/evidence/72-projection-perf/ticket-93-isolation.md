# #93 多观察者共享与多会话隔离

本票只在真实 launcher 与模型替身上证明 #90 的「按会话共享、按观察者格式化」：同一会话的两个
`/chat/observe` 看到同一份投影，断线重连后仍一致；两个会话并发流式时各自的 `/chat/read`
保持有效、单调增长。共享实现来自 #90，**本票没有生产代码改动**，也不改
`scripts/bench-projection.mjs`：测试全部通过，未观察到需要修的缺陷。

## 1. 改动

- 新增 `tests/chat-multi-observer.test.mjs`：只用公共 HTTP/SSE 面（`/chat/send`、
  `/chat/observe`、`/chat/read`、`/sessions/create`）与真实 `runBackendAsync` 启动的后端；
  模型替身固定 2048 字符、每片 8 字符、片间隔 10 ms，即 256 个片段。
- 观察同一会话的两个连接时，只比较同一 `version` 的公共字段
  `version/messages/attempt/settledAttempt/replyStatus/error`。各观察者的
  `throughSeq/fromSeq` 是 #90 设计的每观察者切片范围，故不比较；不使用内部计数或私有字段。
- 不新增测试辅助脚本、不改 wire/错误码/路由，也不改 `combo.json`。

## 2. 精确命令

```bash
git merge integration/spec-72 --no-edit        # 合并 3cd25d2
node --test tests/chat-multi-observer.test.mjs tests/chat-read-window.test.mjs tests/docs.test.mjs
node scripts/bench-projection.mjs --out work/implementation/evidence/72-projection-perf/after-93-run1.json
node scripts/bench-projection.mjs --out work/implementation/evidence/72-projection-perf/after-93-run2.json
```

本机：AMD Ryzen 9 8945HX / 32 核 / 24 GiB，WSL2，Node v24.18.0；后端 dsh
`5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`，被测产品提交 `34963d7`（两次基准的
`machine.productHead` 一致）。

## 3. 多观察者共享（test 1）

- 第一个 observe 在发送前打开；收到 `replyStatus=1` 且 `attempt.text` 非空的流中帧后，再打开
  第二个 observe。两者在 4 个公共 `version` 上逐字段相等，且版本与 attempt 文本在比较区间内
  持续增长（证明比较发生在流式过程中，而不是结束后补拍）。
- 关闭第一个连接、立即重连：新连接与留守观察者在后续 3 个公共 `version` 上再次相等。
- 回复 settle 后，两个连接的末帧相等；`/chat/read` 的 `messages` 与末帧相同，`attempt=null`、
  `replyStatus=0`，且恰有一条 `role=2,status=2` 的已提交回复。
- 同次运行的测试计数：8 个测试全部通过（本文件 2 个 + `chat-read-window` 5 个 + `docs` 1 个）。

## 4. 基准：观察者数对比（#88 脚本，同机同参数）

每个负载 2 次重复，`observerCounts [1,2]`；「片段 CPU/观察者」取脚本的
`cpuMsPerFragmentPerObserver`，「片段 CPU 合计」= 该值 × 观察者数，「观察者间 spread」是同一
片段两个观察者收到帧的间隔差。完整数据见
[after-93-run1.json](after-93-run1.json) 与 [after-93-run2.json](after-93-run2.json)。

| 轮次 | 负载 | 观察者 | read p50/p95 (ms) | 片段 CPU/观察者 (ms) | 片段 CPU 合计 (ms) | spread p50/p95 (ms) | VmHWM (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| run1 | 40 turns | 1 | 6.23 / 8.39 | 2.43 | 2.43 | — | 255.7 |
| run1 | 40 turns | 2 | 6.90 / 10.55 | 1.74 | 3.48 | 1.07 / 2.06 | 256.8 |
| run1 | 160 turns | 1 | 5.80 / 7.86 | 2.49 | 2.49 | — | 386.1 |
| run1 | 160 turns | 2 | 6.12 / 12.58 | 1.73 | 3.46 | 1.14 / 2.45 | 383.7 |
| run2 | 40 turns | 1 | 6.29 / 8.21 | 2.44 | 2.44 | — | 254.5 |
| run2 | 40 turns | 2 | 7.39 / 11.05 | 1.73 | 3.46 | 1.09 / 2.30 | 256.7 |
| run2 | 160 turns | 1 | 5.99 / 8.36 | 2.47 | 2.47 | — | 385.4 |
| run2 | 160 turns | 2 | 6.24 / 18.29 | 1.79 | 3.58 | 1.21 / 2.29 | 385.3 |

读数：同样负载下，第二个观察者把**每观察者**的每片段 CPU 从约 2.4–2.5 ms 降到约 1.7–1.8 ms
（共享 seed 与单元状态，第二份只付格式化与写出），**合计**每片段约 3.4–3.6 ms，是单观察者的
约 1.4–1.5 倍而非 2 倍；VmHWM 在 1/2 观察者之间差异在 ±2% 量级（160 turns 单观察者的一次
402 MB 是采样/GC 波动）。`/chat/read` 的 p50 在所有组合里约 5.8–7.4 ms；p95 随探针调度波动
（7.9–19.8 ms），**本票不设阈值**，#94 负责相对门槛。2 观察者时两连接逐帧的 spread 中位数
约 1.1 ms、p95 约 2.0–2.5 ms，说明两份输出来自同一发布。

## 5. 并发会话观察（test 2）

两个已注册用户各建一个无历史会话，在同一轮里先各自 `send` 再进入读循环；模型替身同负载
（2048 字符 / 256 片）。循环期间每个会话各完成 88 次 `/chat/read`，两侧都出现
`replyStatus=1` + `attempt≠null`（同一轮读里并发在飞），最终都落到一条已提交回复：

| 会话 | read 样本 | p50 (ms) | p95 (ms) | max (ms) | 终态 cursor |
| --- | --- | --- | --- | --- | --- |
| alice | 88 | 5.21 | 5.99 | 10.04 | 13 |
| bob | 88 | 4.62 | 5.81 | 12.86 | 13 |

这些毫秒数只做记录，测试不断言绝对值；测试断言的是每次读取都属于本会话、只含自己的用户消息、
`cursor/version/messages/attempt` 单调不减，且两侧的 messageId 集合与事件窗口没有交集。
两会话各自 256 片 × 2 并发约 2.7 s 内完成，没有一方被另一方阻塞。

## 6. AC 映射与未执行项

- AC1（流中两 observe 一致 + 重连仍一致）→ §3，test 1。
- AC2（第二个观察者不使每片段时间或内存成倍增长）→ §4 的 1/2 观察者对比。
- AC3（两会话并发时读取不被另一会话拖垮）→ §5 证明并发下各自读取持续有效且延迟与单会话
  同量级；**但两侧负载对称、都无历史**，「一方长历史 + 另一方并发流」的成对实验未做，历史
  长度的单会话影响只看 §4 的 40/160 turns 行。
- AC4（行为测试与基准分离）→ 新测试在 `node --test` 里，基准单独脚本、单独 JSON。
- 未执行：真实云模型（全程替身）；Android 端呈现；跨机比较；多用户并发压力（本票只用两个
  用户验证会话隔离）；#94 的相对门槛。
