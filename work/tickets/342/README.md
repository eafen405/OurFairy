# #342 Android 会话命令与上下文重置：任务图

父规格：[#342](https://github.com/eafen405/OurFairy/issues/342)，本地 [正式规格](../../../docs/specs/session-commands.md)、[设计记录](../../../docs/decisions/session-commands.md)。GitHub issue 是发布权威，原生 blocked-by 是实时阻塞权威。

基线：`main` @ `520e1b16a6002a22f641c4bf5174d0b20a834811`。集成分支 `integration/spec-342`。

## 任务图

| 票 | 本地副本 | 阻塞于 | 交付 |
| --- | --- | --- | --- |
| [#343](https://github.com/eafen405/OurFairy/issues/343) | [后端命令](01-backend.md) | — | 现成 compact、最小 clear、稳定操作结果、日志投影与后端协议 |
| [#344](https://github.com/eafen405/OurFairy/issues/344) | [Android 接线](02-android.md) | 协议已交付 | 候选、焦点、青色识别、发送分流、状态和恢复 |
| [#345](https://github.com/eafen405/OurFairy/issues/345) | [保留与恢复验收](03-integration.md) | #343 #347 | 记忆/技能保留、维护/投递竞争、分页/观察与故障恢复 |
| [#346](https://github.com/eafen405/OurFairy/issues/346) | [集成收口](04-closeout.md) | #344 #345 | 证据、全量门禁、两轴审查与清场 |
| [#347](https://github.com/eafen405/OurFairy/issues/347) | [DSH 冷读取修复](05-native-reader.md) | — | V4 关系校验正确折叠既有投递 surface 节点，更新组合锁 |

起始 frontier 只有 #343；随后 #343 先冻结并交付了 [客户端合同](protocol.md)，#344 的协议前置已满足，因此解除其原生阻塞边，与 #343 剩余实现/验证并行。#345 仍在 #343 关闭后开工，#346 等待 #344/#345。每票一个 fresh implementer、一个独立 worktree/分支，从集成最新 tip 开出，交付前再合入集成最新 tip，由 merger 合入。

## 复用与范围决定

用户 2026-11-10 澄清：`/clear` 尚未实现、功能简单。`/compact` 调用锁定 DSH 的 `ctx.compaction.compactNow`；`/clear` 复用 surface replacement、`agent.runMaintenance`、现有会话队列和持久 barrier。优先沿用原生 `command/run`、`command/done` 日志以及带产品 source 的 replacement，不新增原生必需事件、业务表、命令平台或第二份历史。实际协议以 #343 的交付记录为准。

#343 与 #344 已合入并关闭。#345 的确定性投递/clear 冷恢复回归发现，锁定 DSH 的 V4 relationships 校验器遗漏已受 core Session 支持的 `delivery/message`，因此它维护的 surface 不含投递节点，拒绝真实 prune/replacement 的区间。新增 #347，仅修既有事件的折叠与正反回归；完成原生构建和产品锁更新后继续 #345。没有新增格式版本、持久事件或业务表。

数据影响限于现有追加日志的命令/结果/重置表达、聊天投影及客户端待恢复操作元数据；不迁移记忆或技能库。原始日志、主会话身份和维护/学习水位保留。

测试接缝已在父规格确认：认证产品 HTTP + 确定性模型/网络替身，Android 公共状态 + 回环 HTTP + Compose/Robolectric 页面。按 `tdd` 逐行为实施，不重复询问已确认测试接缝。最终全量门禁与设备验收分开记录。

## 写范围协调

#343 拥有后端 chat 与 `tests/session-commands.test.mjs`；#345 优先新增独立 retention/recovery 测试文件，fixture 或生产缺口先协调。#344 拥有 Android 写范围。#346 更新证据索引和规格登记。共享文件由 Lead/merger 协调。

主检出原有未提交内容保留；仅将本规格与设计记录复制入集成分支，其他工作区改动不带入。
