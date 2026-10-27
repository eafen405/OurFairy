# #248 记忆增量集成与真实模型验收

日期：2026-10-27。票面：[`work/tickets/fairy-memory/08-memory-integration-acceptance.md`](../../../tickets/fairy-memory/08-memory-integration-acceptance.md)。
规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md)。
分支 `ticket/248-memory-acceptance`，worktree `.worktrees/248-memory-acceptance`，基线
`1ecbfa661d`（`integration/spec-240`）。实现提交：`63aa66fcf7`；测试/修复提交：`4817b4705b`；
本条为 docs 提交。

本票把 #241–#247 的记忆、印象、维护与自动压缩增量作为一个可复现版本组合收口，并用**真实
MiniMax** 跑一轮不进入 CI 的语义质量样本。本票没有修改或关闭父票 #240，也没有关闭任何
前置票；tracker 由 Lead 处理。

#240 收口复核后补充：`invalidate` 案例新增“删除后再次检索不再命中”的真实检查，并以
`--only invalidate` 用真实 MiniMax 单独重跑（[`invalidate-rerun.json`](invalidate-rerun.json)，
7/7）；复核同时补齐了 dsh 门禁的完整记录、压缩范围偏差与维护保存不中断的确定性用例，
见 §2、§5、§7、§8。

## 1. 本票做了什么

| 改动 | 位置 | 目的 |
| --- | --- | --- |
| 真实模型验收入口 | [`scripts/memory-acceptance.ts`](../../../../scripts/memory-acceptance.ts)、`package.json` 的 `acceptance:memory` | 用真实产品后端与真实 MiniMax 驱动 11 条记忆/印象/维护案例，输出逐条 JSON；`--plan` 只列选择；`--only` 可重跑单例；拒绝回环模型替身 |
| 记忆写入分寸 | [`backend/memory/src/tools.ts`](../../../../backend/memory/src/tools.ts)、[`index.ts`](../../../../backend/memory/src/index.ts)、[`maintenance.ts`](../../../../backend/memory/src/maintenance.ts) | 给有 owner 的 Agent 加 `ourfairy:memory-policy` 段；维护子会话在自己的策略里得到同一条规则；`memory_add` 的描述同步。真实运行暴露的会话摘要、用户画像、IP/位置推断、时间限定观察、元记忆和待办不再写入 |
| 策略接线守卫 | [`tests/memory-policy.test.mjs`](../../../../tests/memory-policy.test.mjs) | 用真实 profile + Loader + 模型替身读取模型实际收到的 prompt，固定主会话有策略段、维护子会话有同规则且不继承主 prompt 策略；确定性的替身测试不能替代真实语义样本 |
| 证据与索引 | 本目录、[`work/implementation/evidence/index/23-spec-240.json`](../index/23-spec-240.json) | 逐条记录真实结果、前后对比、未执行项与门禁；索引由 `node scripts/evidence-index.ts` 重新生成 |

真实模型验收**不在 CI**：它需要 `MINIMAX_CN_API_KEY`、真实网络和数分钟时间；`npm test` 仍只
跑模型替身与真实 profile/Loader 的确定性行为。

## 2. 真实模型验收入口

```sh
set -a; . /home/eafen405/projects/MINIMAX_API_KEY.env; set +a
export MINIMAX_CN_API_KEY="$MINIMAX_API_KEY"      # 产品 minimax-cn 路由读取的名字
npm run build
npm run acceptance:memory                          # 11 条全部
npm run acceptance:memory -- --plan                # 只列案例，不读凭据/不启动
npm run acceptance:memory -- --only supersede      # 单例重跑
```

- 启动真实 v1 profile + Loader + 产品 HTTP 会话；`/gateway/read` 必须报告
  `minimax-cn / MiniMax-M3.1-Flash`，base URL 必须是真实、非回环的 HTTPS 地址；否则在任何案例
  之前失败。每个主会话请求与维护子会话请求都从各自的持久 session log 读到同一路由。
- 通过真实 `/gateway/maintenance` 把触发回合数从默认 15 保存为 **5**、衰减间隔从 6 保存为
  **3**（读回验证 `{triggerTurns:5,decayHours:3}`），因此每个维护区间只需 5 个闭合用户回合，
  不伪造 15 轮噪声，同时复用了 #247 的真实设置路径。
- `--home` 保留隔离 home 以便复查；`--out` 指定报告路径；`--keep` 留下后端进程。
- stdout 是完整 JSON 报告；stderr 是逐例进度。未选中/未执行的案例在报告里是 `unexecuted`，
  不计为通过；全量运行中任何未执行或失败都会让退出码非 0。

本次最终全量运行的原始报告：[`results.json`](results.json)（11 例、67 项检查、全部通过；
其中 `invalidate` 为加强前的 5 项）。#240 收口复核把 `invalidate` 加强为 7 项：删除后必须
真的再跑一次 `memory_search`，并且不再命中该号码；真实重跑 7/7 通过，报告
[`invalidate-rerun.json`](invalidate-rerun.json)。因此当前 harness 的全量检查数应为 **69**；
`results.json` 保留加强前的全量记录，没有把只重跑一例说成重跑了全部 11 例。
修复前的真实失败样本：[`before-fix.json`](before-fix.json)。

## 3. 最终真实模型逐条结果

模型：`minimax-cn/MiniMax-M3.1-Flash`，真实端点 `https://api.minimaxi.com/anthropic`。
维护子会话模型：同一路由（从子会话的 `request/header` 读取）。
设置：真实 `/gateway/maintenance` 读默认 `{15,6}`，保存并读回 `{5,3}`。

| # | 案例 | 用户提示（摘要） | 模型/子会话决定 | 结果行（真实 `memory.sqlite`） | 检查 |
| --- | --- | --- | --- | --- | --- |
| 1 | `remember-explicit` | 请记住：我的猫叫团子，是一只橘猫… | 主会话 `memory_search`×2 → `memory_add` | `#1 用户的猫叫团子，是一只橘猫。以后用户提到“猫”时，指的都是团子。` 普通层，来源=本次会话 | 4/4 |
| 2 | `normal-private-switch` | 请记住：我大学时的绰号是阿岚。→ 把阿岚改成私密记忆… | 主会话 `memory_search` → `memory_switch {"id":2}` | `#2 用户在大学时的绰号是「阿岚」。` 普通→私密；正文与 `content_updated_at` 一字不变 | 6/6 |
| 3 | `supersede` | 手机尾号换成 8150；旧的 3721 别再记了；最近换号码的地方挺多… | 主会话多次 `memory_search` → `memory_edit id=3` 就地更新；维护子会话只做检索 | `#3 用户的手机尾号是 8150。` 唯一一行；区间内没有元记忆/会话行；旧 3721 零残留 | 7/7 |
| 4 | `invalidate` | 请记住：旧手机号 13800000000 已停用。→ 那条旧手机号没用了，删掉 → 再查 13800000000 | 主会话 `memory_search` → `memory_delete {"id":4}`；复核重跑时第三回合再 `memory_search` | `#4` 物理删除；库内无 `13800000000` 残留；后续检索 `matched:0, returned:0` | 全量 5/5；复核 7/7 |
| 5 | `chit-chat-no-write` | 哈哈，今天没什么事…；嗯，晚安。 | 无记忆工具调用 | 0 行 | 2/2 |
| 6 | `maintenance-skip` | 在吗？/嗯。/好的。/哈哈。/晚安。 | 维护子会话 `memory_search`×2，零写入；结束语：材料里没有值得长期保留的内容 | 0 行；`watermark_seq=65` 推进到本次区间 cut | 6/6 |
| 7 | `volatile-observation` | 下午可能下雨…；我有点困…；好像听到楼下动静…；明天再看…；风挺大。 | 维护子会话 `memory_search`×4，零写入；结束语明确把天气/身体/环境/时间限定观察列为不写 | 0 行；`watermark_seq=127` | 5/5 |
| 8 | `passing-preference` | …我一直喜欢不加糖的美式，每天早上都要来一杯，这个习惯很多年了…（夹在寒暄中） | 主会话 `memory_add`（1 次）；维护子会话 5 次检索后判定已存在，不重复 | `#5 用户每天早上都喝一杯不加糖的美式，这个习惯已保持多年，属于长期固定偏好。` 唯一一行、普通层 | 6/6 |
| 9 | `maintenance-no-rewrite` | 还是老样子，早上那杯美式。… | 维护子会话 `memory_search`×4，零写入 | `#5` 仍是同一编号、同一行；没有第二份美式记忆 | 5/5 |
| 10 | `impression` | 无对话提示；Alice 读后写 `ALICE-IMPRESSION-MARKER-7f3a…` | HTTP 读→编辑；Bob 未读先编辑；8001 字符编辑；两个真实对话回合用于读取组装后的系统提示 | 印象行属于 short_id=2；Alice prompt 含标记，Bob prompt 与 admin read 均不含；超长 400 `impression/too-long` 且存储仍是 56 字符原文 | 11/11 |
| 11 | `cross-user-discretion` | Alice 记普通/私密暗号；Bob 做三次检索 | Bob 普通检索：普通暗号命中 `owner_short_id=2`；私密暗号普通层 0；私密层显式检索命中 `owner_short_id=2` | `#6` 普通、`#7` 私密；Bob 的组装 prompt 不含 Alice 印象标记 | 10/10 |

合计：**全量运行 11/11 案例、67/67 项检查通过**；复核后 `invalidate` 单独真实重跑
**7/7**（新增两项），当前 harness 全量应为 **69** 项检查。`results.json` 里保存了每条提示、
主会话与子会话的工具调用/结果、子会话结束语、最终行、维护状态和时间戳，
`invalidate-rerun.json` 保存复核那一次的同样内容，本文只做摘要。

### 跨用户分寸的规范解释

本样本按父规格的明确决定验收：**普通长期记忆是产品全局的，不按用户分区**；规格
Problem Statement 明确写旧 Fairybot 的“按用户分区”不符合本次已确认行为。因此
`cross-user-discretion` 证明的是：

1. 其他用户的**普通**检索可以命中普通记忆，但结果带 `owner_short_id`，Fairy 能判断归属；
2. 其他用户的**普通**检索不会命中私密记忆（本样本 `matched:0`）；
3. 私密记忆只能由显式 `is_private` 的深层检索取得（本样本 `matched:1`），这是有意的动作而不是
   日常上下文泄漏；
4. 印象严格按用户隔离：Bob 的 `/impression/read`、Bob 的组装 prompt、admin 的 read 都不含
   Alice 的标记；Alice 的 prompt 含它。

没有为普通记忆加 per-user 过滤：那会与规格的“按用户分区不符合本次行为”直接冲突。

## 4. 真实模型暴露的质量问题与修复

### 4.1 修复前的真实失败（`before-fix.json`）

第一次真实运行（维护门槛 5/3，真实 MiniMax）在“没什么可记”的区间里得到了不应有的写入：

- `maintenance-skip`（5 个无意义寒暄）：维护子会话写入两条用户画像——
  - `#1` “用户首次交互画像（首次会话）：全程只给零任务信息的极短应答……过早热情地索要任务会被视为无效消耗。”
  - `#2` “用户习惯在深夜说晚安，活跃时段偏夜间……并非‘只会在深夜说晚安’……”
- `volatile-observation`（天气/困倦/楼下动静/不确定）：主会话写入一条由 IP 推断的位置信息
  `#3` “用户所在城市推测为山东济南（依据：会话出口 IP 归属山东移动济南，坐标 36.67N/117.02E）……”；
  维护子会话又写入 `#4`–`#7` 的会话画像、疲劳推断、住宅推断和运行时约束，并编辑了旧行。
- 第一次全量运行的 `supersede`：维护子会话在事实已就地更新后仍新增
  `#4` “用户要求已作废的旧标识信息被彻底删除……”（元记忆）与
  `#5` “用户更换手机号码后，有多处服务/机构的联系方式仍需换绑……”（会话任务状态）。
- 第二次全量运行的 `supersede`：维护子会话新增
  `#4` “用户近期在多个账户和服务处更换了绑定手机号码。”（时间限定观察）。

这些是真实的语义质量问题，不是替身伪影；它们正是规格“质量验证”要抓的“没有值得处理的内容
就结束”和“易变/不确定观察不写成长期事实”。

### 4.2 修复

只在模型自己的接缝上加**分寸指引**，不加语义过滤、不加第二个裁断 agent：

- 有 owner 的 Agent 新增 `ourfairy:memory-policy` 系统提示段：只保存用户明确要求记住的内容，
  或用户自己明确说出的、长期不变的属性/重复习惯/共同经历；不写会话摘要、用户画像、性格推测、
  IP/位置/设备/天气/时间等环境推断、一次情绪/身体感受、Fairy 的回复或工具结果；不写
  「最近/今天/现在/刚才」等时间限定状态、待办、未结项提醒、维护过程、以及对记忆的增删改/切换
  要求本身；没有明确内容就不写。
- `memory_add` 的工具描述同步这些规则（英文），让模型在选择工具时也看到边界。
- 维护子会话的 `ourfairy:memory-maintenance` 段加入同一规则，并明确“材料中的记忆变更已经生效，
  不要重复添加；没有用户明确陈述的值得长期保留的新事实就直接结束；不要为了记录维护结果而写记忆”。
- 维护子会话仍然没有主 prompt 的策略段，只有自己的策略；`tests/memory-policy.test.mjs` 固定
  这两个接缝，并断言子会话仍只有五个记忆工具。
- TDD：先加断言（红）→ 实现 → 新测试 1/1 绿；既有 `memory-crud`、`memory-impression`、
  `memory-maintenance`、`memory-maintenance-recovery` 共 28/28 绿。真实模型在同一组案例上
  重跑，逐轮记录失败并收窄措辞，直到最终 11/11。

修复后，同一批真实案例的维护子会话结束语直接引用了这条规则：

- `maintenance-skip`：“The materials show a light chitchat session. No durable facts about the
  user… Nothing qualifies for long-term memory.”
- `volatile-observation`：“All user messages are time-bound weather/body/event observations and
  a deferral decision. Nothing qualifies.”
- `supersede`：“‘最近换号码的地方挺多的’ — time-bound, skip.” / 零写入。

### 4.3 修复后仍保留的逆风险检查

收紧后必须仍能写入明确要求和稳定偏好；最终运行中：

- `remember-explicit` 仍在同一回合 `memory_add` 并落行 `#1`；
- `passing-preference` 仍由主会话写入 `#5`，且维护子会话没有重复；
- `normal-private-switch` 的显式切换、`invalidate` 的显式删除、`cross-user` 的显式普通/私密
  写入都成功。

## 5. 证据分层：真实模型、模型替身、构建/静态

| 证据类别 | 内容 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| **真实模型质量**（本目录 `results.json`、`invalidate-rerun.json`、`before-fix.json`） | 真实 v1 profile + 真实 MiniMax 的 11 条案例（另加 `invalidate` 的 7/7 真实重跑）、真实维护子会话、真实 HTTP/工具/DB | 明确记忆、偏好、寒暄不写、易变观察不写、事实更新、失效删除且删除后检索不再命中、普通/私密切换、跨用户分寸、维护零写入/不重复、印象读写/注入/超长 | 不覆盖真实长上下文压缩；单次样本，模型可能在其他样本上波动 |
| **模型替身**（`npm test`） | `memory-crud` 11、`memory-impression` 5、`memory-maintenance` 8、`memory-maintenance-recovery` 5、`memory-policy` 1；`gateway-compaction-settings` 2、`gateway-maintenance-settings` 3、`native-compaction` 6 等 | 真实 profile/Loader/产品会话/SQLite 上的确定性行为：门禁、预算、写入上限、材料、恢复、保存不中断维护、设置热生效、原生压缩 | 不证明真实模型的语义质量；替身通过不能替代本目录 |
| **构建/静态/门禁** | `npm run build`、`npm run combo:verify`、Android `test lintDebug`、dsh 的 `compaction-basic` / `gen-config-catalog` vitest、`pnpm run typecheck` 与 `pnpm run check:ci:static` | 版本组合、类型、生成文档、客户端编译/单测/lint、dsh 增量未回归 | 不等于真实模型质量或真机验收；dsh 全量测试与覆盖率分区没有运行（见 §7） |

## 6. 父规格行为与用户故事映射

| 规格范围 | 现在由什么证明 | 证据 |
| --- | --- | --- |
| Problem Statement；故事 1–13 长期记忆与使用边界 | #244 的替身行为测试；#248 真实 `remember-explicit`、`normal-private-switch`、`supersede`、`invalidate`、`passing-preference`、`cross-user-discretion` | [`../244-memory-crud/README.md`](../244-memory-crud/README.md)；本目录 `results.json` |
| 故事 14–21 印象 | #245 的替身测试；#248 真实 `impression`（HTTP 先读后写、超长拒绝、admin 不能读他人、Alice/Bob 组装 prompt 注入隔离） | [`../245-impression/README.md`](../245-impression/README.md)；本目录 `results.json` |
| 故事 22–33 记忆工具 | #244 的门禁、日期、预算、唯一匹配编辑、编号不复用、物理删除测试；复核新增“8000 字符检索预算同时是写入上限”，保证每个可存的行都能被检索到、从而可改可删可切换；#248 真实工具调用 | [`../244-memory-crud/README.md`](../244-memory-crud/README.md)；本目录 `results.json` 与 `invalidate-rerun.json` |
| 故事 34–48 单会话增量维护 | #246 的 15 回合、静默、封口、材料、并行、失败恢复、重启重算；#247 的 5–50/3–24 设置与热生效；#248 真实 5 回合区间维护、零写入推进、不重复写入、子会话真实 MiniMax；复核新增“保存设置时子会话在跑也不中断、仍推进水位”的替身用例 | [`../246-session-memory-maintenance/README.md`](../246-session-memory-maintenance/README.md)、[`../247-maintenance-settings/README.md`](../247-maintenance-settings/README.md)；本目录 `results.json` 与 `tests/memory-maintenance.test.mjs` |
| 故事 49–60 设置与客户端 | #243 压缩阈值、#247 维护设置的替身/客户端测试；#248 真实 `/gateway/maintenance` 保存 5/3 并读回；Android 本轮全量 `test lintDebug` | [`../243-compaction-settings/README.md`](../243-compaction-settings/README.md)、[`../247-maintenance-settings/README.md`](../247-maintenance-settings/README.md)；本目录门禁 |
| 故事 61–65 上下文压缩与恢复 | #241 dsh `compaction-basic` 的绝对阈值/volatile/最小值和 #242 的真实 profile + Loader + 模型替身（阈值压缩、裁剪、offload、溢出、冷恢复、摘要不写记忆）；100000–900000 的范围只由网关校验（§6 的有意偏差，见 §9）；dsh 本轮 vitest、`typecheck` 与 `check:ci:static` | [`../241-absolute-compaction-threshold/README.md`](../241-absolute-compaction-threshold/README.md)、[`../242-native-auto-compaction/README.md`](../242-native-auto-compaction/README.md)；本目录门禁 |
| 票面“真实模型只使用 MiniMax” | 真实 harness 的 `model` 字段、每个主/子会话 `request/header`、拒绝回环 base URL | 本目录 `results.json` 与 `invalidate-rerun.json` 的 `model` 与各案例 evidence |
| 票面“质量证据与替身/构建分开、未执行项保留” | 本文第 5、8 节 | 本目录 |

## 7. 最终门禁（在最终集成状态实际运行）

<!-- gates:start -->
| 命令 | 工作目录 | 实际结果 |
| --- | --- | --- |
| `npm test` | `.worktrees/fix-240-review`（复核轮） | `tests 381` / `suites 7` / `pass 381` / `fail 0`（77088ms，pre-commit 钩子在同一棵树上运行）。#248 原收口时为 `379/379`（79213ms；docs 提交后 74049ms）；复核新增两个用例（维护保存不中断、持久越界值在加载时失败）故为 381。复核轮 `memory-impression` 单文件连续 5 次均 5/5，并在本次全量并行运行中通过，未再出现 `alice-note-two` 的陈旧标记偶发。包含本文件的 docs 提交之后、对同一产品代码再跑仍 `381/381`；docs 本身只改证据文字 |
| `npm run combo:verify` | 同上 | 复核轮提交前 actual `a92edfa772`（与集成 tip 同提交）三行均 ok：`ourfairy ok (worktree is based on the integration tip)`、`dsh ok`（`d80522d276dd5a83`）、`android source ok`（`460109d1b89b824a`）、`combo: combination verified`；docs 提交后在其 HEAD 上再跑，三行仍 ok（actual 为当时 HEAD） |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | `.worktrees/fix-240-review/android` | 复核轮 `BUILD SUCCESSFUL in 3m 50s`，134 tasks；JUnit 合计 `387` tests / `0` failures / `0` errors / `0` skipped；lint：app `0 errors / 31 warnings`（其中 1 条为既有 `impression_counter` 的 PluralsCandidate），highlight 无，ui `0 errors / 0 warnings / 1 hint`；与原票收口一致。docs 提交后在最终 HEAD 复跑 `BUILD SUCCESSFUL`（增量 2s，127 tasks up-to-date；产品代码与 android/ 未变） |
| `corepack pnpm@11.28.5 exec vitest run packages/compaction/compaction-basic` | `/home/eafen405/projects/deepseek-harness`（`d80522d276`，只读） | `Test Files 5 passed (5)`；`Tests 158 passed (158)`（复核轮重跑，结果相同） |
| `corepack pnpm@11.28.5 exec vitest run scripts/gen-config-catalog.spec.ts` | 同上 | `Test Files 1 passed (1)`；`Tests 15 passed (15)`（复核轮重跑，结果相同） |
| `corepack pnpm@11.28.5 run typecheck` | 同上 | `run-gates: 5 passed, 0 failed, 0 skipped in 10.56s`：host compiler、Host Typert、client compiler、host aggregate check、client aggregate check 五个门全过 |
| `corepack pnpm@11.28.5 run check:ci:static` | 同上 | `run-gates: 59 passed, 5 failed, 0 skipped in 166.40s`；5 个失败均为该 dsh fork 的既有漂移，与本规格改动无关（逐条见下） |

`check:ci:static` 的 5 个既有失败（复核轮实际输出）：

1. `verify-no-unknown-casts`：陈旧基线 5 条，位于
   `packages/client/connection/tests/principal-admission.host.spec.ts:85`、
   `packages/jobs/tool-jobs/tests/tool-jobs.spec.ts:85` 与 `:731`、
   `packages/session/session-format-v1-to-v2/tests/codec.spec.ts:149`、
   `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts:2630`；
2. `verify-doc-graphs`：`docs/event-producer-consumer.md` 与 `.zh.md` 的生成图陈旧；
3. `verify-type-equiv`：fork 的 `delivery/message` 与 durable `owner` 字段造成的既有漂移——
   `docs/subsystems/session.md`（`SessionEventMap`、`SurfaceEventType`、`SurfaceIntent`）、
   `docs/subsystems/llm-streaming.md`（`MessageSourceMap`）、
   `docs/subsystems/persistence.md`（`SessionHeader`、`CreateSessionOptions`）；
4. `verify-persistence-formats`：`docs/persistence-changes/historical-formats/README.{md,zh.md,i18n.yaml}`
   的格式事实陈旧；
5. `verify-repository-references`：`python/sdk/uv.lock:113` 仍引用 commit hash。

**dsh 全量测试套件（`check:ci:unit`）与覆盖率分区（`check:ci:coverage`）没有运行**；本规格只跑了
上面两条 vitest、`typecheck` 与 `check:ci:static`。不要把 static 的 59/64 或两条 vitest 说成
dsh 全量通过。

`npm test` 与 `combo:verify` 在 docs 提交前、以最终产品代码运行；docs 提交只改 Markdown、证据 JSON
与索引，不触碰产品代码。`combo:verify` 的 `ourfairy` 实际行在每条提交后随 HEAD 变化，但仍是
“基于集成 tip”，组合校验行本身与 dsh/android 锁定值不变。Android 与 dsh 结果对应最终产品代码
（docs 提交未改 `android/` 或 dsh）。
<!-- gates:end -->

## 8. 未执行项（不升级为通过）

1. **真实 500K 自动压缩 / 16K 保留 / 原生裁剪 / 图片 offload / 溢出与冷恢复**：没有用真实
   MiniMax 造 500K token 上下文；这些行为由 #242 的真实 profile + Loader + 模型替身证明，
   本票只复核 dsh 的 `compaction-basic` 与配置目录门禁。真实长上下文压缩质量未验收。
2. **真实 Android 设备/模拟器**：本轮只有 `./gradlew test lintDebug`（Robolectric/Compose），
   没有真机截图、触感、软键盘或无障碍检查。
3. **默认 15 回合 / 6 小时的真实维护节奏**：本样本用真实网关保存 5/3，未用真实模型等 15 回合
   或 6 小时；默认值与范围由 #247 的替身/设置测试固定。真实网关保存与读回本身已在本轮执行。
4. **真实 Fairy 工具 `impression_edit` 的先读后写**：真实样本覆盖了 HTTP 先读后写与注入；
   工具门禁由 #245 的替身测试固定，本轮没有让真实模型直接编辑印象。
5. **真实维护失败/恢复与真实并行**：由 #246 的模型替身用例覆盖；真实样本只观察到成功完成、
   零写入完成与真实子会话。
6. **真实跨用户私密深层检索的访问控制裁决**：本样本记录到 Bob 显式深层检索能命中 Alice 的
   私密记忆（`matched:1`，`owner_short_id=2`）。这是规格的“层”语义与有意动作；如果产品要求
   绝对 per-user 隔离，需要新的规格决定，不能由 #248 静默加上。
7. **真实维护子会话系统提示里 DSH 自身的 runtime/harness 指令**：仍会出现（#246 已记录的
   已知风险）；本票没有改 dsh 来关闭它。策略在该提示之后仍生效，但这是残余风险。
8. **dsh 全量测试与覆盖率分区**：本规格只运行 `compaction-basic`、`gen-config-catalog`、
   `typecheck` 与 `check:ci:static`；`check:ci:unit` 与 `check:ci:coverage` 没有运行，
   `check:ci:static` 的 59/64 也不等于完整 CI（见 §7）。

## 9. 残余风险与诚实结论

- **提示是引导，不是语义过滤器。** 最终 11/11 是一次真实样本；修复前的样本已证明模型会写出
  画像、会话摘要、位置推断和时间限定观察。换一种问法或模型版本仍可能写出噪声；本票没有加
  “第二个裁断 agent”或硬编码关键词过滤，符合规格。重复运行应重新看 `acceptance:memory` 的
  逐条结果，而不是把本次通过当成永久保证。
- **修复前/后的措辞经过多轮真实运行收窄。** `before-fix.json` 保留了三类失败（画像/环境推断、
  元记忆+会话状态、时间限定观察）；最终 `results.json` 是同一组案例在固定提交上的通过记录。
- **维护子会话仍收到 DSH harness 指令。** 这些指令不包含源会话的 persona/身份/印象，但也不是
  维护策略的一部分；若未来要求子会话只有维护提示，需要 dsh 的原生接缝。
- **压缩范围只有网关一处校验，这是规格 §6 的有意偏差。** 规格写「后端与各自拥有者的 schema
  都校验范围」；维护两项成立（`memory` 行 Config 的 5–50 / 3–24，越界持久值在加载时被 Loader
  拒绝，见 `tests/memory-maintenance-recovery.test.mjs`），但 `compaction-basic` 归 dsh 所有，
  schema 只约束正整数，100000–900000 只在 `/gateway/compaction` 校验。没有改 dsh 的通用
  schema；绕过网关直接改 profile 用户层仍会被原生 schema 接受。决定记录在
  [`../243-compaction-settings/README.md`](../243-compaction-settings/README.md)、
  `backend/v1-bundle/cordis.patch.yml` 的压缩配置注释与本目录。
- **维护设置保存不中断维护子会话已由确定性用例固定。** §6 的“保存后不主动中断维护子会话”
  由 `tests/memory-maintenance.test.mjs` 的新增用例覆盖：子会话请求被挂起时通过真实
  `/gateway/maintenance` 保存新值，子会话完成后仍把水位推进到冻结 cut，且没有第二个子会话；
  这是模型替身证据，不是真实模型证据。
- **跨用户分寸按规格是层隔离，不是按用户分区。** 普通记忆产品全局共享；私密记忆只能显式深层
  检索；印象严格按用户。证据见第 3 节与 `results.json`。
- **harness 的日志读取。** 子会话证据通过读取 dsh 的 `session.v4.jsonl.zstd` 取得；脚本实现了
  与 dsh 相同的拼接 zstd 帧扫描。如果 dsh 改日志容器，脚本会失败或读不到子会话，而不是静默
  判过；本票没有把这个读取器放进产品代码。
- **真实模型报告含用户对话正文。** 报告写进操作者隔离 home 与证据目录；不含 API key、密码或
  凭据文件内容。密钥只从环境读取，脚本从不打印。

## 10. 复现与提交

- 原票分支：`ticket/248-memory-acceptance`；基线 `1ecbfa661d`（`integration/spec-240`）。
- 实现提交：`63aa66fcf7`（harness + `acceptance:memory`）；测试/修复提交：`4817b4705b`
  （策略 + `memory-policy` 测试）；原 ticket 的 docs 提交为 `57a4801f79`。
- **#240 收口复核轮**：worktree `.worktrees/fix-240-review`，分支 `fix/240-review`，基线
  `a92edfa772`（`integration/spec-240` 的 tip）。代码/测试提交 `2b3608d71b`；本证据与索引由
  紧随其后的 docs 提交写入（本文件不写自身提交号）。复核没有改写 `results.json` 的历史全量记录，
  而是新增 `invalidate-rerun.json` 并记录本轮门禁。
- 复跑真实样本（全量或单例）：

  ```sh
  set -a; . /home/eafen405/projects/MINIMAX_API_KEY.env; set +a
  export MINIMAX_CN_API_KEY="$MINIMAX_API_KEY"
  npm run build
  npm run acceptance:memory -- --home /tmp/ourfairy-248-replay
  npm run acceptance:memory -- --only invalidate \
    --out work/implementation/evidence/248-memory-integration-acceptance/invalidate-rerun.json
  ```

  报告在 `--home` 下；逐条结果与本次 `results.json` 对比。`--plan` 可以在不读凭据的情况下
  预览 11 条案例。
