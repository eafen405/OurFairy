# #251 会话标题：自动生成、兜底与老会话兼容

日期：2026-10-28。票面：[`work/tickets/250/251.md`](../../../tickets/250/251.md)，父规格
[`#250`](../../../tickets/250/250.md)。
分支 `ticket/251-session-title`，worktree `.worktrees/251-session-title`，基线 `30693dd405`
（`integration/spec-250`）。

探查结论见 [`work/implementation/notes/250-title-and-archive-seams.md`](../../notes/250-title-and-archive-seams.md)，
本 README 只记本票的改动与证据。

## 判断：这是没挂载，不是被裁剪

dsh 自带会话标题能力，本仓库的 bundle 从未挂载它们。存在两个原生包：

- `@deepseek-ai/dsh-session-title`：`sessionTitle` 服务，把标题写成**仅日志**的 `session/title`
  事件；提供确定性兜底、`get()` 折叠读取，以及 `rename()`（写入 `source.kind = 'user'` 并把标题钉住）。
- `@deepseek-ai/dsh-session-title-first-prompt-llm`：首条人类消息的模型 provider。

所以本票不建标题表、不写第二份标题生成逻辑，只把两行挂上并接出读取路径。

## 改动

后端 `@ourfairy/dsh-sessions`：

| 文件 | 职责 |
| --- | --- |
| [`src/events.ts`](../../../../backend/sessions/src/events.ts) | 标题的三个上限常量与 `TITLE_SOURCE` 数字编码；`readSessionTitles` 用一次 `sessionQuery.readTitleSnapshots` 折叠整批标题，只对没有 `session/title` 的会话走既有一次性事件读取，按其首条人类消息派生兜底标题（只读，不写日志、不调模型） |
| [`src/service.ts`](../../../../backend/sessions/src/service.ts) | `expose()` 增加 `title`/`titleSource`；`titlesOf`/`titleOf` 是批次与单条两个窄接口 |
| [`src/http.ts`](../../../../backend/sessions/src/http.ts) | 五个 `/sessions/*` 路由都带标题；`/sessions/list` 用一次批量折叠 |
| [`package.json`](../../../../backend/sessions/package.json) | 新增 peer `@deepseek-ai/dsh-session-title`（显式 caret 区间，既有兼容性校验要求） |

后端 `@ourfairy/dsh-chat`：[`src/runtime.ts`](../../../../backend/chat/src/runtime.ts) 的 `#resume` 在
`agents.resume` 返回后补上一次标题生成。

`backend/v1-bundle/cordis.patch.yml`：`plugins` 组挂载 `session-title` 与 `session-title-llm` 两行。

Android：`SessionApi.kt` 的 `OwnedSession` 增加 `title`/`titleSource`（含默认值，旧后端仍可解码）与
`OwnedSessionTitleSource` 常量；`IdentitySessionList.kt` 的行名改为会话标题，未命名显示 `新会话`，
主会话绑定降为标题旁的标记，裸 id 不再作为名称。

## 关键决定

**标题上限只有一个权威。** 三个数字（5 词 / 40 字节 / 80 字节）在 `events.ts` 是导出常量，
bundle 行是配置值，`tests/session-title.test.mjs` 的第一条用例经 dsh 自己的 `composeEntries` 读回
挂载的行并逐字段比对。改一处而不改另一处，该用例失败。

**列表路径绝不写日志、绝不调模型。** 老会话的列表名是从首条人类消息派生的只读兜底；用例用
「整棵 `dsh-home/sessions` 的 sha256 与 mtime 不变」和「模型请求计数不变」两条断言钉住。

**补生成挂在 `#resume` 之后，不在 `setup` 里。** `setup` 在 publish 之前运行，此时
`ctx.sessions.get(id) !== session`，`refresh` 会以「not live in this store」失败。

**守卫看来源，不看「有没有标题」。** `onUserMessage` 对新人类消息无条件跑兜底，所以历史会话若在
补生成落地前先收到一条消息，日志里会先出现**兜底**标题。若按「有标题就跳过」，该会话会被永久钉在
兜底上。守卫因此是「无标题或来源为兜底」才补生成；`user` 一律跳过——`refresh` 会覆盖用户标题，
那是 #252 禁止的。用例
「a message sent while the first-open backfill is in flight still ends with a provider title」 钉住这个竞态。

**进程内只补一次。** 每个 `/chat/read`、`/chat/page`、`/chat/stop` 都会 `open`，只看日志会让同一次
标题请求被重复发起；`#titleBackfilled` 集合按 session id 记住已尝试，成功失败都不再重试（失败留给
下一个进程再试一次）。

**失败不打扰用户。** 补生成是 fire-and-forget 且自带 `catch`：失败只写 `warn` 日志，不改回复、不改
列表可用性。显式 `refresh` 路径本身会把 provider 错误抛给调用者，所以 `catch` 是必需的。

**标题不进模型。** 原生 `session/title` 是仅日志事件，不在 surface 事件集里。用例既断言会话消息里没有
标题文本，也断言模型替身收到的**每一个**请求体都不含标题文本。

## 实际跑过的命令

在 `.worktrees/251-session-title` 上：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `node --test tests/session-title.test.mjs` | 7 通过 / 0 失败，`duration_ms` 11158 |
| `node --test tests/owned-sessions.test.mjs tests/baseline-boot.test.mjs tests/bundle-packages.test.mjs tests/bundle-groups.test.mjs tests/plugin-compatibility.test.mjs` | 33 通过 / 0 失败，`duration_ms` 51051 |
| `node --test tests/chat-read-window.test.mjs tests/chat-page-cut.test.mjs` | 9 通过 / 0 失败 |
| `npm test`（全量，收口前） | **388 通过 / 0 失败 / 0 取消** |
| `cd android && ./gradlew test lintDebug` | BUILD SUCCESSFUL（`:app:testDebugUnitTest` 与三模块 `lintDebug`） |

`tests/baseline-boot.test.mjs` 的 `FORBIDDEN_ROW_IDS` 删掉 `session-title` 与 `session-title-llm`
两项：它们原意是「尚未适配」，本次挂载后该理由不再成立。

`tests/chat-read-window.test.mjs` 的桩 context 原先没有 `ctx.get`；补上 `get(name) { return this[name] }`，
让该世界与「未挂载该行」的 profile 同构（可选服务探测走 `ctx.get`，与本仓库 `spill-read.ts` 读
`spillStore` 一致）。

`tests/chat-read-window.test.mjs` 与 `tests/chat-page-cut.test.mjs` 用桩 context 直接构造
`SessionRuntime`；补生成钩子对可选服务的探测走 `ctx.get`，桩里没有它就会在 `open` 上抛错。

## 挂载标题改变了每个会话的模型请求序列

这是本票影响面最大的一处，写在这里以免被当成测试噪声。

`session-title-first-prompt-llm` 在首条人类消息后向**同一条部署路由**多发一次请求。仓库里的模型替身
按到达顺序消费脚本（`startMockLlmServer` 的 `sequence`），所以这个辅助请求会吃掉本该给对话用的那一条，
后续断言全部错位；失败信息指向标题提示词，而不是被测行为。

处理办法是把「这条路由也回答标题请求」这件事收进一个地方：`tests/helpers/title-aware.mjs`。

- `startTitleAwareModel(options)`：把 dsh 的脚本化替身放在一个代理后面，标题请求由代理自己用固定标题
  回答，其余请求逐字节转发并原样流回。`requests` 因此只含对话请求，`titleRequests` 单独记录。
  使用 `startMockLlmServer` 的用例改用它。
- `answerIfTitle(raw, response)`：自建替身（要发工具调用、图片或挂起回复的那些）在解释请求体之前调用
  一次即可，标题请求既不会让它崩，也不会进入它记录的对话轮次。

两处都只改测试脚手架，产品面没有为此增加开关或第二路由。`tests/projection-units-real.test.mjs` 的冻结
期望另有一处变化：日志现在多出 `session/title`、`session/title-llm-request`、`session/title` 三个事件，
首条人类消息之后的每个 seq 后移 3。只有 seq 字段、cut 键与活动 episode id 移动，行内容、顺序、状态、
文本与任务/活动值不变——重跑该套件即是对这一点的验证。

## 未执行项

- **真实模型标题质量未验收。** 以上全部结论来自回环 Messages 替身（模型替身），不是真实 MiniMax
  路由。真实服务下的标题语言、长度与失败率需要 `npm run acceptance:*` 级别的验收，不在本票完成。
- **真机未验收。** 客户端结论止于 Robolectric 单测与 `lintDebug` 通过；没有在设备上跑过抽屉。
- **#252 的用户改名路由尚未存在。** `TITLE_SOURCE.user` 与 `titleFactOf` 对 `'user'` 的映射在本票
  有断言，但写入该来源的 `rename` 路由属于 #252。
