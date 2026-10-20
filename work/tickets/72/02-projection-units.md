## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

把现在的「每次读取都全量 fold 事件日志」改成注册在原生 `ctx.sessionProjections` 上的增量投影单元，并让折叠结果与现状逐字段一致：

- `transcript` 单元：消息身份、seq、requestId、role、status、text、attachments；消息身份规则与 attempt 行的确定性身份 `attempt:<sessionId>:<seq>` 不变；同时维护窄的 receipts 映射（requestId → messageId、acceptedSeq、text、uploadIds），供发送幂等与冲突检测查询。
- 任务与活动单元：任务 roster、状态、输出窗口元数据、report 状态、输出位置；episode、completed、delivery 摘要与 reasons。**两者必须共享同一次按事件的 fold**：活动判定依赖每个事件后的任务/report 状态，拆成两个单元会把 report 状态机复制一份，构成第二套权威，而 spec 明确禁止。单元 state 只含日志派生事实；`availability`、`running`、attempt 文本等 live 状态不写进单元。
- 每个单元声明稳定 key、`stateVersion`、zod `stateSchema`、`init`、`apply`；对不关心的事件返回同一 state 引用；只使用 `sessionProjections` 的公开注册/读取接口。
- 为分页保留「截点状态」：transcript 行记录首次出现 seq 与结算 seq（以及 attempt 所属 turn 与其 turn/end 的 seq/kind），使任意固定截点都能还原该行的 seq 与 status，而不必重新 fold 前缀。

## Acceptance criteria

- [ ] 三个单元注册在原生 registry 上（transcript 一个；任务与活动一个单元两个输出），无关事件返回同一 state 引用
- [ ] 对现有测试使用的固定事件序列，单元输出与改造前 `transcript()` / `projectSession()` 逐字段一致（消息身份、seq、requestId、role、status、text、attachments；taskId、kind、label、status、availability 之外的全部字段、output、report；activity 的 status/reasons/episodeId/startedSeq/throughSeq/completed/delivery）
- [ ] receipt 查询只读单元状态，不扫描事件日志；同一 requestId 的 acceptedSeq 与消息身份不变
- [ ] 冷日志（从 seed 事件重建）与热日志（逐事件 apply）折叠结果一致
- [ ] 新增 `zod` 为 `backend/chat` 的普通依赖，profile 安装后仍可启动（doctor/probe 通过）
- [ ] `stateVersion` 语义写进模块说明：折叠语义或 state 形状变化时递增

## Blocked by

None (can start immediately).
