# merger-verification — arch-51-chat-runtime

- 票：#51（chat live-session runtime seam 重构）
- 票分支：`arch/51-chat-runtime`
- 票分支 tip（实现者 FINAL_SHA）：`4ebfdf6`（证据提交；实现提交 `ec309ec`）
- 合并提交：`d575817`（`Merge branch 'arch/51-chat-runtime' into integration/ourfairy-v1`）
- 合并后 `integration/ourfairy-v1` tip：`d575817f13f89c00261a0e093997d72ad96b8d43`

## 前置核对

- OurFairy 主 checkout 在 `integration/ourfairy-v1`、`git status --porcelain` 为空，tip `3062879`。
- 票分支 HEAD `4ebfdf6`，`git merge-base --is-ancestor 3062879 4ebfdf6` 成立（无需补合集成分支）。
- 合并前主 checkout 无未提交改动；合并 `--no-ff` 无冲突。
- `git diff --quiet 4ebfdf6 d575817` 通过：合并提交树与实现者交付树逐字节相同，实现者验收状态未被合并过程改变。

## 合并后验证（OurFairy 主 checkout，命令与真实输出）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | **133/133 pass**，6 suites，0 fail / 0 cancelled / 0 skipped，29.7s | `merge-npm-test.log` |
| `npm run combo:verify` | `combo: combination verified`；ourfairy `d575817` ok（worktree is the integration tip）、dsh `fe2bbc3` ok、rikkahub `a0c03bc` ok | `merge-combo-verify.log` |
| `node --test tests/remote-chat.test.mjs tests/jobs.test.mjs tests/text-delivery.test.mjs tests/file-delivery.test.mjs` | **31/31 pass**，15.6s（本票触及的锁/版本递增路径定向回归） | `merge-targeted.log` |
| `node --test tests/chat-runtime.test.mjs` | **5/5 pass**（本票新增 seam 测试） | `merge-chat-runtime.log` |

`npm test` 全量包含上述四个既有套件与新增 `chat-runtime` 套件；全量一次通过，未触发实现者记录的既有 PDF flake。

## 票面「删除测试」结论的落地方式

票面结论：把 `delivery.mjs`/`jobs.mjs` 拆回 `service.mjs` 不减复杂度，**拆分保留、seam 换成有名字的 runtime**。落地即：新增 `backend/chat/src/runtime.mjs`（`LiveSession` / `SessionRuntime`）与 `backend/chat/src/queues.mjs`（`runSession` / `runDelivery` 两个命名 key 空间）；`delivery.mjs`、`jobs.mjs` 只依赖 `runtime.*`，不再出现 `chat._*`；`version++` 收敛到 `runtime.mjs` 单一处；同队列嵌套改为立即 reject 而非静默挂起。上述均有源码断言与 `tests/chat-runtime.test.mjs` 覆盖。

## 已知 flake（如实记录）

实现者记录：既有 PDF 测试偶发 `worker-unavailable` vs `resource-limit`（见 `hook-fail-pdf-flake.log`、`pdf-rerun.log`），隔离重跑通过；与本票改动无关。本次合并后全量未复现。

## 未完成项 / 范围外

- 无阻塞。保持票面已记录的范围外观察：`SessionRuntime.#live` 不逐出会话（沿既有策略，本票未改）。
- 未改实现者代码、未改 `combo.json`；rikkahub/dsh pin 未动。
