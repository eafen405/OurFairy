# #274 PDF 工具改由 global layer 注册

日期：2026-10-31。票面：[#274](https://github.com/eafen405/OurFairy/issues/274)。
分支 `ticket/274-pdf-global-layer`，worktree `.worktrees/274-pdf-global-layer`，基线
`9730d94aee`，合入 main 的提交 `02149dbafa`。

本票是 [#274](https://github.com/eafen405/OurFairy/issues/274) 的 pilot：只把 attachments 包的三个
`pdf_*` 工具从「每个 Agent 的 own layer」移到「row 的 global layer」，用来验证
**maintenance preset 的 `restrict({ allow: [] })` 是否成为「子只继承什么」的唯一权威**。

## 这是一个产品语义决策，不是纯重构

工具目录的语义从「每一行决定把工具给谁」变成「Agent preset 的 restriction 决定继承面」。
今天除维护子外没有 restricting Agent，所以行为等价；但这是一次可观察的语义变更，后续若再往
search / delivery 推，应在同一前提下推进。

## 改动

| 文件 | 职责 |
| --- | --- |
| [`backend/attachments/src/pdf.ts`](../../../../backend/attachments/src/pdf.ts) | 三个 `pdf_*` 在 `installPdf` 内对行 `ctx.tools.register` 各注册一次（global layer，effect 归 row）；删除 `agent/created` listener、`agents.list()` 回放与 `MAINTENANCE_PRESET` 跳过 |
| [`backend/attachments/src/index.ts`](../../../../backend/attachments/src/index.ts) | 移除 `inject` 里已不再使用的 `'agents'`（复核补丁 `ee31136062`） |
| [`tests/pdf-worker-cancel.test.mjs`](../../../../tests/pdf-worker-cancel.test.mjs) | fake ctx 从 `agents.list()` / `on()` 改为 `tools.register`；首个用例先断言三个工具已注册。仍是真实 subprocess 取消路径 |

## 判定依据

`agent.ctx.tools.register` 写该 Agent 的 own layer，effect 归 Agent scope；行自己的
`ctx.tools.register` 写 global layer，effect 归 row。`restrict()` **只过滤继承来的 layer**
（global + ancestor chain），从不过滤 own layer。维护子把 memory 的五个工具注册进 own layer，
继承面被 `allow: []` 清空，因此它恰好只看见那五个。

## 实际命令与结果（三组 canary）

```
$ node --test tests/model-double.test.mjs
✔ one real turn reaches the external model double, registers tools, and persists the session (1214ms)
ℹ tests 2  ℹ pass 2  ℹ fail 0

$ node --test tests/memory-maintenance.test.mjs
✔ the default threshold is the policy's 15 closed user turns, and a zero-write child advances the watermark (3024ms)
ℹ tests 9  ℹ pass 9  ℹ fail 0

$ node --test tests/row-addressability.test.mjs
✔ disabling the delivery row leaves chat serving and refuses deliver_message (1807ms)
✔ disabling the groups row removes its tools and roots, not the file spaces or scripts (2055ms)
ℹ tests 7  ℹ pass 7  ℹ fail 0

$ node --test tests/pdf.test.mjs tests/attachments.test.mjs tests/attachment-download-abort.test.mjs
ℹ tests 12  ℹ pass 12  ℹ fail 0
```

补丁后重跑：

```
$ node --test tests/model-double.test.mjs      ℹ tests 2  ℹ pass 2  ℹ fail 0
$ node --test tests/memory-maintenance.test.mjs ℹ tests 9  ℹ pass 9  ℹ fail 0
```

## 等价性

| 场景 | 改前 | 改后 |
| --- | --- | --- |
| 主会话工具目录 | 25 个名字（含三个 `pdf_*`） | 同 25，`deepEqual` 通过 |
| 维护子工具目录 | 5 个 memory 工具 | 同 5，`deepEqual` 通过 |

## 没有直接断言的部分

「pdf 工具随 attachments row 禁用而消失」没有直接用例——`row-addressability` 只禁 delivery /
groups。这条现在只由 `ctx.effect` 的归属结构性保证（附带收益之一）。若要变成可执行声称，
需要给 `row-addressability` 增加一个禁用 attachments 的用例。

## 环境说明

冷 worktree 第一次跑 `memory-maintenance` 时 `start` 在 profile 安装上 300s 超时、stdout/stderr
为空；用 launcher 生成 `.ourfairy-template` 预热后重跑全绿，不是断言失败。
