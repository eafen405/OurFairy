# arch-50 merger verification — owner codec 收敛

- 票：<https://github.com/eafen405/OurFairy/issues/50>（地图 #69）
- 票分支：`arch/50-owner-codec`
- 实现者 FINAL_SHA：`41770e2210e421edc2dee5c05b35c3c34e02177d`（`git -C <worktree> log --oneline -3` 核对一致；已含集成分支 tip `1c95299`）
- 合并前补记：实现者遗留 2 个未跟踪证据日志（`commit-evidence2.log`、`commit-evidence3.log`）在票分支提交为 `751772f`（merger 仅收录证据，未改实现代码）
- 集成分支合并前 tip：`1c95299`
- 合并提交：`5dd301c9ff9e143c`（`Merge branch 'arch/50-owner-codec' into integration/ourfairy-v1`，`--no-ff`，无冲突）

## 合并后验证（主 checkout `/home/eafen405/projects/OurFairy`，合并提交之上）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | **127/127 通过**，`fail 0`，耗时 26.5s，exit 0 | `merger-full.log` |
| `npm run combo:verify` | **三项 ok**：ourfairy based on integration tip `5dd301c9`、dsh `fe2bbc3b`、rikkahub `189648274`；`combo: combination verified`，exit 0 | `merger-combo-verify.log` |

本次合并后独立全量运行未复现实现者记录过的 PDF 资源预算 flake（`worker-unavailable` vs `resource-limit`）；实现者开工基线与改后全量各命中一次该既有 flake，单独重跑 `node --test tests/pdf.test.mjs` 为 5/5（见 `README.md`、`pdf-rerun.log`）。merger 以本次 127/127 为准。

补记：本证据提交的 pre-commit hook 第一次运行（又一次合并后全量）命中了同一 PDF flake（`tests/pdf.test.mjs:170`，actual `worker-unavailable` / expected `resource-limit`，其余用例全绿），按仓库纪律原样重试提交，第二次 hook 全量通过并完成提交。该 flake 与 #49/#64 记录一致，属并发负载抖动，不是本票引入；merger 未用 `--no-verify` 绕过任何一次 hook。

## 行为边界（实现者同步调用方的类型变化）

- `spaces/src/scope.mjs` 的 `owner(session)` 返回类型由 **string → number**（codec `shortIdOf` 的 short number）。仓库内调用方仅 `spaces/src/groups.mjs`（2 处）与 `attachments/src/service.mjs`（1 处），均已删除 `Number(...)` 回转；`privateRoot()` 用模板串拼目录，`spaces/private/<shortId>` 布局不变，非 owner 仍以 `FS_PERMISSION_DENIED` 拒绝。该方法是服务端内部 seam，HTTP/Android 契约不暴露其返回类型。
- chat sender 解析收紧：`user:02`、`user: 2` 等非规范 owner 串旧实现会 `Number(replace(...))` 解析出 2，现由 codec 统一拒绝（403 `delivery/unknown-sender`）。产品路径的 header 只由 sessions 服务端经 `ownerOf` 写入，不会产生此类串；这是码表唯一后的收紧。
- codec 拒绝超出安全整数范围的 short number（同 #49）；真实 short number 由 SQLite INTEGER 分配，不可触发。

## 范围外（未改动，如实记录）

- `backend/probe/src/index.mjs` 的 `'user:1'`：测试专用 liveness probe，不在产品 bundle，固定 fixture；新测试源码扫描显式排除 `probe/`。
- `backend/spaces/test-support/scope-contributors.mjs` 的模板串：测试 fixture；`scope.owner()` 的 codec 校验会让任何漂移立即失败。
- 未改 Android 客户端与 `combo.json`；本票不涉 rikkahub/dsh。

## 未完成项

无。合并冲突：无。实现代码：merger 未改动。
