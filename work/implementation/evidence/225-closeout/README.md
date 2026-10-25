# #225 T3 收口：两轴评审修复、可执行声称与最终门禁

日期：2026-10-25。票面见[工作副本](../../../tickets/225/03-closeout.md)，父规格见
[#225](https://github.com/eafen405/OurFairy/issues/225)（本地父规格副本
[`docs/specs/ourfairy-v1.md`](../../../../docs/specs/ourfairy-v1.md)）。worktree
`.worktrees/225-closeout`，分支 `ticket/225-closeout`，基线 `integration/spec-225` 的
`8de97d2038`（含 T1 [#226](https://github.com/eafen405/OurFairy/issues/226) 与
T2 [#227](https://github.com/eafen405/OurFairy/issues/227)）。

## 评审结论

- **Spec 轴：无发现。** 页读取与任务查找都落在规格要求的位置：`SessionRuntime.page` 拥有固定截点、
  范围、事件读取与消息选择；`RemoteChat` 保留认证、打开、JSON 校验、`maxEvents` 与 HTTP 映射；
  任务访问收在 work projection unit 的窄查找里，返回 `{ task, jobId }`，`jobs` 用原生 `JobId`
  调 `readAt`/`get`/`kill`。协议、字段、数字编码与 SSE 未变。
- **Standards 轴：8 条发现，全部在本票修复。** 3 条硬发现（可执行声称），5 条判断项（命名、
  feature envy、重复路径、导出面、注释）。逐条修复与配套检查见下节。

## 逐条修复

| # | 发现 | 修复 | 失效会失败的检查 |
| --- | --- | --- | --- |
| 1 | `units.ts` 声称任务行投影「cannot drift apart」，而 `chat-task-lookup` 的同名用例从不读列表 | 新增「the looked-up task equals the list row projection, available and unavailable」：经 `runtime.projection(...).tasks` 与 `runtime.taskOf(...)?.task` 在可用、不可用（两次读取之间清空 fake live jobs）两种状态下逐字段比较；原用例改名为「the lookup reports status, availability and report degradation for the folded row」；`units.ts` 注释指向新用例。提交 `50302512c4` | `node --test tests/chat-task-lookup.test.mjs` |
| 2 | 页证据声称 `null -> 400 chat/invalid-page`，HTTP 回归只断言 400 | `tests/reconnect.test.mjs` 的五个无效页请求体（含 `throughSeq: cut + 1` 超出 cursor）都断言 `error.code === 'chat/invalid-page'`，状态 400 断言保留。提交 `3ae8dcb972` | `node --test tests/reconnect.test.mjs` |
| 3 | `runtime.taskOf` 注释声称「不读 attempt/transcript/activity」，测试只固定零 `observeSession` 读取 | 注释收窄为被测试固定的设计事实：直接读 work 单元与 jobs 注册表、不经过 `projection`，因此不初始化观察 window，并指向固定该行为的用例。提交 `7c4cd05da2` | `node --test tests/chat-task-lookup.test.mjs`（零 `observeSession` 断言） |
| 4 | 命名：`taskRowWithJob` 返回 `{task, jobId}` 不是行；`taskRowOf` 返回 wire task；重复的 `JobRow & { report }` 形状 | `taskRowWithJob` → `taskLookupOf`、`taskRowOf` → `wireTaskOf`；新增 `TaskRow = JobRow & { report: ReturnType<typeof reportState> }`，`rowWithReport`、`wireTaskOf`、`taskLookupOf` 共用。提交 `9b7ea02b23` | `npm run build`（类型检查覆盖三处签名）+ 任务/投影测试 |
| 5 | `taskLookupOf` 只为 `ctx.jobs.generation` 接收整个 `ctx` | 参数改为 `generation: string`，调用方传 `ctx.jobs.generation`。提交 `9b7ea02b23` | `npm run build` + `node --test tests/chat-task-lookup.test.mjs`（旧 generation 用例） |
| 6 | `jobs.ts` 的 `jobOutput` / `jobStop` 重复 `runtime.taskOf` + 404 | 抽成 `installJobs` 内的 `taskOr404(state, taskId)`；`jobOutput` 保持 open → 校验 `from`（400）→ 查找（404）顺序。提交 `7ad0560501` | `node --test tests/chat-task-lookup.test.mjs tests/jobs.test.mjs` |
| 7 | `tests/helpers/chat-world.mjs` 导出只在内部使用的 `deferred` | 去掉 `export`；确认无测试从 helper 导入。提交 `8fa7e780e2` | `node --test tests/chat-page-cut.test.mjs tests/chat-read-window.test.mjs`（helper 使用者） |
| 8 | `chat-read-window` 头注释写提交门禁的扫描规则 | 改为陈述它穿过 `backend/chat` 真实读取路径的行为；保留包路径以便门禁关联，但不再像扫描 workaround。提交 `8fa7e780e2` | `node --test tests/precommit.test.mjs`（关联选择仍包含该套件）+ `tests/docs.test.mjs` |

红态验证（声称检查的牙齿）：临时把 `taskAt` 的 generation 与列表侧错开并重建后，
`tests/chat-task-lookup.test.mjs` 有 3 条失败，其中包含新的同源比较；恢复实现并重建后 7/7 通过。
该变异只用于验证检查灵敏度，没有提交。发现 2、7、8 是给既有行为补断言或整理注释，实现前即通过，
其红态无法由行为失败构造；错误码断言直接读取响应体，映射改变即失败。

## 可执行声称核对

下表逐条核对规格 Implementation / Testing Decisions 中本次增量声称满足的条目。
「结果」均为最终 tip 上的 focused 套件（见下节）。

| 规格条目 | 声称 | 失效会失败的检查 | 结果 |
| --- | --- | --- | --- |
| ID 1 | runtime 页操作拥有截点校验、页范围、事件读取与消息选择 | `tests/chat-page-cut.test.mjs` 7 条经 `runtime.open` + `runtime.page` 的用例 | 通过 |
| ID 2 | RemoteChat 仍管认证、打开、JSON 校验、`maxEvents` 1..256 与 HTTP 映射 | `tests/reconnect.test.mjs`（401/404、`maxEvents` 0/257 → 400） | 通过 |
| ID 3 | 只有 `throughSeq` 超出 cursor 返回 `null` 并映射 400 `chat/invalid-page`；有效空页正常 | `tests/reconnect.test.mjs` 五个无效体断言 400 + `error.code`；`chat-page-cut` 的 valid empty page | 通过 |
| ID 4 | `end = min(throughSeq + 1, beforeSeq)`、`fromSeq = max(0, end - maxEvents)`、消息在页事件范围内 | `chat-page-cut` 的「ends at the smaller」「messages carry the seqs」 | 通过 |
| ID 5 | 未初始化 window 只读本页范围；已初始化 window 切片且不再读日志 | `chat-page-cut` 的 `pageReads`/`pageOpens`/`observeSession` 计数断言 | 通过 |
| ID 6 | 不新增 writer queue/durability barrier；固定截点重试内容相同 | `chat-page-cut` repeated page；`reconnect` 的 lost page 重试 | 通过 |
| ID 7 | transcript fold、持久 state 与 `stateVersion` 不变；页读取复用 `transcriptAt` | `tests/projection-units.test.mjs`、`tests/projection-units-real.test.mjs`；`git diff` 中无 `stateVersion`/schema 改动 | 通过 |
| ID 8 | cursor 来源不变：已初始化 window 用观察末尾，否则用 live 事件末尾 | `chat-read-window` 的 cursor/冻结截点断言；`chat-page-cut` | 通过 |
| ID 9 | 窄查找在现有 work projection unit 内，不新建 task module 或持久状态 | `tests/chat-task-lookup.test.mjs`；diff 无新 module/表 | 通过 |
| ID 10 | 查找只有 `null` / `task` + `null jobId` / `task` + `JobId` 三态 | `chat-task-lookup` 的 missing、old-generation、retained、available 用例 | 通过 |
| ID 11 | 只暴露原生 `JobId`；jobs 用 `readAt`/`get`/`kill`，不切割 taskId | `chat-task-lookup` 对 `world.jobCalls` 的精确 id 断言 | 通过 |
| ID 12 | 列表与查找共用行投影、状态映射、报告降级与 generation 判断 | 新增的 `the looked-up task equals the list row projection` 两态比较 | 通过 |
| ID 13 | 任务查找只读 work projection 与原生注册表，不初始化事件 window | `chat-task-lookup` 的查找用例断言零 `observeSession` 读取；同源比较用例先 seed 列表投影一次、再断言查找不新增读取；`taskAt` 入参只有 work state（attempt/transcript 不在可达范围） | 通过 |
| ID 14 | jobs 继续拥有偏移校验、输出、停止、404 与不可用输出形状 | `chat-task-lookup`（不可用形状/停止 0）、`native-job-status`、`jobs.test.mjs`（真实 HTTP 404） | 通过 |
| ID 15 | 可用输出取注册表最新；停止进入 barrier；结果 1/2；未知结果 500 | `chat-task-lookup`（readAt/get/kill 与 flush）、`native-job-stop-outcome`、`jobs.test.mjs` | 通过 |
| ID 16 | 任务身份 = generation + 原生 id；旧 generation 不解析到重启后同名任务 | `chat-task-lookup` old-generation 用例；`jobs.test.mjs` 的重启身份用例 | 通过 |
| TD 5 | 页与任务测试复用同一 fake native world，不复制第二套世界 | 唯一 helper `tests/helpers/chat-world.mjs`；`chat-page-cut`/`chat-read-window`/`chat-task-lookup` 均导入它 | 通过（结构） |
| TD 9-10 | 经 `jobOutput`/`jobStop` 进入真实查找，并在 native seam 断言零 `observeSession` | `chat-task-lookup` 的 `jobOutput`/`jobStop` 用例断言零读取；同源比较用例不经这两个操作，单独断言列表投影 seed 一次后查找不新增读取 | 通过 |
| TD 14-17 | 最终状态跑全量门禁、两轴评审、证据如实 | 本 README 的验证节与命令记录 | 通过 |

无法给出检查的声称已删除或收窄，而不是补断言：`runtime.taskOf` 注释不再声称
attempt/transcript/activity 读取检查（发现 3）；`chat-task-lookup` 的旧用例名不再声称「即列表行投影」
（发现 1）；页证据的 `chat/invalid-page` 声称现在由 HTTP 断言固定（发现 2）。

## 变更面与保持不变

本次收口的代码与测试增量只有 7 个文件（证据文档另计，不计入下面的路径过滤）：

```sh
git diff --stat 8de97d2038..HEAD -- backend tests
# backend/chat/src/jobs.ts        | 14 +++++++++-----
# backend/chat/src/runtime.ts     |  9 +++++++---
# backend/chat/src/units.ts       | 23 +++++++++++++++--------
# tests/chat-read-window.test.mjs |  7 +++----
# tests/chat-task-lookup.test.mjs | 32 ++++++++++++++++++++++++++++++--
# tests/helpers/chat-world.mjs    |  2 +-
# tests/reconnect.test.mjs        |  6 +++++-
```

- 无 `android/`、数据库 schema、projection 持久 state 或 `stateVersion` 改动：`backend/chat/src/units.ts`
  的 `stateVersion: 4` 与 `stateVersion: 2` 在 diff 中未出现，schema 与 fold 的 `apply` 未改。
- 无 dsh fork、`combo.json` 或 bundle 行改动：`git diff --name-only 8de97d2038..HEAD -- android combo.json`
  为空，`npm run combo:verify` 的 dsh 与 android 源声明均为 green。
- 无路由、请求/响应字段、数字编码或 SSE transport 改动：`service.ts`、`index.ts` 均不在本次 diff；
  `jobs.ts` 只改 404 抽取，输出/停止的字段与数字保持不变。`git status --short` 在提交前为空。

## 验证

以下命令在最终 tip 的代码/测试树上运行；把实测数字写入本 README 只改文档，产品与测试文件不变。
`npm test` 与 `npm run combo:verify` 是本次收口的最终状态门禁，不是 T1/T2 的历史数字。

```sh
npm run build
# exit 0（tsc --fresh 无诊断）；3.1s

node --test tests/chat-page-cut.test.mjs tests/chat-task-lookup.test.mjs \
  tests/chat-read-window.test.mjs tests/native-job-status.test.mjs \
  tests/native-job-stop-outcome.test.mjs tests/reconnect.test.mjs \
  tests/jobs.test.mjs tests/projection-units.test.mjs tests/projection-fold.test.mjs
# 66 pass / 0 fail；16.1s

npm test
# 321 pass / 0 fail；78.1s（pretest 时 `npm run build` 先通过）

npm run combo:verify
# combo: combination verified
```

提交门禁（`.githooks/pre-commit` → `scripts/precommit.ts`）在各提交上按改动面运行：`8fa7e780e2`
（helper 改动触发 full）跑全量 `npm test` 321/321 与 `combo:verify`；其余提交走 related 或 docs
门禁，均通过。

## 证据性质

- `chat-task-lookup`、`chat-page-cut`、`chat-read-window`、`native-job-status`、
  `native-job-stop-outcome`、`projection-units`、`projection-fold` 是**测试替身证据**：原生 Agent /
  jobs / sessionQuery / sessionPersistence 由 fake native world 提供，但 projection units、runtime、
  页操作、任务行投影与 jobs module 跑的是真实产品实现。零事件读取在 fake
  `sessionQuery.observeSession` seam 上观测，不是对内部 state 的断言。
- `reconnect`、`jobs.test`、`projection-units-real`、`chat-multi-observer` 是**真实后端进程 + 真实
  HTTP** 证据：真实 dsh 原生持久化与真实 jobs registry，模型由测试内本地 SSE mock server 提供。
  它们不是官方 DeepSeek 或真实云服务证据。
- `npm run build` 只证明编译与类型检查通过，不等于运行时验收；`combo:verify` 只核对版本组合声明。

## 未完成项与残留风险

- 未执行 Android、真机、官方模型服务或数据库验收（本规格无相关改动；Testing Decision 15 不要求）。
- 未知原生停止结果只能由替身构造（真实 registry 只返回自己的成员）；500
  `chat/unknown-stop-outcome` 的覆盖来自 `tests/native-job-stop-outcome.test.mjs`，与改动前一致。
- fake jobs registry 是内存替身：输出环、retention、spill 与跨进程重启语义由 `jobs.test.mjs` 的真实
  后端用例覆盖，本次没有复制这些路径。
- 未记录性能数据；「任务访问不初始化事件 window」是行为断言，不是延迟或内存承诺（规格 ID 23）。
- 共享 fake world 的 `sessionPersistence` 是内存切片，不模拟原生读失败、压缩或文件权限；这些路径由
  `reconnect` 的真实后端用例覆盖。

## 集成分支合并

收口分支基于 `integration/spec-225` 的 `8de97d2038`（T1/T2 合入后的 tip）。收口期间该分支 tip
未前进，`git merge integration/spec-225` 返回 `Already up to date.`，工作树无变化；删除该合并步骤
不改变任何文件，因此上面的 focused 与全量门禁结果就是最终集成状态的结果。
