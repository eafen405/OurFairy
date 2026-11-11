# #342 Android 会话命令与上下文重置：交付证据

本规格的 #343 后端、#344 Android、#345 保留/恢复组合测试、#347 原生冷读取修复均已合入并关闭。审查后最终运行基线为产品 **`de9ba53ce4f8e9e42c548b99f0a5c3ed31d08932` + 唯一 jobs 夹具修复**、native **`2b05c480ec6377f7a592a1d4d7a379584aba2bf5`**；#346 已顺序完成 **Node 854/854、combo 三行、Android 89 suites / 791 tests（0 failures/errors/skipped）与 lint 0 errors / 42 warnings / 2 hints**。首轮 Node 的 853/854 实际失败、公开接缝正负对照及最小 test-only 修复完整保留于 [04 当前记录](04-closeout/README.md#审查后最终完整门禁当前)，不把受控 trace 充作原 full 日志；原 `0886f18 + 8014fc7` 的 Node854/Android787仍为 HISTORICAL。

Standards/Spec 原各 1 个 P2 已由同一 fresh implementer 修复，并获各自原 reviewer 对产品 `f733e0d` / native `2b05c48` 定点确认 **RESOLVED，无原 finding remaining**；Root 已复核可执行声称并确认最小 fixture 修复不弱化原断言。这不是第二轮全量 review，也不宣称 CI 通过。原分轴报告、确认与 merger 构建详见 [06](06-review-fixes/README.md)。#342/#346 保持 OPEN，由 Root merger 接管统一发布与关闭。

需求以[正式规格](../../../../docs/specs/session-commands.md)为准，[设计记录](../../../../docs/decisions/session-commands.md)保留访谈及发布时的只读调查，[任务图](../../../tickets/342/README.md)记录依赖演变。当前客户端接口统一维护在[协议合同](../../../tickets/342/protocol.md)，[chat README](../../../../backend/chat/README.md)经 01 历史证据转到该合同；下列旧证据中的协议、旧锁及当时 OPEN/待执行描述均是交付时历史快照。

| 证据 | 内容与时点 |
| --- | --- |
| [01-backend：#343](01-backend/README.md) | 认证命令入口、原生 compact、同会话 clear、稳定身份、持久结果、投影与基础忙态；历史 DSH 锁 ae2 |
| [02-android：#344](02-android/README.md) | 两项候选、实际焦点/颜色页面断言、发送分流、附件拒绝、草稿与原身份恢复；相关 12 suites / 174 tests，不能替代最终全量 |
| [03-integration：#345](03-integration/README.md) | 人格/印象/记忆/技能保留、维护/学习冻结区间、真实写入失败、投递/任务/排队竞争、分页与观察；子票交付锁 8014，相关四文件 20/20 |
| [04-closeout：#346](04-closeout/README.md) | 当前 de9 + jobs fixture / native2b：Node854/854、Android89 suites/791 tests+lint；首轮失败与受控对照、精确测试 blob、全部 suite 数字；旧854/787历史快照单列 |
| [05-native-reader：#347](05-native-reader/README.md) | V4 投递 literal、晚到 system/实际 system 首节点保护；当时 source 最终相关161 tests、primary requiredBuild四条、artifacts7/7、随后check2/2、doctor12/12。旧474有重叠且早于followup，不累加；后续2b构建见06 |
| [06-review-fixes：#342](06-review-fixes/README.md) | 两轴原报告及原 reviewer 定点RESOLVED；Android状态查询身份恢复与native recorded-session修复、native2b构建/pin，及其后#346最终完整产品门禁 |

数据影响限于既有追加日志的 `command/run`、`command/done`、surface replacement 与聊天投影，以及 Android 待恢复操作元数据；不新增业务表或记忆/技能库迁移。行为事实与会失败的公开接缝检查见[收口映射](04-closeout/README.md#规格场景与现有检查)。

本规格没有真机、真实多设备、真实云模型或 ASR 验收，没有构建/安装本轮 APK。模型与网络为确定性替身，Android 为公共状态、回环 HTTP 与 Compose/Robolectric；不能据此宣称全部 64 条故事完成设备验收。Native 宽文档门禁曾有 4 个基线失败，详见 [05 的具体失败与基线依据](05-native-reader/README.md#既有-native-文档债)，没有扩修，也不称原生门禁全通过。
