# #250 余票设计决议（#252 / #253 / #254）

日期：2026-10-28。适用于 [#251](../../tickets/250/251.md) 之后的三票。探查依据见
[`250-title-and-archive-seams.md`](250-title-and-archive-seams.md)；本文件只记**已经决定**的、
跨票必须一致的几点，票面仍是需求权威。

## 1. 改名走「活会话」，路由在 chat

`sessionTitle.rename(session, title)` 要求 `ctx.sessions.get(session.id) === session`
（`dsh-session-title/src/index.ts:407-411`）；detached 重放对象一律拒绝。而把 `session/title`
事件手写进存档日志会造出**第二个标题写者**（标题服务仍在内存里维护 `supersede` 状态），
违反「权威唯一」，也绕开 `normalizeSessionTitle` 的长度规范化。

因此：

- **改名 = 先让会话变活，再用原生 `rename`。** 「变活」只有一个入口：`SessionRuntime.open`
  （`backend/chat/src/runtime.ts:173`），因为 resume 需要 persona、身份段与模型选择，
  那是 chat 的职责，不是 sessions 的。
- **路由放在 chat 模块**（`/chat/rename`）。`/sessions/*` 保持「只读 header 的授权面」
  （create/list/select/primary/read 都不写日志）；改名要写日志、要先变活，属于 `/chat/*`
  这一族。sessions 因此不新增对 chat 的反向依赖——那会与 chat 已有的 `ourfairySessions`
  注入成环。
- **改名不该为标题补生成付一次模型调用。** `#backfillTitle` 在 `#resume` 末尾必发一次
  `refresh`（`runtime.ts:295,303-312`）。改名会在其后立刻写入 user 标题，所以 open 需要一条
  「不要补生成」的路径（给 `open` 加可选参数，或让 rename 显式跳过），否则每次改名都白付一次
  模型请求。
- **必须补一道守卫。** `#backfillTitle` 只在**排程时**看来源；它内部的 `refresh` 是异步的，
  若在改名落地之后才真正开始，`refresh` 会按原生语义把 user 标题重新推导覆盖掉
  （`session-title/src/index.ts:436-462`，注释明说 explicit refresh 是 unpin）。改名是本票引入的
  第一个「user 标题可能先出现」的路径，所以 `#backfillTitle` 的异步体在 `refresh` 前要**再看一次**
  来源，user 一律跳过。补生成是自动家务，永远不得 unpin 用户标题。
- Android 侧改名入口在会话抽屉里（不必先进会话），调用 `RemoteChatApi` 家族的 rename；成功后
  `OwnedSessionState.refresh()`，列表与标题栏都取后端返回的标题。

## 2. 归档是 sessions 模块自己的表

dsh 没有归档概念（探查 D10），归档必须是产品状态。**不建新包、不放进 identity 的库**：
identity 存的是账号侧事实（users/invites/groups/uploads/deliveries），把会话生命周期塞进去会让
账号库的 schema 版本为一个外来关注点而移动。改为 **`backend/sessions` 自持一个 SQLite 文件**，
与 memory 行同形（`backend/memory/src/store.ts` 的 `DatabaseSync` + WAL + `meta.schema_version`
+ `BEGIN IMMEDIATE` + dispose 关库）。

数据结构变动（AGENTS.md 要求设计阶段告知）：

```sql
CREATE TABLE IF NOT EXISTS session_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,          -- SessionHeader.id 原样
  owner_short_id INTEGER NOT NULL,   -- 归档所属的调用者（作用域，不是归属权威）
  status INTEGER NOT NULL,           -- 0 已恢复/活动, 1 已归档
  archived_at INTEGER,               -- 归档时刻 epoch ms；活动时为 NULL
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                 -- 逻辑删除（业务表必有）
);
CREATE UNIQUE INDEX IF NOT EXISTS session_archive_by_session ON session_archive(session_id);
```

- 归属权威仍是 `SessionHeader.owner`；`owner_short_id` 只把条目限定在调用者视界，归档/恢复照样
  先走 `_ownedHeader` 授权。别人的会话既不能归档也不能被影响。
- 一行一会话，恢复 = `status = 0, archived_at = NULL`；读 = `status = 1 AND deleted_at IS NULL`。
- 行挂在 bundle `sessions` 行的 `path` 上（`dshHomePath('session-archive/archive.sqlite')`），
  **不要**放进 `dshHomePath('sessions')`——那是 session-persistence-jsonl 自己的日志根目录。

## 3. 归档的过滤只有一处

`OwnedSessionService.list(owner, { archived })` 是唯一的过滤点：默认只出活动会话。因此

- 「新建会话复用空会话」自然跳过归档会话（`_newestEmptyOrdinary` 走 `list`）；
- 搜索只出活动会话（`backend/search/src/index.ts:46` 调 `list(user)`）；
- 投递目标是主会话，而主会话不可归档。

不要在各调用点各加一次过滤——那就是多份权威。

## 4. 主会话与「先停止回复」

- 主会话不可归档：后端 `_ownedHeader` 之后单独拒绝（不是靠界面），错误码自成一个。
- 归档前停止回复**由客户端串起来**：确认框写明会先停止当前回复，确认后先 `stop` 再 `archive`。
  不为抽屉里的一行新造一个「这个会话在回复吗」的端点——回环状态只有被观察的会话才有
  （探查 E15）。`stop` 在空闲时本身就是 no-op。

## 5. 归档视图

`/sessions/list` 用请求体里的 `archived: true` 切换到归档视图，不新开路径。归档视图里
不出主会话、不提供物理删除、行名用与默认视图同一条标题规则（后端 `readSessionTitles` 已统一）。
客户端 `SessionsSnapshot` 增加视图标记，切换视图不得丢掉 `selectedId`。

## 6. 两票并行的文件边界

- #252 主改 `backend/chat/**` 与 Android 的 rename 入口。
- #253 主改 `backend/sessions/**`（含新 store）、bundle 的 `sessions` 行、Android 的归档入口。
- **抽屉里的行操作两边都会碰**（`IdentitySessionList.kt` 的同一行）。各自只做**增量**：
  #252 加改名入口，#253 加删除入口；报告前都把 `integration/spec-250` 的最新提交合进自己分支，
  冲突自己解，不要留给 merger。
