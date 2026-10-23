# 01 三条（实为四条）接缝的上游等价物裁决

票 [#185](https://github.com/eafen405/OurFairy/issues/185)。上游目标 `687f282e86`（`dsh-v0.2.1-rc.2`），
fork 基线 `42133b30ad`（`product/ourfairy-v1`），共同基线 `d743267388`（`dsh-v0.2.1-alpha.2`）。

issue 正文点了三条接缝。真合并时发现第四条：job 事件。四条一并裁决，因为它们都是「fork 有、上游没有或有别的」。

裁决原则：**上游已有等价能力的一律采用上游事实**；只有上游确实没有、且产品真正依赖的才保留，
并整理成不夹带产品私有假设的补丁形态。

---

## ① `@deepseek-ai/dsh-agent/session-history`

**fork 侧。** `packages/core/agent/src/session-history.ts`，通过 `package.json` 的
`exports["./session-history"]` 暴露为子路径导出（`files` 也加了对应产物）。导出
`createSessionHistorySeam`、`SessionHistoryGapError`。

**上游 rc.2。** `dsh-agent` 的 `exports` 里没有这个子路径；全包搜索 `session-history`/`SessionHistory`
无命中。上游没有等价物。

**裁决：保留。**

**理由。** 这是「用公开接缝读会话历史，而不是 import 内部模块」的能力，本身与产品无关：任何宿主
都需要一条稳定的历史读取缝。上游没有替代品，删掉就等于产品直接摸内部结构。

**消费点。**
- 产品：`backend/chat/src/runtime.mjs`（`createSessionHistorySeam`、`SessionHistoryGapError`）。
- 组合校验：`scripts/combo.mjs` 的 `SESSION_HISTORY_EXPORT`，作为「必需原生能力」之一被解析，
  解析失败即 `combo:verify` 失败。
- 测试：`tests/native-capabilities.test.mjs`。

**上游可接受的最小形状。** 一个 `exports` 子路径 + 一个工厂 + 一个具名错误类型；入参只取 session id 与
游标区间，不出现用户、邀请、群组等产品词汇。已按此形状保留。

---

## ② `SessionHeader.owner`

**fork 侧。** `SessionHeader` 增加可选字段 `readonly owner?: SessionOwnerId`，并新增 `SessionOwnerId` 品牌类型。
持久化、导出与格式迁移都携带它。

**上游 rc.2。** `SessionHeader` 没有 `owner`；全仓搜索 `SessionOwnerId` 无命中。

**裁决：保留。**

**理由。**
1. 上游的 `Principal` 是**连接层的调用者身份**（`{ kind: 'owner' }`，可经 `PrincipalMap` 扩展），
   生命周期止于一次连接；它不落盘、不随会话历史走。产品需要的是**持久的会话归属**，两者语义不同，
   不能互相替代。
2. 字段是**可选**的：没有 owner 的历史会话照常读取，格式层不发明、不默认、不猜测 owner
   （缺 owner 时是否拒绝属于产品/授权边界，不属于存储格式）。因此它对上游是向后兼容的加法。

**消费点。** `backend/sessions/src/service.mjs`（`header.owner` 比对、`meta: { owner }` 写入）、
会话持久化与导出路径。

**上游可接受的最小形状。** 一个可选 header 字段 + 一个不透明的品牌类型，不带任何产品身份语义；
格式层只负责存取，不做归属校验。已按此形状保留。

---

## ③ `connection.authenticators`

**fork 侧。** Connection 上多了：`authenticators` 注册表
（`ConnectionAuthenticator { name, identify(request) → ConnectionPrincipal { id } }`）、
`principalOf(peer)`、`revokePrincipal(principalId)`、`fence(request)`、`operator` Peer，
以及 `operator-peer.ts` / `principal-peer.ts` 两个独立 Peer 实现。

**上游 rc.2。** 连接层被重构成 `peer.ts` 的 `Peer` + `browserPeer`（唯一 owner Peer）+
`peers: Map<PeerId, PeerRecord>` + `createPeer({ principal })` + `admitConnection()` +
`ConnectionAdmission`。**没有**插件注册自定义凭据的钩子：`admit()` 只认浏览器 cookie 与 `/connect`
换出来的 API peer id。

**裁决：保留能力，改用上游的 Peer/Principal 基底。**

具体取舍：
- **采用上游**：`peer.ts` 的 `Peer`、`browserPeer`、`peers` 映射、`admitConnection`/`ConnectionAdmission`、
  `Principal` 与可扩展的 `PrincipalMap`。删除 fork 自带的 `operator-peer.ts`、`principal-peer.ts`。
- **保留**：`authenticators` 注册表、`fence`、`revokePrincipal`，重写成上游模型上的加法。
- **删除**：`principalOf`。上游的 `PeerScope` 已经公开 `principal`，再包一层没有信息增益。
- **接口形状调整**：`identify` 不再返回 `{ id }`，而返回 `{ subject, principal }`。
  `subject` 是 Connection 不解释的不透明键，用于「一个 subject 一次 Peer 缓存」与撤销；
  `principal` 是上游的调用者身份。这样接缝不预设产品身份模型。

**理由。** 上游的 Peer/Principal 已经覆盖了「谁能连接」的建模，fork 当初另起一套（operator + principal
peer）只是因为上游当时没有。继续保留两套就是两份权威状态。但上游**确实没有**「插件把一种自定义凭据
映射成调用者身份」的能力，而产品的 `backend/identity` 正依赖它（会话 token 同时是 dsh `/api` 的凭据）。
所以：基底用上游，缺的那一层作为通用加法补回。

**消费点。**
- `authenticators.register`：`backend/identity/src/index.mjs`。
- `revokePrincipal`：`backend/identity/src/index.mjs`（登出时撤销该 principal 的 Peer 作用域）。
- `fence`：`backend/identity`、`backend/sessions`、`backend/speech`、`backend/chat`、`backend/gateway`、
  `backend/attachments` —— 产品自有路由在 `/api` 之外，必须能在任何凭据存在之前被访问，
  所以它们只要 Host/Origin 栅栏，不要浏览器认证。

**上游可接受的最小形状。** 一个注册表 + 一个「Host/Origin only」栅栏 + 一个按不透明 subject 撤销的入口，
不出现用户/邀请/群组词汇。已按此形状保留。

---

## ④ job 事件（issue 未点名，合并时浮现）

**fork 侧。** `packages/jobs/tool-jobs/src/index.ts` 通过 `SessionEventMap` 增补声明两个事件并写入：
- `jobs/lifecycle`：`{ generation, phase: 'registered'|'stopping'|'settled'|'removed', job: { id, kind, label, status, startedAt, finishedAt?, detail?, output } }`
- `jobs/report`：`{ generation, jobId, delivery: 'wakeup'|'busy-context'|'quiet-context'|'none'|'failed', messageId?, reason? }`

**上游 rc.2。** 有 `job/registered`（`packages/jobs/jobs-local/src/index.ts`）与 `job/settled`，
声明在 `packages/jobs/jobs/src/types.ts`，载荷是 `{ jobId, startedAt }` / `{ jobId, startedAt, finishedAt, producerReported? }`。
上游的 `tool-jobs` 不写任何 job 事件。

**裁决：两套并存，保留 fork 的两个事件，同时接受上游的两个。**

**理由。**
1. **产品依赖 fork 的两个事件**：`backend/chat/src/units.mjs` 用它们渲染后台任务活动卡与完成投递
   （`delivery` 决定是唤醒、忙上下文、静默上下文还是不投递）。上游的 `job/settled` 没有 `delivery`，
   也没有 `phase`/`job` 快照，替换会改变产品的呈现与投递语义。
2. 改产品的 HTTP/SSE 契约与本 spec 的范围冲突（issue 明写「不改 HTTP/SSE 契约」）。
3. 两套事件**可以共存**：`KNOWN_SESSION_EVENT_TYPES` 由全仓 `SessionEventMap` 增补生成，
   只要 `tool-jobs` 的增补还在，重新生成就会同时列出四个名字。上游读取器对不认识的事件名有
   `ignorable` 信封标记作为兼容机制，所以并存不是格式违规。

**消费点。** `backend/chat/src/units.mjs`（401/405/433/434/467/480 行）；
产品测试 `tests/projection-fold.test.mjs`、`tests/projection-units.test.mjs`、
`tests/fixtures/projection-logs.mjs`、`tests/chat-read-window.test.mjs`、
`tests/chat-cold-boundary.test.mjs`、`tests/jobs.test.mjs`。

**验证方式。** 合并后重新生成 `packages/core/session/src/known-event-types.ts`，确认
`jobs/lifecycle`、`jobs/report`、`job/registered`、`job/settled` 四个名字同时在内。
这条不是「已检查」的声称——它由生成器在漂移时失败来保证。

---

## 汇总

| 接缝 | 上游有等价物 | 裁决 | 落到合并里的动作 |
| --- | --- | --- | --- |
| ① `dsh-agent/session-history` | 无 | 保留 | 不动 fork 的导出面 |
| ② `SessionHeader.owner` | 无（`Principal` 是连接层身份，不落盘） | 保留 | 保留可选 header 字段 |
| ③ `connection.authenticators` | 部分（有 Peer/Principal，无自定义凭据钩子） | 保留能力，改用上游基底 | 删 `operator-peer`/`principal-peer`，在 `Peer` 上重写注册表；删 `principalOf`；`identify` 改回 `{ subject, principal }` |
| ④ job 事件 | 有同名但不同载荷的事件 | 两套并存 | 保留 `tool-jobs` 的两个事件与增补声明 |

## 未执行项

- 没有把任何接缝实际提交到上游仓库（本 spec 只要求可提交形态，见 #190）。
- 第 ③ 条最终能否被上游接受，取决于上游是否愿意在 `admit()` 上增加插件钩子；本记录只说明它不夹带
  产品私有假设。
