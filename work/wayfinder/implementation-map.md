## Destination

在已确认的首版产品范围内，查清会影响实施路线的关键兼容性与适配缺口，确定前后端共同接口、必要原生改动和实施依赖顺序，达到可以开始工程实施的程度。

终点是有证据支撑的实施路线及验证门槛；不要求本图实现首版或通过真机验收。此方向由用户在 2026-10-14 明确选择。

## Notes

- 延续已完成的[后端骨架设计：基于 dsh 的多用户插件装配](https://github.com/eafen405/OurFairy/issues/1)和[前端改造与剪枝：rikkahub 客户端与法厄同网关](https://github.com/eafen405/OurFairy/issues/2)，不重新打开旧地图。
- 产品规则以[确定后端最小装配：选用、替换与新增插件](https://github.com/eafen405/OurFairy/issues/9#issuecomment-6163738839)及[确定前端首版边界：功能取舍与后端契约](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)为准。字段、算法、包布局等常规实现选择由 agent 推导；只有具体证据表明既有要求存在冲突，才提出新的用户取舍。
- 使用 wayfinder、research、codebase-design；人工决策票使用 grilling 与 domain-modeling。保持深模块：规则留在各自模块，装配只连接依赖，不增加仅转发的统筹层。
- 研究以固定版本一手源码和官方文档为准，复用已有研究并明确本次增量。区分源码事实、建议和实际运行结果。研究结论不是自动采纳的设计决定。
- 允许为判断可行性开展隔离、可丢弃、无需真实凭据的最小探针；不修改产品仓库、不调用付费模型、不部署。探针无法执行时说明缺失条件，不把静态阅读当作通过验证。
- 每张研究票先 assign @me，再交给独立 subagent，资产保存在单独 research/* 分支的 docs/research/ Markdown 中。使用 GitHub 原生子议题及阻塞关系；地图仅索引结论。
- 现有本地未提交文稿保持原状；本轮研究使用独立分支。旧文稿中的待定项须与最终 resolution 对照，不能直接恢复为 fog。
- 待实施目标仍为小规模受邀多用户、官方 DeepSeek 共用对话模型、硅基流动 ASR、基于 rikkahub 的 Android 自用 APK；首批手机 vivo S50。后台提醒、投递和长任务的既定能力边界继续有效。
- 用户本轮确认 PDF 支持文字提取和扫描页/图表按需读图，需要官方视觉通路；音视频附件理解排除，既定 ASR 保留。详见[首版实施路线中的用户范围澄清](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6166922935)，具体实施按最终路线推进。

## Decisions so far

- [研究首版后端适配：装配闭包、会话归属与投递写入](https://github.com/eafen405/OurFairy/issues/19#issuecomment-6166961552)：查清显式插件注入闭包、原生会话/格式改动链和持久写入屏障；Loader 完整启动及产品兼容仍须实施验证。
- [研究跨端共同接口：会话投影、断线恢复与活动状态](https://github.com/eafen405/OurFairy/issues/20)：形成统一会话同步接口建议和四条恢复轨迹，区分实时观察与持久确认；活动聚合及首次同步取舍由最终实施路线收束。
- [研究首版输入链路：ASR、附件与 DeepSeek 官方接口](https://github.com/eafen405/OurFairy/issues/21#issuecomment-6166945444)：查清 ASR 配置适配、现有官方图片通路及 PDF 后端按页阅读的新增部分；音视频理解排除，PDF 范围按用户确认落实。

- [确定首版实施路线：共同接口、依赖顺序与验证门槛](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227)：已确定分阶段实施路线、共同接口与验证门槛，确认合并活动、首次通知基线及官方 Flash/PDF 路线；本图规划完成。

## Not yet specified

无。本图全部决策与研究已完成，实施路线足以开始工程工作；具体实现、集成验证与 vivo S50 验收按最终决议交接。

## Out of scope

- 首版产品功能实现、UI 迁移、数据迁移执行、部署、发布及真机验收的实际执行。
- 重开已经确定的用户归属、共享范围、群组管理、投递语义、通知规则、任务呈现和流式最终格式等产品决定。
- 子代理、记忆与印象蒸馏、定时任务、技能、个人模型或凭据、未来 Web、TTS、媒体生成、备份及其他已暂缓能力；本图不借研究自动扩展首版。
- 把提示词隔离等同于模型绝对遵从，或在未有产品决定时新增人格输出审查、学习与记忆系统。
- 音视频附件的内容理解兼容；不影响既定 ASR 语音输入。
