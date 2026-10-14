## Destination

明确前后端分离后首版 Android 客户端需要保留、适配、剪除或暂缓哪些 rikkahub/Fairybot 前端能力，确定可复用视觉模块及后端交互契约需求。

## Notes

- 采用深模块理念：接口简单、复杂性留在实现，优先复用黑盒能力，避免重复实现与无职责的转发层。
- 本轮为 wayfinder 规划与研究，不实施产品功能；研究结论不是自动采纳的设计决策。
- 每次处理决策票使用 grilling、domain-modeling；模块设计参考 codebase-design，研究使用 research 技能。
- 使用 GitHub 原生子议题和阻塞关系。开始处理先 assign @me；研究结果以单独研究分支中的 Markdown 为资产，结论放在票的 resolution comment。

- 前端是独立设计路线，首版 Android，基于 rikkahub。Fairybot 原视觉设计值得沿用，可复用层次以研究及最终决议为准。
- 法厄同入口称“网关”，有对话与配置功能；代理人入口仅有 agent 对话功能。首版入口组织见最终决议；后续 Web 入口另行规划。
- agent 主要在后端执行。手机可提供通知等信息并接收主动消息，暂不设计 agent 操作手机。接收或展示内容不等于无条件启动新一轮 Fairy 推理。
- 不全盘接受 fork 项目功能；模块是否保留由产品用途、耦合和复用价值决定。前后端分离改变现有本地执行与数据职责，需要明确哪些模块随之适配。
- 后端独立建图。前端研究可以并行；最终交互职责应与后端骨架决策对齐。

关联路线：[后端骨架设计：基于 dsh 的多用户插件装配](https://github.com/eafen405/OurFairy/issues/1)。

## Decisions so far

- [研究前端 fork 的模块价值：保留、适配与剪枝候选](https://github.com/eafen405/OurFairy/issues/6)：已核查模块与依赖；视觉和展示能力可复用，客户端执行与权威会话职责需调整，候选取舍由最终前端边界决议收束。
- [研究 rikkahub 架构：客户端模块分层与运行时数据流](https://github.com/eafen405/OurFairy/issues/17)：已绘制 4 张 Mermaid 图（模块分层架构、用户发消息端到端序列、配置工具侧链、通知外部触发侧链），13 个模块按深模块视角写成说明。rikkahub `UIMessage` 与 dsh `Message` 不一一对应已显式标注。资产在 [`research/rikkahub-architecture` 分支](https://github.com/eafen405/OurFairy/blob/research/rikkahub-architecture/docs/research/rikkahub-architecture.md)。

- [确定前端首版边界：功能取舍与后端契约](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)：已确定入口与功能取舍、群组对话管理、每会话统一通知、任务与投递呈现，以及旧版性能复用和最终格式完整性要求。

## Not yet specified

无。本图范围内的产品决定已收束；具体协议接线、视觉迁移和性能参数按最终决议进入工程实施与验收。

## Out of scope

- 前端代码剪枝、UI 移植、协议接线、性能调优与发布的实际执行；目标手机行为及性能验收随实现开展。
- 后续 Web 入口与 Android 的关系，以及 React + TypeScript 网关的设计和实现。
- 后端用户隔离与插件装配的内部实现，由后端地图处理。


