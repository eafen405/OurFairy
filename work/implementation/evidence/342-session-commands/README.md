# #342 Android 会话命令与上下文重置：交付证据

本规格的实现已合入 `integration/spec-342`：#343 后端、#344 Android、#345 保留/恢复组合测试、#347 原生冷读取修复均已关闭。#346 在独立分支完成证据整理及最终完整 Node、combo、Android test/lint 门禁；结果和具体代码基线统一见[收口记录](04-closeout/README.md)。Standards/Spec 两轴各发现 1 个 P2，已由同一 fresh implementer 修复，待最终集成复验；原报告、各轴 resolution 与本轮验证边界见 [06 review fixes](06-review-fixes/README.md)，当前不宣称最终审查或 CI 通过。

需求以[正式规格](../../../../docs/specs/session-commands.md)为准，[设计记录](../../../../docs/decisions/session-commands.md)保留访谈及发布时的只读调查，[任务图](../../../tickets/342/README.md)记录依赖演变。当前客户端接口统一维护在[协议合同](../../../tickets/342/protocol.md)，[chat README](../../../../backend/chat/README.md)经 01 历史证据转到该合同；下列旧证据中的协议、旧锁及当时 OPEN/待执行描述均是交付时历史快照。

| 证据 | 内容与时点 |
| --- | --- |
| [01-backend：#343](01-backend/README.md) | 认证命令入口、原生 compact、同会话 clear、稳定身份、持久结果、投影与基础忙态；历史 DSH 锁 ae2 |
| [02-android：#344](02-android/README.md) | 两项候选、实际焦点/颜色页面断言、发送分流、附件拒绝、草稿与原身份恢复；相关 12 suites / 174 tests，不能替代最终全量 |
| [03-integration：#345](03-integration/README.md) | 人格/印象/记忆/技能保留、维护/学习冻结区间、真实写入失败、投递/任务/排队竞争、分页与观察；最终锁 8014，相关四文件 20/20 |
| [04-closeout：#346](04-closeout/README.md) | 精确基线、最终完整 Node/Android 门禁与计数、文档检查、审查 PENDING 和 merger 交接 |
| [05-native-reader：#347](05-native-reader/README.md) | V4 投递 literal、晚到 system/实际 system 首节点保护；source 最终相关 161 tests、primary 四条 requiredBuild、artifacts 7/7、随后 build:check 2/2、doctor 12/12。旧 474 run 有重叠且早于 followup，不累加 |
| [06-review-fixes：#342](06-review-fixes/README.md) | 两轴各 1 P2 的原报告、Android 状态查询身份恢复修复与 native recorded-session 冷恢复回放；待最终集成复验，旧 full 不充作新代码最终门禁 |

数据影响限于既有追加日志的 `command/run`、`command/done`、surface replacement 与聊天投影，以及 Android 待恢复操作元数据；不新增业务表或记忆/技能库迁移。行为事实与会失败的公开接缝检查见[收口映射](04-closeout/README.md#规格场景与现有检查)。

本规格没有真机、真实多设备、真实云模型或 ASR 验收，没有构建/安装本轮 APK。模型与网络为确定性替身，Android 为公共状态、回环 HTTP 与 Compose/Robolectric；不能据此宣称全部 64 条故事完成设备验收。Native 宽文档门禁曾有 4 个基线失败，详见 [05 的具体失败与基线依据](05-native-reader/README.md#既有-native-文档债)，没有扩修，也不称原生门禁全通过。
