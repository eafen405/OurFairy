# #283 自投文件随落点：附件落在发起会话且只在该会话可下载

- 票：[#283](https://github.com/eafen405/OurFairy/issues/283)；父 spec：[#280](https://github.com/eafen405/OurFairy/issues/280)
- 分支：`ticket/283-file-landing`；worktree `.worktrees/283-file-landing`
- 基线：`integration/spec-280` @ `114f7b451e`（`git merge-base --is-ancestor 114f7b451e HEAD` 通过）
- 交付：本 README 与 `tests/file-delivery.test.mjs` 的同一提交

## 结论

**用例在基线上直接通过，没有改动生产代码。这是一条字符化（characterisation）切片，不是新规则。**

#282 已经把落点判定收进 `backend/delivery/src/index.ts`：`deliveries.prepare` 之前判定一次并写入
`sessionId`，文件准备（`prepareDeliveryFile`）与 settle（`runtime.appendOnce(row.sessionId, …)`）都读
这条已记录的落点。因此自投文件不需要单独规则：文字和附件清单在同一次 `settle` 的同一个
`delivery/message` 事件里写进发起会话。`/attachments/download` 先按 `ourfairySessions.read(owner,
sessionId)` 校验会话归属，再只在该会话日志的 admitted message 里找 `messageId`/`index`，所以同一
`messageId` 在主会话或同用户其他会话都没有可下的清单，答案就是 404。

本票没有发现需要修的生产缺陷。

## 用例断言

新增用例 `a file delivered to the caller lands with its text in the origin session and downloads only there`，
全部经真实启动器与现有 `/sessions/*`、`/chat/*`、`/attachments/*` 路由，没有新增测试接缝：

1. 新用户先落主会话并填充其日志，再 `/sessions/create` 得到普通（非主）会话 `origin`，断言
   `origin !== primary`。
2. 在 `origin` 里用 `write` 写一份发送者自己私有空间中的文件，用 `deliver_message` 带文字和
   `files: [{ path }]` 投给本人。
3. `origin` 投影里文字只出现一次、`role` 为 2（普通 Fairy 消息），附件清单为
   `[{index:0,type:1,name:'self-landing.txt',mime:'text/plain',bytes}]`，字节数按发送前原文计算。
4. `origin` 里恰有一条 `delivery/message` 事件，且 `data.origin.sessionId` 是 `origin`。
5. 主会话的投影没有该文字，也没有 `delivery/message` 事件。
6. 从 `origin` 下载同一 `messageId`/`index`：200，字节与写文件前一致。
7. 用同一 `messageId`/`index` 分别从主会话与同用户的新会话下载：都是 404。

## 文件

| 文件 | 变化 |
| --- | --- |
| `tests/file-delivery.test.mjs` | 新增 1 条自投文件行为用例；既有 8 条跨用户/恢复/并发/共享文件用例不改 |
| `work/implementation/evidence/283-file-landing/README.md` | 本证据 |

## 命令与结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 基线构建 | `npm run build` | exit 0 |
| 基线套件（改用例前） | `node --test tests/file-delivery.test.mjs` | 8 pass / 0 fail |
| 定向（新用例） | `node --test --test-name-pattern="a file delivered to the caller lands" tests/file-delivery.test.mjs` | 1 pass / 0 fail；没有红：走的是既有规则，本身就是绿 |
| 本票套件 | `node --test tests/file-delivery.test.mjs` | 9 pass / 0 fail |
| 共享投递行为 | `node --test tests/text-delivery.test.mjs` | 7 pass / 0 fail |
| 合并前构建 | `npm run build` | exit 0 |
| 提交门禁（首提交，测试 + 证据） | `git commit`（`.githooks/pre-commit` → `scripts/precommit.ts`，2 个改动路径） | `npm run build` exit 0；相关套件 10 pass / 0 fail（9 条 file-delivery + 1 条 Markdown 链接）；`npm run combo:verify` 三行 ok |
| 提交门禁（amend，仅证据） | `git commit --amend`（Markdown-only 改动） | Markdown 链接 1 pass / 0 fail；`npm run combo:verify` 三行 ok |
| 合并集成分支 | `git merge integration/spec-280` | `Already up to date.`（交付时集成 tip 仍为 `114f7b451e`，无合并提交） |

定向用例没有出现「先红后绿」不是漏跑：写用例前先跑了基线 8/8，确认套件本身可运行；新用例第一次
运行即 1/1，说明 #282 的落点规则已经覆盖文件投递。按票面要求如实记录为字符化切片。

## 判读与决定

- **不新增生产代码。** 落点规则只在 `backend/delivery/src/index.ts` 判定一次，文件准备和 settle 复用
  同一个 `sessionId`；给文件另写一条判定会让同一次投递出现两个落点权威，票面也明确要求复用 #282。
- **不新增接缝。** 用例沿用该套件既有的 `tool` helper（真实 `/chat/send` 回合）和 `/chat/read`、
  `/sessions/*`、`/attachments/download` 路由；没有导入 delivery/attachments 内部模块，没有查数据库。
- **主会话断言用消息与事件两种视角。** 只查 `messages` 可能漏掉「事件写进主会话但投影被折叠」的
  回归，因此同时断言主会话没有该 `delivery/message` 事件。
- **两个 404 使用同一 `messageId`/`index`。** 这保证 404 来自「该会话里没有这条 admitted message」，
  而不是附件索引或下载字节本身有问题；发送者对这些会话都有归属权，404 不是权限拒绝。
- **保持跨用户文件用例不动。** 既有 8 条覆盖跨用户落主会话、恢复、幂等、检查表与共享文件空间，
  本票只追加自投一例，没有改 helper 或既有断言。

## 未执行

- 未跑全量 `npm test`：按 AGENTS.md 的验证节奏留给收口/合并阶段；本交付的 pre-commit 已按改动面
  跑相关套件（10 tests / 0 fail）与 `combo:verify`，本票没有生产代码，未自行扩大测试面。
- Android 不在本票范围（按落点发通知属 #285）。
- 归档后的自投文件回落主会话、重试沿用首次落点的显式文件用例属其他票/既有语义，本票未新增。
- 全部为模型替身证据；没有真实云模型、真机或真实服务验收。
