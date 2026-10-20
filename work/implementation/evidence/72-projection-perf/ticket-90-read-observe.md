# #90 观察者共享与 read/observe 切换

本票把 `/chat/read` 与 `/chat/observe` 从「每个流式片段重读全量日志 + 重折全量」切换到
「durable 投影快照 + live overlay」：同一会话只保留一份事件窗口与一份单元状态，每个观察者
只按自己的 `fromSeq` 切窗口、按自己的截点格式化。wire 形状与语义未变。

## 1. 实现

### 1.1 事件窗口（seed 一次，之后增量）

`backend/chat/src/runtime.mjs` 的 `LiveSession` 增加一个窗口：

```text
window = { events: null, nextSeq: 0, buffer: [], seeding: null }
```

- **第一次 projection 时 seed**：`#windowOf` 只做一次 `readSessionEvents`（一次
  `observeSession(..., { projectionMode: 'none' })` + 立即 dispose），把返回的完整已提交前缀
  作为 `window.events`。seed 期间到达的提交事件进入 `buffer`，seed 后按 `seq` 合并（已包含在
  快照里的重复项丢弃）。`seeding` promise 让并发的 projection（例如两个观察者同一次 publish）
  共用同一次读取。
- **之后由原生 `session/event` 增量维护**：runtime 的监听器在每次提交时把事件 append 到窗口并
  推进 `nextSeq`；`seq < nextSeq` 的重复项丢弃。观察者在流式片段里不再触发任何日志读取。
- **每个观察者只格式化自己的窗口**：打开时的截点 `C=cursor`、`L=max(0,C-maxEvents+1)` 记在
  观察者对象上；后续快照保留 C/L，输出 `window.events.slice(L)`（即 L 到当前 cursor 的全部
  正式事件）。`/chat/read` 每次是独立请求，C 取当前 cursor。

seed 放在**第一次 projection**而不是 `open()`：`/chat/send`、`/chat/stop`、`/chat/receipt`
不读取投影，不应为一个不会被读的窗口付一次全量日志读取。窗口 seed 的是**完整已提交前缀**而不是
固定长度的最近窗口：协议要求任意 `fromSeq`（`maxEvents` 最大 256）与长连接冻结的 L 都能被
`slice` 服务，且这份日志本来就是 dsh 活会话在内存里持有的同一批事件。这是一处与票面「最近的
窗口」措辞的偏离，理由是上面两条契约；偏离只影响 seed 的大小，不影响每片段成本。

### 1.2 durable 值与 live overlay

- durable：`ctx.sessionProjections.stateOf(state.session, key)` 读 #89 的两个单元
  （`ourfairyTranscript` / `ourfairyWork`）。所有观察者共享同一份单元状态；单元由原生 registry
  在 `session/event` 上 eager 驱动，读取不产生新的 fold。
- live：`attempt` 累计文本、`replyStatus`、`stopping`、`error`、`settledAttempt`、任务
  `availability` 与 Agent running 仍在 `runtime.mjs`，只在格式化时叠加；不写入单元 state。
  `tasksAndActivityAt(workState, ctx, sessionId, running, cursor)` 的 `running` 与 registry
  可用性就是这层 overlay。
- `runtime.events` 保留（`delivery.mjs` 的一次性投递查找与 `/chat/page` 的事件区间仍用它），
  只有每片段的读取路径不再经过它。

### 1.3 删除被替代的 fold

`projection.mjs`、`history.mjs`、`activity.mjs` 删除；`units.mjs` 是唯一 fold。
`/chat/page` 的消息行改为 `transcriptAt(unitState, throughSeq)`（事件区间仍走一次性读取，
分页在固定截点取值是 #91）；`jobs.mjs` 的 `TASK_STATUS` 改为从 `units.mjs` 导入。
`docs/decisions/upstream-compatibility-calibration.md` 中指向已删除文件的链接改指 `units.mjs`。

## 2. 改动文件

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/runtime.mjs` | 增量窗口（`#observe` / `#windowOf` / `#seedWindow`）；`projection` 改为窗口切片 + `stateOf` + live overlay；删除对旧 fold 的调用 |
| `backend/chat/src/service.mjs` | `/chat/page` 消息行改读 transcript 单元；不再导入旧 fold |
| `backend/chat/src/jobs.mjs` | `TASK_STATUS` 改从 `units.mjs` 导入 |
| `backend/chat/src/units.mjs` | 导出 `TASK_STATUS`；模块说明更新为「唯一 fold」 |
| `backend/chat/src/projection.mjs` / `history.mjs` / `activity.mjs` | 删除 |
| `backend/chat/README.md` | 注明 read/observe 从单元读 durable 值、事件窗口只读一次日志后增量维护 |
| `docs/decisions/upstream-compatibility-calibration.md` | 失效链接改指 `units.mjs` |
| `tests/chat-read-window.test.mjs` | 新增：假原生上下文上的窗口/overlay 行为（seed 一次、片段零读取零折叠、观察者共享、C/L 冻结、seed 竞态、live 不落 unit） |
| `tests/fixtures/projection-logs.mjs` | 固定日志与工作用例（从 #89 测试移出，作为冻结期望的输入） |
| `tests/fixtures/projection-expected.json` | 删除前从旧 fold 捕获的固定日志期望（transcript、每个截点、15 组 tasks/activity、receipt、首次出现顺序） |
| `tests/fixtures/projection-real-expected.json` | 删除前从旧 fold 捕获的真实会话期望（稳定字段；messageId 由运行期生成故不入冻结） |
| `tests/projection-units.test.mjs` | 改为对照冻结期望；不再引用旧 fold |
| `tests/projection-units-real.test.mjs` | 真实 launcher + 模型替身日志对照冻结期望；保留 attempt/工具/inbox 形状断言 |
| `tests/projection-fold.test.mjs` | 改为 `ourfairyWork` 单元读取：每事件一次 apply、读取不再折叠、空日志与 turn-end 收尾 |
| `tests/helpers/dsh-peers.mjs` | 增加 `@deepseek-ai/dsh-agent` 与 `@ourfairy/dsh-sessions` 的解析锚点（运行时测试直接加载 `runtime.mjs`） |

## 3. 实际命令与结果

环境：Node v24.18.0，WSL2；dsh 为 `combo.json` 锁定检出。命令在
`.worktrees/90-read-observe`（分支 `ticket/90-read-observe`）执行。

```bash
# 1. 新窗口测试（实现前先红：5 fail）
node --test tests/chat-read-window.test.mjs
# 实现后 → tests 5 / pass 5 / fail 0，137 ms
#   覆盖：两个观察者共用一次 seed；流式片段 observeSession 0 次、单元 apply 0 次；
#   C/L 冻结；中流打开者拿到完整 attempt；seed 期间提交的事件不丢不重；live 值不写 state

# 2. 既有对话/重连回归（新读取路径）
node --test tests/remote-chat.test.mjs tests/reconnect.test.mjs
# → tests 14 / pass 14 / fail 0，30.1 s

# 3. 任务与投递回归（含 jobs 输出、停止、重启）
node --test tests/jobs.test.mjs tests/text-delivery.test.mjs tests/file-delivery.test.mjs
# → tests 23 / pass 23 / fail 0，15.4 s

# 4. 冻结期望的捕获（删除前、在 9092e52 的旧 fold 上）
#    固定日志：一次生成 tests/fixtures/projection-expected.json
#    真实会话：同一脚本连跑两次，折叠结果逐字节一致后才落盘
#    → events 39 / cuts 12 / messages 8 / tasks 0；cmp 两次输出一致

# 5. 定向全集（删除 fold 后、合并集成分支前）
node --test tests/projection-units.test.mjs tests/projection-units-real.test.mjs \
  tests/projection-fold.test.mjs tests/remote-chat.test.mjs tests/reconnect.test.mjs \
  tests/chat-runtime.test.mjs tests/jobs.test.mjs tests/text-delivery.test.mjs \
  tests/chat-read-window.test.mjs
# → tests 51 / pass 51 / fail 0，28.5 s

# 6. 合入集成分支 tip（baf932e）
git merge integration/spec-72 --no-edit
# → 1 file changed（证据索引），无冲突；合并提交见 §5

# 7. 文档链接检查（合并后、补上本文件链接后）
node --test tests/docs.test.mjs
# → tests 1 / pass 1 / fail 0
```

## 4. 覆盖的验收点

| 验收点 | 证据 |
| --- | --- |
| 字段、事件窗口、`fromSeq/throughSeq`、`hasMore/beforeSeq`、`replyStatus`、`attempt`、`settledAttempt`、`error` 语义不变 | `remote-chat` / `reconnect` 全过；`chat-read-window` 断言 C/L 冻结、`L..cursor`、attempt 完整 |
| 流式片段不再全量读取或全量 fold；两个观察者共享 durable 状态 | `chat-read-window` 计数 `observeSession` 与 `units.apply`：一次 seed、片段 0 读 0 折；同一次 publish 两个观察者只 seed 一次 |
| 发送去重、冲突与 receipt 读单元状态（含进程重启） | `remote-chat` 的并发重试 + 重启后同一 receipt；`projection-units` 的 frozen receipt；#89 的 `receiptFrom` 路径未改 |
| 停止、错误、恢复后活动/回复正确收尾 | `remote-chat` 的 stop/错误/部分失败；`reconnect` 的崩溃恢复 closer；`jobs` 的任务/报告/活动用例 |
| 原有测试全过；删除被替代的全量 fold，不保留两套 | 定向 51/51；三个 fold 文件已删除；`projection-units*` 改为冻结期望，`projection-fold` 改测唯一单元 |
| 每片段成本与日志大小脱钩（行为层） | `chat-read-window` 的「片段 0 读 0 折」；本票不做基准测量（#94） |

## 5. 提交

| 提交 | 内容 |
| --- | --- |
| `407c734` | `feat(chat)`：增量窗口 + durable 单元快照 + live overlay，read/observe/page/jobs 切换 |
| `5365e24` | `refactor(chat)`：删除三个旧 fold，冻结期望，测试改指唯一单元 |
| `f44b3bb` | 合并 `integration/spec-72`（`baf932e`），证据索引无冲突 |

## 6. 未执行项

- **没有跑全量 `npm test` 与 `npm run combo:verify`。** 按票面只跑定向文件；全量留给 #95 在
  集成分支上执行。
- **没有性能测量。** 本票只钉住「片段不读日志、不折叠」这一行为；延迟/RSS 对比属 #94。
- **冷会话打开仍载入整份日志。** `agents.resume` 与首次 `stateOf` 的单元惰性构建各会读/折一次
  完整日志，这是 dsh resume 与无 projection cache 的现状；本票消除的是每请求、每片段的全量
  读取与折叠。session-projection-cache 不在本 spec 范围。
- **`/chat/page` 的事件区间仍一次性读取整份日志。** 分页在固定截点取值是 #91 的范围；本票只把
  page 的消息行切到 transcript 单元。
- **没有真实云服务与 Android 设备。** 全程模型替身；客户端契约未改，未做客户端验证。
