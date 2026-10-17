# arch-53 merger 验证记录

- 票：https://github.com/eafen405/OurFairy/issues/53（地图 #69 架构收口）
- 仓库：OurFairy（后端）；集成分支 `integration/ourfairy-v1`
- 票分支：`arch/53-projection-fold`（worktree `/home/eafen405/projects/OurFairy/.worktrees/arch-53-projection-fold`）
- 合并人：merger 子代理；日期 2026-10-17

## 前置核对

| 检查 | 结果 |
| --- | --- |
| 主 checkout `/home/eafen405/projects/OurFairy` 在 `integration/ourfairy-v1`、工作树无未提交改动 | 通过（`git status --porcelain` 空，HEAD `514026d`） |
| 票分支 tip = 实现者 FINAL_SHA | 通过：`62a1fc9`（`docs(evidence): record arch-53 final merged verification`），含 `f1acf76` 实现、`b25ba2d` 证据、`199abb7` merge `514026d` |
| 集成分支当前 tip 已包含于票分支 | 通过：`git merge-base --is-ancestor 514026d arch/53-projection-fold` |
| 合并冲突 | 无（`ort` 策略自动合并） |

## 合并

```
git merge --no-ff arch/53-projection-fold -m "Merge branch 'arch/53-projection-fold' into integration/ourfairy-v1"

commit 7601bf12e30e7c7d0c60afba9c6f83537a9f5cec
parents: 514026d 62a1fc9
```

合并后集成分支 tip：`7601bf12e30e7c7d`。

## 合并后验证（真实输出）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test`（第 1 次） | 135 tests / **134 pass / 1 fail（exit 1）**：`tests/pdf.test.mjs:161` PDF 资源预算用例得到 `worker-unavailable`（期望 `resource-limit`），详见下方 flake | `merger-npm-test-run1.log` |
| `npm test`（第 2 次，立即重跑） | **135 tests / 135 pass / 0 fail，exit 0**，duration 44220ms | `merger-npm-test-run2.log` |
| `npm run combo:verify` | ourfairy `7601bf12e30e7c7d`（worktree is the integration tip）、dsh `fe2bbc3b1c14efd7`、rikkahub `81f1b06bf7df8889`，3 仓 **ok**，exit 0 | `merger-combo-verify.log` |
| 定向：`node --test tests/projection-fold.test.mjs tests/jobs.test.mjs tests/text-delivery.test.mjs tests/remote-chat.test.mjs tests/reconnect.test.mjs` | **31 pass / 0 fail，exit 0** | `merger-targeted-chat-tests.log` |
| 定向：`node --test tests/chat-runtime.test.mjs tests/projection-interface.test.mjs tests/session-events.test.mjs` | **7 pass / 0 fail，exit 0** | `merger-targeted-projection-tests.log` |

全量 `npm test` 覆盖 remote-chat / jobs / activity / projection 路径；定向两组额外确认本票改动的折叠 seam 与 wire projection 契约。

## PDF flake 记录（如实）

- 第 1 次全量失败同样是实现者证据提交首试遇到的已知 flake：`compressed costly page hits an actual process resource budget` 在并发负载下得到 `worker-unavailable` 而非 `resource-limit`。
- 现场负载：`uptime` load average 11.21，同期有 Android 构建 `java` 进程约 212% CPU（#68 实现者在 rikkahub worktree），与本票改动路径无关（PDF worker 资源预算）。
- 立即重跑全量即 135/135 通过；未使用 `--no-verify`，未改测试或实现代码。

## 实现者落地方式（核对结论，未改代码）

- 同一事件日志每轮 projection 的 `taskHistory` 折叠次数 **2 → 1**：新增 `backend/chat/src/history.mjs`，`taskHistory` 唯一折叠，`projectSession` 一次产出 `tasks` + `activity`；`jobs.mjs` 不再拥有折叠。
- **每事件 snapshot 未惰性化**：`activity` 的 `working` 判定真实消费逐事件任务状态（运行中/停止中、pending report），当前语义下没有可省的事件；删掉的是第二次折叠，不是这次构造。票面允许的惰性求值未落地，未做即未做，如实记录。
- 每个订阅者仍各自折叠一次（`publish` 按 observer 生成完整 projection），跨订阅者共享属缓存设计，票面未要求；`transcript` 仍独立遍历 events。
- 输出语义保持：`tasks` / `activity` 字段与判定顺序未变；新增 2 条 seam 测试钉住只折叠一次与空日志 `throughSeq = -1` 回退。

## 证据与范围

- 本目录随票分支合入：`README.md` 为实现者报告，其余 `*.log` 为实现者原始日志；`merger-*.log` 与本文为合并后状态复跑记录。
- 未改实现者代码；未 push 前未评论/关闭 issue（由 merger 后续步骤完成）。
