# #252 会话改名：用户标题钉住、规范化与界面入口

日期：2026-10-28。票面：[`work/tickets/250/252.md`](../../../tickets/250/252.md)，父规格
[`#250`](../../../tickets/250/250.md)。
分支 `ticket/252-rename`，worktree `.worktrees/252-rename`，基线 `8b6fca1ed0`
（`integration/spec-250`），落地前并入 `3d41311249`（设计决议修订）。

设计依据见 [`250-batch-design.md`](../../notes/250-batch-design.md) §1/§4/§6（含 2026-10-28 16:47 的修订：
路径留在 sessions 家族、处理器由 chat 供给）；探查依据见
[`250-title-and-archive-seams.md`](../../notes/250-title-and-archive-seams.md) A/B/C。本 README 只记本票的
改动、判断与证据。

## 判断：改名只有一个写者，就是原生标题服务

`sessionTitle.rename(session, title)` 只接受 `ctx.sessions.get(session.id) === session` 的**活会话**
（`session-title/src/index.ts:407-411`），并在内部完成三件产品不能自己做的事：用
`normalizeSessionTitle` 规范化（压空白、去控制字符、按 `maxTitleBytes` 截断）、以 `source.kind = 'user'`
追加 `session/title`、`supersede` 掉在途的自动生成。手写 `session/title` 事件会造出第二个标题写者并绕开
规范化，因此本票**不写事件**，只接这条原生路径。

「变活」的唯一入口是 `SessionRuntime.open`：resume 要装 persona、身份段与模型选择，那是 chat 的职责。
于是路径按**作用对象**命名（`/sessions/rename`，常量单源于 `backend/sessions/src/http.ts` 的
`SESSION_RENAME_PATH`），处理器由 chat 注册——sessions 反向依赖 chat 会成环。

## 改动

后端 `@ourfairy/dsh-chat`：

| 文件 | 职责 |
| --- | --- |
| [`src/runtime.ts`](../../../../backend/chat/src/runtime.ts) | `open(owner, id, { titleBackfill })` 增加「不要补生成」的路径；`backfillTitle` 由私有转为可复用的公开方法，并在 `refresh` 前**重读标题来源**（`needsBackfill`）；`renameTitle` 把原生 `rename` 的 `SessionTitleInvalidError` 折成 `undefined`，其余失败照常抛出 |
| [`src/service.ts`](../../../../backend/chat/src/service.ts) | `rename(owner, {sessionId,title})`：先 `open`（关补生成）→ `runSession` 内改名 → `barrier` 落盘 → 用 `ourfairySessions.expose(header, shortId, titleOf(id))` 回答，即列表同一行 |
| [`src/index.ts`](../../../../backend/chat/src/index.ts) | 注册 `SESSION_RENAME_PATH`，`codePrefix: 'sessions'`（错误码沿用会话家族），`caller(request, 'sessions/unauthorized')` |
| [`package.json`](../../../../backend/chat/package.json) | 新增 peer `@deepseek-ai/dsh-session-title: ^0.2.1-alpha.2`（值是运行时依赖：`SessionTitleInvalidError` 的 `instanceof`） |

后端 `@ourfairy/dsh-sessions`：[`src/http.ts`](../../../../backend/sessions/src/http.ts) 新增并导出
`SESSION_RENAME_PATH`（不加入 `SESSION_PATHS`：本模块不服务它，`apply` 的「每条路径都有处理器」不变式保持），
[`README.md`](../../../../backend/sessions/README.md) 的「Owns」补这一条地址；`backend/chat/README.md` 的路由表补
一行与错误码说明。

Android：

| 文件 | 职责 |
| --- | --- |
| `data/remote/SessionApi.kt` | `SessionBackend.rename(token, sessionId, title)` 与 `SessionApi` 实现（POST `/sessions/rename`，文档 `{sessionId,title}`，与 select/read 同形） |
| `data/remote/OwnedSessionState.kt` | `rename(sessionId, title)` 走既有 `request{}` 守卫，用后端返回的行 `joined(stand = false)`；新增哨兵 `EMPTY_TITLE`，让 drawer 用自己的话术说「空标题」 |
| `ui/identity/IdentitySessionList.kt` | 行内改名入口（非主会话行，与 #253 的删除入口并列）+ 改名对话框；拒绝时对话框不关、把判定写在输入框下 |
| `ui/fairy/FairyWindowBar.kt` | `FairyWindowTopBar(title = …)`：有名字的会话把会话名放首行，产品名牌退为状态行的小标签；无名字仍显示名牌。标题列占满剩余宽度并省略号截断，状态行行为不变 |
| `ui/fairy/FairyConversationPage.kt` | 标题栏读 `receive.owned.snapshot` 里**同一个 `OwnedSession` 行**；接收层观察每个会话的 `session/title` 事件并刷新列表，进入会话本身不花额外列表请求 |

## 关键决定

**响应复用列表那一行，而不是让两条路径各答一次。** `rename` 的响应由
`ourfairySessions.expose(header, ..., titleOf(id))` 生成，与 `/sessions/list` 的每一行是同一份代码；
`tests/session-rename.test.mjs` 直接用 `deepEqual` 比对「改名的答案」与「随后列表的那一行」。
客户端因此把返回行直接折进快照（一次请求），不需要「改名后再 refresh」的第二次往返。

**改名的 open 不补生成标题。** `#backfillTitle` 在每个 resume 末尾必发一次 `refresh`；改名紧接着就要写
user 标题，这次模型调用纯属浪费。`open` 因此有显式的 `titleBackfill: false`，只有改名用它。

**补生成在 `refresh` 前重读来源。** 原来的守卫只在**排程时**看来源；它内部的日志读取是异步的，改名若在
这段窗口落地，`refresh` 会按原生语义把 user 标题重新推导覆盖（explicit refresh 就是 unpin）。现在
`needsBackfill` 在两处读同一份判断：排程前，与 `refresh` 前。`tests/session-rename-backfill.test.mjs`
用可控的日志读把窗口固定下来——把这道重读删掉，该用例即红（已实测，见下）。

**空标题与超长是两种结果，不能折叠。** 超长按码点截断（`truncateTitleUtf8`），不报错；只有规范化后为空
才拒绝，且拒绝码自成一体（`sessions/empty-title`），客户端按码换成本地话术而不是显示后端英文消息。
`tests/session-rename.test.mjs` 对 40 个 CJK 字符与「79 字节 + 4 字节 emoji」各钉一次边界，后者证明不会切
在码点中间。

**不自动把「改名失败」变成静默。** 空标题时对话框保持打开、保留用户输入并就地显示原因；这是本票
唯一新增的交互失败面。

**标题栏只有一条来源。** 标题栏与抽屉行读同一份 `OwnedSession`（`receive.owned.snapshot`），没有第二条
客户端标题状态；模型标题到达时由接收层按 `session/title` 事件刷新列表，改名时靠响应行折入。

## 实际跑过的命令

在 `.worktrees/252-rename` 上（后端）：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过（多次，含每次提交前钩子的 fresh build） |
| `node --test tests/session-rename.test.mjs` | **5 通过 / 0 失败**，`duration_ms` 11613 |
| `node --test tests/session-rename-backfill.test.mjs` | **3 通过 / 0 失败** |
| 变异验证：从 `dist/runtime.js` 删掉「refresh 前重读来源」，重跑上面的文件 | `a rename landing during the backfill log read is not overwritten by the refresh` **失败**（1 失败 / 2 通过），随后重新构建恢复 |
| 提交前钩子（10 个改动路径 → 全量门禁） | `npm test` **396 通过 / 0 失败 / 0 取消**，`combo:verify` 通过 |

Android（`android/`）：

| 命令 | 结果 |
| --- | --- |
| `./gradlew test --tests …`（`test` 聚合任务不接受 `--tests`） | 不可用：`Unknown command-line option '--tests'`，改用 `:app:testDebugUnitTest` |
| `./gradlew :app:testDebugUnitTest --tests SessionApiTest --tests OwnedSessionStateTest --tests FairyPagesTest` | **通过**（25 个用例中含本票新增 5 个） |
| `./gradlew test lintDebug`（全量，提交前钩子与手工各一次） | **BUILD SUCCESSFUL**：`:app:testDebugUnitTest` 与 app/ui/highlight 三个模块的 `lintDebug` 全绿 |
| 并入 `integration/spec-250`（含 #253）后 `./gradlew :app:testDebugUnitTest` | **BUILD SUCCESSFUL**（两侧用例同在） |

### 并入 `integration/spec-250`（含 #253）

分支提交前并入 `e344d64531`（#253 已落地）。冲突全部是「同一行 UI / 同一组测试替身」：

- `IdentitySessionList.kt`：抽屉行现在**同时**有改名与删除入口（非主会话行两个 IconButton），
  改名对话框与归档确认框是两个独立块；`stopReply` 参数（#253）保留。
- `SessionApi.kt` / `OwnedSessionState.kt`：`rename` 与 `archive` 并存，各自保留自己的 KDoc 与折叠规则。
- 测试替身：每个 `SessionBackend` 实现补齐 `rename`/`archive` 两个方法（#253 新增的
  `IdentitySessionListTest` 也在内）；`OwnedSessionStateTest` 同时保留两侧新增用例。
- `backend/sessions/src/index.ts` / `README.md`：`SESSION_RENAME_PATH` 与归档 store 导出并存。

合并后跑全量后端 **405 通过 / 0 失败**（含两侧全部用例）。

沙箱要求的两处环境适配（不是绕过门禁：门禁本身照跑，只是把可写的缓存放到工作区内）：

```bash
GRADLE_USER_HOME=$PWD/work/tmp/252/gradle-home                 # ~/.gradle 只读
JAVA_TOOL_OPTIONS="-Dmaven.repo.local=$PWD/work/tmp/252/m2/repository \
                   -Drobolectric.dependency.dir=$PWD/work/tmp/252/robolectric"
```

`JAVA_TOOL_OPTIONS` 是给 **测试 JVM** 的：Robolectric 4.16 用 `maven.repo.local` 决定它下载/加锁的仓库，
`robolectric.dependency.dir` 指向一个扁平的 android-all jar 目录（不是 Maven 目录树，传目录树会得到
`Path is not a file`）。两项都是本机环境限制，没有改构建文件，CI 不受影响。

## 覆盖到哪一层（证据性质）

- **真实启动器 + 回环模型替身**（`tests/session-rename.test.mjs`）：HTTP、鉴权、持久化、重启、
  列表/读取一致性、空标题拒绝无写入、UTF-8 截断、他人/无主/不存在会话的拒绝。标题请求由
  `tests/helpers/title-aware.mjs` 的代理回答，对话走 dsh 自己的脚本化替身——**这是模型替身证据**，
  不是真实 MiniMax 路由的行为。用例覆盖「改名后重启仍是用户标题」「改名不花模型请求」「改名后新消息不再
  触发自动标题」。
- **桩上下文**（`tests/session-rename-backfill.test.mjs`）：只有它能确定性地制造「日志读在途时改名落地」
  的窗口；真实 HTTP 下这个窗口是毫秒级、且失败方向会让用例假绿（没有守卫也常通过），所以这道守卫在
  这一层钉住，并用变异验证证明它真会红。
- **Robolectric + Compose**（`FairyPagesTest`）：标题栏显示会话名并随同一行变化；抽屉非主会话行有改名
  入口。**没有**自动化用例驱动 AlertDialog 本身：该窗口在暂停时钟下永不让 Robolectric 进入 idle
  （`AppNotIdleException`），本套件的其余用例都跑在暂停时钟上。改名的行为由
  `OwnedSessionStateTest`（一次请求、返回行折入、空标题码透传）与 `SessionApiTest`（线上形状）覆盖，
  对话框到状态的这一行接线靠代码审查。
- **android 单测**：`SessionApiTest` 校验请求路径、Bearer、`{sessionId,title}` 原样发送（客户端不预裁
  文本，规范化是后端的）、以及 `sessions/empty-title` 原样透出。

## 未完成项 / 未验证

- **真实模型标题质量未验收。** 全部标题结论来自回环替身；真实服务下的标题语言、长度、失败率需要
  `npm run acceptance:*` 级别验收，不在本票完成。
- **真机未验收。** 客户端结论止于 Robolectric 单测与 `lintDebug`；抽屉改名对话框、标题栏省略号与
  长标题在真实设备上的观感没有跑过。
- **改名对话框没有自动化 UI 用例**（原因见上）。入口存在、状态行为、线上形状各有用例。
- **`/sessions/rename` 在「会话正被同一进程的回复写入」时的排队行为**只靠 `runSession` 队列的既有
  保证，没有专门用例；`tests/session-rename.test.mjs` 的竞态用例覆盖的是补生成方向。
- 观察到但**未改**（不属本票）：`backend/chat/src/service.ts` 的 `caller()` 仍以 `chat/unauthorized`
  为默认码，其它 `/chat/*` 路由的语言不变；`FairyConversationPage` 进入一个「早已有标题、且没有新回复」
  的会话时不会主动刷新列表（用户可用抽屉的刷新），这是有意保持「进入会话不花请求」的选择。
