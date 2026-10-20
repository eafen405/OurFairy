## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

产品的断线重连与响应式读取改用 #04 的原生接缝提供 assistant 流基线与缺口修复：流式中的累计正文、`settledAttempt`、终止状态与最终消息保持现状，Android 不需要改。历史分页的字段与窗口语义不变；`/chat/page` 的固定截点与切片读取由投影性能工作（#72）拥有，本票只接原生算法，不另写一套分页。所有历史/跟随入口在调用前仍先核对会话归属。

## Acceptance criteria

- [ ] 产品不再自己累计 assistant 流基线：`attempt.text` 来自原生接缝；`attemptId`/`revision`/`settledAttempt` 的可见语义与现在一致
- [ ] 断线重连的既有场景（长断线、并发尾部、assistant attempt 前缀）字段与改造前一致：不重复、不丢失、最终收尾一致
- [ ] 跟随遇到事件缺口时由原生接缝修复，不把缺失事件当连续历史
- [ ] `/chat/read`、`/chat/observe`、`/chat/page` 响应形状与错误码不变；调用接缝前先核对会话归属
- [ ] 与 #72 的读取路径改动不并行实现：本票只替换算法调用点，投影/切片仍归 #72

## Blocked by

- [在 dsh fork 暴露 Host 可调用的历史/跟随接缝](https://github.com/eafen405/OurFairy/issues/84)
