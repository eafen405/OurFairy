# #225 T1 页读取：runtime 完整页操作

日期：2026-10-25。票面见[工作副本](../../../tickets/225/01-page-read.md)，父规格见
[#225](https://github.com/eafen405/OurFairy/issues/225)。开工基线为 `integration/spec-225` 的
`98b5156210`；收尾时该分支 tip 未前进，合并为空操作。

## 结论与范围

- `/chat/page` 的固定截点校验、页范围计算、事件读取与消息选择收进 `SessionRuntime.page`：接收已打开
  `LiveSession` 与已校验数字 `throughSeq` / `beforeSeq` / `maxEvents`；`throughSeq` 超出当前 cursor 返回
  `null`，其余（含有效空页）返回正常页对象。`RemoteChat.page` 只保留认证、打开、不可信 JSON 校验与
  `null -> 400 chat/invalid-page` 映射，未新增 writer queue 或 durability barrier。
- 分页定义未变：`end = min(throughSeq + 1, beforeSeq)`、`fromSeq = max(0, end - maxEvents)`；消息仍按
  `throughSeq` 经 `transcriptAt` 派生并过滤到 `seq < end`。证据见
  [chat-page-cut.test.mjs](../../../../tests/chat-page-cut.test.mjs) 的范围、空页、重试与 seq 断言。
- 未初始化 window 经 `ctx.sessionPersistence` 只读本页范围；已初始化 window 直接切片。两种情形都未读取
  整份日志、未建立 window、未改变 cursor 来源；证据是该测试文件中的 `pageReads` / `pageOpens` /
  `observeSession` 计数断言。
- `pageEvents` / `cursorOf` 改为 `#` 私有；`tests/chat-page-cut.test.mjs` 不再直接调用，统一经
  `runtime.open` + `runtime.page`。
- 生产范围的其它面未动：T2 的任务查找、路由、响应字段、SSE、Android、数据库与 projection 持久状态
  `stateVersion` 均未改。

## 改动面

- `backend/chat/src/runtime.ts`：新增 `ChatPage` 与 `page()` 完整操作；`pageEvents` → `#pageEvents`，
  `cursorOf` → `#cursorOf`，`projection` 改走私有 cursor。
- `backend/chat/src/service.ts`：`page()` 只做 `maxEvents` 与数字范围校验、调用 runtime 页操作、把 `null`
  映射为原有 400；删除 service 内的范围计算、事件读取与 `transcriptAt` 调用。
- `tests/helpers/chat-world.mjs`（新）：从 `chat-read-window` 抽出的共享 fake native world；保留真实
  projection units，instrument `sessionQuery.observeSession`，并新增计数的 `sessionPersistence` 范围读取。
- `tests/chat-read-window.test.mjs`：改用共享 helper，断言与覆盖不变。
- `tests/chat-page-cut.test.mjs`：重写为 7 条经 `runtime.open` + `runtime.page` 的行为用例。

## red-green 与命令结果

红（实现前，工作树）：

```sh
node --test tests/chat-page-cut.test.mjs
# exit 1；0 pass / 7 fail
# 7 条均失败于 TypeError: runtime.page is not a function
```

红态与最小实现同处提交 `6ba069614e`：本仓库 commit hook 要求提交时相关测试为绿，故没有单独的红提交；
红态运行结果按证据协议不把原始日志入库。

绿（实现后）：

```sh
npm run build
# exit 0（tsc --fresh 无诊断）

node --test tests/chat-page-cut.test.mjs tests/chat-read-window.test.mjs
# 12/12 通过，0 失败

node --test tests/chat-page-cut.test.mjs tests/chat-read-window.test.mjs \
  tests/projection-units.test.mjs tests/projection-fold.test.mjs tests/chat-runtime.test.mjs
# 39/39 通过，0 失败

node --test tests/reconnect.test.mjs
# 8/8 通过，0 失败（含固定页重试、lost page 重试、HTTP 400 与跨页拼接）

node --test tests/projection-units-real.test.mjs
# 1/1 通过，0 失败（真实后端上经 /chat/page 拼完整日志并与冻结投影比对）

node --test tests/chat-multi-observer.test.mjs
# 2/2 通过，0 失败
```

收尾合并后重跑（最终状态）：

```sh
git merge integration/spec-225
# Already up to date.（integration tip 仍为 98b5156210）

npm run build
# exit 0

node --test tests/chat-page-cut.test.mjs tests/chat-read-window.test.mjs tests/reconnect.test.mjs
# 20/20 通过，0 失败
```

提交门禁（`.githooks/pre-commit` → `scripts/precommit.ts`）：

- `2474b51c27`（抽取 helper，`tests/helpers/` 触发全量门禁）第一次被拦下：`tests/precommit.test.mjs` 的
  「product package change runs the tests that mention that package」失败，因为改写后的
  `chat-read-window` 不再在正文里出现 `backend/chat/`。两个测试文件头部补充了它们经 helper 依赖的
  `backend/chat/dist/units.js` / `runtime.js` 路径后，第二次通过全量 `npm test` 与 `combo:verify`
  （`combo: combination verified`）。
- `6ba069614e`（页操作 + 页测试）走 related 门禁：`npm run build`、选中的 12 个相关测试文件、`combo:verify`
  全部通过。

## 证据性质

- 页操作单测（`chat-page-cut`、`chat-read-window`）是**测试替身证据**：fake native world 提供
  `agents.resume`、`sessionQuery.observeSession` 与 `sessionPersistence`，但 projection units、页范围与
  消息选择跑的是真实产品实现。
- `reconnect`、`projection-units-real`、`chat-multi-observer` 是**真实后端进程 + 真实 HTTP** 证据；模型
  由 `llm-mock-server` 替身提供，`reconnect` 的页读取走真实原生 `sessionPersistence`。它们不是官方
  DeepSeek 或真实云服务证据。
- `npm run build` 只证明编译与类型检查通过，不等于运行时验收。

## 未完成项与残留风险

- T2（任务身份访问）在同一规格内、不在本票范围；本分支未改 jobs 查找。
- 按票面要求未在最终 tip 跑全量 `npm test`；全量套件只在 `2474b51c27` 的 helper 提交门禁上跑过一次
  （通过）。最终集成状态的全量 `npm test` / `combo:verify` 由 Lead 收口执行。
- `SessionRuntime.page` 信任调用方已校验的数字参数（票面即如此分工）；静态数字校验与 `maxEvents` 范围仍在
  `RemoteChat.page`。直接调用 runtime 的其它入口若将来出现，需要自带校验。
- 共享 fake world 的 `sessionPersistence` 是内存切片，不模拟原生读失败、压缩或文件权限；这些路径由
  `reconnect` 的真实后端用例覆盖。
- 未执行 Android、真机、真实模型服务或数据库验收（本票无相关改动）。
