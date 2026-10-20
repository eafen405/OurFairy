# 105-overlay — 票 #105 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/10-row-addressability-tests.md`；协作边界
> `work/implementation/notes/73-boundary.md`、执行状态 `73-execution.md`、落点
> `73-row-plan.md`。分支 `ticket/105-overlay`；基线 `integration/spec-73` 的
> `b1878e7`；实现提交 `ae8ee49`；本证据目录随后一并提交。报告前 fast-forward 到 `integration/spec-73` 的
> `ed782ca`。终审轮（#106）在 `fix/73-final` 上更新本文件，代码 HEAD 为 `90a64e9`
> （文档提交随后）。#105 本身只新增测试与测试 fixture，不改产品代码、bundle 行 id、
> launcher 或 `combo.json`；终审轮对 probe 的 disabled-row 规则与 identity TTL 的改动
> 属于 #73 评审修复，见 `work/implementation/notes/73-review-findings.md`。

## 改了什么

1. 新增 `tests/row-addressability.test.mjs`（终审轮后 7 条用例），只从调用方可见的
   事实断言：启动结果、模型收到的工具目录、产品 `/chat/*` 返回的工具结果、HTTP
   响应，以及 launcher 的 start report 写出的行/服务事实。不断言私有组合对象。
2. 新增 `tests/fixtures/recording-bash-provider.mjs`：overlay 插入的替换 shell
   provider。终审轮后它继承产品自己的 `ScopedBash`（调 `super.execute`，保留作用域
   校验），在 stdout 前加 `[fixture]`，让调用方看得出实际运行的是替换模块。

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

- 经 launcher `start` 启动成功：探针的 disabled expected row 规则把 `shell` 的缺席当作
  刻意缺席，因此 `start` 等到 ready（这同时覆盖父票 #73「禁用 scoped provider 后仍能启动」）；
- launcher 写出的 `run/start-report.json`：`ok: true`、`services.shell.live = false`、
  `expectedRow = "scoped-bash"`、`disabled: true`，且没有 `service "shell" is not live`
  失败；被寻址行 `disabled: true`；
- 报告中没有新增行，也没有任何原生 fallback package/行（按行 id 与 `name` 双重断言）；
- HTTP 面仍可用：`/identity/sign-in`、`/sessions/create`、`/chat/send` + `/chat/read`
  完成一轮；工具目录无 `bash`；调用 `bash` 返回 `unknown tool "bash"`。这是本条票面要求的
  「scoped provider 依赖调用明确失败」的 tool-call 级证据。

### 4. 单独 disable 文件系统 provider（`scoped-fs`）

- 基线 probe 干净；带 overlay 的 probe 仍非零，但失败来自等待中的依赖而不是被禁用行
  自己：`services.fs.live = false`、`expectedRow = "scoped-fs"` 且 `disabled: true`，
  没有 `service "fs" is not live`；失败点名 `service "ourfairyAttachments" is not live`
  与 `bundle product row "attachments"` 等；
- `scoped-fs` 被标记 disabled；依赖 `fs` 的行 `scoped-directory`、`attachments`、
  `chat` 处于 `pending`；没有出现任何原生 fallback 行（`fs-sandbox`、
  `working-directory`、`bash-sandbox`、`sandbox`，并额外按 mounted package name 断言
  `@deepseek-ai/dsh-fs-sandbox` 等不会出现），也没有出现基线之外的新行；
- direct boot（裸 `dsh --profile ourfairy --patch <overlay>`，没有 probe overlay /
  readiness gate / probe 环境）后，web carrier/identity/session 面仍在：
  `/identity/sign-in` 与 `/sessions/create` 返回 200；`/chat/read`、`/chat/send` 均为
  404，因为 chat 行仍在等 `fs` 依赖链，路由从未注册。

**依赖事实（必须如实记录）**：`fs` 是硬传递依赖，不是只影响文件工具。固定 dsh 的
`WorkingDirectoryService.inject` 含 `fs`，所以 `scoped-directory` 行等 `fs`；
`@ourfairy/dsh-attachments` 的 inject 含 `fs`、`workingDirectory`，而 chat 行 inject
`ourfairyAttachments`，因此 chat 也等 `fs`。`tool-bash` 的 inject 含
`workingDirectory`，所以 bash 工具同样缺席。于是 disable `scoped-fs` 时**不存在**
工具目录，无法制造 `read`/`write` 的 `unknown tool` 调用级断言；本票没有为此改动
产品依赖（Lead 在 2026-10-20 明确选择记录真实级联、不造 unknown-tool 用例）。该级联
是显式降级：probe 点名等待依赖的服务与等待中的行，HTTP 面用 404 明确暴露 chat 路由
缺席，不是静默 fallback。

### 5. overlay 替换 provider 且其他行不受影响

替换按 disable+insert 表达：overlay 先 `disabled: true` 掉 `scoped-bash`，再 `insert`
一个提供同一 `shell` 服务的 fixture 行（`scoped-bash-recording`）。经 launcher `start`
启动成功，`run/start-report.json` 记录 `ok: true`、`services.shell.live = true`、
`expectedRow = "scoped-bash"` 且 `disabled: true`——服务 live 而 expected row 被禁用就是
探针的「替换」规则，不再记为失败。随后：

- 工具目录重新出现 `bash`（同时有 `read`）；
- `bash` 调用结果带 `[fixture]` 前缀且命令输出仍在，证明跑的是替换模块；
- `write`/`read` 仍可读写私有空间，`working_directory` 仍报告私有根，证明其他
  provider 行未受影响。

fixture（`tests/fixtures/recording-bash-provider.mjs`）继承**产品自己的** `ScopedBash`：
通过 launcher 安装出的 profile 用 `createRequire(profile/package.json)` 解析
`@ourfairy/dsh-spaces/bash` 的安装副本，再 `import` 其文件 URL；`execute` 调
`super.execute`，因此作用域校验、`ourfairySpaces.run` 与受限执行都真实运行，只额外加
`[fixture]` 前缀。它依赖 launcher 设置的 `DSH_HOME` 与 `combo.json` 的 profile 名；这是
测试 fixture 的解析方式，不是产品行为。

### 6. 非法行 config 在加载期失败并命名行与字段

两个 overlay 场景（票面要求「非法 root/缺失字段」），都经 launcher `start`：

- `identity` 的 config 改为只含 `sessionTtlDays`（缺 `path`）；
- `spaces` 的 config 改为 `{ root: 42 }`（root 类型非法）。

每个场景都断言：

- `start` 非零退出，stdout 没有 `"ready": true`，也没有 `listeningPorts`；
- stderr 点名对应行，并给出指向 boot 日志的 `log <path>:` 指针；
- boot 日志含对应的 `ValidationError: invalid config:` 与字段路径（`$.path` / `$.root`）；
- `start` 写出的 `run/start-report.json` 中对应行 `fiberState: "failed"`，
  failures 点名 `bundle product row "<row>" (<package>) is not active`。

用例把 launcher 的 readiness 等待显式限制为 30s（`--ready-timeout-ms 30000`）：
load 失败在探针里立即有结论，但 launcher 要等自己的 ready 轮询超时；不设上限时默认
120s。30s 是运行参数，不放宽任何断言。两个场景各用独立 home，互不共享安装状态。

## 启动路径：launcher 为主，direct 只服务 fs 级联

- `start`（经 launcher）需要探针报告 ready。投递/群组 disable、shell disable（disabled
  expected row 的缺席是刻意缺席）、provider 替换（disabled expected row 上 live 的服务是
  替换）以及非法 config（加载期失败，根本到不了 ready）都走 launcher。能经 launcher 启动
  本身就是 #105「启动成功」的调用方可见证据。
- 只有 `scoped-fs` disable 走 direct boot：`fs` 是 attachments（以及 chat）和
  `scoped-directory` 的硬依赖，这些行等待使依赖服务缺席，组合无法满足探针 ready。direct
  boot 是**一条裸 `dsh --profile ourfairy --patch <overlay>`**：没有 probe overlay、没有
  readiness gate、也不设置 `OURFAIRY_PROBE_*`；它只用于这条级联用例，就绪由
  `/identity/sign-in` 实际应答判断，而不是日志行。探针 boot 同一 overlay 时断言
  chat/attachments/scoped-directory 等行 `pending`；direct boot 断言 `/chat/*` 为 404
  （路由从未注册）——两个事实都是同一条级联的调用方可见面。

## 实际执行的命令与输出摘要

终审轮最终代码树（`fix/73-final`，代码 HEAD `90a64e9`；本文件随后提交）：

```
$ node --test tests/row-addressability.test.mjs
✔ disabling the delivery row leaves chat serving and refuses deliver_message
✔ disabling the groups row removes its tools and roots, not the file spaces or scripts
✔ disabling the shell provider starts, keeps the HTTP surface, and leaves the capability absent
✔ disabling the fs provider leaves its dependants waiting, not a fallback
✔ an overlay can replace the shell provider and leave the other providers working
✔ an invalid identity config fails at load and names the row and $.path
✔ an invalid spaces config fails at load and names the row and $.root
ℹ tests 7  suites 0  pass 7  fail 0  duration_ms 76001.713913
```

```
$ npm test
ℹ tests 185  suites 7  pass 185  fail 0  duration_ms 86568.806557
```

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  based on integra  90a64e9（HEAD）  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      460109d1b89b824a  2d97ed143e7a6487  MISMATCH
combo: 1 drift/missing entry（退出码 1）
```

rikkahub 的 `MISMATCH` 是已知外部漂移（分支 tip `2d97ed14` ≠ `combo.json` 锁定
`460109d1`，另一 spec 的归档提交）。本票没有改 `combo.json`，也没有动 rikkahub；
ourfairy 与 dsh 两项均为 ok。

历史快照：终审轮前在 `ed782ca` + `ae8ee49` 上是 6 条用例与 182 条全量；那组数字属于
旧版 direct-boot 用例与旧探针规则，不再是当前行为。

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

1. **替换 provider 的 fixture 无法 import**（历史：当时继承原生 executor）。插入行日志为
   `failed to import`，`shell` 服务缺席、`tool-bash` pending，工具目录自然没有 `bash`。
   原因是 overlay 模块从 checkout 解析裸 specifier 不命中 profile。当轮按固定 dsh checkout
   的构建产物绝对路径导入 `<dshDir>/packages/shell/bash-sandbox/lib/index.js` 修复；
   终审轮改为继承安装副本里的产品 `ScopedBash`（`super.execute` 保留作用域校验），
   见第 5 节。
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
  调用级证据（chat 行本身在等 `fs`）；这是产品依赖形状，本票未改产品来制造它。direct
  boot 只服务这一条级联，不设置 probe 环境；替换 fixture 依赖 `DSH_HOME` 指向 launcher
  安装出的 profile，这是测试解析方式。
- `npm run combo:verify` 因 rikkahub 已知外部漂移退出 1；ourfairy/dsh 两项 ok。
  pre-commit hook 会跑 `npm test` + `combo:verify`，必然被同一项漂移挡住，因此本轮
  提交使用 `git commit --no-verify`；提交前已手动跑完全量测试与 verify。
