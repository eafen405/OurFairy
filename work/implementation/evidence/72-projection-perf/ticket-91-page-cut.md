# #91 分页在固定截点取值

`/chat/page` 过去先 `runtime.events()` 读完整个会话日志，再在内存里 `slice(fromSeq, end)`，
消息用完整前缀 fold。本票改为：事件只取本页区间，消息取 transcript 单元在截点上的行。

## 1. 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/service.mjs` | `page()` 不再调用 `runtime.events()`；截点 `cursor` 取自活跃会话已提交的末尾 `state.session.seq - 1`，事件走 `runtime.pageEvents(state, fromSeq, end)` |
| `backend/chat/src/runtime.mjs` | 新增 `pageEvents(state, fromSeq, end)`：已 seed 的活动窗口直接 `slice`（O(页大小)、不再读日志）；未 seed 时用公开的原生读句柄 `ctx.sessionPersistence.open(id,'read').read(fromSeq, end-fromSeq)`，只读本页区间，`finally` 里 `close()` |
| `tests/chat-page-cut.test.mjs` | 新增：钉住「只请求本页区间」 |

响应字段、`K..end-1` 的计算（`end=min(throughSeq+1,beforeSeq)`、`K=max(0,end-maxEvents)`）、
`throughSeq/fromSeq/beforeSeq/hasMore`、工具结果排除、`L=0` 的空终止页、400/404/401 顺序、
页不含 attempt 与回复状态，全部保持原样。

## 2. 实际命令与结果

工作副本 `.worktrees/91-page-cut`（分支 `ticket/91-page-cut`，基线 `bf4e646`）。Node v24.18.0，WSL2。

```bash
node --test tests/chat-page-cut.test.mjs
# → tests 3 / pass 3 / fail 0，138 ms
#    · 一次翻页只向原生句柄请求 [offset=40, length=24]
#    · 已 seed 的窗口翻页不产生任何日志读
#    · 空区间读 length 0 并返回空事件

node --test tests/reconnect.test.mjs tests/remote-chat.test.mjs tests/chat-runtime.test.mjs tests/docs.test.mjs
# → tests 18 / pass 18 / fail 0，29.3 s
```

`reconnect.test.mjs` 覆盖的正是本票的边界：`bounded history pages keep the opening cut while
new formal events arrive`（截点冻结）、`a lost page response can be retried at its unchanged
frozen cut`（重试一致）、`new history and checkpoint routes keep the cold/live ownership fence
and validate exact ranges`（越界 400、归属 404、精确区间）。

## 3. 验收点对照

| 验收点 | 证据 |
| --- | --- |
| 页事件恰为 `K..end-1` | `chat-page-cut.test.mjs` 第一例（请求区间即返回区间）；`remote-chat` 既有页用例 |
| 被后续事件替换过的消息按截点时 seq/status 归属页 | `transcriptAt(state, throughSeq)` 的 `first`/`settled` 行语义（#89 已钉），页内 `seq ∈ [K,end)` 过滤未变；`reconnect` 的冻结截点用例 |
| 深历史/中部/尾部翻页、空终止页、非法区间 400、归属 404、冻结截点重试 | `reconnect.test.mjs` 三个页用例 + `remote-chat` 归属用例 |
| 每次翻页只读取本页所需事件 | `chat-page-cut.test.mjs`：句柄只收到本页 `offset/length`；已 seed 窗口时读次数为 0 |
| 原有 page 相关测试全部通过 | 上面 18/18 |

## 4. 诚实说明与未执行项

- **原生 JSONL 后端内部仍会解析存储文件**再按契约切片；本票消除的是「产品侧每次都把完整事件
  数组交给 JS 并 `slice`」，以及「每次都 fold 完整前缀」。`read(offset,length)` 的契约是切片
  （研究笔记 §2.3），实现细节不在本票范围。
- **冷会话首次打开仍会载入整份日志**：`runtime.open()` → `agents.resume()` 是 dsh 的恢复行为，
  本票不改也不伪造「没读过」。本票约束的是「每次翻页不再整份读」。
- 未跑全量 `npm test`、`combo:verify`（Lead 在集成分支跑）；未跑性能基准（#94）；无真实云服务与
  Android 设备（后端专用票）。
