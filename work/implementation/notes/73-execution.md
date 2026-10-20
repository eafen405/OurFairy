# #73 执行中状态（Lead 维护；实现者开工先读本文）

票面与父规格仍是行为权威；本文只记**当前执行状态**与并行纪律。落点见
`work/implementation/notes/73-row-plan.md`，写范围见 `73-boundary.md`。

## 组合与基线

- 产品分支 `integration/spec-73`；基线提交见本文所在提交（实现者开工时以 `git rev-parse HEAD` 核对，
  并把 `integration/spec-73` 最新 tip 合进自己的票分支）。
- dsh fork 锁定 `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`（`combo.json`），已构建。
- rikkahub 锁定 `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`；其分支 tip 已到 `2d97ed14`（另一 spec 的
  归档提交）。**不要**改 rikkahub，也不要 checkout 它的提交。

## 进度

| 票 | 状态 |
| --- | --- |
| #96 bundle 包集合权威 | 已完成并合入，已关闭 |
| #97 并行传输边界文档 | 已完成并合入，已关闭 |
| #98 产品包 dsh 兼容范围 | 本轮并行 |
| #99 投递独立行 | 本轮并行 |
| #100 群组独立行 | 本轮并行 |
| #101 scoped provider 各自成行 | 本轮并行 |
| #102 Config 与行 liveness | 待 #101 |
| #103 单一模型权威 | 待 #102 |
| #104 只声明 bundle 的 profile 验收 | 待 #98–#103 |
| #105 overlay 行可寻址验收 | 待 #99–#102 |
| #106 收口 | 待 #104/#105 |

## 并行纪律

- 只写票面声明的范围。`backend/v1-bundle/package.json` 的 `dependencies` 与
  `cordis.patch.yml` 会被 #99/#100/#101 同时编辑：**只追加自己的行与包，不重排、不删除别人的行**。
  合并冲突在合并时按语义解决（保留双方的行）。
- 新产品包的 `peerDependencies` 直接写明确 semver 范围，不要写 `workspace:`。当前安装版本是
  `@deepseek-ai/dsh*` = `0.2.1-alpha.2`、`@deepseek-ai/cordis` = `4.0.5-alpha.1`、
  `@deepseek-ai/schemastery` = `3.18.5-alpha.1`、`@ourfairy/dsh-*` = `0.1.0`；
  用能包含它们的范围（如 `^0.2.1-alpha.2`、`^4.0.5-alpha.1`、`^3.18.5-alpha.1`、`^0.1.0`）。
  #98 会统一全部产品包并加 doctor 检查；新包先按此写，避免合并后再改。
- 产品行的最小元数据跟 dsh 的 `readPluginMeta` 走：包内 `locale/en.json` 的
  `{"meta":{"title":...,"description":...}}`，`package.json` 的 `description` 作兜底，
  并在 `exports` 与 `files` 声明 `./locale/*.json`。例子见 `backend/v1-bundle/locale/en.json`
  与 dsh 包的 `locale/en.json`；不要发明新字段。
- 不修改 `backend/chat/src/runtime.mjs`、`service.mjs`、`projection.mjs`、`history.mjs`
  （#72 的写范围）；#99 只在 `chat/src/index.mjs` 与新增的窄门面文件落改动。
- 每个 worktree 跑自己的测试；主 worktree 里有另一会话的未跟踪 scratch（`work/tmp/`），
  `tests/docs.test.mjs` 会扫到它，不要在合并树上判断测试红绿。

## 检查与提交

- 基线事实：干净 worktree 的 `npm test` = 157 pass / 0 fail（约 75–90 秒）。
- `npm run combo:verify` 的 **ourfairy** 一项必须 ok（票分支已合入 `integration/spec-73` tip）；
  **rikkahub** 一项当前必然 MISMATCH（分支 tip `2d97ed14` ≠ 锁定 `460109d1`，外部漂移，与本 spec 无关）。
  不要为了让 verify 变绿去改 `combo.json` 或 rikkahub；在证据里记录这一条即可。
- pre-commit 会跑全量测试与 `combo:verify`。因上述外部漂移失败时可以 `--no-verify`，
  但必须在证据里写明原因，并在本 worktree 干净树上手动跑完 `npm test`。
- 证据按 `work/implementation/CONVENTIONS.md` 第 5 节写
  `work/implementation/evidence/<NN>-<slug>/README.md`，随票提交。

## 报告格式（给 Lead）

票号、分支、HEAD SHA、改动文件、执行的命令与结果摘要、证据路径、未执行项、与并行票冲突的文件与
你采用的解决方式。不要复述票面。
