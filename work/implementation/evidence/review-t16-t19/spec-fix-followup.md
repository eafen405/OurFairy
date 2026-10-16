# P2 修复复查

范围：OurFairy `c820386`、Android `af9491ecc` 到当前工作区；已保存 `ourfairy-fix-snapshot.diff`、`android-fix-snapshot.diff` 与两份 `*-reviewed.sha256`，新测试另存 snapshot。

结论：原 P2 在受审源码中闭环，未发现修复引入的实质缺陷。票19第5条、规格故事75/§7对应：RemotePresentation.kt:75–85 仅给已观察的 live 行按原生 settlement 关联正式消息；正在读且未追尾时延后布局转换，离视口/回尾永久释放，历史立即 rich。RemoteTranscript.kt:135–160 保持同一 key 与标题/正文结构；:234–244 仍后台完整解析，仅延后展示。停止/错误最终正文取正式消息，无同文去重。

后端 service.mjs:69–73 只透传 dsh 原生 end.outcome.seq；Android key 包含 generation/attempt，独立同文投递不会 alias。新测试覆盖末增量、停止/错误、回尾、离视口、历史和同文投递。既有用户滚动优先保留。

这是源码复查；最终提交需核对受审 SHA256，owner 的最终检查与真机布局验收不能由此替代。
