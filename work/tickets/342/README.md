# #342 Android 会话命令与上下文重置：任务图

父规格：[#342](https://github.com/eafen405/OurFairy/issues/342)，本地 [正式规格](../../../docs/specs/session-commands.md)、[设计记录](../../../docs/decisions/session-commands.md)。GitHub issue 是发布权威，原生 blocked-by 是实时阻塞权威。

基线：`main` @ `520e1b16a6002a22f641c4bf5174d0b20a834811`。集成分支 `integration/spec-342`。

## 任务图

| 票 | 本地副本 | 状态（2026-11-10） | 原前置 | 交付 |
| --- | --- | --- | --- | --- |
| [#343](https://github.com/eafen405/OurFairy/issues/343) | [后端命令](01-backend.md) | 已合入、CLOSED | — | 原生 compact、最小 clear、稳定操作结果、日志投影与后端协议 |
| [#344](https://github.com/eafen405/OurFairy/issues/344) | [Android 接线](02-android.md) | 已合入、CLOSED | 协议先交付 | 候选、焦点、青色识别、发送分流、状态和恢复 |
| [#345](https://github.com/eafen405/OurFairy/issues/345) | [保留与恢复验收](03-integration.md) | 已合入、CLOSED | #343 #347 | 记忆/技能保留、维护/投递竞争、分页/观察与故障恢复 |
| [#346](https://github.com/eafen405/OurFairy/issues/346) | [集成收口](04-closeout.md) | OPEN、blocked=0；完整门禁已记录，待 Lead 审查/merger | #344 #345 | [最终集成证据](../../implementation/evidence/342-session-commands/04-closeout/README.md)；两轴各 1 P2 已修复，[待最终集成复验](../../implementation/evidence/342-session-commands/06-review-fixes/README.md) |
| [#347](https://github.com/eafen405/OurFairy/issues/347) | [DSH 冷读取修复](05-native-reader.md) | 已合入、CLOSED | — | V4 投递 literal、晚到 system 与实际首节点保护；组合锁 `8014fc7` |

依赖演变（历史）：起始 frontier 只有 #343；随后先冻结并交付[客户端合同](protocol.md)，解除 #344 的协议前置，与后端剩余实现/验证并行。#345 在 #343 关闭后开工，受原生冷读缺口阻塞后由 #347 解阻。2026-11-10 收口实查 GitHub：#343/#344/#345/#347 均 CLOSED、blocked=0，#346 已 assigned、OPEN、blocked=0。每票独立 worktree/分支并在交付前合入集成 tip；收口分支按 Lead 要求保留给 merger，不在实现者阶段 push、关闭 #346 或清除本 worktree。

## 复用与范围决定

发布时的范围澄清（2026-11-10）：当时 `/clear` 尚未实现、功能简单。`/compact` 调用锁定 DSH 的 `ctx.compaction.compactNow`；`/clear` 复用 surface replacement、`agent.runMaintenance`、现有会话队列和持久 barrier。沿用原生 `command/run`、`command/done` 日志以及带产品 source 的 replacement，不新增原生必需事件、业务表、命令平台或第二份历史。当前接口统一以[协议合同](protocol.md)为准，原 #343 协议摘录为历史证据。

#343 与 #344 已合入并关闭。#345 的确定性投递/clear 冷恢复回归曾发现旧锁 DSH 的 V4 校验器遗漏 `delivery/message`；#347 已补齐该 literal，并补修晚到 system 与实际首节点保护，在 `8014fc7` 完成原生构建和产品锁更新。#345 随后在最终锁复验原失败场景及保留/恢复组合并已合入、关闭。详见[原生证据](../../implementation/evidence/342-session-commands/05-native-reader/README.md)和[组合测试证据](../../implementation/evidence/342-session-commands/03-integration/README.md)；没有新增格式版本、持久事件或业务表。

数据影响限于现有追加日志的命令/结果/重置表达、聊天投影及客户端待恢复操作元数据；不迁移记忆或技能库。原始日志、主会话身份和维护/学习水位保留。

测试接缝已在父规格确认：认证产品 HTTP + 确定性模型/网络替身，Android 公共状态 + 回环 HTTP + Compose/Robolectric 页面。按 `tdd` 逐行为实施，不重复询问已确认测试接缝。最终全量门禁与设备验收分开记录。

## 写范围协调

#343 拥有后端 chat 与 `tests/session-commands.test.mjs`；#345 优先新增独立 retention/recovery 测试文件，fixture 或生产缺口先协调。#344 拥有 Android 写范围。#346 更新证据索引和规格登记。共享文件由 Lead/merger 协调。

主检出原有未提交内容保留；仅将本规格与设计记录复制入集成分支，其他工作区改动不带入。
