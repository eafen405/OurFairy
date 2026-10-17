# arch-53 — 会话投影重复折叠事件日志

- 票：#53（地图 #69 架构收口）
- 仓库：OurFairy（后端）
- worktree：`/home/eafen405/projects/OurFairy/.worktrees/arch-53-projection-fold`
- 分支：`arch/53-projection-fold`；集成分支 `integration/ourfairy-v1`
- 实现提交：`f1acf76`（`refactor(chat): fold the session log once for tasks and activity`）
- 合并提交：`199abb7`（`Merge branch 'integration/ourfairy-v1' into arch/53-projection-fold`，第二父 `514026d`）
- 证据提交：`b25ba2d` 建立本目录；本文件所在提交（在其后更新最终合并状态）即分支 tip / FINAL_SHA，具体 SHA 见实现者报告与 merger 前置核对
- 结论：前提成立；同一日志每次 projection 的折叠次数 **2 → 1**，输出语义不变

## 前提核对（行号已因 #51 漂移）

#51 已把 `_projection`/`_publish` 从 `service.mjs` 迁入 `backend/chat/src/runtime.mjs`。按开工 tip `167d1ef` 就地复核：

| 票面断言 | 复核结果 |
| --- | --- |
| `service.mjs:155` 调 `projectTasks`，其内部 `jobs.mjs:66` 调 `taskHistory(events)` | **成立**，现位于 `runtime.mjs:160-161` → `jobs.mjs:64,66`（第一次折叠） |
| `service.mjs:159` 调 `projectActivity`，其内部 `activity.mjs:15` 再次 `taskHistory(events, visit)` | **成立**，现位于 `runtime.mjs:165` → `activity.mjs:15`（第二次折叠） |
| `jobs.mjs:58` 对**每个事件**传 `snapshot()`；`jobs.mjs:35` 构造全量行拷贝 + `reportState` | **成立** |
| `activity.mjs` 只在 `session/end-seed` 分支用到 `rows` | **不完全成立（范围更小）**：`activity.mjs:34` 的 `working` 判定也逐事件读 `rows`（运行中/停止中任务、pending report）。逐事件状态是 activity 的真实输入，不能删；可删的是「同一日志再折一遍」 |
| `service.mjs:213` 的 `_publish` 每个版本变化、每个订阅者重跑该路径 | **成立**，现位于 `runtime.mjs:131-147`：`publish` 循环 listeners，每个 observer 各算一份 projection |

结论：重复折叠与「每事件构造全量 snapshot 后丢弃」仍成立（snapshot 在旧路径的第二次折叠里被构造，只有 activity 的真子集判定消费）。按减法方向修掉重复折叠。

## 改了什么

1. **新增 `backend/chat/src/history.mjs`**（依赖无关，可直接单测）：
   - `taskHistory(events, visit)`：唯一的一次折叠，保留原逐事件 `visit(event, rows, pending)` 契约；
   - `projectTasks(ctx, rows, sessionId)`：改为消费折叠结果而不是自己再折（原 `jobs.mjs:64-81` 逐行搬移）；
   - `projectSession(ctx, events, sessionId, running) → { tasks, activity }`：runtime 唯一调用点，一次折叠同时得到 roster 与 activity。
   - `TASK_STATUS` 成为状态码唯一映射（`jobs.mjs` 的 job 输出复用，不再各存一份）。
2. **`backend/chat/src/activity.mjs`** 改为 `observeActivity(sessionId) → { visit, finish }`：原 63 行状态机逐行搬移，`visit` 消费同一折叠的逐事件状态，`finish` 用同一折叠得到的 roster + live `running` 结算；`throughSeq` 由 visit 记录（每个事件恰好访问一次，与 `events.at(-1)` 等价），`finish` 不再读 events。
3. **`backend/chat/src/jobs.mjs`** 只保留 `installJobs`（owned HTTP 控制），不再拥有折叠。
4. **`backend/chat/src/runtime.mjs`**：`projection` 里一次 `projectSession(...)` 同时取 `tasks` 与 `activity`。
5. **`tests/projection-fold.test.mjs`**（新增 2 条）：
   - 用计数可迭代事件源断言「同一份日志只折叠一次」（`reads === 1`），并把 tasks/activity 的期望值钉在 `backend/chat/README.md` 的 wire 契约上；
   - 空日志 + running agent：`throughSeq = -1`、episode 从 seq 0 回退开启（钉住搬移后的 `lastSeq` 回退语义）。

可度量事实（同一输入）：每次 projection 的事件日志折叠 **2 → 1**；`taskHistory` 调用点 **2 → 1**；每事件 snapshot 从「第二次折叠构造后丢弃」变为「与 roster 同一次折叠、activity 实际消费」。实现提交净改动 +190/−104 行（`history.mjs` +93、`tests/projection-fold.test.mjs` +63、`jobs.mjs` +3/−80、`activity.mjs` +28/−20、`runtime.mjs` +3/−4）。

## 语义保持

- `tasks` / `activity` 的字段与判定顺序未变：折叠、`reportState`、roster 映射、activity 状态机均逐行搬移，只改组合方式。
- 兜底测试：`tests/jobs.test.mjs`、`tests/text-delivery.test.mjs`、`tests/remote-chat.test.mjs`、`tests/reconnect.test.mjs`（改动前 15/15，改动后 29/29）；另有全量 `npm test`。

## 命令与结果（原始日志同目录）

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 特征化（改动前） | `node --test tests/jobs.test.mjs tests/text-delivery.test.mjs` | 15 pass / 0 fail（`baseline-behavior.log`） |
| red（新 seam） | `node --test tests/projection-fold.test.mjs` | `ERR_MODULE_NOT_FOUND`：`history.mjs` 尚不存在 → 1 fail（`red-fold-seam.log`） |
| green（新 seam） | 同上 | 2 pass / 0 fail（`green-fold-seam.log`） |
| 定向行为（改动后） | `node --test tests/jobs.test.mjs tests/text-delivery.test.mjs tests/remote-chat.test.mjs tests/reconnect.test.mjs` | 29 pass / 0 fail（`green-behavior.log`） |
| 全量（合并前 `167d1ef`） | `npm test` | 134 pass / 1 fail（`full-npm-test.log`）：唯一失败是 `lifecycle` 的 doctor 报 worktree HEAD 未基于集成分支 tip `459ca98` + rikkahub pin 中间态，非本票改动；按 CONTEXT 先 merge 再复跑 |
| merge `459ca98`（arch-63 证据/pin，无代码冲突，fast-forward）后全量 | `npm test` | **135 pass / 0 fail，EXIT 0**（`full-npm-test-merged.log`；本票新增 2 条，基线 133 条） |
| 该状态组合一致 | `npm run combo:verify` | 3 仓 ok，exit 0（`combo-verify.log`） |
| merge `514026d`（arch-58 证据/pin，无代码冲突，合并提交 `199abb7`）后全量 | `npm test` | **135 pass / 0 fail，EXIT 0**（`full-npm-test-final.log`） |
| 最终状态组合一致 | `npm run combo:verify` | ourfairy `199abb7` 基于集成分支、dsh `fe2bbc3b`、rikkahub `81f1b06b`，3 仓 ok，exit 0（`combo-verify-final.log`） |
| pre-commit hook（实现提交 `f1acf76`） | 自动 `npm test` + `combo:verify` | 通过后提交成功 |
| pre-commit hook（证据提交首试） | 自动 `npm test` | 1 fail：pdf resource-limit 用例偶发 `worker-unavailable`（并发负载 flake，非本票路径），见下 |
| 单独复跑该用例 | `node --test --test-name-pattern="compressed costly page" tests/pdf.test.mjs` | 1 pass（`recheck-pdf-resource-limit.log`） |
| 重试证据提交 | `git commit`（同一 hook） | 通过后提交成功（`commit-evidence.log`） |

## flake 记录（如实）

- 证据提交首试被 pre-commit hook 拦下：`tests/pdf.test.mjs` 的「compressed costly page hits an actual process resource budget」得到 `worker-unavailable` 而非 `resource-limit`。该用例与本票无调用关系（PDF worker 资源预算），对同一工作树单独复跑通过；重试提交的 hook 全量通过。未使用 `--no-verify`。

## 合并集成分支

开工基线 `167d1ef`（= 开工时集成分支 tip，已先 `git merge integration/ourfairy-v1` 快进到它）。执行中集成分支前进两次，均不触碰 `backend/chat`：

1. `459ca98`（arch-63：`combo.json` pin + 证据）→ fast-forward 后复跑全量（135/135）与 combo；
2. `514026d`（arch-58：rikkahub pin `6f6cf7f` → `81f1b06b` + 证据）→ 合并提交 `199abb7`，在**最终合并状态**复跑全量（135/135）与 combo（3 仓 ok）。

其间一次证据提交尝试被 hook 的 `combo:verify` 拦下：rikkahub `product/ourfairy-v1` 已到 `81f1b06b` 而集成分支尚未更新 pin（跨仓中间态，非本票改动）。按 CONTEXT 先 merge 集成分支 `514026d` 解决，未使用 `--no-verify`。

## 未做 / 范围外

- **每事件 snapshot 仍构造一次**：`working` 需要逐事件任务状态（运行中/停止中、pending report），这是 activity 的真实输入，票面允许的「惰性求值」在当前语义下没有可省的事件；删掉的是第二次折叠，不是这次构造。
- **每个订阅者仍各自折叠一次**（`publish` 按 observer 生成完整 projection）。跨订阅者共享折叠结果属缓存设计，票面未要求，未做。
- `transcript` 仍独立遍历 events：它是消息投影，与任务折叠无关，本票未动。
- 未 push、未合入集成分支、未改 `combo.json`（合并带来的 pin 更新除外）、未评论/关闭 issue。
- 未发现其他票面相关问题。
