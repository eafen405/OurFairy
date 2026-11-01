# #282 自投文字落发起会话

- 票：[#282](https://github.com/eafen405/OurFairy/issues/282)；父 spec：[#280](https://github.com/eafen405/OurFairy/issues/280)
- 分支：`ticket/282-self-delivery-text`；worktree `.worktrees/282-self-delivery-text`
- 基线：`integration/spec-280` @ `4edb78fa49`（票面要求的基线，`git merge-base --is-ancestor` 通过）
- 交付提交：`5f0e047b7d34b544a18622dc6ac4394a43d9268a`
- 合并集成：`git merge integration/spec-280` → `Already up to date.`（本地集成分支 tip 仍为 `4edb78fa49`，未推进）

## 起始事实

- `deliver()` 原先在 `runtime.runDelivery(...)` 之前解析 `primary(target)`，把 `sessionId: primary.id`
  交给 `deliveries.prepare`，所以自投也落主会话。
- `deliveries.prepare` 重试时返回既有行；同身份冲突检查不比较 `sessionId`（`backend/identity/src/store.ts`）。
  因此落点只需在首次 prepare 前判定并写入行，重试与启动恢复自然沿用记录。
- 会话服务原先只有 read/list/primary/create/archive/restore；归档事实只有
  `archiveStore.archivedSessionIds(ownerShortId)` 的整表列表读，没有单会话读。
- `settle()` 已经按 `row.sessionId` 经 `ourfairyChatRuntime.appendOnce` 追加并读回 `row.sessionId` 生成回执；
  delivery 队列与目标会话队列是两个 key 空间。
- **与本票先验不符的实测事实**：`appendOnce` 会进入目标会话队列，而工具的 `execute` 运行在 chat
  `/chat/send` 队列条目启动的回合里。`SessionQueues` 的 `AsyncLocalStorage` 会把那条 key 一直带进回合的
  后续异步上下文。当发起会话就是落点会话时，`runSession(origin)` 被误判为「本调用链已持有」而立即抛错
  （`chat queues: "session:…" is already held by this call chain`）。基线里「在主会话中自投」会抛同样
  的错误；普通会话自投此前落主会话，因此没有暴露。本票的「自投落发起会话」必然走同一会话写入，所以
  队列的持有判定必须按「条目是否仍在运行」而不是「上下文里有没有这个名字」来回答。

## 落点规则

1. `src/target.ts` 是规则的唯一实现，无任何 import：`deliveryTargetOf({senderShortId, recipientShortId,
   originSessionId, originCanHost})` 返回 `'origin' | 'primary'`。收件人 ≠ 发送者 → primary；没有发起
   会话 → primary；发起会话不能承载 → primary；否则 origin。
2. `src/index.ts` 只在「收件人 = 发送者」时向会话服务问一次 `canHostDelivery(owner, originId)`，
   判定一次，把结果会话 id 记录在 `deliveries` 行上。落 origin 时不再调用 `primary()`，因此不会为一次
   自投创建主会话。
3. `canHostDelivery` 是会话服务新增的唯一公开成员：header 存在 + owner 等于 `ownerOf(owner.shortId)`
   + 未归档；不抛 404/403，只回答布尔值。归档事实走 `archive-store.isArchived({sessionId, ownerShortId})`
   单行索引读，不调用 `archivedSessionIds()` 枚举。
4. 回执、`delivery/message` 事件、启动恢复都读行上的 `sessionId`；回执形状不变。
5. 队列修复：`SessionQueues` 为每个条目记录 `settled`；上下文里同名条目已结束时允许进入（此时队列尾部
   不包含自己），仍在运行时照旧立即拒绝，真实自等待仍是错误。

## 文件

| 文件 | 变化 |
| --- | --- |
| `backend/delivery/src/target.ts` | 新增：无依赖的 `deliveryTargetOf` 与 `DeliveryTargetFacts` |
| `backend/delivery/src/index.ts` | prepare 前判定落点一次并记为 `sessionId`；origin 为落点时跳过 `primary()`；工具描述改为「收件方的会话」 |
| `backend/delivery/README.md` | 新增「Where a delivery lands」；入口与依赖说明 |
| `backend/sessions/src/service.ts` | 新增 `canHostDelivery`；主会话归档注释改为一处列出的新理由 |
| `backend/sessions/src/archive-store.ts` | 新增单行 `isArchived` |
| `backend/sessions/README.md` | 服务成员、归档窄读说明 |
| `backend/chat/src/queues.ts` | 条目 `settled` 状态：已结束条目可重入，运行中条目仍立即拒绝 |
| `backend/chat/src/runtime.ts` | `appendOnce` 的队列前提注释同步 |
| `backend/chat/README.md` | 「跨用户投递」改为「投递消息」，写入落点规则与回执即落点 |
| `GLOSSARY.md` | 主会话、投递消息两条按新规则改写 |
| `tests/delivery-target.test.mjs` | 新增 4 例纯函数用例（origin / 无发起会话 / origin 拒绝 / 其他用户） |
| `tests/text-delivery.test.mjs` | 新增自投落发起会话 + 归档后回落主会话；已有跨用户/恢复/并发用例不改 |
| `tests/chat-runtime.test.mjs` | 新增「已结束条目可重入」；既有「运行中重入仍拒绝」保持 |

## 红-绿

1. 红：`node --test tests/delivery-target.test.mjs` → `ERR_MODULE_NOT_FOUND .../dist/target.js`。
   绿：实现 `target.ts` + `npm run build` → 4/4。
2. 红：`node --test --test-name-pattern="self delivery" tests/text-delivery.test.mjs`，落点已改到 origin 后
   报 `Error: chat queues: "session:…" is already held by this call chain; waiting on it would never finish`
   （自投回写发起会话被队列守卫挡住）。这先于任何落点断言失败，证明单改落点不足以满足验收。
3. 红：`node --test tests/chat-runtime.test.mjs` 的新增用例 `a continuation of settled queue work may
   re-enter that queue` → 同一 `already held` 错误。
   绿：`SessionQueues` 记录条目结束状态后，该用例与既有「运行中重入立即失败」同时通过。
4. 绿：完整 `tests/text-delivery.test.mjs` 7/7，包含此前的跨用户投递、live 接收、恢复与幂等用例。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run build` | exit 0（提交门禁内再次执行，同样通过） |
| `node --test tests/delivery-target.test.mjs tests/chat-runtime.test.mjs tests/chat-append-once.test.mjs tests/docs.test.mjs` | 11 pass / 0 fail |
| `node --test tests/text-delivery.test.mjs tests/file-delivery.test.mjs` | 15 pass / 0 fail |
| `node --test tests/owned-sessions.test.mjs` | 10 pass / 0 fail |
| 提交 `5f0e047b7d` 的 pre-commit `related` 门禁（13 个改动路径选 35 个测试文件） | `npm run build` + 221 tests / 0 fail；`npm run combo:verify` 三行 ok |
| `git merge integration/spec-280` | `Already up to date.`（集成 tip 未推进，无合并提交） |

## 判读

- 自投行为的断言都在真实启动器 + 现有 `/sessions/*`、`/chat/*` 路由上完成，没有新增测试接缝。
- `delivery-target` 是纯函数单测；服务侧「归档 → false」由 text-delivery 行为用例覆盖，
  「不存在 / 不属于发送者」今天不可经工具到达（票面要求为未来后台投递保留输入），只在纯函数以事实
  入参覆盖，没有单独的服务级用例。
- 队列修复是票面写范围外的必要偏离：不修则「自投落发起会话」必然在工具执行链内抛错（见上）。它不改
  任何公开接口，只让既有守卫区分「仍在运行的条目」与「已结束但上下文仍继承的条目」；请复核这一点。

## 未执行

- 未跑全量 `npm test`：按改动面跑了 35 个相关套件（221 tests），全量与 `combo:verify` 的最终门禁
  留给收口/合并阶段；本提交的 pre-commit 已跑 `combo:verify`（三行 ok）。
- Android 不在本票范围（通知按落点发属 #285）。
- 自投文件随落点（#283）与「重试/启动恢复沿用首次落点」的显式行为用例（#284）未在本票实现；
  `prepare` 返回既有行且落点不参与冲突检查的既有语义已由现状保证。
- 全部为模型替身证据；没有真实云模型、真机或真实服务验收。
