# 169-upgrade-checklist — 票 #169 证据

票面：本地 [`work/tickets/135/07-upgrade-checklist.md`](../../../../tickets/135/07-upgrade-checklist.md)（父票 #135）。
分支：`ticket/169-upgrade-checklist`，基线 `integration/spec-135` tip `17d9ce5`（开工与收口前均确认
`git merge integration/spec-135` 为 `Already up to date`）。
范围：把前六张票建立的六处原生语义守卫写进升级复核入口，并让引用清单在测试改名/删除时失败。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `docs/architecture/dsh-ecosystem-boundary.md` | 新增「4. 原生语义漂移」一节：六行表格逐项写明上游变化、产品处理方式、上游变化时失败的测试文件与标题，并简述没有守卫时的静默失败方式。日期行补 2026-10-21 增补说明，保留 2026-10-19 原文；后续两节顺延为 5、6。全文只引用测试路径/标题，没有复制 bundle 行/包清单。 |
| `tests/ecosystem-boundary.test.mjs` | `CITED_CHECKS` 追加六条引用（既有条目未动）：`tests/native-job-status.test.mjs`、`tests/native-job-stop-outcome.test.mjs` 各一条，`tests/gateway.test.mjs` 三条，`tests/remote-chat.test.mjs` 一条。测试改名/删除或文档不再引用时，`every limitation names a check whose test title still exists` 失败。 |
| `backend/chat/README.md` | 「dsh 升级复核」第二条 `node --test` 命令补入 `tests/native-job-status.test.mjs tests/native-job-stop-outcome.test.mjs`；正文补两句，点名两条对账断言及其捕获的上游变化（任务状态增删、停止返回值增删）。 |

六处守卫与文档中的测试标题：

| 上游变化 | 检查 |
| --- | --- |
| 原生任务状态词表增删成员 | `tests/native-job-status.test.mjs`：`native job status vocabulary matches the projection` |
| 原生停止结果新增返回值 | `tests/native-job-stop-outcome.test.mjs`：`native job stop outcome vocabulary matches the adapter` |
| 模型条目新增部署自有字段 | `tests/gateway.test.mjs`：`a route saved from the phone keeps model fields the draft does not edit` |
| 选型保存入口的串行化行为改变 | `tests/gateway.test.mjs`：`consecutive selection saves commit in submission order` |
| 原生输入模态列表增删成员 | `tests/gateway.test.mjs`：`the gateway accepts every native input modality` |
| transcript 受理锚点行为改变 | `tests/remote-chat.test.mjs`：`the same request id sent twice in a row produces one message` |

任务状态与停止结果的原生词表是导出类型、不进入运行时，因此文档明确写「没有编译期保证」，
对账发生在测试期，运行期对未知值分别显式记为未知与 5xx 响亮失败。

## red / green（文档的检查先红）

新增引用后、写文档前：

```text
$ node --test tests/ecosystem-boundary.test.mjs
✖ every limitation names a check whose test title still exists
  AssertionError [ERR_ASSERTION]: the doc must cite tests/native-job-status.test.mjs
    as the check that fails when its limitation stops holding
ℹ fail 1
```

写文档并更新 chat README 后：

```text
$ node --test tests/ecosystem-boundary.test.mjs tests/docs.test.mjs
✔ every relative link in the repository Markdown resolves
✔ the boundary doc is reachable from the repository README
✔ the doc names the parallel-transport exception and the /api admission boundary
✔ the doc points at the row and package authorities instead of copying them
✔ the doc names the native capabilities each retained product implementation replaces
✔ the bundle mounts no Gateway, Remote/Typert or plugin-manager package
✔ every product package stays unpublished
✔ the doc records the explicit non-goals
✔ every limitation names a check whose test title still exists
ℹ tests 9 / pass 9 / fail 0
```

行/包复制检查（`the doc points at the row and package authorities instead of copying them`）在上述
运行中通过：新节只出现测试路径与标题，没有出现任何挂载行 id 或包名。

## 最终门禁

以下命令在 `integration/spec-135` tip `17d9ce5` 已合入本分支（`Already up to date`）的状态下执行：

```text
$ node --test tests/native-job-status.test.mjs tests/native-job-stop-outcome.test.mjs
✔ native job status vocabulary matches the projection
✔ an unmapped native job status is an explicit unknown in /chat/jobs/output
✔ native job stop outcome vocabulary matches the adapter
✔ known native stop outcomes keep their numeric wire contract
✔ an unknown native stop outcome is a 5xx product error naming it
ℹ tests 5 / pass 5 / fail 0

$ npm test
ℹ tests 244 / suites 7 / pass 244 / fail 0 / cancelled 0 / skipped 0
ℹ duration_ms 117623.974637

$ npm run combo:verify
ourfairy        integration/ourfairy-v1  ... ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  -                        460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

提交时 `.githooks/pre-commit` 在最终树上重跑同一对命令：`npm test` 244 pass / 0 fail，
`npm run combo:verify` 输出 `combo: combination verified`。本次未使用 `--no-verify`。

## 未完成项

无。证据索引 `work/implementation/evidence/README.md` 未加本目录条目——本票面未要求，且
spec #135 的六个兄弟证据目录也未登记；如需统一登记，由收口方一次性补。
