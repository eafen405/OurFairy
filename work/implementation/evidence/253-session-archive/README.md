# #253 删除会话：复用归档并二次确认

日期：2026-10-28。票面：[`work/tickets/250/253.md`](../../../tickets/250/253.md)，父规格
[`#250`](../../../tickets/250/250.md)。分支 `ticket/253-archive`，worktree `.worktrees/253-archive`，
基线 `8b6fca1ed0`（`integration/spec-250`）。

设计决议见 [`work/implementation/notes/250-batch-design.md`](../../notes/250-batch-design.md) 第 2–4 节；
本 README 只记本票的改动与证据。

## 判断：删除即归档，归档是产品事实

dsh 没有归档概念（探查 D10 已确认：没有 archived 状态、没有 `SessionHeader` 标记、没有持久化过滤）。
所以「删除会话」按用户决定实现为**归档**：会话离开默认列表，日志、消息与历史原样保留并可恢复，
**不提供物理删除**。

归档存在本模块自己的 SQLite 文件里，而不是 identity 的业务库：归档是会话生命周期，不是账号事实；
塞进账号库只会让那份 schema 为一个外来关注点移动版本。与 memory 行同形（`DatabaseSync` + WAL +
`meta.schema_version` + `BEGIN IMMEDIATE` + dispose 关库）。

## 数据结构变动

本票新增一张表（AGENTS.md 要求的设计阶段告知项）：

```sql
CREATE TABLE IF NOT EXISTS session_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,          -- SessionHeader.id 原样
  owner_short_id INTEGER NOT NULL,   -- 归档作用域（调用者），不是归属权威
  status INTEGER NOT NULL DEFAULT 0, -- 0 活动 / 1 已归档（数字编码）
  archived_at INTEGER,               -- 归档时刻 epoch ms；活动时为 NULL
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                 -- 逻辑删除（业务表必有）
);
CREATE UNIQUE INDEX IF NOT EXISTS session_archive_by_session ON session_archive(session_id);
```

一行一会话，upsert 保留首次归档时刻（幂等）。归属权威仍是 `SessionHeader.owner`；每条写入都先过
`_ownedHeader`，所以 `owner_short_id` 只把条目限定在调用者视界，不会变成第二位所有者。

## 改动

后端 `@ourfairy/dsh-sessions`：

| 文件 | 职责 |
| --- | --- |
| [`src/archive-store.ts`](../../../../backend/sessions/src/archive-store.ts) | 归档表、`archivedSessionIds` 读、幂等 `archive` 写、schema 版本与事务 |
| [`src/service.ts`](../../../../backend/sessions/src/service.ts) | `list(owner, { archived })` 是**唯一过滤点**；`archive()` 先授权、再拒主会话（`sessions/primary-not-archivable`）、再写一行 |
| [`src/http.ts`](../../../../backend/sessions/src/http.ts) | 新增 `/sessions/archive`；`/sessions/list` 读请求体的 `archived` 标志 |
| [`src/index.ts`](../../../../backend/sessions/src/index.ts) | 行 `Config.path`；store 随插件 dispose 关库 |
| [`package.json`](../../../../backend/sessions/package.json) | 新增 `@deepseek-ai/schemastery` peer |

`backend/v1-bundle/cordis.patch.yml`：`sessions` 行的 `path` =
`dshHomePath('session-archive/archive.sqlite')`——**不在** `dshHomePath('sessions')` 里，那是
session-persistence-jsonl 自己的日志根目录。

`backend/probe/src/index.ts` 增加 `ourfairySessions` 的 `SERVICE_ROWS` 条目：否则探测报告不列该服务，
`tests/config-contracts.test.mjs` 与 `tests/baseline-boot.test.mjs` 会以「服务不活」失败（这是实测到的失败，
不是预防性改动）。

Android：

| 文件 | 职责 |
| --- | --- |
| [`SessionApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/SessionApi.kt) | `SessionBackend.archive`，与 `select`/`read` 同样的文档形 |
| [`OwnedSessionState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/OwnedSessionState.kt) | `archive()` 复用既有 `request{}` 守卫：成功后按后端同一条规则去掉该行，被归档会话上的选中项回到主会话 |
| [`RemoteChatState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt) | `stop()` 改为 fire-and-forget 的 `stopReply()`；新增可等待的 `stopReply()` |
| [`RemoteReceiveState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteReceiveState.kt) | `stopReply(sessionId)`：按**行自己的 id** 停，而不是当前选中会话 |
| [`IdentitySessionList.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentitySessionList.kt) | 非主会话行的删除入口 + `AlertDialog` 二次确认 |
| [`FairyConversationPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt) | 把 `stopReply` 窄参数接到抽屉 |

## 关键决定

**唯一过滤点在 `list`。** 归档会话因此自动不参与「新建会话复用空会话」（`_newestEmptyOrdinary` 走
`list`）、不出现在会话搜索（`backend/search/src/index.ts` 调 `list`）。在各调用点各加一次过滤就是
第二份权威，所以没有那样做——这两点各有用例钉住。

**主会话由后端拒绝，不靠界面守。** 它是投递、通知与回复的落点，归档它会让这些失去落点；调用者拿到
自己的错误码（`sessions/primary-not-archivable`，409），而不是被谎称「会话不存在」。归档视图里
`primarySessionId` 答 `null`，因为不在视图里的会话不能是该视图的默认项。

**「先停止回复」由客户端定序，不为一行新造端点。** 抽屉要操作的是「可能没被选中的那一行」，
所以用的是按行 id 的 `stopReply(sessionId)`；`stop()` 保持原语义（发出即返回），归档走可等待版本，
使「停 → 归档」是一对有序请求而不是两个竞态请求。空闲时 stop 本身是 no-op。

**归档视图不塞进 `SessionsSnapshot`。** `RemoteReceiveState` 把可见列表当作「允许存在的 chat」集合，
复用同一条流会让「浏览归档」把正在进行的会话 chat 全部 detach。归档视图与其状态属于 #254，
本票只在 HTTP 层提供 `archived` 标志。

**取消不产生持久化变化。** 确认框的 `取消` 与 `onDismissRequest` 只清待确认状态；用例断言
`events`（stop/archive 调用记录）与归档集合都为空。

## 实际跑过的命令

在 `.worktrees/253-archive` 上：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `node --test tests/session-archive.test.mjs` | 8 通过 / 0 失败 |
| `node --test tests/session-archive.test.mjs tests/config-contracts.test.mjs tests/baseline-boot.test.mjs` | 22 通过 / 0 失败 |
| `cd android && ./gradlew test lintDebug` | BUILD SUCCESSFUL；`app/build/test-results/testDebugUnitTest` 共 49 个套件 / **330 用例 0 失败**；`lint-results-debug.xml` 中 `severity="Error"` 计数 0 |

Android 构建的一个实测坑：`~/.gradle` 在工作区之外且只读，直接跑会以
`gradle-9.6.0-bin.zip.lck (Read-only file system)` 失败。办法是把 `GRADLE_USER_HOME` 指到
`work/tmp/253/gradle-home`（工作区内，gitignored），`ANDROID_HOME` 指向 SDK。

新增 Android 用例（在结果文件里可查）：`IdentitySessionListTest` 两条（主会话无删除入口且其余行都有；
确认框写明归档/恢复/先停止回复，且确认后按 `stop` → `archive` 顺序调用）、`OwnedSessionStateTest`
一条（拒绝的归档不改列表与选中）、`SessionApiTest` 一条（archive 命名会话并以其答复）、
`RemoteChatStateTest` 一条（`stopReply` 等待绑定会话的停止）、`RemoteReceiveStateTest` 一条
（归档时的停止作用于该行自己的会话，而不是选中会话）。

## 未执行项

- **真机未验收。** 客户端结论止于 Robolectric 单测与 `lintDebug` 通过；抽屉里的删除入口与确认框
  没有在设备上点过。
- **归档视图与恢复未实现**（#254）：本票只提供后端过滤标志与归档写入；「已归档」列表、恢复按钮、
  恢复路由都属于 #254，因此「恢复后回到默认列表」这条验收不在本票证据范围内。
- **归档与「正在回复」的时序未在真机验证。** 单测断言了请求顺序（先 stop 后 archive），但没有在
  真实回复进行中对真机点过一次。
