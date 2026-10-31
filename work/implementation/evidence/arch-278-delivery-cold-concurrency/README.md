# #278 投递冷写与 resume 并发的黑盒护栏

日期：2026-10-31。票面：[#278](https://github.com/eafen405/OurFairy/issues/278)。
分支 `ticket/278-delivery-cold-concurrency`，worktree `.worktrees/278-delivery-cold-concurrency`，
基线 `29a5ed9dcc`（main）。

`delivery.settle` 有两条写路径：目标会话已被 chat 打开时走 `runtime.events` + `runtime.barrier`
的 live Session；没有 Agent 时自己 `sessionPersistence.open(id,'write')` → `sessions.prepare` →
append → flush。两条都在 `runSession(target)` 里，chat 的 open/resume 取同一把 session key，
所以两者应当串行；但在此之前没有任何直接用例。#275 要把冷路径收进
`ourfairyChatRuntime.appendOnce`，本票先把「冷写与 resume 并发时会怎样」钉成可执行事实。

## 改动

只新增 [`tests/delivery-cold-concurrency.test.mjs`](../../../../tests/delivery-cold-concurrency.test.mjs)
（377 行，4 个用例；37 处断言调用，helper 每轮复用）。未改 `backend/` 下任何产品代码、既有测试、
`tests/helpers/*` 或表结构。

断言只落在可观察事实：投影里的 `delivery/message` 条数、`deliveries` 行及其 `status`/`message_id`、
HTTP 状态（`request()` 要求 200）、发送方拿到的工具结果。不断言走了哪条写路径，也不断言队列实现。
模型与网络走替身（现有 `runBackendAsync` + `startArgs` + `writeOverlay` 写法，本文件不需要 overlay）。

## 用例与断言形状

| 用例 | 轮次 | 断言 |
| --- | --- | --- |
| A 投递 vs `/chat/read` 打开冷 primary | 6 | 每轮：发送方工具结果含 `deliveryId`；并发 `/chat/read` 返回 200 且 `projection.sessionId === target`；随后读取的投影里该文本的 `delivery/message` 恰好 1 条、同文本 transcript 行恰好 1 条；`deliveries` 该文本恰好 1 行且 `status = 1`，行的 `message_id` 等于投影事件的 message id，工具回执的 `deliveryId` 等于行的 `delivery_id`；之后 `/chat/send` 受理（有 `receipt.messageId`）并最终出现 `CHAT:<text>` 回复且 `replyStatus = 0`，该 delivery 仍只有 1 条、seq 不变 |
| B 投递 vs `/chat/observe` 打开冷 primary | 5 | 同 A 的交付断言；另：observer 最新一帧里该文本恰好 1 条消息、`delivery/message` 恰好 1 条；所有已发布帧中该文本从未出现 2 次；关闭观察后同 A 的 `/chat/send` 与单条断言 |
| C 两个发送者并发投递到同一已存在的冷 primary | 3 | 每轮两个工具结果都含 `deliveryId`；每个文本在 `deliveries` 恰好 1 行且 `status = 1`；全部轮次后一次读取：`delivery/message` 恰好 2×3 条、消息文本 multiset 等于 6 个文本、全部为 assistant 行；之后 `/chat/send` 正常且不新增 delivery |
| D 冷写持久化失败 + 同身份重试 | 1 | 把目标会话日志文件改成只读：工具结果不含 `deliveryId`；`deliveries` 行恰好 1 且 `status = 0`；日志文件字节与失败前逐字节相同；恢复权限后同一 callId 重试得到 `deliveryId`，该文本恰好 1 条事件 / 1 行消息 / 1 行 `status = 1` 且行指向同一 message；之后 chat 仍可用 |

### A/B 的并发窗口是实测的，不是声明

A/B 用 `deliveries` 行的出现作为开赛信号：行在 `deliveries.prepare` 里提交，紧接着就是 `settle`。
一次加临时打印（未提交）的运行里：

- A/B 共 11 轮，发出 `/chat/read` / `/chat/observe` 时该 delivery 行仍全部是 `status 0`（结算未完成）；
- 11/11 轮里，这个并发读取返回的冻结投影已经包含该 `delivery/message`（B 是 observer 的第一帧）。

这与「open/observe 排在冷 `runSession` 之后、resume 读到已落盘事件」一致，因此 A/B 落在冷写与
resume 的竞争窗口里，而不是只覆盖 live 路径。C 让目标会话在全部轮次里保持冷态，确定性地压冷写。
该打印只用于确认窗口，没有进入断言、也不随提交保留。

### D 的失败点

D 的失败点是冷 `sessionPersistence` 句柄的持久化 append：日志已 materialize 的会话上
`handle.flush()` 直接返回，durability 发生在 append（`open(path, 'a')`）。实际工具结果：

```
[{"type":"text","text":"Error: EACCES: permission denied, open '<home>/dsh-home/sessions/_no-cwd/<primary>/session.v4.jsonl.zstd'"}]
```

这是文件权限条件，不是产品 seam；冷分支不发 `session/event`，所以
`backend/chat/test-support/fail-outlets.ts` 抓不到它，本票也没有为它改产品代码。

## 实际命令与结果

```
$ npm run build                                    exit 0

$ node --test tests/delivery-cold-concurrency.test.mjs   # 连续三次
ℹ tests 4  ℹ pass 4  ℹ fail 0  ℹ duration_ms 3893.918216
ℹ tests 4  ℹ pass 4  ℹ fail 0  ℹ duration_ms 3603.224657
ℹ tests 4  ℹ pass 4  ℹ fail 0  ℹ duration_ms 3632.429714

$ node --test tests/text-delivery.test.mjs tests/delivery-row.test.mjs tests/file-delivery.test.mjs
ℹ tests 15  ℹ pass 15  ℹ fail 0  ℹ duration_ms 8818.348554
```

新 worktree 第一次跑之前，把 main 检出里同 product-source hash 的只读模板
（`.ourfairy-template/8f8b1e26a7fd40a1625e9758f9b37a46088b500af18bea761daa097c90ec7ff0-11.28.5`，
`npm run build` 后本 worktree 的 hash 与之相同）复制过来，避免隔离 home 的首次 profile 安装超时；
模板是 gitignore 产物，不入库。

A/B 共 11 轮、C 3 轮×2 发送者、D 1 次失败 + 1 次重试；三次运行逐用例耗时在
0.2–2.2s（A 1.9–2.1s、B 0.73–0.76s、C 0.37s、D 0.21–0.22s），无偶发失败。

## 没有覆盖的 / 未执行项

- **未跑全量 `npm test` 与 `npm run combo:verify`**：票面要求只加测试并跑相关面；本次改动不含产品代码。
- **不断言 A/B 每一轮走哪条写路径**：两条路径的结果相同且都对，票面也只要求可观察事实；窗口覆盖见上。
- **构造不了字面 `handle.flush()` 处的冷写失败**：投递目标的主会话在 `/sessions/primary` 已
  materialize 空日志，该会话上 `flush` 直接返回，durability 在 append。要让 flush 失败需要未
  materialize 的会话，而投递目标在 prepare 阶段就已存在。
- **未做跨进程并发**：两个后端进程争同一 home 的 lease 不是产品语义，需要就单独开票。
- **未在 #275 分支上验证**：本套件是它的护栏，改动后应保持全绿。
- 与真机/真实模型无关：模型走替身。

## 与 #275 的关系

#275 把冷路径收进 `appendOnce` 后，A/B/C 的断言应原样通过：同一身份仍只有一条
`delivery/message`、`deliveries.status = 1`、两个请求都不 5xx、会话仍可继续 `/chat/send`；
D 固定「durability 失败不得确认，同身份重试只落一条」。本票没有为 D 加任何产品 seam。
