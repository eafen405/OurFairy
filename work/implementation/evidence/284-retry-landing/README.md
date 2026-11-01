# #284 投递重试与启动恢复沿用首次落点

- 票：[#284](https://github.com/eafen405/OurFairy/issues/284)；父 spec：[#280](https://github.com/eafen405/OurFairy/issues/280)
- 分支：`ticket/284-retry-landing`；worktree `.worktrees/284-retry-landing`
- 基线：`integration/spec-280` @ `114f7b451e`（`git merge-base --is-ancestor 114f7b451e HEAD` 通过）
- 合并集成：开工 `git merge integration/spec-280` → fast-forward `114f7b451e` → `50f22d22d3`（含 #283/#285）；收口前 tip 推进到 `dfbf58a2b0`（#283 证据索引），再合并为 `2c2452a5fa`（无冲突，未改测试）
- 交付提交：`c522e2ec53`（本 README 与 `tests/text-delivery.test.mjs` 的同一提交；`git log --diff-filter=A -1 --format=%h -- work/implementation/evidence/284-retry-landing/README.md` 可复读该 SHA）

## 结论

**两例在基线上直接通过，没有改动生产代码；这是把既有语义固定的字符化（characterisation）切片，不是新规则。**

#282 之后，`deliver()` 每次调用仍会先算一个候选落点（`deliveryTargetOf` + 必要时 `primary()`），但
`deliveries.prepare` 对同一 `deliveryId` 返回既有行，不比较也不更新 `recipient_session_id`；随后的
`settle(row)`、回执和启动恢复都读 `row.sessionId`。所以「首次落点已记录后重试」「启动时结算未完成投递」
都自然沿用记录，发起会话被归档也不会改判。`prepareDelivery` 的同身份冲突检查只比较 sender、发起会话、
收件人、文本与文件选择器（`backend/identity/src/store.ts`），落点不在其中，因此归档造成的**落点差异本身
不是冲突**，而内容差异仍报 `different content or recipient`。

本票没有发现需要修的生产缺陷。若再在 `deliver()` 里加一层「先查既有行再决定落点」的短路，那会引入票面
未要求的第二套判定顺序；当前「先算候选、记录优先」的形状已经满足验收。

## 用例断言

新增两例，全部经真实启动器、既有 `/sessions/*` 与 `/chat/*` 路由，没有新增测试接缝：

1. `a self delivery retry reuses its recorded landing after the origin is archived`（`tests/text-delivery.test.mjs:302`）
   1. 新用户先落主会话并填充其日志，再 `/sessions/create` 得到普通会话 `origin`（断言 `origin !== primary`）。
   2. 用只匹配本条文本的 `deliveries` UPDATE 触发器让业务完成失败：`deliver_message` 返回
      `injected business completion failure`；断言 `deliveries` 行 `status = 0`、`recipient_session_id = origin`
      （首次落点已记录），`origin` 投影里该文本恰一条 `role = 2` 消息、恰一条 `delivery/message` 事件，
      主会话里没有。
   3. 归档 `origin`（此后新调用会回落主会话，即候选落点已改变），删掉触发器，用同一 `callId` 重试：
      回执 `sessionId = origin`，`origin` 里仍只有一条同文本消息与一条事件，主会话仍没有，行的
      `status = 1` 且 `recipient_session_id` 仍是 `origin`。
   4. 同一 `callId` 换文本再调：返回 `different content or recipient`——落点差异不是冲突，内容差异仍是。
2. `boot recovery settles a pending self delivery into its recorded origin without a tool call`（`tests/text-delivery.test.mjs:347`）
   1. 同样制造一次「消息已持久化、业务完成失败」的自投，断言行 `status = 0`、`recipient_session_id = origin`，
      `origin` 里已有一条消息。
   2. 停后端、删触发器、再启动；此后不再发任何工具调用，只轮询行状态。
   3. 启动结算把行置为 `status = 1`；`origin` 投影仍是同一条消息、事件恰一条，`message_id` 等于 `origin`
      日志里那条 `delivery/message` 的 `message.id`，主会话没有该文本。

触发器写成 `WHEN NEW.text = '<本条唯一文本>'`：只影响本用例的行，既有跨用户/恢复/并发用例不受影响。

## 用例敏感性（临时变异，未提交）

两例在基线上即绿，为证明它们不是在空转，做过两次临时生产变异，跑完即恢复（最终 `git diff --stat` 只有
`tests/text-delivery.test.mjs`）：

| 临时变异 | 结果 |
| --- | --- |
| `deliver()` 的 `settle(row)` 改成 `settle({ ...row, sessionId })`（重试改用重算的落点） | 用例 1 失败：`the retry receipt names the recorded landing`，actual 是主会话 id，期望是 `origin` id |
| 启动恢复的 `deliveries.pending()` 改成空列表（不结算） | 用例 2 失败：`condition not reached`（轮询到行仍非 `status = 1`） |

## 文件

| 文件 | 变化 |
| --- | --- |
| `tests/text-delivery.test.mjs` | 新增 2 条自投重试/启动恢复行为用例（+84 行）；既有 7 条跨用户/恢复/并发/自投用例不改 |
| `work/implementation/evidence/284-retry-landing/README.md` | 本证据 |

## 命令与结果

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 基线构建 | `npm run build` | exit 0 |
| 基线套件（改用例前） | `node --test tests/text-delivery.test.mjs` | 7 pass / 0 fail |
| 定向（新用例，基线上第一次跑） | `node --test --test-name-pattern="self delivery retry|boot recovery settles" tests/text-delivery.test.mjs` | 2 pass / 0 fail；没有红：走的是既有规则，本身就是绿 |
| 敏感性变异 A | 临时改 `backend/delivery/src/index.ts` 后 `npm run build` + 上述定向 | 用例 1 fail（见上表），恢复后通过 |
| 敏感性变异 B | 临时改启动恢复的 `pending()` 后 `npm run build` + 上述定向 | 用例 2 fail（见上表），恢复后通过 |
| 合并后构建 | `npm run build` | exit 0 |
| 本票套件（合并后） | `node --test tests/text-delivery.test.mjs` | 9 pass / 0 fail |
| 共享投递行为（合并后） | `node --test tests/file-delivery.test.mjs tests/delivery-row.test.mjs tests/delivery-cold-concurrency.test.mjs tests/delivery-target.test.mjs` | 17 pass / 0 fail |
| 合并集成分支（开工） | `git merge integration/spec-280` | fast-forward 到 `50f22d22d3`，无冲突、无合并提交 |
| 合并集成分支（收口前） | `git merge integration/spec-280`（`dfbf58a2b0`） | 合并提交 `2c2452a5fa`，无冲突；只带入证据索引两个文件 |
| 收口后构建与套件 | `npm run build`；`node --test tests/text-delivery.test.mjs tests/docs.test.mjs` | build exit 0；10 pass / 0 fail |
| 提交门禁 | `git commit`（`.githooks/pre-commit` → `scripts/precommit.ts`，2 个改动路径选 `tests/docs.test.mjs` + `tests/text-delivery.test.mjs`） | `npm run build` exit 0；10 pass / 0 fail；`combo:verify` 三行 ok、`combo: combination verified` |
| 证据索引 | `node scripts/evidence-index.ts --check` | `evidence index is current`（本目录尚未登记进 `index/29-spec-280.json`，按票面要求留给 Lead） |

## 判读与决定

- **不新增生产代码。** 重试/恢复读 `row.sessionId` 已由 #282 的「落点判定一次并记录」保证；本票只把
  「同一 `callId` 在失败、归档、重启后仍落原会话」变成可执行断言。没有新增显式目标会话参数、接口或恢复规则。
- **两例而不是三例。** 归档后的重试是「首次业务完成失败」状态的直接延续，拆成两例会重复同一套建用户/
  填充主会话/触发器准备；合成一例后，断言链本身就是验收顺序。
- **数据库行只读协调事实。** `deliveries` 行的 `status`/`recipient_session_id`/`message_id` 是本票验收明确
  要求「行仍指向该会话」的对象，也是既有恢复套件检查同一类事实的做法；消息落点与「只有一条」仍只从
  `origin`/主会话投影与事件断言，不读源码、不调内部函数。
- **两处视角都断言。** 「只有一条」同时看 `messages` 与 `delivery/message` 事件；「不在主会话」同时看
  主会话 `messages` 与事件，避免「事件写进主会话但投影折叠」的回归漏判。
- **保持既有用例不动。** 没有改 helper 或既有 7 条断言；触发器按唯一文本匹配，避免影响其他投递行。

## 未执行

- 未跑全量 `npm test`：按 AGENTS.md 的验证节奏留给收口/合并阶段；本交付的 pre-commit 已按改动面跑了
  相关套件与 `combo:verify`，本票没有生产代码，未自行扩大测试面。
- 未跑 `npm run combo:verify` 之外的全量组合/真实服务验收；Android 不在本票范围（#285 已按落点发通知）。
- 证据索引登记（`work/implementation/evidence/index/29-spec-280.json` 与生成后的
  `work/implementation/evidence/README.md`）按票面约束留给 Lead 收口，本票未改这两个文件。
- 全部为模型替身证据；没有真实云模型、真机或真实服务验收。
