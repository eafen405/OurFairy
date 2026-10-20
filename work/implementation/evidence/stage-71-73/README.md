# 阶段整合：规格 #71 / #72 / #73 合入 `integration/ourfairy-v1`

三个并行收口的规格与本轮的客户端合仓（#123）在产品集成分支上合并。本目录记录合并顺序、
每个冲突的取舍依据、合并后执行的命令与结果。规格行为仍是权威：票面 #71–#73、#123 与
[`docs/specs/ourfairy-v1.md`](../../../../docs/specs/ourfairy-v1.md)。

## 合并顺序与提交

基线与顺序按各 spec 的交接记录确定（`73-boundary.md` 的交接点 1 要求 #96 先落地；
`integration/spec-71` 的 `87-closeout/README.md` 要求 #85 的调用点落在 #72 的新读取路径上）。

| 步骤 | 提交 | 说明 |
| --- | --- | --- |
| 基线 | `025a610`（`integration/spec-123`） | 客户端快照已内联；`combo.json` 只剩产品仓、dsh 与 `androidSource` |
| 1 | `8f128f6` | Merge `integration/spec-73` |
| 2 | `b209602` | Merge `integration/spec-72` |
| 3 | `5185764` | Merge `integration/spec-71` |
| 4 | 本提交 | 证据与索引 |

三个 spec 分支均切自 `88c27b0`，互不包含；#123 也是 `88c27b0` 之上的两个提交。

## 冲突与取舍

| 文件 | 取舍 |
| --- | --- |
| `README.md` | 保留 #123 的来源/许可与历史证据段，并回补 #73 的「架构」段 |
| `combo.json` | 取 #123 的两仓 + `androidSource` 拓扑；`rikkahub` 仓条目与 `agentModel` 不再存在 |
| `scripts/combo.mjs` | #123 的 android source 行 + #73 的 bundle/插件校验 + #71 的 native capabilities；按 #87 交接，`verifyInstalledNativeCapabilities` 改为复用 `installedBundle()`（该函数现在同时返回 profile），避免第二次 loader 读取 |
| `scripts/ourfairy-backend.mjs` | 三个 doctor 检查并存：`bundle packages`、`plugin compatibility`、`native capabilities` |
| `backend/chat/package.json` | 保留 #73 的 semver peer 范围与 locale 导出，加 #72 的 `zod` 依赖与 #71 的 `@deepseek-ai/dsh-spill-local` peer |
| `backend/chat/src/runtime.mjs` | 以 #72 的观察窗口与耐久单元为读取路径；#85 的两个调用点落在其上：`attemptOf`（原生 assistant 基线）与 `contiguousEvents`（原生事件 cursor，用于窗口种子读取）。删掉产品侧的 `BlockAssembler` 自累计 |
| `backend/chat/src/{index,projection}.mjs` | `index.mjs` 同时注册投影单元与 spill 读取，inject 取并集；`projection.mjs` 随 #72 的删除保留删除，`attemptText` 移入 `units.mjs` 并导出 |
| `backend/v1-bundle/README.md` | 取 #103 的「bundle 行是唯一声明、combo.json 无副本、doctor 无对比检查」，并采用 #71 的模型改名 |
| `tests/pdf-worker-cancel.test.mjs` | 保留 #73/`#123` 的私有 TMPDIR 隔离，采用 #71 的 `resource-limit` 取消映射 |

## 需要作决定的四处（依据）

1. **共用模型的唯一权威**。#103 把初始选择收到 bundle 的 `agent-default-model` 行，
   删掉 `combo.json` 的副本与 doctor 的双声明比对；#71 把模型 id 改为
   `MiniMax-M3.1-Flash`。合并后改写落在 bundle 行（及规格与 README 的引用），
   `combo.json` 不再出现 `agentModel`。
2. **`androidSource` 的提交**。#71 曾把 rikkahub pin 移到归档 tip `2d97ed14`；#123 的快照
   实际导入自 `460109d1`，而 `2d97ed14` 只多一条归档说明（rikkahub `README.md` +2 行，
   客户端代码无差异）。客户端内联后该字段是来源记录，因此保留导入提交 `460109d1`；
   若将来整体重导快照，同时改 `combo.json` 与 `android/ourfairy-source.json`。
3. **读取路径**。#72 拥有投影窗口、耐久单元与分页；#85 只替换算法调用点。合并后的
   种子读取经原生 cursor 校验，实时尾段仍由 #72 的窗口承接，`/chat/read` 不再每次读日志。
4. **测试随结构适配**（均为合并产物，不是行为变化）：
   - torn-read 用例把故障注入点移到新进程的首次读取（合并后唯一的日志读取点）；
   - `chat-read-window` 的假宿主补上 `ctx.on`/`ctx.effect`，并按原生折叠的要求给出逐帧递增的
     revision/index；
   - `chat-page-cut` 的假宿主补上同样两个方法；
   - `bundle-only-profile` 的探针模型断言改为 `MiniMax-M3.1-Flash`。

## 实际执行的命令与结果（代码 tip `5185764`；基准在其后的同一代码树上跑）

```text
$ npm test
ℹ tests 234
ℹ suites 7
ℹ pass 234
ℹ fail 0
ℹ duration_ms 111800.043812

$ npm run backend:doctor
ok    combo combination: ourfairy@518576492dba, dsh@5b8ec0f175d3, android source@460109d1b89b
ok    bundle packages: 10 declared package(s) mounted by 15 row(s)
ok    plugin compatibility: 12 installed product package(s) compatible with dsh 0.2.1-alpha.2
ok    native capabilities: llm-retry, spill-local, spill-policy, subprocess, @deepseek-ai/dsh-agent/session-history
doctor: all checks passed

$ npm run combo:verify
ourfairy  integration/ourfairy-v1  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  product/ourfairy-v1  460109d1b89b824a  460109d1b89b824a  ok (declaration matches)

$ git diff --check 88c27b0...HEAD -- . ':(exclude)android'
(no output)

$ node scripts/bench-projection.mjs --label after-merge --out work/tmp/after-merge-1.json
(8 runs, one document: 40/160 turns × 1/2 observers, 2 repetitions each)

$ node scripts/bench-gate.mjs \
    --baseline work/implementation/evidence/72-projection-perf/baseline-run1.json \
               work/implementation/evidence/72-projection-perf/baseline-run2.json \
               work/implementation/evidence/72-projection-perf/baseline-run3-final-tip.json \
    --after work/tmp/after-merge-1.json
bench-gate: all gates pass   (18/18)
```

关键比值（after/before）：`cost160` 0.696（160/1）与 0.675（160/2），门槛 0.85；`historySlope`
0.965 / 1.011，门槛 1.20；`observerRatio` 1.586，门槛 1.80；`readP95` 最高 1.228（40/2），
门槛 1.50；`memory` 最高 1.075，门槛 1.25；`payload` 最高 1.009，门槛 1.05。

三次合并提交都由仓库的 `pre-commit` 钩子跑过全量与 `combo:verify`（`.githooks/pre-commit`）；
#73 合并在 `8f128f6` 上为 191 条通过，#72、#71 的合并提交后为全量通过。

`android/` 是逐 blob 导入的上游快照，其 `highlight` 测试资源本身带行尾空白，因此
`git diff --check` 只在排除该目录后作为产品树的检查；快照内容未改动。

## 未执行 / 已知限制

- **after 基准只跑了一次**：门槛一次通过（18/18），但 #94 的记录用多次运行取中位数；
  若要把多次运行写进证据，在本 tip 上按同样的参数重复 `bench-projection.mjs` 即可。
- **Android 构建与真机未运行**：本次合并不改 `android/` 或客户端代码；客户端行为以其自身
  证据（`123-client-merge`）为准。
- **真实模型与云服务未调用**：全量测试使用模型替身。
- **#123 的汇合交接项漏执行，已补**：`docs/architecture/dsh-ecosystem-boundary.md` 的两处
  "客户端不在本仓库"按 #123 票面（`work/tickets/123/03-topology-docs-and-hygiene.md`）须在两条
  集成分支汇合时改；合并时该文件是整文件新增、文本零冲突，没有把它当成交接检查项，因此漏掉。
  合并完成后已改为"客户端在本仓库 `android/`"，并同步修正父规格 §8 的三仓表述与 `配套 fork`
  措辞（#23 留有拓扑修订评论）。记在这里，避免把交叉交接项当成已覆盖。
- **两轴评审尚未进行**：本次交付是合并与整合证据；按 `CONVENTIONS.md` §8 的最终检查点，
  下一步应对 `88c27b0...<tip>` 跑 Standards + Spec 两轴评审（Spec 轴引三份规格、各票副本与
  本文件「冲突与取舍」）。
