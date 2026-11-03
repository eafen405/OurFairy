# #223 消息呈现顺序：跨页恢复与稳定位置

父票：[#223 消息呈现顺序：跨页恢复与稳定位置](https://github.com/eafen405/OurFairy/issues/223)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `6662bef17e`，集成分支 `integration/spec-223`；dsh 锁保持 [`combo.json`](../../../combo.json) 不变。

## 目标与实证

后端按首次出现位置排列 `messages`，Android 却按 `(seq,messageId)` 重排。当前生产 `RemoteChatState` 的临时探针实际将后端 `[u-first,u-second,a1]` 排成 `[u-second,a1,u-first]`；合法旧页场景则保留较新 live 的 `seq=4,status=3,text=new`。探针在 `probe/message-ordering-20261025` @ `ade0239c3f`。

本规格让后端把既有首次出现名次以数字 `position` 传给 Android，客户端按该事实恢复消息呈现顺序。

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-position-recovery.md` | [#224](https://github.com/eafen405/OurFairy/issues/224) | 跨端 position 契约与 Android 有序恢复 | 无 |

只有一张实施票，前沿为 #224。

## 已确认约束

- `messages[]` 新增必填 JSON 数字 `position`，Android 为 `Long`；由 transcript `rows` 下标读时派生，会话内唯一且同 messageId 稳定。只用于排列，不表示 seq、连续性或内容新旧。
- 缺字段、同 ID 改位置、不同 ID 同位置均响亮失败；无 seq/messageId 兜底，不维护混合版本兼容路径。
- 不改数据库、持久 state 形状或 dsh fork，transcript `stateVersion` 保持 4。
- 沿用 `mergeMessages` / `orderedMessages`：内容仍按 `seq >=` 合并，显示按 `position` 排列；不新建恢复 actor、公开流程、adapter 或独立合并 module。
- generation、events 覆盖、durable/consumer、pending、附件、任务与实时 attempt 不变；Android 不重折 events。
- 提醒预览与流式测量独立取最大 seq 的 Fairy 输出。

## 验收

- 确定性覆盖：position 与 seq 不同的顺序、跨页、同 seq 多行、位置漂移/冲突/缺失、generation 与提醒取序。
- 最终集成状态运行 `npm test`、`npm run combo:verify`、Android `test lintDebug assembleDebug`。
- 运行 `node scripts/real-acceptance.ts` 的真实 M3.1 文本、PDF、ASR 三步；边界仍由确定性替身负责。
- 当前无物理设备，真机验收记未执行；不以构建或模拟器代替。
- 证据遵循 [`work/implementation/CONVENTIONS.md`](../../implementation/CONVENTIONS.md)，收口做 Standards + Spec 两轴评审和可执行声称检查。

## 范围外

stateRevision/contentRevision、正文历史持久化、恢复 actor、独立合并 module、路由/SSE 帧/模型/权限变化、整个 RemoteChatState 重构及架构报告其他候选。
