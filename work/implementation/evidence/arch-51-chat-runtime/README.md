# arch-51-chat-runtime

票 #51：`RemoteChat` 的 `_` 成员是 service / delivery / jobs 三文件间的隐式 interface；`_live` 是就地构造的裸对象；`_queues` 被 `sessionId` 与 `'delivery:' + deliveryId` 两种 key 空间复用；`state.version++` 由三个文件各自递增。本票把这些升格为有名字的 `SessionRuntime` / `LiveSession` / `SessionQueues`，delivery 与 jobs 只依赖 runtime。

## 票面前提核对（先核后动）

基线：`integration/ourfairy-v1` @ `1c95299`（开工时 tip，#66 的 `readSessionEvents` 已在其中）。原始行号（`git show HEAD:...`）。

| 票面条目 | 核对结果 |
| --- | --- |
| `service.mjs` `_agent` :37 / `_exclusively` :91 / `_barrier` :98 / `_events` :108 / `_projection` :143 / `_publish` :213 | 在 `1c95299` 实际为 :39 / :93 / :100 / :110 / :143 / :213：`_agent` 等前四处各下移 2 行，原因是 #66 新增两条 import；`_projection`/`_publish` 与票面一致。前提成立。 |
| `delivery.mjs:22/:24/:26/:27/:71` 调用 `_exclusively`/`_live`/`_events`/`_barrier`，并读 `state.agent.session` | 与票面行号一致。成立。 |
| `jobs.mjs:87/:88/:91/:93/:98/:99/:104/:105/:108/:109` 调 `_live`/`version++`/`_agent`/`_projection`/`_barrier` 并读 `state.agent.id` | 与票面行号一致。成立。 |
| `_events` 已于 #66 收敛为 `readSessionEvents` | `service.mjs:111` 委托成立；本票保留为 `SessionRuntime.events`，未回退。 |
| 删除测试：拆 delivery/jobs 回 service 不减复杂度 | 按票面结论执行：不搬回，复杂度集中到有名字的 runtime。 |

## 改动

1. `backend/chat/src/runtime.mjs`（新增）
   - `LiveSession`：有名字的 live 记录（`generation/version/durableThroughSeq/attempt/settledAttempt/stopping/error/listeners/scheduled/agent`），提供 `session`/`sessionId`/`status` 只读访问器。
   - `SessionRuntime`：`open(owner, sessionId)`（授权 + 至多一次并发 resume；取代 `_agent`/`_resume`）、`live(sessionId)`、`runSession(sessionId, work)`、`runDelivery(deliveryId, work)`、`events(sessionId)`（#66 委托）、`barrier(state)`、`changed(state)`（唯一 `version++` 处）、`publish(state)`、`projection(state, range)`、`subscribe(state, maxEvents, listener)`、`followup(state, message)`、`stop(state)`。
2. `backend/chat/src/queues.mjs`（新增，无外部依赖）：把两种 key 空间写成命名方法 `runSession(sessionId, work)` / `runDelivery(deliveryId, work)`，内部以 `session:` / `delivery:` 前缀分区——即使 id 相同也互不阻塞；同一队列的嵌套（同一 async 调用链已持有该队列）立即 reject，而不是静默等自己。key 策略只在这个对象上定义，`SessionRuntime` 只做委托。
3. `service.mjs`：只保留 HTTP 操作与参数校验，全部经 runtime；删除 `_opening/_queues/_live` 与 `_agent/_resume/_exclusively/_barrier/_events/_projection/_publish`。
4. `delivery.mjs`：`installDelivery(ctx, runtime)`；`settle` 用 `runtime.runSession(row.sessionId)` + `runtime.live/events/barrier`，append 用 `state.session`；`deliver` 用 `runtime.runDelivery(deliveryId)`，不再写 `chat.deliver`（tool 的 `execute` 直接调用本模块闭包）。
5. `jobs.mjs`：`installJobs(ctx, runtime)`；任务事件用 `runtime.live` + `runtime.changed`，控制用 `runtime.open/projection/barrier` 与 `state.sessionId`；返回 `{ jobOutput, jobStop }` 供路由注册。
6. `index.mjs`：构造 `SessionRuntime`，传给 `RemoteChat` 与两个 installer；job 路由改用返回的处理器。
7. `tests/chat-runtime.test.mjs`（新增 5 条）
   - 同 id 的 session / delivery 队列互不阻塞（session 队列被真实持有，delivery 队列仍能完成）；
   - 同一队列按调用顺序串行、不交叠；
   - delivery 内取 target session 队列（真实组合）允许；同队列嵌套立即 reject（不挂起）；
   - delivery/jobs 源码不含 `chat._`、以 `runtime.` 协作，runtime 导出 `SessionRuntime` 并委托 `SessionQueues`；
   - `version++` 只出现在 `runtime.mjs`（service / delivery / jobs 均为 0）。

### 关于「静默死锁」的复现

生产路径当前没有同队列嵌套，所以旧代码不会当场死锁；风险是后续改动在已持有临界区里复用同一 key。本票把这条路径从「挂起」变成「立即报错」，并用第 3 条测试钉住。`queues.mjs` 无外部依赖，因此 `node --test` 能直接驱动这个策略；`runtime.mjs` 自身静态 import 已钉版本的 dsh peers，只能在安装后的组合里加载（与 #57 抽出 `createDownloadResponder` 的取舍相同），其余 seam 由源码断言 + 既有端到端套件覆盖。

## 实际命令与输出

```
node --test tests/chat-runtime.test.mjs
  # red: ERR_MODULE_NOT_FOUND.../backend/chat/src/queues.mjs            -> red-runtime.test.log
node --test tests/chat-runtime.test.mjs
  # green: 5/5 pass                                                       -> green-chat-runtime.log
node --test tests/remote-chat.test.mjs tests/jobs.test.mjs tests/text-delivery.test.mjs tests/file-delivery.test.mjs
  # green: 31/31 pass（合并 #50/#67 前的基线）                              -> green-targeted.log
npm test
  # 1c95299 + 本票：129/129 pass（124 基线 + 5 新增）                      -> full-npm-test.log
npm run combo:verify
  # combo: combination verified                                           -> combo-verify.log
node --test tests/pdf.test.mjs
  # 5/5 pass（首次全量遇到既有 PDF flake: worker-unavailable vs resource-limit，
  #  隔离重跑通过）                                                        -> pdf-rerun.log
```

合并最新集成分支后的最终验收（实现提交 `ec309ec`，基线 `integration/ourfairy-v1` @ `3062879`，`git merge` 为 Already up to date）：

```
git merge integration/ourfairy-v1     # Already up to date
npm test                              # 133/133 pass, 6 suites       -> final-full-npm-test.log
npm run combo:verify                  # combo: combination verified   -> final-combo-verify.log
```

实现提交的 pre-commit hook 本身也复跑了 `npm test`（133/133）与 `combo:verify`；期间的失败与重试（PDF 既有 flake、集成分支/rikkahub pin 在提交窗口内前进）。

## 偏差 / 范围外

- `state.handle` 在旧代码中 resume 后赋值、从未被读取；`LiveSession` 不再保留该字段。teardown 由插件 fiber / agent registry 持有，本包没有 dispose 路径，行为不变。
- `send` 的 `state.error = null` 保留在原位置（附件准备之前），未挪进 `followup`，因此附件失败/等待期间的可观察顺序不变。
- 范围外观察：`SessionRuntime.#live` 与旧 `_live` 一样从不逐出会话（进程生命周期内累积），本票未改动该既有策略。
- 提交时集成分支/rikkahub pin 正被其他票推进，pre-commit hook 的失败与重试记录；实现测试本身在 hook 内为全绿（最终 133/133 + combo verify）。

## 提交

- 实现 + 测试提交：`ec309ec`（hook 复跑 133/133 + combo verify 通过）
- 合并 `integration/ourfairy-v1`：开工后集成分支从 `1c95299` 前进到 `3062879`，提交前已合并（`git merge` Already up to date）。
- 证据提交（本 README + 全部日志）为分支最终 tip；交付报告中的 `FINAL_SHA` 即该提交。
