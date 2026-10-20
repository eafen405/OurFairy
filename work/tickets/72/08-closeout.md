## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

收口：在 `backend/chat/README.md` 写明投影单元契约（key、stateVersion、init、apply、同引用返回）、durable 与 live 的分界、以及 dsh 升级后必须重跑的行为测试与基准；证据索引登记本 spec；在最终集成状态跑全量验证；按 tracker 方式关闭子票，不修改父票 #72 的标题、正文与状态。

## Acceptance criteria

- [ ] 投影单元契约与 durable/live 分界写进模块 README，并说明为什么任务与活动共享一个单元
- [ ] dsh 升级复核步骤可执行（跑哪些测试、哪些基准、缺服务/行/导出时如何失败）
- [ ] 证据目录有 README，列出各票命令、结果、未执行项，链接可解析
- [ ] `npm test`、`backend doctor`、`combo verify` 在最终集成状态通过
- [ ] 子票按 tracker 方式关闭；父票 #72 未被修改

## Blocked by

- [冷启动重建与 live 状态边界](https://github.com/eafen405/OurFairy/issues/92)
- [多观察者共享与多会话隔离](https://github.com/eafen405/OurFairy/issues/93)
- [改造后基准与相对门槛](https://github.com/eafen405/OurFairy/issues/94)
