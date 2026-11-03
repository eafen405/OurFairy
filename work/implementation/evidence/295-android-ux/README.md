# #295 Android 修复与体验优化（E1–E4 + E7）

2026-11-03。spec #295「Fairy Skill 系统与工作流学习」Android 客户端修复轮。

- 分支：`fix/295-android-ux`，基线 `origin/fix/295-adversarial-review`（`ac93251`，后端修复轮已推送并门禁全绿）。
- 范围与方向由用户在本轮开工前拍板（不重新讨论产品方向）：
  - 分支基线基于已推送的后端修复轮分支（审核展示/待审入口/批准交互依赖其新行为）。
  - 本轮范围：P1（E1 待审入口、E2 后台候选提醒、E3 审核展示、E4 技能面板）+ 低风险 P2 的 E7（错误码本地化 + 真实后端 envelope golden 契约测试）。
  - 通知门控：技能提醒与「后台接收」开关解耦，技能通知渠道可用性作为唯一通知门（仍保持"不骚扰"）。
  - 不做：E5（聊天页固定话术按钮）、E6（拒绝原因展示）、后端语义改动、Fairy 自禁用、默认关网、重构整个 skills 页设计系统。

直接输入：`work/implementation/evidence/295-adversarial-review/README.md` §2.E（E1–E7）与 `/tmp/handoff-20261103-android-fixes.md` §5；规格 `docs/specs/fairy-skills.md` §5；ADR-0004；后端展示权威 `backend/skill-creator/src/creation.ts` 的 `buildReviewDisplay`。

## 改动

### A. 技能面板（E4）与错误态/契约（E7）——`android-panel`

- `ui/identity/SkillsPage.kt`：
  - 选择池按后端派生 `state` 分组为四个可折叠组：进入目录（默认展开）、被遮蔽、已禁用、已归档（后三者默认折叠并显示后端计数）；未知 `state` 进入「未知状态」折叠桶，不静默丢行。组内保留原有全部后端事实与动作（启停开关、归档/恢复及作用域、scope、遮蔽说明、待审修订 chip）。
  - 行内 `description` 取首句（≤96 字符，超出加省略号），不再把完整（≤500 字符）描述铺开。
  - 本地名称搜索：大小写不敏感、`trim`、只过滤已读列表、不发网络请求；命中折叠组也会展示；无匹配显示本地化文案。
  - 页面头部显示后端 `/skills/list` 的 `pendingCount`（不在客户端由 pending 列表推导）。
  - 失败横幅：只映射真能到达该页面的 7 个已枚举 code（`skills/unauthorized`、`forbidden`、`not-found`、`archived`、`not-pending`、`invalid-request`、`internal`），改成 `stringResource`；未知 code 保留 `code: message` 原文兜底；`skills/integrity` 经审计确认到不了该横幅（只由 `service.versionDirectory` 抛出，`#description` 内部 catch），不建死映射。
  - 本轮不接 `/skills/detail`（`SkillsApi.detail` 保持无调用方；接口保留），记录为已知限制。
- `ui/fairy/FairySettingsPage.kt`：设置页打开且已登录时读取一次 `pendingCount`（token 变化才重读、未登录不请求），技能组**折叠态**即在组头显示「待审 N」徽标；去掉了展开内容里重复的 chip，更新过时注释。
- `res/values/strings_identity.xml`、`res/values-zh/strings_identity.xml`：新增搜索/错误码本地化文案；en/zh key 集合保持一致。

### B. 审核展示（E3）与激活行/审核展示验证（E1）——`android-review`

- `ui/identity/RemoteTranscript.kt` 的 `SkillReviewPanel`：由整段单个 `Text` 原文渲染改为按后端 `buildReviewDisplay` 的固定行前缀分区渲染，文本逐字保留、不重算任何字段：
  - 变更 / 来源 / 适用与收益（标注「候选自述」，可选中、次要色）/ 验证（`包内容`、`验证`摘要常显；`✔`/`↺`/`✘` 命令、比较、环境折叠为「验证详情」；**阻断性 `⚠` 警告常显**并以 warning/error 色呈现，必须不展开就能看到「不能用于批准」）/ 审核方式 / 详情（版本、64 位 hash、`skill_manage inspect` 语法默认折叠）/ 其他（未识别行原样兜底，后端新增前缀或截断半行不丢文本、不崩）。
  - 验证命令/场景来自候选，新增常显注记「以下命令与场景由候选提供。」。
  - 新分区文案全部走 `stringResource`（13 个 `skills_review_*` key，en/zh 集合一致）。
- E1（后端已修，`/skills/review-open` 现在真正投递引用并触发一次审核回合）：客户端保持「点待审 → 调 `/skills/review-open` → 打开后端返回的 primary session」；kind 1 激活行继续渲染 `加载了skill:<name>`（精确断言），kind 2 审核展示分区呈现。未新增聊天页审批按钮（E5 不在本轮）。

### C. 后台候选提醒（E2）——`android-notify`

- 通知发布门从「后台接收」开关（`AndroidRemoteNotifications.enabled`，默认 false）解耦为**技能通知渠道可用性**：`AndroidRemoteNotifications.skillsNotificationsAllowed()` 公开为唯一门；`di/IdentityModule.kt` 注入改为该方法；`SkillsReviewNotifier` 参数 `notificationsEnabled` → `remindersAllowed`（gate 仍在 ledger 记账之后，行为不变）。聊天通知门未动。
- 保持反骚扰语义不变：ledger 先记账后发布（抑制不补发）、前台抑制、每账号一条合并提醒（同 tag 替换）、同集合不重复、personal 仅后台创建（`sourceType == 2`）、common 仅可决策者（`nextActions` 非空）、`reviewResults` 仅 proposer 终态。
- 测试：`RemoteReceiveControllerTest` 新增 controller→notifier 真接线用例（接收开关 OFF 时 `onStop` 发布一条合并提醒、同集合不重复；渠道不可用时不发布且账本已消费、恢复不补发、之后新集合正常发布）；新增 `RemoteReceiveControllerSkillsTest`（真实 Koin `identityModule` + 真实 `AndroidRemoteNotifications` 的 Robolectric 生产组合，能捕获「DI 又改回 `enabled.value`」）；`SkillsReviewNotifierTest` 适配并强化渠道门语义。
- 已知边界：项目无 push 通道；技能观测发生在 `RemoteReceiveController` 的 onStart/onStop/身份变化，以及 `RemoteReceiveService` 的 60s 轮询（轮询随后台接收服务运行）。「后台接收」关闭时，App 切后台的 `onStop` 会发布已观测候选；App 持续后台期间新到候选没有观测点，回前台时按既有反骚扰语义被前台抑制消费，改由 in-app `pendingCount`（技能页头部/设置组头徽标）承载。详见「已知限制」。

### D. Lead 收口修复（两轴 code-review 后）

- Standards 轴：审核面板 11 处用户可见文案 + 2 处 `contentDescription` 改为 `stringResource`（13 个 `skills_review_*` key，en/zh 同步）；技能池行渲染抽 `SkillRows` 复用（搜索分支与组内容不再重复 `forEachIndexed + divider`）；`skillDescriptionExcerpt` 删掉从未变化的 `limit` 参数；组头视觉向 Fairy tokens 靠拢；精简重复的「技能渠道唯一门」KDoc。
- Spec 轴：
  - E7：删除 `skills/integrity` 死映射与对应字符串（审计结论见上）。
  - E3：后端 `buildReviewDisplay` 增加 `singleLine()`，把候选/模型可控文本（技能名、来源 address/固定版本/摘要、适用/不适用/目标收益、验证 executed/reused/failed 的 name+command、比较名）中的 `\r\n`/`\n`/`\r`/U+2028/U+2029 规范为行内空格，防止候选文本用换行伪造 `来源：`/`⚠`/`审核方式：` 等固定前缀行（社会工程面）；字段值、批准判断、状态机、`boundDisplay` 截断均未变。后端测试新增注入用例（全字段伪造前缀；复用报告下伪造警告不复制真实警告）并重跑关联回归。
  - E1：用后端 `tests/skill-review-entry.test.mjs`（3/3）与全量 `npm test` 验证后端触发回合；客户端行为以契约/Robolectric 测试覆盖；无设备，真实后端组合 E2E 未执行（见未完成项）。

## 验证（最终工作树，2026-11-03）

所有命令在 `/home/fatfish/OurFairy/.worktrees/295-android-ux`；后端类命令均 `export OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`（dsh 锁定提交 `d80522d2`，四条 requiredBuild 已完成，未重建）。

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Android 全量 | `/tmp/ourfairy-295-android-gate.sh test lintDebug`（即 `cd android && ./gradlew test lintDebug`） | **BUILD SUCCESSFUL in 4m 33s**；696 tests / 0 failure / 0 error（app 624、highlight 52、ui 20）；lint 0 error（app/ui/highlight 三模块 `severity="Error"` 均为 0） |
| 后端全量 | `npm test`（pretest 重新 build） | **652/652，44 suites，0 fail，exit 0**（修复轮基线 650；本轮新增 display 注入 2 个测试） |
| 版本组合 | `npm run combo:verify` | `combo: combination verified`（ourfairy 基于 main tip；dsh d80522d2；android source 声明匹配） |
| E1 后端入口 | `node --test tests/skill-review-entry.test.mjs` | **3/3 pass**（投递引用并触发真实审核回合；重复/并发打开不叠加；被拒/失败不写引用不起回合） |
| E3 display 注入 | `node --test tests/skill-evolution-display.test.mjs` | **11/11 pass**（含 2 个新增注入用例）；关联回归 `skill-creation`/`skill-evolution`/`skill-install-product`/`skill-sharing` **57/57 pass** |
| 证据索引 | `node scripts/evidence-index.ts --check` | `evidence index is current` |
| 空白/冲突 | `git diff --check` | 无输出 |

各工作包自测（在最终工作树、共享 flock 串行门禁内，定向执行）：

- `android-panel`：`SkillsPageTest` / `FairyPagesTest` / `SkillsApiTest` / `SkillsStateTest` → **98 tests / 0 failure**（14/67/8/9）；测试 `settle()` 在 Robolectric 暂停时钟下等待注入点击的下一帧。
- `android-review`：`RemoteTranscriptSkillActivationTest` / `RemoteTranscriptSkillReviewTest` / `SkillReviewDisplayParsingTest` / `RemoteTranscriptCopyTest` / `RemoteTranscriptViewportTest` / `RemoteTranscriptToolCallTest` → **34 tests / 0 failure**（3/7/7/7/2/8）。
- `android-notify`：`SkillsReviewNotifierTest` / `RemoteReceiveControllerTest` / `RemoteReceiveControllerSkillsTest` → **8/8/1，0 failure**；另有 `NotificationColdStartTest` smoke 绿（真实 Koin 图 + 新 notifier 注入可启动）。
- Red→green 证据：notify 侧先把接线测试按旧生产接线（gate=`Platform.enabled.value`）运行得 2 failed，切到渠道门后绿；组合测试把 `IdentityModule` 临时回退 `enabled.value` 后 failed，改回后绿（能精确复现 E2）。

## 已知限制 / 未完成

- **E2 观测面**：无 push 通道。技能提醒只在 controller 生命周期观测点与 `RemoteReceiveService` 60s 轮询（轮询随后台接收服务运行）发布；「后台接收」关闭且 App 持续后台期间新到候选没有观测点，回前台时按既有反骚扰语义（前台抑制、抑制不补发）被消费，靠 in-app `pendingCount` 承载。本轮没有为技能提醒另起后台服务/WorkManager（那会违反用户关闭后台接收的选择，且超出 review 最小决策）。
- **E5 / E6 本轮不做**（用户范围）：聊天页无固定话术按钮；「最近审核结果」不展示拒绝原因。
- **`/skills/detail` 未接**：接口与 `SkillsApi.detail` 保留但无调用方；面板详情（完整描述等）未提供。
- **本地化**：客户端审核面板分区标题/错误横幅已入 `stringResource`；但后端生成的审核 display 正文、技能通知标题仍是硬编码中文，跨语言客户端会混合语言（属后端范围，本轮不改）。
- **验证环境**：无模拟器/真机，`connectedAndroidTest` 不可用，release 签名未配置；未做真机截图/设备验收。
- **E1 端到端**：未跑真实后端组合的 Robolectric→HTTP/真机 E2E（无设备与真实服务环境）；以客户端契约/Robolectric 测试 + 后端 `skill-review-entry.test.mjs` 与全量后端测试覆盖「后端触发回合 + 客户端导航/呈现」两段。
- **两轴 review 的 judgement 项未全部处理**（记录为可接受）：审核 display 解析器与呈现同文件（依赖后端行前缀，后端新增前缀会落「其他」兜底，不做跨仓检查）；测试内有重复的 `SkillsBackend` 替身；`UNKNOWN_POOL_GROUP = -1` 哨兵；`skills/forbidden-authority` 等 dsh-http envelope code 与对话侧 `skill_manage` code 走原文兜底（不建死映射）。
- **未做完整设备/云服务验收**：本轮是客户端呈现与提醒接线修复，真实模型/云服务不参与；不改变后端语义。

## 证据与命令

- 本轮工作包交接与原始日志（不入库）：`/tmp/android-panel-*.log`、`/tmp/ourfairy-295-android-*.log`、`/tmp/ourfairy-295-backend-*.log`，以及各 owner 的 `git diff`。
- 最终门禁命令（本 worktree）：
  - `cd android && ./gradlew test lintDebug`（或 `/tmp/ourfairy-295-android-gate.sh test lintDebug`，内部 flock 串行）
  - `export OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 && npm test`
  - `npm run combo:verify`
  - `node scripts/evidence-index.ts --check`
  - `git diff --check`
- Android 工具链：Temurin JDK 21.0.13+9、Android SDK `platforms 37.2/37.0/36.1` + build-tools、Gradle 9.6.0；仓库内仅 `android/local.properties`（gitignored）。无模拟器/真机，本轮不跑 connected 测试。
