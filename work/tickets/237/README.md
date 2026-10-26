# #237 流式渲染异常

票：[GitHub #237](https://github.com/eafen405/OurFairy/issues/237)。GitHub issue 是发布权威，本目录是实施工作副本。

基线：`main` @ `d56b928c2e`；分支：`ticket/237-stream-refresh`；worktree：`.worktrees/237-stream-refresh`。

## 现象与实证

Fairy 文字正文的总生成速度正常，但可见刷新频率低，大段文字一次出现，不符合预期的打字机式连续呈现。

空会话确定性复现使用每次 80 字符、间隔 333 ms 的累计正文：模型、SSE、Android 状态与 Compose 均只有 6 次推进，呈现约 3 次/秒、单次最多增加 80 字符，总速率仍约 226 字符/秒。细分片在同一 vivo S50 上可达到约 28 次/秒，因此问题不是设备只能低频呈现，也不是中间快照在网络或状态层丢失。

`RemoteTranscriptPresentation.update` 直接把完整 `attempt.text` 放入视觉行，现有呈现接缝没有大增量分帧推进。

## 实施约束

- 只改 Android 现有呈现 implementation 与测试，不改后端、网络 DTO、SSE、数据库或持久状态。
- `RemoteTranscript` 的公共输入不变；行身份仍由 generation 与后端 attempt/settlement 决定。
- 实时大增量逐帧推进，使用 Unicode 码点而不切分代理对；待显示内容较多时加速，避免形成持续增长的积压。
- 正式消息不等待实时分帧队列，下一帧发布完整正文；输出结束、停止和失败后的最终格式语义不变。
- 打开复制菜单后，即使可见正文仍是部分前缀，复制实时行仍取得已经到达的完整正文。
- 保留阅读位置、历史消息、工具名、附件、下载与既有性能测量入口。

## 验收

- 经现有 `RemoteTranscript` Compose 入口证明：大增量先显示部分正文，随后显示完整正文。
- 经相同入口证明：分帧期间到达的正式消息发布完整正文。
- 经现有复制测试证明：菜单打开后，大增量处于部分显示时仍复制完整已到达正文。
- 相关行身份、阅读位置、复制和工具行回归通过；最终运行 `npm test`、`npm run combo:verify` 与 Android `test lintDebug assembleDebug`，并编译 perf 源集。
- 当前 USB 设备不可连接，修复后的 vivo S50 真机复测记为待执行，不以 JVM/Robolectric 或构建结果替代。
- 用户决定先合入 `main`，真机体验由本人进行；本 issue 在体验确认前保持打开。

## 范围外

- 不改变模型分片、后端 32 ms 发布、网络压缩、状态合流或恢复语义。
- 不引入新的公开呈现接口、持久行键、第二份消息权威或通用动画框架。
- 不处理 #223/#224/#233 的实施、合并或关闭。
