## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

证明并固定「按会话共享、按观察者格式化」：同一会话打开两个 observe 连接时只维护一份 durable 投影；两个会话并发流式时互不阻塞。用延迟/内存基准观察共享效果，不断言内部计数。

## Acceptance criteria

- [ ] 同一会话两个 observe 连接在模型替身流式输出期间看到相同投影，断线重连后仍一致
- [ ] 同一负载下，第二个观察者不使每片段处理时间或内存成倍增长（相对单观察者基线，数据写入证据）
- [ ] 两个会话并发长流时，一个会话的读取延迟不被另一个会话的历史长度拖垮（固定负载、重复运行）
- [ ] 行为测试覆盖多观察者与并发会话；基准单独记录，不进普通单元测试

## Blocked by

- [观察者共享与 read/observe 切换](https://github.com/eafen405/OurFairy/issues/90)
