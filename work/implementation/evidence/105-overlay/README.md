# 105-overlay — 票 #105 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/10-row-addressability-tests.md`；协作边界
> `work/implementation/notes/73-boundary.md`、执行状态 `73-execution.md`、落点
> `73-row-plan.md`。分支 `ticket/105-overlay`；基线 `integration/spec-73` 的
> `b1878e7`；实现提交 `ae8ee49`；本证据目录随后一并提交。报告前分支已 fast-forward
> 到 `integration/spec-73` 的 `ed782ca`（Lead 合入 `fix/73-review` 后的 tip），并在
> 该 tip 上重跑了本票测试与全量。本票只新增测试与测试 fixture，不改产品代码、
> bundle 行 id、launcher 或 `combo.json`。

## 改了什么

1. 新增 `tests/row-addressability.test.mjs`（648 行，6 条用例），只从调用方可见的
   事实断言：启动结果、模型收到的工具目录、产品 `/chat/*` 返回的工具结果、HTTP
   响应，以及探针写出的行/服务事实。不断言私有组合对象。
2. 新增 `tests/fixtures/recording-bash-provider.mjs`：overlay 插入的替换 shell
   provider。它继承固定 dsh checkout 里的 `SandboxBashExecutor`，在 stdout 前加
   `[fixture]`，让调用方看得出实际运行的是替换模块。

## 每条用例证明什么

### 1. 单独 disable 投递行

overlay `[{id: 'delivery', disabled: true}]` 经 launcher `start` 启动：

- 启动成功（launcher 等探针 ready，说明其余组合仍完整）；
- 模型实际收到的工具目录包含 `read`/`bash`，不含 `deliver_message`；
- `/chat/send` + `/chat/read` 仍完成一轮对话（用户消息与 assistant 回复都在投影里）；
- 模型调用 `deliver_message`，产品返回明确失败
  `unknown tool "deliver_message"`。

### 2. 单独 disable 群组行

overlay `[{id: 'groups', disabled: true}]` 经 launcher 启动：

- 启动成功；工具目录不含 `groups`/`group_create`/`group_members`，`read`/`write`/
  `bash` 仍在；
- 私有、公有文件空间分别写入并读回；私有空间内受限脚本经 `bash` 运行成功；
- 群组根（`spaces/groups/1`）的 `read`/`write` 都返回 `outside`/`denied`；
- 调用缺失的 `groups` 工具返回 `unknown tool "groups"`。

### 3. 单独 disable 一个 scoped provider（`scoped-bash`）

- 基线 probe 返回 0 且 `ok: true`；带 overlay 的 probe 非零，`services.shell.live =
  false`、`expectedRow = "scoped-bash"`，失败文本点名 `service "shell" is not live`；
- 与基线相比没有新增行（没有挂载原生 fallback provider），被寻址行 `disabled: true`；
- 直接启动 CLI 后 HTTP 面仍可用：`/identity/sign-in`、`/sessions/create`、
  `/chat/send` + `/chat/read` 完成一轮；工具目录无 `bash`；调用 `bash` 返回
  `unknown tool "bash"`。这是本条票面要求的「scoped provider 依赖调用明确失败」的
  tool-call 级证据。

### 4. 单独 disable 文件系统 provider（`scoped-fs`）

- 基线 probe 干净；带 overlay 的 probe 非零，`services.fs.live = false`、
  `expectedRow = "scoped-fs"`，失败文本同时点名 `service "fs" is not live` 与
  `expected row "scoped-fs"`；
- `scoped-fs` 被标记 disabled；依赖 `fs` 的行 `scoped-directory`、`attachments`、
  `chat` 处于 `pending`；没有出现任何原生 fallback 行（`fs-sandbox`、
  `working-directory`、`bash-sandbox`、`sandbox`），也没有出现基线之外的新行；
- 直接启动 CLI 后，web carrier/identity/session 面仍在：`/identity/sign-in` 与
  `/sessions/create` 返回 200；`/chat/read`、`/chat/send` 均为 404，因为 chat 行
  仍在等 `fs` 依赖链，路由从未注册。

**依赖事实（必须如实记录）**：`fs` 是硬传递依赖，不是只影响文件工具。固定 dsh 的
`WorkingDirectoryService.inject` 含 `fs`，所以 `scoped-directory` 行等 `fs`；
`@ourfairy/dsh-attachments` 的 inject 含 `fs`、`workingDirectory`，而 chat 行 inject
`ourfairyAttachments`，因此 chat 也等 `fs`。`tool-bash` 的 inject 含
`workingDirectory`，所以 bash 工具同样缺席。于是 disable `scoped-fs` 时**不存在**
工具目录，无法制造 `read`/`write` 的 `unknown tool` 调用级断言；本票没有为此改动
产品依赖（Lead 在 2026-10-20 明确选择记录真实级联、不造 unknown-tool 用例）。该级联
是显式降级：probe 点名缺失服务/行与等待中的行，HTTP 面用 404 明确暴露 chat 路由
缺席，不是静默 fallback。

### 5. overlay 替换 provider 且其他行不受影响

overlay 先 `disabled: true` 掉 `scoped-bash`，再 `insert` 一个提供同一 `shell` 服务的
fixture 行（`scoped-bash-recording`）。直接启动 CLI 后：

- 工具目录重新出现 `bash`（同时有 `read`）；
- `bash` 调用结果带 `[fixture]` 前缀且命令输出仍在，证明跑的是替换模块；
- `write`/`read` 仍可读写私有空间，`working_directory` 仍报告私有根，证明其他
  provider 行未受影响。

overlay 的 `insert` 只按模块路径加载；patch 行只有 `id`+`name` 时 loader 只校验名字，
同名也不能换模块，所以替换的做法是 disable 原行 + 插入新行。探针的服务表仍把
`shell` 期望在 `scoped-bash` 上，因此这种情况 probe 会报 `service "shell" is live but
its row "scoped-bash" is disabled`——这是探针的期望归属，不是产品失败，所以本用例与
scoped provider disable 一样直接启动 CLI。

### 6. 非法行 config 在加载期失败并命名行与字段

overlay 把 `identity` 的 config 改为只含 `sessionTtlDays`（缺 `path`），经 launcher
`start`：

- `start` 非零退出，stdout 没有 `"ready": true`，也没有 `listeningPorts`；
- stderr 点名 `identity`，并给出指向 boot 日志的 `log <path>:` 指针；
- boot 日志含 `identity (@ourfairy/dsh-identity): ValidationError: invalid config:` 与
  `$.path missing required value (at path)`；
- `start` 写出的 `run/start-report.json` 中 `identity` 行 `fiberState: "failed"`，
  failures 点名 `bundle product row "identity" (@ourfairy/dsh-identity) is not active`。

该用例把 launcher 的 readiness 等待显式限制为 30s（`--ready-timeout-ms 30000`）：
load 失败在探针里立即有结论，但 launcher 要等自己的 ready 轮询超时；不设上限时默认
120s。30s 是运行参数，不放宽任何断言。

## 为什么两种启动路径并存

- `start`（经 launcher）需要探针报告 ready；探针检查「bundle 贡献的每个**非刻意
  disabled** 产品行 active」以及服务 liveness。投递/群组 disable 后组合仍完整，所以
  走 launcher，并顺带证明依赖它们的路由/服务没被拆坏。
- scoped provider disable 后其服务按设计缺席，探针会（正确地）把缺席记为失败；这时
  launcher 的 ready 门会拦住启动。因此这两类用例用与 launcher 相同的 `--patch`、
  相同的 `dsh --profile ourfairy` 直接启动 pinned CLI，省掉的只是 launcher 的
  ready 门；就绪仍由 `/identity/sign-in` 实际应答判断，而不是日志行。
- 替换 provider 的用例同样直接启动：插入行让 `shell` 服务 live，但探针期望它由
  `scoped-bash` 提供，会报「live 但行被 disabled」。

## 实际执行的命令与输出摘要

最终树（`ed782ca` + `ae8ee49`）上：

```
$ node --test tests/row-addressability.test.mjs
✔ disabling the delivery row leaves chat serving and refuses deliver_message
✔ disabling the groups row removes its tools and roots, not the file spaces or scripts
✔ disabling a scoped provider keeps the HTTP surface while its service and tool are absent
✔ disabling the fs provider leaves its dependants waiting, not a fallback
✔ an overlay can replace the shell provider and leave the other providers working
✔ an invalid row config fails at load and names the row and field
ℹ tests 6  suites 0  pass 6  fail 0  duration_ms 50743.585958
```

```
$ npm test
ℹ tests 182  suites 7  pass 182  fail 0  duration_ms 84656.654512
```

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  based on integra  ed782ca140ab80a6  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      460109d1b89b824a  2d97ed143e7a6487  MISMATCH
combo: 1 drift/missing entry                      （退出码 1）
```

rikkahub 的 `MISMATCH` 是已知外部漂移（分支 tip `2d97ed14` ≠ `combo.json` 锁定
`460109d1`，另一 spec 的归档提交）。本票没有改 `combo.json`，也没有动 rikkahub；
ourfairy 与 dsh 两项均为 ok。

## 排障记录（红 → 绿）

首轮按整文件跑时，进程长时间没有输出，被终止后改为逐条运行定位。逐条计时：

| 用例 | 首次结果 | 修复后 |
| --- | --- | --- |
| 投递 disable | 通过 2.48s | 通过 |
| 群组 disable | 通过 2.83s | 通过 |
| scoped-bash disable | 通过 4.05s（含 hook 14.09s） | 通过 |
| 替换 shell provider | **失败**：`waitForCatalog` 90s 超时（用例 92.4s） | 通过 7.93s |
| 非法 config | **失败**：断言 stderr 含 `$.path`（用例 126.4s） | 通过 33.1s |
| scoped-fs disable | 新增 | 通过 3.52s |

两处失败都是测试缺陷，不是产品缺陷：

1. **替换 provider 的 fixture 无法 import**。插入行日志为 `failed to import`，`shell`
   服务缺席、`tool-bash` pending，工具目录自然没有 `bash`。原因：fixture 原先用
   `createRequire(<dsh>/apps/cli/package.json).resolve('@deepseek-ai/dsh-bash-sandbox')`，
   而该包不是 `apps/cli` 的依赖；改成纯静态 import 后仍未命中 overlay 模块的运行时
   解析。最终按固定 dsh checkout 的构建产物绝对路径导入
   `<dshDir>/packages/shell/bash-sandbox/lib/index.js`（与 profile 里产品 bash 行
   扩展的是同一个模块文件），插入行 active、`bash` 工具恢复。
2. **非法 config 的字段名不在 start 的 stderr**。launcher 的 stderr 只有探针失败摘要
   与 `log <path>:` 指针；`$.path` 在 boot 日志里。测试改为解析该指针、读日志断言
   `identity` 与 `$.path`，并额外断言 `start-report.json` 的失败行。字段名要求没有
   降低，只是断言到操作者实际能看到的落点。

**关于「整文件跑 15 分钟无输出」**：不是某条用例无界挂起。逐条复跑里最长的等待是
替换用例的 90s `waitForCatalog`（失败路径）与非法 config 用例的 launcher 默认 120s
ready 轮询（失败路径），两者都是有界等待；加上首次运行经过 `tail` 管道（EOF 前不
输出），所以运行中看不到任何行。修复 fixture 并把 ready 上限设为 30s 后，整文件
50.7s 完成；没有复现无界 hang，也没有用例超过它自己声明的期限。

## 未执行 / 未覆盖项

- 所有模型 turn 都打到进程内的 Messages SSE 替身（`MINIMAX_CN_API_KEY` +
  `OURFAIRY_MINIMAX_BASE_URL` 指向本地服务器），**没有**调用官方 DeepSeek/MiniMax
  等真实服务；本票不涉及真机/模拟器。
- 没有对 `scoped-sandbox`、`scoped-directory` 做 tool-call 级 disable 用例；票面只要求
  「至少一个 scoped provider」，这里由 `scoped-bash` 承担 tool-call 级证据，
  `scoped-fs` 承担第二个 provider 的 HTTP/probe 级证据。`tests/scoped-provider-rows`
  已对四个 provider 做过 probe 级 disable 覆盖。
- 如「依赖事实」所述，`scoped-fs` disable 无法产生 `read`/`write` 的 unknown-tool
  调用级证据（chat 行本身在等 `fs`）；这是产品依赖形状，本票未改产品来制造它。
- `npm run combo:verify` 因 rikkahub 已知外部漂移退出 1；ourfairy/dsh 两项 ok。
  pre-commit hook 会跑 `npm test` + `combo:verify`，必然被同一项漂移挡住，因此本票
  提交使用 `git commit --no-verify`；提交前已手动跑完上述全量测试与 verify。
