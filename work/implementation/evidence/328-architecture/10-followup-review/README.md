# #328 及子票独立复审与小范围修复

2026-11-09，审查范围固定为 `git diff 25a2b34...88b1916`。基线来自
[任务图](../../../../tickets/328/README.md)，包含 #338 合入前的全部实现及上一轮修复。
GitHub 元数据核对：#328 与 #329–#336 均关闭，8 张子票的开放 blocker 数均为 0。
`gh pr view 338 --json number,mergedAt,mergeCommit,headRefOid,statusCheckRollup` 核实原 PR 于
2026-11-08 合为 `88b1916`，历史 `full-gate` 与 `android` 均 SUCCESS；本轮未推送或触发 CI。
本轮不发布 tracker 评论，不改 ADR、数据结构或产品权限。

## 审查方法与架构判断

两位独立审查者分别执行 Standards 与 Spec 轴；Lead 检查实际调用路径、运行反例探针与相关套件，
再交叉核对候选。规范来源为根 `AGENTS.md`、`CODING_STANDARDS.md`、实施 `CONVENTIONS.md`
及 Android 指引；需求来源为本地 328 票面、父产品规格与技能增量规格。

本轮未发现需要扩大改造的架构问题。验证报告集中解析与判据、来源互斥下沉到创建契约、候选回迁复用、
远程资源串行 lane 和通知准入共享均有现有调用方支撑；新增 module 的 interface 承担当前实际差异。
发布和 seed 的事务、rename、回滚顺序留在调用处，权限与归属检查保持原有行为。
不因 `join` 转发或只读印象忽略 writing 等局部形状另建抽象。

## Standards

1. **P2，#335：文本扫描不能支撑 CI 实际调用及“无副本”保障。**
   原 `tests/combo-build.test.mjs` 用 `indexOf`、`includes` 和正则检查 workflow 字符串，
   `scripts/combo.ts` 却描述为能拒绝第二份副本或漏调记录。
   这不满足编码标准“声称须可执行”的结构声称要求。Lead 在临时副本中把真实调用改成
   `# node scripts/combo.ts build` 加空操作 `:`，同名检查仍 **1/1 通过**。
   修正为执行真实 build step 的 `run` 内容、观察廉价 fixture 的记录动作；
   字面副本扫描明确降为启发式提示，不声称覆盖任意 shell 写法。
2. **P3，#329：坏报告的注释超过解析器实际覆盖。**
   原注释声称 malformed 报告总会变成 incomplete 空报告，且不会一个消费者可批准、另一个不可读。
   直接调用 `readVerificationReport`，输入 `{"complete":true,"executed":[null]}` 时仍返回 complete，
   `verificationVerdict` 在无父版本时返回 `ok:true`；数组元素没有 schema 校验。
   这是先存坏数据库行的行为及本次新增注释过宽，不是新增模型写报告入口。
   只将注释收窄为缺值、坏 JSON、非对象容器及字段类型的现有回退，明确元素来自系统 runner；
   不为注释引入一套新校验机制。

规范轴共 **2 项**，最严重为 #335 的 P2；两项均已完成小范围修正，并由需求轴审查者独立复核通过。

## Spec

**P2，#335 验收条件 2 部分覆盖不足。**
[票面](../../../../tickets/328/07.md)要求“快速漂移测试能发现复制或漏步”。
原测试可以在 CI 实际漏掉构建调用时继续通过，上述注释加空操作反例已复现。
当前 workflow 本身仍正确调用构建器，问题在快速门禁未验证该行为。
修正后的行为探针应因遗漏实际调用而失败，同时观察修改/删除记录命令对实际执行动作的影响。

| 子票 | 核对结果 |
| --- | --- |
| #329 | 共用 reader、父哈希规则及判据；事务内复核、增长确认和审核证据保留 |
| #330 | 创建契约拒绝非法来源；合法后台修订保留 claim、benefit 与父版本 |
| #331 | 三领域共用串行读写；技能审核不重读；网关接受写后重读失败仍回调；印象原本只读 |
| #332 | 读取与启动复用回迁；unsafe/missing 启动终态已在上一轮恢复 |
| #333 | 只删除无消费者 auth 声明；handler、fence、认证、角色与归属未改 |
| #334 | 链接检查脱离后端 helper；无 dist、无 dsh 副本可以运行 |
| #335 | 防漏步覆盖不足已由真实 run 行为探针修复，独立复核放行 |
| #336 | 共用端点与账号准入；会话归属及打开后身份二次确认保留 |

需求轴共 **1 项**，为 #335 的 P2，与规范轴第 1 项是同一根因，不另算业务故障。

另核对 RemoteResource 的 queued load 在前序写的重读后短暂丢失 loading 标记：
`25a2b34` 的 SkillsState/GatewayState 已有同一窗口，不计为本次增量回归，不扩大本轮修改。

## 验证

审查开始时默认 dsh 检出缺少 TypeScript；另一个已有检出 `/home/fatfish/dsh-d80522d2` 的 HEAD
经 `git rev-parse HEAD` 确认为组合锁定的 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`，
后续产品检查显式使用 `OURFAIRY_DSH_DIR` 指向该检出。

已完成的审查验证（修改前的固定树）：

- `node --test tests/docs.test.mjs tests/combo-build.test.mjs`：13/13。
- `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/skill-verification-report.test.mjs tests/skill-creation-domain.test.mjs tests/skill-paths.test.mjs tests/precommit.test.mjs tests/route-inventory.test.mjs`：83/83。
- `npm run combo:verify`：产品、dsh、Android 来源三行 ok。
- `JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9 ANDROID_HOME=/home/fatfish/tools/android-sdk ./gradlew :app:testDebugUnitTest --tests me.rerere.rikkahub.data.remote.RemoteResourceTest --tests me.rerere.rikkahub.data.remote.SkillsStateTest --tests me.rerere.rikkahub.data.remote.ImpressionStateTest --tests me.rerere.rikkahub.data.remote.GatewayStateTest --tests me.rerere.rikkahub.ui.identity.RemoteNotificationNavigationTest --tests me.rerere.rikkahub.NotificationColdStartTest`（在 android 目录）：BUILD SUCCESSFUL，6 suite / 51 tests，0 failures / errors。

修复后的快速验证：

- 实现者将新用例的实际 script 临时替换为注释加 `:`，用例 exit 1、见证记录为空；恢复实际 run 后整文件 12/12。
- Lead 运行 `node --test tests/combo-build.test.mjs tests/docs.test.mjs`：14/14，`git diff --check` 通过。
- 需求轴审查者独立运行 `node --test --test-name-pattern 'the workflow build step executes' tests/combo-build.test.mjs`：1/1，并复核四文件差分放行。
- 行为探针覆盖当前构建步骤的 literal run 内容，不模拟 GitHub Actions 调度及未来的 step-level if/shell/env 配置。
- 提交不重复触发全量钩子；最终本地 main 上统一运行全量门禁，随后把结果补入本文。

首次集成检查（本地 `main` @ `b393221`）：

- `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run typecheck`：exit 0。
- `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run combo:verify`：三行 ok。
- `JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9 ANDROID_HOME=/home/fatfish/tools/android-sdk ./gradlew test lintDebug`（android 目录）：BUILD SUCCESSFUL，6m31s；app 686、ui 20、highlight 52，共 758 tests，0 failures / errors，lintDebug 完成。
- `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test`：839 tests / 836 pass / 3 fail，0 skipped / cancelled，659.7s。
  失败均为 `tests/skill-learning.test.mjs` 的替身观察断言：`a failure signal never counts…` 的原第 710 行（全局 `seen.creation.length` 为 2；前一条按任务键过滤的数据库断言通过）、`an uncertain review…` 的原第 726 行（全局请求数为 1；信号状态断言通过）、`a background candidate reaches…` 的原第 805 行（全局第二个 creation 请求无预期工具结果）。同时旧 claim 请求触发新用例的全局 callback，在原第 875 行产生异步断言。
- 三项隔离：`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- --test-concurrency=1 --test-name-pattern 'a failure signal never counts|an uncertain review is stored|a background candidate reaches the pending list' tests/skill-learning.test.mjs`：3/3，14.3s。
- 原树整文件独占：`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- --test-concurrency=1 tests/skill-learning.test.mjs`：23/23，156.8s。历史 [09-review-fixes](../09-review-fixes/README.md) 第 10 节也记录过这三项失败及整文件 23/23 的隔离结果。

## 验收暴露的既有测试边界修正

失败调查确认单文件共享的 `script`、`seen.creation` 未按 claim 隔离。`a running source session blocks…`
用例末尾只等待第三条消息的检测请求到达，就允许下一用例 `resetScript`，旧子代理仍可能发送后续模型请求，
吃到新脚本或触发新 case 的 callback。#329 新增判据只在子代理完成、候选已存在后的结算阶段参与，
不能直接造成上述阈值之后的全局请求计数和请求索引断言失败。

本轮只在这个已定位的用例末尾加六行：捕获第三冻结 cut，等待同源学习状态回到 0 且水位覆盖该 cut。
请求前 claim 已持久化 cut；结算发生在 `whenIdle()` 之后且保留 cut，因此这是等待本次工作完成，
不是重算产品算法。保留全部观察和负断言，不过滤请求、不引入通用隔离框架，不改产品逻辑。
两位审查者独立复核通过；这封住一个明确窗口，不声称全套替身已完全隔离。

修正已提交为 `1efade0` 并快进本地 main：

- `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- --test-concurrency=1 --test-name-pattern 'a running source session blocks|a failure signal never counts|an uncertain review is stored|a background candidate reaches|a changed candidate that only reuses' tests/skill-learning.test.mjs`：5/5，21.6s。
- 最终 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test` 在该树独占运行：**839 tests / 839 pass / 0 fail**，52 suites，0 skipped / cancelled，637.2s；后台学习 23/23，未再出现前轮三项失败及异步断言。Android 源码与前一次完整 test/lint 的树相同，未重复运行。
- 初始审查的两项发现与验收期间定位的六行测试同步修正均已完成；后续仅提交本证据和索引描述。

本轮验证使用替身模型/网络及 Android JVM 测试；未执行真实云服务、APK 构建或真机验收。
原始日志与 XML 不入库。
