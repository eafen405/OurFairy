# Wayfinder Handoff · Grilling #10（前端首版边界）

> **本交接已完成：** [确定前端首版边界：功能取舍与后端契约的正式决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)已发布，决策票与前端地图已关闭。当前材料入口为[前端首版边界](../../docs/decisions/frontend-v1-boundary.md)。下文为历史交接，不再执行其 Q4/Q5 待办；本地文档未提交，产品代码未实施。

> **2026-10-14 接管后纠正：下文保留为历史交接，不能将“事实层已稳”“banner 已定”“Q4/Q5 后即可收束”作为当前结论。** 已复核 GitHub 决议、Android 官方资料与 dsh 源码，见[交接审核](../../docs/research/frontend-handoff-audit.md)。遗失的 18 项表已由用户补回并记录在[边界讨论稿](../../docs/decisions/frontend-v1-boundary.md)；用户确认群组管理经 Fairy 对话完成，普通成员不能执行成员变更。主 checkout 工作稿仍未提交；无需为已消失且没有这些稿件的临时 worktree 重建目录。

> 生成时间：2026-10-14（Asia/Shanghai 操作系统时区）
> 会话语言：中文
> 用户偏好：在中文下明确决议；产品决策靠 grilling、事实层靠 research；用户曾明确拒绝"凭幻觉"补足信息，要求以事实为重，会批评"口口声声说不要幻觉，却不愿派子代理"。
> 路径说明：本 handoff 写在 `work/handoff/`（按 Fairybot 仓库约定临时工作单路径），不在 main checkout 上 commit。下一个 agent 直接读它即可。

## 0. 这是什么

`/handoff` 文档。把当前 wayfinder 流程里 #10 的 grilling 进度**完整移交**给下一个 agent。下一个 agent 应当能**接管并收束 #10**（Q4 → Q5 → resolution comment → close → 更新 #2 地图）。

## 1. 当前位（未变更）

- **仓库**：`/home/eafen405/projects/OurFairy`
- **本会话目录**：`/home/eafen405/projects/OurFairy`（主 checkout，main，57ea2d1）
- **分支 worktree**：`/tmp/ourfairy-grill-frontend`（`work/wayfinder-grill-frontend`）— 当前是 prunable 状态，使用前需要 `cd /home/eafen405/projects/OurFairy && git worktree add -f /tmp/ourfairy-grill-frontend work/wayfinder-grill-frontend` 重新激活。
- **议程（GitHub）**：
  - [#2 前端改造与剪枝：rikkahub 客户端与法厄同网关](https://github.com/eafen405/OurFairy/issues/2) — `wayfinder:map`（已更新，含 #17 与 #10 引用）
  - [#10 确定前端首版边界：功能取舍与后端契约](https://github.com/eafen405/OurFairy/issues/10) — `wayfinder:grilling`（已 assign @me，已解除 #17 阻塞）
  - [#17 研究 rikkahub 架构：客户端模块分层与运行时数据流](https://github.com/eafen405/OurFairy/issues/17) — `wayfinder:research`（已 CLOSED，产物在 `research/rikkahub-architecture` 分支）
  - 相关已完成票：[#6](https://github.com/eafen405/OurFairy/issues/6)、[#8](https://github.com/eafen405/OurFairy/issues/8)、[#9](https://github.com/eafen405/OurFairy/issues/9) — 均收束。

## 2. 已完成的工作

| 步 | 内容 | 状态 |
|---|------|------|
| 1 | 建 research 票 #17（rikkahub 架构）并完成 research，close。 | ✓ |
| 2 | 把 #10 ↔ #17 双向 blocked-by / blocks 链接在两个 issue body。 | ✓ |
| 3 | 更新 #2 地图（Decisions so far +1，Not yet specified 收紧，新增 Frontier）。 | ✓ |
| 4 | 在 #10 assign @me，开始 grilling。 | ✓ |
| 5 | 建独立 worktree `/tmp/ourfairy-grill-frontend`（分支 `work/wayfinder-grill-frontend`）。 | ✓ |
| 6 | Q1 = A1（一 APK + 邀请码路由 + 同 NavGraph 按身份决定 destination 可见性） | ✓ 已 user 确认 |
| 7 | Q2 = 1–18 勾定表（剔除 12 TTS / 14 媒体生成：服务来源未定不能扣产品功能） | ✓ 已 user 确认 |
| 8 | Q3 = A1（复用美术资源，不迁实现；两边 fork 项目不同资源不能直取） | ✓ 已 user 确认 |
| 9 | 派 2 个并行 research 子代理写 dsh 事件消费与 vivo/国产 Android 通知事实 | ✓ |
| 10 | 把两份事实产物落到 session workspace `docs/research/` | ✓ |

## 3. 已落产物

| 路径 | 内容 |
|------|------|
| `research/rikkahub-architecture` 分支（origin 已 push） | rikkahub 架构图与模块说明，4 张 Mermaid + 13 节 |
| `docs/research/domestic-android-notification-vivopush-revival.md`（main untracked） | vivo S50 / 国产 Android 通知通道能力边界（24 KB） |
| `docs/research/dsh-event-consumption.md`（main untracked） | dsh 传输 / jobs / 补取 / Android 对接事实层（7 KB） |
| `docs/decisions/.tmp-q4-brief.md`（main untracked） | Q4 事实层 brief（仅事实，待 Q4 选项确认后定夺是否提交） |
| `work/handoff/grilling-10-frontend-boundary.md`（本文件） | handoff 文档 |

## 4. 下一会话要做的（顺序）

1. **重新激活 worktree**：`cd /home/eafen405/projects/OurFairy && git worktree add -f /tmp/ourfairy-grill-frontend work/wayfinder-grill-frontend`。
2. **Q4 决议**：在 #10 评论下向用户发起 Q4 五个决定项（A 通知粒度 / B 后台权限引导 / C 长任务呈现 / D 投递消息 UI 可识别 / E 应用被杀后提醒）。事实层已稳，**不要重烤事实**。
3. **Q5 决议**：跨用户投递在 UI 上的呈现（GLOSSARY `投递消息` ≠ 普通消息）。属于产品决策，grilling 模式。
4. **写决议表 / 候选矩阵**到 worktree 的 `docs/decisions/frontend-v1-boundary.md`（已存在 draft，需更新）。
5. **写 resolution comment** 在 #10，关闭 #10。
6. **更新 #2 地图**：Decisions so far 追加 #10 行；Frontier 清空（前端地图已 ready for implementation 或移交实现票）。
7. **不要 commit** 任何 main 工作稿；该提交由 user 决定。

## 5. 已烤过的事实 / 已决定的事（不要重复问）

- **Q1 入口组织 = A1（用户已答）**：一 APK + 邀请码路由 + 同 NavGraph 按身份决定 destination 可见性。
- **Q3 视觉资源 = A1（用户已答）**：复用美术资源（色板、字体、Fairy tokens、眼睛动效、回复面板的**资源与美术资产**），不迁实现；两边 fork 项目不同不直接合并资源。
- **Q2 功能集**：用户已勾 1–18 表（剔除 12 TTS / 14 媒体生成），完整勾定表见 `docs/decisions/.tmp-q4-brief.md`（待 Q4 之后再固化）。
- **TTS / 媒体生成**：服务来源未定（VOICE_API_KEY 是 ASR，AGENTS.md 没声明后端；`#8/#9` 决议未含产品语义）。**不进首版功能决策**。
- **登录系统**：用现成邀请码登录能力（不烤实现）；用户信息存后端，客户端不持有用户档案。
- **首版排除**：子代理、记忆、定时任务、技能（#9 resolution）。
- **客户端不使用**：vpush / 华为 / 小米 / OPPO 推送——单设备单 APK（vivo S50），不走。
- **视觉资源**：Fairybot 与 rikkahub **两边 fork 资源不同**，不能默认合并。

## 6. 不要做的事（已在节）

- **不要把 `/tmp/ourfairy-grill-frontend/docs/...` 路径作为长期保存**——`/tmp` worktree 自动 prune；写文件必须落到 session workspace `docs/` 之下，再 push 到 grill 分支或由用户决定 main 上的归宿。
- **不要重复烤已答问题**（Q1/Q2/Q3）。
- **不要重复烤已查事实**（dsh 事件消费、vivo 通知通道）——产物在磁盘上，grilling 只在事实之上做决策。
- **不要**提议 TTS / 媒体生成进入首版产品功能——除非用户明示。
- **不要**凭"fork 现成有"补功能（fork 现成有 ≠ 必然属于产品功能；user 已两次纠正此点）。

## 7. 关键事实摘要（避免重读）

### 7.1 dsh（来自 `dsh-event-consumption.md`）

- 单传输 = WebSocket mux `GET /api/remote.mux`；**无原生 SSE / 无推送通道**。
- 多用户身份 wire 上**无字段** → 后端 RPC handler 补齐归属。
- Assistant 流 transient，**当前 revision 内** baseline 续；无 chunk-index 补取。
- jobs 输出按**字节 offset 续拉**；jobs 内存，Host 重启即丢。
- 列表/projection reconnect **全新 baseline**；client 缓存按整张表刷新。
- 补取 = `session.page({ throughSeq })` 或 `session.follow` 重开 + Client 累加 by `seq`。
- Android 原生客户端绑定代码**不存在**；需要重写。
- Cookie 持久化（launch token 换 Set-Cookie）；必须 trust fence。

### 7.2 vivo / 国产（来自 `domestic-android-notification-vivopush-revival.md`）

- vivo vpush 必须上架，**自用签名 APK 物理不可走**。
- 系统通知用户必须开（vivo 新机型默认关；Android 13+ POST_NOTIFICATIONS 必须授权）。
- 前台服务 `dataSync` **6h/24h 滚动窗口**。
- Doze 冻结普通网络，前台服务连接**不豁免**。
- 进程被回收 → 重启重连补取；不影响 WorkManager / AlarmManager。
- 锁屏通知 / 横幅 / 悬浮 由用户通知设置决定；平台与厂商都无法绕过。
- vivo 新机型 **通知开关默认关**，首次进入应用弹窗授权。
- Android 15 stopped state 下 pendingIntent 被取消，jobs/alarms 仍可运行。
- 证据空白：vivo OriginOS 高耗电 / 后台省电策略**无公开文档**，实机验证。

### 7.3 已决定（#8 / #9）

- **共用模型**：DeepSeek 官方 API（VOICE_API_KEY 是 ASR，分开）。
- **空间范围**：本人私有、群组、公有（无逐文件权限）。
- **客户端缓存不是权威**。
- **投递 = 收件方 Fairy 发言**，不启动接收方推理。
- **长任务** = dsh jobs + 会话内 banner + 完成通知。
- **前台服务 + 补取** = #9 已定，**进程回收后须等待接收端恢复**，能补取不能保证提醒。

## 8. 建议 Skill 调用（下一个 agent 应该用）

按 wayfinder 流程，下一会话应当：

1. **`skill wayfinder`** — 加载 wayfinder 主流程。
2. **`skill grilling`** — Q4 / Q5 用 grilling 的 4 步式烤。
3. **`skill domain-modeling`** — 决议收束前，确认 GLOSSARY 词汇没有歧义（如 `投递消息`、`主会话`）。
4. **`skill code-review`** — 不调用（本会话无代码 diff；如未来需要，前端剪枝后调用）。
5. **`skill tdd` / `prototype`** — 不调用（本会话是规划不实现）。
6. **`skill research`** — 不调用（除非 Q4 暴露新事实缺口；当前事实层已稳）。

## 9. 下一会话不要做的事

- **不要重烤 Q1/Q2/Q3**（用户已答）。
- **不要重新读所有 dsh 源码**——产物已写。
- **不要重新核查 vivo 文档**——产物已写。
- **不要把研究产物**交到 main 上 commit——除非 user 决定。
- **不要重提交任何研究 PR**——user 没明示提交过。
- **不要拟定实现代码**——本票是规划，#2 Out of scope。

## 10. 下一会话直接读

按此顺序读 5 个文件即可启动：

1. 本文件（handoff / work/handoff/grilling-10-frontend-boundary.md）
2. [#10 当前 body](https://github.com/eafen405/OurFairy/issues/10) — 看头部 comment 与 body 内链。
4. [`docs/research/dsh-event-consumption.md`](../../docs/research/dsh-event-consumption.md) — 旧 dsh 研究，已有复核纠正。
5. [`docs/research/domestic-android-notification-vivopush-revival.md`](../../docs/research/domestic-android-notification-vivopush-revival.md) — 旧 vivo 研究，已有复核纠正。
6. [`docs/decisions/.tmp-q4-brief.md`](../../docs/decisions/.tmp-q4-brief.md) — 已更新的 Q4 记录；决策已完成，勿重新发问。
