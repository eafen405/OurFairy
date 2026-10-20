## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

把 `/chat/read` 与 `/chat/observe` 切到「durable 投影快照 + live overlay」：不再在每个流式片段上重新读取全部事件并重新 fold；同一会话的所有观察者共享同一份 durable 状态，每个观察者只按自己的窗口格式化输出。`attempt` 累计正文、`replyStatus`、`stopping`、`error`、`settledAttempt`、任务可用性等 live 状态继续由 runtime 叠加，且不写进可持久化投影。

事件窗口不再靠每个片段重新观察整份日志：会话恢复时取一次最近的窗口，之后由提交事件增量维护；`read`/`observe` 的帧只按观察者自己的 `fromSeq` 输出窗口。

## Acceptance criteria

- [ ] `/chat/read`、`/chat/observe` 的字段、事件窗口、`fromSeq/throughSeq`、`hasMore/beforeSeq`、`replyStatus`、`attempt`、`settledAttempt`、`error` 语义全部不变
- [ ] 流式过程中每个片段不再触发全量事件读取或全量 fold；同一会话两个观察者共享同一份 durable 状态
- [ ] 发送去重、冲突检测与 receipt 查询改用单元状态，行为不变（含进程重启后的 receipt）
- [ ] 停止、错误、恢复后活动与回复状态正确收尾，不会永久停在未完成格式或错误的活动状态
- [ ] 原有 remote-chat / reconnect / jobs / 投递场景测试全部通过，删除被替代的全量 fold 实现，不保留两套

## Blocked by

- [投影单元：transcript / tasks+activity 注册到原生 registry](https://github.com/eafen405/OurFairy/issues/89)
