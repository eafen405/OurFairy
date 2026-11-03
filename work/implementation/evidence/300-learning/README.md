# #300 — 后台工作流学习：检测、复用信号与跨会话创建

Ticket: [#300](https://github.com/eafen405/OurFairy/issues/300)，spec [#295](../../../../docs/specs/fairy-skills.md)。
分支 `ticket/300-learning`，worktree `.worktrees/300-learning`，起点
`integration/spec-295` tip `a6f3a63289`（含 #296/#297/#299）；交付前已合入
`integration/spec-295` tip `545fef5b63`（含 #298），冲突在 `creation.ts`、`index.ts`、
`cordis.patch.yml` 三处，按两侧语义合并。

## 改了什么

### Schema v2（`backend/skill-creator/src/store.ts`）

- `SKILL_SCHEMA_VERSION` 1 → 2。真实迁移步骤：读到 v1 文件时执行 `SCHEMA_V2` 再写版本号；
  新文件直接建 v1+v2；v1 表不改一列。`tests/skill-learning-store.test.mjs` 用原始 SQL 造 v1
  文件（identity/version/preference 各一行）再打开，断言 v2 版本号、三张新表出现、v1 行完全
  保留、重复打开幂等。
- `skill_learning_state`：每源会话一行，watermark、冻结 cut、检测子会话、status 0/1/2、
  retry_at、updated_at、deleted_at。
- `skill_reuse_signal`：owner、规范任务键、源会话、证据区间、status 0 success/1 failure/
  2 uncertain/3 revoked、`revokes_signal_id`、judged_at、processing、creation_job_id、
  时间戳与逻辑删除。撤销是新行；原行的 status 与证据区间从不改写。
- `skill_creation_job`：owner+任务键唯一认领，state 0 pending/1 running/2 candidate/
  3 no_improvement/4 failed，`signals` JSON、through_signal_id、child_session、
  candidate_version_id、attempts、next_retry_at。部分唯一索引
  `(owner, task_key) WHERE state IN (0,1,4)` 是数据库侧第二道保证。
- Store 方法：检测状态 `learning/observe/claim/complete/fail/reset`；信号
  `insertSignals/validSuccessSignals/revocableSignals/taskKeys/creationCandidates`；
  认领 `claimCreationJob/activeCreationJob/lastCompletedCreationJob/resume/fail/complete/
  setCreationChild/setCreationCandidate`。

### 材料投影（`src/material.ts`，纯函数）

`(watermark, cut]` 的用户消息、Fairy 回复、附件名称、工具调用（参数有界；`content`/
`new_string` 等文件正文只留长度）、有界结果、文件变更摘要。逐行限长 + 总长
`learningMaxMaterialChars`；超界时保留头尾并显式标注省略行数。附件正文、系统提示、印象、
压缩摘要和环境快照都不进入材料。检测和创建子会话共用同一个投影。

### 检测引擎（`src/learning.ts`）

- 1s tick，逐源会话；只有用户自己的会话是源（owner、无 parentSession、无 agentPreset）。
- 阈值 `learningTurns`（默认 5）按 watermark 之后的闭合用户回合计数；静默 = 无 live agent
  或 `idle`；claim 在 `BEGIN IMMEDIATE` 内冻结 cut，后续消息属于下一区间。
- 检测子会话：`meta {parentSession, origin:'subagent', agentPreset:'ourfairy:skill-learning'}`，
  **header 无 owner**（owner 从源会话取、经 setup 闭包传入）；setup 先
  `tools.restrict({ allow: [] })`，再只注册 `submit_signals` 与检测提示；走
  `learningModel/learningProvider` 轻量路由；材料是它唯一的 user message。
- 完成只看持久日志：本 run 最后 `turn/end` 为 `completed` 且恰好一次成功的
  `submit_signals`。提交在引擎里重新校验后才落库；零信号完成也推进 watermark；其余结局保持
  watermark 并恢复同一子会话。`learningMaxTurns` 限制连续失败次数，用尽后释放区间供后续
  重新认领（水位仍不前进）。
- 提示携带该 owner 最多 30 个既有任务键；任务键语法 `<task-type>:<artifact>`，两段
  kebab-case、总长 ≤ 64，store 再次校验。
- 模糊但值得保留的信号（status 2）由一个独立轻量子会话审查，同一材料 + `submit_review`
  返回 success/failure/uncertain；uncertain 不触发自动创建。
- 晚到纠正：后续区间可提交 `status 3` + `revokesSignalId`（只能引用本会话列出的有效成功）。
  引擎插入新行，有效成功 = status 0 且无后续撤销。

### 跨会话创建（`src/deep-creation.ts`）

- 同一 owner+任务键至少两个不同源会话的有效成功、无活动/待重试认领、存在比上次完成认领
  `through_signal_id` 更新的信号；`claimCreationJob` 在同一事务内重读这些事实并落认领。
- 创建前再读认领信号：晚到撤销会剔除证据；不足两个会话则 no_improvement 空完成，不碰任何
  检测水位。
- 创建子会话：header 无 owner，`parentSession` = 最新贡献源会话，同一 preset，工具恰好
  `read_evidence/submit_candidate/run_verification/finish_no_improvement`；使用触发源会话的
  “深度”模型路由（冷源回退部署默认）；复用 `bundledSkillsDir` 里的 Skill Creator 正文与
  既有候选/当前技能去重列表。
- `submit_candidate` 走既有候选路径（`source_type: 2`、background provenance、延迟验证），
  `run_verification` 在既有一次性 bwrap 环境执行记录的场景，系统写入报告；没有系统验证
  报告的候选不算完成。
- 结局 candidate / no_improvement / failed。失败只重试认领，不回滚检测水位；重启从三张表
  重建两个引擎并恢复持久子会话。

### 接线与配置

- `src/index.ts` 构造 `LearningEngine` + `SkillCreationEngine`，关闭顺序先引擎后 store；
  `inject` 增加 `sessionPersistence`；每用户会话 `learning.watch(agent)`。
- `cordis.patch.yml` 把 `learningTurns/learningModel/learningProvider/
  learningMaxMaterialChars/learningMaxTurns` 从环境变量接入（默认 5 / `MiniMax-M3.1-Flash` /
  `minimax-cn` / 12000 / 4）。
- `tests/helpers/backend.mjs` 的 `launchEnv` 默认置 `OURFAIRY_SKILL_LEARNING_TURNS=50`：与
  learning 无关的确定性套件不因 5 回合阈值而额外调用模型替身；学习套件自己传 1。
- `src/creation.ts` 增加 background provenance、`deferVerification` 与
  `verifyBackground`（只允许候选 owner、只对带 background provenance 的 pending 版本执行）。
- `src/service.ts` 增加 `bundledSkillsDir` getter 供创建提示读取内置 Skill Creator。

### 客户端

- #298 已合入的 `SkillsReviewNotifier`/`SkillsReviewLedger` 就是“既有通知面”：pending 集合
  含后台候选，按 version id 记住并合并成一条提醒。
  `android/app/src/test/java/me/rerere/rikkahub/data/remote/SkillsReviewNotifierTest.kt`
  新增用例：空 pending 不发布；后台候选（`sourceType = 2`）出现时恰好一条合并提醒；同一集合
  再次观察不再发布；ledger 记录该候选。未新增后端 push/通知表。

### 真实模型验收

`scripts/skill-acceptance.ts` + `npm run acceptance:skill`：

- `--plan` 无凭据可运行（exit 0），列出 8 个样本与要求。
- 启动真实后端、检查 gateway 路由为 `minimax-cn / MiniMax-M3.1-Flash` 且 base URL 为真实
  https 非 loopback；显式 loopback `OURFAIRY_MINIMAX_BASE_URL` 在任何 case 前拒绝。
- 从持久会话日志统计轻量调用（`ourfairy-skill-learning-*` / `ourfairy-skill-review-*`）与
  深度调用（`ourfairy-skill-creation-*`）次数及 token 用量，逐 case 与总计入报告。
- 样本：无意义对话、一次成功、两个独立会话、晚到纠正、既有证据去重、显式创建、共有提案、
  地址安装（未传 `--address` 时该 case 记为 unexecuted，绝不记为 pass）。

### 跨模块必要调整

- `backend/memory/src/index.ts`：memory 工具此前对**每个** Agent 注册（含其他 row 的子会话）。
  为满足本票“检测子会话只有自己的结构化工具”，改为只对用户会话或 memory 自己的维护子会话
  注册。memory 自己的维护子会话仍得到五个记忆工具（既有测试固定）；学习子会话不再得到它们。
  `tests/skill-learning.test.mjs` 断言检测子会话工具集恰为 `submit_signals`。

## 命令与结果（模型替身 + 真 SQLite/真启动器）

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 通过（多次，含合并后） |
| `node --test tests/skill-learning.test.mjs` | 15/15 通过（检测阈值/静默/cut/零信号/恢复、任务键、审查、失败证据、两会话阈值、并发认领、去重、晚到纠正、跨用户、重启恢复、端到端候选） |
| `node --test tests/skill-learning-store.test.mjs` | 7/7 通过（v1→v2 阶梯、撤销不可改写、认领原子/唯一、through 门禁、任务键、检测状态、认领后重检） |
| `node --test tests/skill-learning-material.test.mjs` | 4/4 通过（材料内容/排除项/总长界限/闭合回合） |
| 13 个既有 skill 套件（creation/evolution/sharing/install/runtime/verify/package/store） | 109/109 通过（合并后） |
| memory 维护/CRUD/设置 + route inventory + identity-http + model-double + agent-capabilities | 48/48 通过 |
| `npm test`（全量，最终树） | 595 个测试，595 通过，0 失败（exit 0，duration 202.8s） |
| `npm run combo:verify` | `combo: combination verified`（ourfairy 基于集成 tip、dsh 锁定提交一致、Android 声明一致） |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | 见下方“最终门禁” |
| `npm run acceptance:skill -- --plan` | exit 0，未读凭据、未启动后端、未写文件 |
| `MINIMAX_CN_API_KEY=fake OURFAIRY_MINIMAX_BASE_URL=http://127.0.0.1:9 npm run acceptance:skill -- --only meaningless` | exit 1，`this acceptance refuses a loopback model double` |
| 无凭据 `npm run acceptance:skill` | exit 1，明确要求 `MINIMAX_CN_API_KEY` / `MINIMAX_API_KEY` |

## 真实模型验收状态

**未执行（not executed）**：本环境没有可用的 `MINIMAX_CN_API_KEY`（也未提供
`MINIMAX_API_KEY`），也没有 MiniMax 网络凭据。`--plan` 已实际运行并通过；loopback 拒绝与
缺凭据拒绝已实际验证。真实运行需要：

```
set -a; . /home/eafen405/projects/MINIMAX_API_KEY.env; set +a
export MINIMAX_CN_API_KEY="$MINIMAX_API_KEY"
npm run acceptance:skill -- --address <技能包地址>
```

报告会记录每个样本的轻量/深度模型调用次数、输入/输出 token、实际结果与未执行项；本次没有
把未执行升级为通过。

## 未完成项 / 风险

- 真实模型验收未执行（原因同上）；这是本票唯一未完成的验收面。确定性替身测试不替代它。
- 地址安装样本需要 `--address`；未传时按 unexecuted 记录。共有提案、显式创建、去重三个样本
  依赖真实模型按提示调用 `skill_manage`，报告按实际行为判分，不视为确定性保证。
- 创建子会话使用触发源会话的模型路由；源会话已冷时回退部署默认路由。这一选择记录在
  `deep-creation.ts` 注释与本 README，尚未由真实模型验收覆盖不同路由的对比。
- `learningMaxTurns` 的连续失败上限只在进程内计数；重启后重置。检测失败仍保持水位并恢复
  同一子会话，预算只用于避免同一区间无限重放。
- 审查子会话失败按检测失败处理（保持水位、恢复检测子会话）；审查结果为 uncertain 时信号
  以 uncertain 落库且不触发创建。
- 关停顺序上学习引擎先于 store 关闭；若进程被强杀，区间停留在 running，重启时由持久状态
  恢复（测试覆盖 stop/start）。
- 合并 #298 后 `create` 同时支持 files/fetched package/background，三个入口共用同一候选与
  验证路径；background 与 install 互斥（install 要求 install source，background 由认领
  生成）。

## 最终门禁

最终树 = `ticket/300-learning` 合并 `integration/spec-295` tip `545fef5b63` 后，再含本票提交。

- `npm run build`：通过。
- `npm test`：595/595 通过（exit 0，duration 202.8s）。
- `npm run combo:verify`：`combo: combination verified`。
- `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug`：`BUILD
  SUCCESSFUL in 7m 23s`（134 个任务：60 executed / 74 up-to-date；`:app:testDebugUnitTest`
  与 `:app/:highlight/:ui:lintDebug` 全部通过，exit 0）。新增的
  `SkillsReviewNotifierTest` 后台候选用例在 `:app:testDebugUnitTest` 结果 XML 中。
- 收口前的聚焦门禁：学习三套件 26/26；13 个 skill 套件 109/109；memory/route/identity 等
  8 个受影响套件 48/48；Android `SkillsReviewNotifierTest` 7 个用例通过（含本票新增）。

### 说明：一次全量套件的偶发失败

全量套件第一次（594 个测试）出现 1 个失败：`tests/skill-creation.test.mjs` 的“最后一条
模型请求”断言被执行较晚的 memory 维护子会话请求插入。该套件不测维护，已把
`OURFAIRY_MEMORY_MAINTENANCE_TURNS` 设为 50（与 `launchEnv` 对学习阈值的 50 同一理由），
之后全量 594/594、595/595 连续通过。失败是测试读取“全局最后请求”的脆弱断言，不是产品行为
回归；学习/维护子会话本身均由各自测试覆盖。

## Review fixes (spec #295)

The review moved the duplicated learning-child setup, `successfulCalls`/`turnCompleted` and the
active/running/retry bookkeeping into `src/learning-child.ts`, dropped the dead `deleted_at` from
`skill_learning_state` (it follows `maintenance_state`), added the same
`OURFAIRY_MEMORY_MAINTENANCE_TURNS` guard to the other skill suites, and required revision evidence
in the background `submit_candidate` contract. See the
[spec review-fix evidence](../295-review/README.md).
