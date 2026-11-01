# #284 投递重试与启动恢复沿用首次落点

- 票：[#284](https://github.com/eafen405/OurFairy/issues/284)；父 spec：[#280](https://github.com/eafen405/OurFairy/issues/280)
- 分支：`ticket/284-retry-landing`；worktree `.worktrees/284-retry-landing`
- 基线：`integration/spec-280` @ `114f7b451e`（`git merge-base --is-ancestor 114f7b451e HEAD` 通过）
- 合并集成：开工 `git merge integration/spec-280` → fast-forward `114f7b451e` → `50f22d22d3`（含 #283/#285）；收口前 tip 推进到 `dfbf58a2b0`（#283 证据索引），再合并为 `2c2452a5fa`（无冲突，未改测试）
- 交付提交：`c522e2ec53`（本 README 与 `tests/text-delivery.test.mjs` 的同一提交；`git log --diff-filter=A -1 --format=%h -- work/implementation/evidence/284-retry-landing/README.md` 可复读该 SHA）
- 复审修订：`ticket/280-review-fixes` 按 spec #280 两轴复审（Standards 6 / Spec c1、Standards 7）把本票两条用例改为纯外部行为断言，并同步更新本 README；原始交付结论与提交记录保留在下面。

## 结论

**两例在基线上直接通过，没有改动生产代码；这是把既有语义固定的字符化（characterisation）切片，不是新规则。**

#282 之后，`deliver()` 每次调用仍会先算出候选落点（先解析主会话、问一次 `canHostDelivery`，再由
`deliveryTargetOf` 选择），但 `deliveries.prepare` 对同一 `deliveryId` 返回既有行，不比较也不更新
`recipient_session_id`；随后的 `settle(row)`、回执和启动恢复都读 `row.sessionId`。所以「首次落点已记录后重试」
「启动时结算未完成投递」都自然沿用记录，发起会话被归档也不会改判。`prepareDelivery` 的同身份冲突检查只比较
sender、发起会话、收件人、文本与文件选择器（`backend/identity/src/store.ts`），落点不在其中，因此归档造成的
**落点差异本身不是冲突**，而内容差异仍报 `different content or recipient`。

本票没有发现需要修的生产缺陷。若再在 `deliver()` 里加一层「先查既有行再决定落点」的短路，那会引入票面
未要求的第二套判定顺序；当前「先算候选、记录优先」的形状已经满足验收。

## 用例断言

两条用例只读外部行为：工具返回、`/chat/read` 的会话投影，以及同一工具调用 id 的回执。`deliveries` 表的
SQL 触发器只在重试用例里作为故障注入存在，经短生命周期连接安装与删除，不读行、不读 status/落点/消息 id。
启动恢复用例不读数据库，也不在重启后发工具调用。全部经真实启动器、既有 `/sessions/*` 与 `/chat/*` 路由，
没有新增测试接缝。

1. `a self delivery retry reuses its recorded landing after the origin is archived`（`tests/text-delivery.test.mjs:312`）
   1. 新用户先落主会话并填充其日志，再 `/sessions/create` 得到普通会话 `origin`（断言 `origin !== primary`）。
   2. 用只匹配本条文本的 `deliveries` UPDATE 触发器让业务完成失败：`deliver_message` 返回
      `injected business completion failure`。触发器只制造失败，不断言数据库行。
   3. 归档 `origin`（此后新调用会回落主会话，即候选落点已改变），删掉触发器，用同一 `callId` 重试：
      回执 `sessionId = origin`；`origin` 投影里该文本恰一条 `role = 2` 消息，主会话里没有。
   4. 同一 `callId` 换文本再调：返回 `different content or recipient`——落点差异不是冲突，内容差异仍是。
2. `boot recovery settles a pending self delivery into its recorded origin without a tool call`（`tests/text-delivery.test.mjs:341`）
   1. 同样先准备 `primary` 与 `origin`。
   2. 用既有 `backend/chat/test-support/fail-outlets.ts` 的 `failFlush` 故障（按 `origin` 会话）重启后端，
      并先用 `/chat/read` 把 `origin` 打开为 live；发起自投后 `deliver_message` 返回
      `injected durability checkpoint failure`。
   3. 在仍运行的后端上归档 `origin`；停后端，不带故障层再启动。此后不再发任何工具调用。
   4. 轮询 `origin` 投影直到该文本出现：断言恰一条 `role = 2` 消息，主会话没有该文本。落点读的是首次
      记录的 `origin`，而不是归档后重新判定会得到的主会话。

触发器写成 `WHEN NEW.text = '<本条唯一文本>'`：只影响本用例的行，既有跨用户/恢复/并发用例不受影响。

## 文件

| 文件 | 变化 |
| --- | --- |
| `tests/text-delivery.test.mjs` | 新增 2 条自投重试/启动恢复用例；复审修订把两条改为纯外部断言，并把「填充主会话再建普通会话」的准备提取为 `selfDeliverySessions` helper；既有跨用户/恢复/并发/自投用例的断言不变 |
| `work/implementation/evidence/284-retry-landing/README.md` | 本证据（复审修订同步更新） |

## 命令与结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 基线构建 | `npm run build` | exit 0 |
| 基线套件（改用例前） | `node --test tests/text-delivery.test.mjs` | 7 pass / 0 fail |
| 定向（新用例，基线上第一次跑） | `node --test --test-name-pattern="self delivery retry\|boot recovery settles" tests/text-delivery.test.mjs` | 2 pass / 0 fail；没有红：走的是既有规则，本身就是绿 |
| 合并后构建 | `npm run build` | exit 0 |
| 本票套件（合并后） | `node --test tests/text-delivery.test.mjs` | 9 pass / 0 fail |
| 共享投递行为（合并后） | `node --test tests/file-delivery.test.mjs tests/delivery-row.test.mjs tests/delivery-cold-concurrency.test.mjs tests/delivery-target.test.mjs` | 17 pass / 0 fail |
| 合并集成分支（开工） | `git merge integration/spec-280` | fast-forward 到 `50f22d22d3`，无冲突、无合并提交 |
| 合并集成分支（收口前） | `git merge integration/spec-280`（`dfbf58a2b0`） | 合并提交 `2c2452a5fa`，无冲突；只带入证据索引两个文件 |
| 收口后构建与套件 | `npm run build`；`node --test tests/text-delivery.test.mjs tests/docs.test.mjs` | build exit 0；10 pass / 0 fail |
| 提交门禁 | `git commit`（`.githooks/pre-commit` → `scripts/precommit.ts`，2 个改动路径选 `tests/docs.test.mjs` + `tests/text-delivery.test.mjs`） | `npm run build` exit 0；10 pass / 0 fail；`combo:verify` 三行 ok、`combo: combination verified` |
| 证据索引 | `node scripts/evidence-index.ts --check` | `evidence index is current`（本目录尚未登记进 `index/29-spec-280.json`，按票面要求留给 Lead） |

## 复审修订的重跑（`ticket/280-review-fixes`）

| 命令 | 结果 |
| --- | --- |
| `npm run build` | exit 0 |
| `node --test tests/delivery-target.test.mjs` | 4 pass / 0 fail |
| `node --test tests/chat-runtime.test.mjs` | 5 pass / 0 fail |
| `node --test --test-name-pattern="self delivery retry\|boot recovery settles" tests/text-delivery.test.mjs` | 2 pass / 0 fail |
| `node --test tests/text-delivery.test.mjs tests/file-delivery.test.mjs tests/chat-runtime.test.mjs tests/delivery-target.test.mjs tests/docs.test.mjs` | 28 pass / 0 fail |

## 判读与决定

- **不新增生产代码。** 重试/恢复读 `row.sessionId` 已由 #282 的「落点判定一次并记录」保证；本票只把
  「同一 `callId` 在失败、归档、重启后仍落原会话」变成可执行断言。没有新增显式目标会话参数、接口或恢复规则。
- **两例而不是三例。** 归档后的重试是「首次业务完成失败」状态的直接延续，拆成两例会重复同一套建用户/
  填充主会话/触发器准备；合成一例后，断言链本身就是验收顺序。
- **只断言外部行为。** 复审修订删掉了 `deliveries` 行的 `status`/`recipient_session_id`/`message_id` 断言：
  回执给出落点，两个会话的投影给出「只有一条」和「不在主会话」。触发器只作故障注入，数据库连接只在安装/
  删除触发器时短暂存在。
- **启动恢复只用既有故障接缝。** 复用 `backend/chat/test-support/fail-outlets.ts` 的 `failFlush`，不再注入
  SQL 触发器；重启后只读投影、不发工具调用。
- **保持既有用例不动。** 既有跨用户/恢复/并发/自投用例的断言未改；复审修订只把三处相同的建会话准备提取为
  `selfDeliverySessions` helper。

## 未执行

- 未在本票分支跑全量 `npm test`、`npm run combo:verify` 与 Android `test lintDebug`：按 AGENTS.md 的验证节奏
  留给收口/合并阶段；复审后的最终门禁由 Lead 在最终集成分支 tip 运行（见
  [`280-review`](../280-review/README.md) 的 F3 未完成项）。
- 未跑真实服务验收；Android 不在本票范围（#285 已按落点发通知）。
- 全部为模型替身证据；没有真实云模型、真机或真实服务验收。
