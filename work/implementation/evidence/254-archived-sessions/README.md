# #254 已归档会话的查看与恢复

日期：2026-10-28。票面：[`work/tickets/250/254.md`](../../../tickets/250/254.md)，父规格
[`#250`](../../../tickets/250/250.md)。分支 `ticket/254-restore`，worktree `.worktrees/254-restore`，
基线 `077215a2c1`（`integration/spec-250`，含 #251/#252/#253）。

设计决议见 [`250-batch-design.md`](../../notes/250-batch-design.md) 第 5 节；本 README 只记本票的改动与证据。

## 判断：归档的另一半必须在，且不能碰活会话

#253 把删除做成了归档，所以「看得见、拿得回」不是加分项而是归档成立的条件。本票补上视图与恢复。

恢复不需要新表、新包、新路由族：一行一会话，恢复就是同一行回到 `status = 0, archived_at = NULL`
（`archive` 的 upsert 早已写明「恢复后再次归档取新时刻」）。所以本票只在既有表上加一个写方法。

## 改动

后端 `@ourfairy/dsh-sessions`：

| 文件 | 职责 |
| --- | --- |
| [`src/archive-store.ts`](../../../../backend/sessions/src/archive-store.ts) | `restore()`：`UPDATE … SET status = 0, archived_at = NULL WHERE session_id = ? AND owner_short_id = ? AND status = 1 AND deleted_at IS NULL`，返回是否有行变动 |
| [`src/service.ts`](../../../../backend/sessions/src/service.ts) | `restore(owner, sessionId)`：先 `_ownedHeader` 授权；行没变动则以 `sessions/not-archived`（409）拒绝，不写任何东西 |
| [`src/http.ts`](../../../../backend/sessions/src/http.ts) | `SESSION_PATHS` 增加 `/sessions/restore`，复用 `oneSession` 答复形状 |

归档视图的读没有新路径：沿用 #253 的 `/sessions/list` + 请求体 `archived: true`。

Android：

| 文件 | 职责 |
| --- | --- |
| [`OwnedSessionState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/OwnedSessionState.kt) | 新增独立的 `ArchivedSessions` 流与 `SessionView`；`refreshArchived()` 只填归档流；`restore()` 从归档流移除、把后端答复的同一行折叠回默认列表；`request{}` 泛化为 `act(view, …)`，两视图共用一套 epoch/loading 守卫 |
| [`SessionApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/SessionApi.kt) | `SessionBackend.list(token, archived)` 与 `restore` |
| [`IdentitySessionList.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentitySessionList.kt) | 默认/归档视图切换；归档行显示恢复入口，不显示删除；归档视图不出主会话、不提供物理删除 |

## 关键决定

**归档视图必须是独立的流，不能复用 `SessionsSnapshot`。** `RemoteReceiveState` 把可见列表当作
「允许存在的 chat」集合：不在其中的 id 会被 `detach()`，选中项会被重指。若归档视图换了同一条快照的
内容，用户「浏览归档」就会把正在进行的会话 chat 与通知积压一起拆掉。这是本票唯一不显然的设计点，
注释与用例都钉在这一点上（`the archived view is a list of its own and leaves the default list alone`）。

**拒绝要有自己的码。** 「未归档」用 `sessions/not-archived`，而不是谎称会话不存在——会话确实存在，
只是不在归档里。他人会话仍以 `sessions/unknown-session` 拒绝，与既有路由同口径。

**恢复不移动选中项。** 恢复是「把会话拿回列表」，不是「进入这个会话」；折叠时 `stand = false`，
所以 `selectedId` 不变（有用例断言）。

**一次动作一个守卫。** 两个视图共用 `act()` 的 epoch 检查与「一次一个请求」约束，但进度与拒绝各报
各的流：归档视图里的失败不会把默认列表刷成错误态。

## 实际跑过的命令

在 `.worktrees/254-restore` 上：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `node --test tests/session-archive.test.mjs` | 11 通过 / 0 失败（归档 8 + 恢复 3） |
| `cd android && ./gradlew test lintDebug` | BUILD SUCCESSFUL；`testDebugUnitTest` 49 套件 / **345 用例 0 失败**；`lint-results-debug.xml` 的 `severity="Error"` 计数 0 |

Android 需要 `GRADLE_USER_HOME` 指到工作区内（`~/.gradle` 在沙箱外只读），否则 wrapper 会以
`gradle-9.6.0-bin.zip.lck (Read-only file system)` 失败。

新增/相关的客户端用例（均在结果文件里可查）：`IdentitySessionListTest` 两条（归档视图只显示归档行、
无主会话无删除；从归档视图恢复后该行回到默认列表）、`OwnedSessionStateTest` 四条（归档视图独立且不
动默认列表；恢复跨两视图折叠；拒绝的恢复不动两视图；归档视图不会展示给下一个账号）、`SessionApiTest`
两条（归档视图走同一路径带 flag；恢复答复列表那一行；拒绝保留自己的码）。

## 未执行项

- **真机未验收。** 客户端结论止于 Robolectric 单测与 `lintDebug`；视图切换与恢复按钮没有在设备上点过。
- **真实模型与真实多设备未验证**，与 #252/#253 相同。
- **恢复后的「继续对话」止于测试替身。** 用例证明历史消息仍在、会话可读；真实模型往返不在本票证据内。
