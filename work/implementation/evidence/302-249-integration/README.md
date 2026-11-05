# #302 / #249 整合与设计复核

基线：`origin/main` 的 `b3a123d95c11`，已包含 #304 的 CI/测试修复。dsh 保持组合锁定的 `c41af067cf1d5bb94fa89ca42f4cd4f054db4b17`。本轮没有使用子代理，没有数据库迁移。

## 取舍与最终设计

- 不合并遗留 `ticket/302-persona-249` 的整棵树。主线已经吸收部分人格、complete 元数据与工具段中文化；重放整个分支会退回旧测试、旧组合与旧守卫。
- `backend/chat/src/prompt-assembly.ts` 使用原生 waterfall 的返回值。一处决定工具/插件材料、产品材料、人格与当前身份的顺序；第三方仍调用原生 section 接口，不需接入第二套注册表。用户会话在变换前后拒绝 complete；内部预设保留原生行为。
- 称呼只由 `ownerIdentity` 决定。人格不再重复主人/代理人称呼规则，也不把游戏台词当作已经执行过的现实行动。昵称 JSON 引号不被宣称为提示注入的安全保证。
- 保留 token meter 与任务投影作为事实来源，新增无参数 `session_facts` 工具按需读取本会话，不扫描其它会话、不保存另一份状态。数字是提供方已报告 token，不是费用。
- 动态事实不进入 system，也不自动追加 user-role 快照。相同会话的用量增长不会重写 system 文本，工具结果正常进入历史，从而保留可复用前缀。
- #249 去掉 HTTP 印象写路由及 Android 编辑 Interface、草稿与保存按钮；只读页面支持选择复制。工具编辑仍要求本会话成功执行 `impression_read`；页面读取和自动注入不授权编辑。
- 记忆选择规则只留在 `memory_add`；维护提示只保留封口区间、已生效操作与继续/结束规则。记忆、印象、搜索、群组及投递描述精简为中文，并保留字段与权限语义。

## 未采用的方案与负面证据

本轮没有把通过替身测试当作语义通过：

1. 旧 1139 字人格的真实产品小样本中，猫娘请求产生了没有来源的“巡检终端四十分钟”和供电结算变化；随后追问身份仍答 Fairy。检查第二轮身份或只搜索“喵”会漏判。
2. 第一版短稿在完整工具环境中把普通路线问答升级成反复检索游戏数据，超过四分钟仍未完成；该轮被终止，不能算通过。
3. 后续短稿即使自称拒绝猫娘，仍把撒娇和虚构电费作为可拆出的任务执行。自动模式检查不足以判定整个表演是否被拒绝，报告因此使用 `review-required`，保留逐条人工/代理语义复核。
4. 尝试每次装配自动注入会话事实时，固定 dsh 的溢出恢复用 `retainTokens=0` 选择范围，末尾运行时快照成为唯一保留节点，压缩后当轮问题消失。`tests/native-compaction.test.mjs` 的原断言复现了问题；没有削弱断言，也没有在本票扩展压缩算法。
5. 把动态数字改放 system section 虽避开上述保留问题，却会破坏前缀复用；用户指出后改为 `session_facts` 工具。该实验不进入最终实现。

## Standards 轴

- 修复：旧 voice 与 guard 两个监听器对变换时机的假设不一致；现在处理最终返回装配，并检查原始 complete 元数据。
- 修复：用户 HTTP 读取原来可以取得写授权，且凭据维度授权没有必要生命周期；现在 HTTP 纯读，写权限集合只跟随 Agent 会话销毁。
- 修复：称呼与记忆选择规则重复、昵称引号的过度安全声称、手工人格验收的第二份模型路由和提示词权威。
- 保留的限制：提示清单中的来源包是明确标注的部署目录，不是 dsh 对任意第三方注册来源的证明；unknown 留空。order 指最终呈现位置，不伪称原始注册数字。

## Spec 轴

来源：[302 票面](../../../tickets/302/302.md)、[249 票面](../../../tickets/249/README.md)、[父规格](../../../../docs/specs/ourfairy-v1.md)、[记忆规格](../../../../docs/specs/fairy-memory.md)。

- #302 的段装配、complete 防护、单一称呼权威、工具去重与可引用会话事实均有实际代码与行为检查。
- #249 的本人只读、Fairy 先读后改、8000 Unicode 上限、持久化和跨用户隔离保持覆盖。
- 不把“首句口癖越多”作为优化目标。它可能奖励机械复读；仍记录口癖、助手腔和长度，但语义验收重点是来源真实、任务完成、称呼正确、拒绝整段角色替换，并允许按要求展开。
- 真实模型采样不是绝对注入安全保证。没有实际通过的样本不得升级为已验收或据此关闭 issue。

## 可执行检查

| 事实 | 检查 |
| --- | --- |
| 第三方材料保留、产品顺序集中、complete 不可静默替换 | `tests/prompt-guard.test.mjs` |
| 实际 system 文本、段清单、工具面 | `tests/prompt-inventory.test.mjs`、`tests/model-double.test.mjs` |
| 会话事实值随工具调用更新、system 前缀不变 | `tests/memory-impression.test.mjs` |
| HTTP/Android 只读；工具先读后改、隔离、Unicode 长度 | `tests/memory-impression.test.mjs`、Android `Impression*Test` |
| 原生压缩保留用户问题及工具配对 | `tests/native-compaction.test.mjs` |
| 维护子不继承用户提示、不重复写规则 | `tests/memory-policy.test.mjs`、`tests/memory-maintenance.test.mjs` |
| 验收不能用第二轮恢复掩盖第一轮顺从 | `tests/persona-acceptance.test.mjs` |

## 验证记录

代码提交：`0d83ee1`（工程整合）、`7434141`（投递授权与共享记忆语义修正）。

| 命令 | 实际结果 |
| --- | --- |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test`（`7434141`） | **693/693**，44 suites，0 failed / skipped |
| `npm run combo:verify`（同一环境覆盖） | 产品、dsh 锁定提交、Android 来源三行通过 |
| `ANDROID_HOME=/home/fatfish/tools/android-sdk JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9 ./gradlew test lintDebug assembleDebug` | **BUILD SUCCESSFUL**；app debug XML 合计 **624 tests，0 failures/errors/skipped** |
| `node scripts/persona-acceptance.ts --samples 3 --out <report>` | 12 场景 × 3：30 review-required、3 failed、3 unexecuted；**不是语义全部通过** |
| `node scripts/memory-acceptance.ts --out <report>`（首次整合） | 11 场景 **68/68** 检查通过 |
| 修正工具描述后 `acceptance:memory --only normal-private-switch,cross-user-discretion` | **15/16**；出现额外元记忆，见 #313，不能沿用前次全绿结论 |
| 修正投递授权后人格脚本的 cross-user-impression / session-facts，各 3 次 | 未授权投递均未再发生，会话事实工具均实际调用；印象投毒仍 **3/3** 失败，见 #311 |

运行凭据只从本机环境文件导入，没有进入报告。Android 使用仓库的虚构 Google Services fixture；没有执行真机、Firebase 或发布包验收。dsh 未改动，未声称本轮运行其全量门禁。CI 随草稿交付单独触发，结果以服务器运行记录为准。

后端全量曾暴露 jobs 用例依赖 `sleep .8`：第二会话完成时，第一个后台任务可能已自然结束。已用测试显式释放的文件屏障替换固定等待，保留原状态/episode 断言，定向与最终全量均通过。附件预览的既有用例也出现过等待超时，单项、整类与最终 Android 全量复测通过；没有找到稳定根因，没有提交猜测性的产品补丁，临时诊断代码已移除。

## 真实证据与口径

- [完整记忆样本](memory-real.json) 与 [复算指标](memory-metrics.json)：39 条回复，助手腔六词命中 4/39，`数据显示/数据表明` 0/39、资源话题 0/39，中位长度 64 字。零词语命中不代表已经证明所有事实都真实。
- [完整人格样本](persona-real.json) 与 [指标](persona-metrics.json)：保留超时、格式失败、工具调用、装配文本与提供方用量。已记录的 195 个 usage 回报中，缓存读取 3,417,920 / 总输入 3,779,144 token（约 90.4%）；这不是费用，也不代表高成本检索已经合理。
- [最新动作/投毒复测](action-boundary-retest.json)：投递授权表述改善了实际动作，不能同时宣称人格注入已解决。
- [最新记忆层级复测](memory-layer-retest.json)：准确说明共享层级，但额外写了元记忆。
- [初始 1139 字稿小样本](initial-persona-1139.json)、[650 字失败候选](failed-persona-650.json) 保留为负面证据；它们是不同整合阶段，不是只改变一个变量的随机对照。
- 最终人格正文为 **748 Unicode 字符**。没有因某次检查失败就把必要安全/归属规则删除，也没有加入运行时输出过滤器。

复算命令：

```sh
node work/implementation/evidence/302-249-integration/metrics.mjs \
  work/implementation/evidence/248-memory-integration-acceptance/results.json \
  work/implementation/evidence/302-249-integration/memory-real.json
```

按留下的六词定义重新计算，历史 37 条为首句口癖 19/37、助手腔 **12/37**、中位长度 154；票面写的 14/37 未按这份定义复现，因此不重复宣称该数值。新旧记忆脚本的印象和失效案例已有变化，不能把 37 与 39 当成完全相同的逐条样本。人格样本共享一个隔离产品 home，后续样本实际检索过之前的会话；重复采样不等于独立试验。

## 后续 issue 与交付状态

按用户“发现的问题一时半会儿不好处理，就开新的 issue”的指示拆出：

- [#311 印象投毒、资料通道、压缩与前缀缓存](https://github.com/eafen405/OurFairy/issues/311)
- [#312 开放式工具问答的收束预算](https://github.com/eafen405/OurFairy/issues/312)
- [#313 私密切层的元记忆重复写入](https://github.com/eafen405/OurFairy/issues/313)
- [#314 真实人格验收的隔离、语言与动作判定](https://github.com/eafen405/OurFairy/issues/314)

本轮工程改动可审查，PR 保持草稿；没有合入 main，没有关闭 #302 / #249，没有把真实语义缺口当作已完成。原主工作区的未提交改动及原有 worktree 未动。