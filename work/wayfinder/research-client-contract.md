## Question

在既定消息呈现、每会话活动状态、断线补齐、通知和双停止规则下，rikkahub 客户端与 dsh 后端应共享怎样的最小 Interface，才能让历史、流式、投递和任务使用一致的会话事实？已有原生协议和 Fairybot 接收机制分别可复用到哪里，最少需要补什么？

类型：AFK research。研究结果是工程建议，不自动采纳具体协议，也不让用户重新选择已经确定的行为。

本次增量：已有研究已说明 UIMessage 与 dsh Message 不一一对应、follow/page 的真实语义及通知边界。本票将这些事实连成可实施的端到端映射，不重新做功能盘点。

- 以发送、生成、投递、终态、后台任务、重连为具体轨迹，建立原生事件到客户端会话/消息/活动投影的映射；区分持久事实、临时流状态及本地呈现状态。
- 依据 follow baseline、向后 page 和 active attempt 的实际行为，给出补齐历史截点、重叠去重、并发新事件、终态收尾的最小方案；不得把 throughSeq 写成 afterSeq。
- 在同一个 Interface 中表达任务状态、输出保留窗口和分别停止回复/任务；不新增日志永久完整或服务器重启自动续跑承诺。
- 给出 HTTP/RPC/stream、任务、附件入口的可信用户到会话授权接线要求；连接层不决定业务规则。人格与投递来源的内部真实性不得因普通 Fairy 消息外观丢失。
- 说明纯文本流式、最终完整格式、通知合并分别消费哪些共同事实；不得让各页面或投递/生成/jobs 调用方各自实现通知规则。
- 输出可 review 的接口示意、事件时序与失败/恢复例子，标注原生复用、必要适配及对后端会话扩展的依赖。常规字段与算法由研究提出建议，只有无法满足已定行为的冲突才提出产品待决。

必读：[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)、docs/research/dsh-event-consumption-audit.md、message-model.md、fairybot-stream-performance-reuse.md、docs/decisions/frontend-v1-boundary.md，以及已完成的[rikkahub 架构研究](https://github.com/eafen405/OurFairy/issues/17)。基线以引用的固定提交为准。

完成标准：一份基于一手源码的共同接口建议，至少走通正常生成、长断线恢复、生成中收到投递、任务输出缺失四条静态轨迹；清楚说明哪些需在产品集成中验证。本票不实施协议、UI 或真机测试。
