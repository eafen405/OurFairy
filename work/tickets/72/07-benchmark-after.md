## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

在同一台机器、同一工作负载上重跑基准，与 01 的改造前基线对比，给出相对门槛与结论：每片段处理时间不再随历史长度线性增长、观察者数不放大 durable 成本、分页不读完整日志。记录实际命令、参数、重复次数与未执行条件。

## Acceptance criteria

- [ ] 改造前后使用完全相同的脚本与参数，对比表包含 p95、内存峰值、payload 与观察者数
- [ ] 给出相对同机基线的回归门槛（相对值，不是绝对毫秒），并说明取整与噪声处理
- [ ] 明确写出哪些指标改善、哪些未改善及原因；未执行项逐条记录
- [ ] 结论用词区分实测与推断；不把单次墙钟当稳定断言

## Blocked by

- [固定负载基准与改造前同机基线](https://github.com/eafen405/OurFairy/issues/88)
- [观察者共享与 read/observe 切换](https://github.com/eafen405/OurFairy/issues/90)
- [分页在固定截点取值](https://github.com/eafen405/OurFairy/issues/91)
