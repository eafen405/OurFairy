# T15 独立合并验证

精确合入 OurFairy `5f00d871275684e257f1ff577aa83369aa554470` 与 Android `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6`；dsh `fc5c7ac0220cf48c404cda34d1584901387eea06` 保持不变。阶段审查固定基点为 OurFairy `ecd345327225100e252d665039e9ad668ea4c3bb`、dsh `173e155a85305db378dd92b1fa057ac6e6dea86e`、Android `b0911d34bdbe6ee8f559167ede41da95a9f082f8`。

最终集成检查：

- T15 fixture：1/1，通过真实持久投递、认证 projection 和 SSE 捕获；模型为本地受控替身。
- `npm test`：102/102，通过。
- `npm run combo:verify`：通过。
- `npm run backend:doctor -- --home /tmp/stage1315-t15-integration/doctor-home`：通过。
- `git diff --check`：通过。

首次未设置输出目录的调用失败已保留原始日志；设置票面要求的输出目录后捕获通过。原始输出在本目录 `.log.gz`。owner 的 136/136 JVM、APK 与实际 SSE→生产 RemoteChatApi/State→平台边界证据见 `../../15-notifications/README.md`。未执行官方云模型、真实设备/模拟器、APK 连接生产后端、性能或最终整体验收。

本提交仅归档阶段证据，不发布 T15。后续由 Lead 启动 T13–T15 一次两轴 Standards + Spec review。根 dsh 的 16 个既有脏路径未暂存，哈希全部保持；Android 既有 `?? .worktrees/` 保留。
