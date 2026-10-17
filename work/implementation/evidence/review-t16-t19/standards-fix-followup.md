# Standards 修复增量复查

范围：OurFairy `c820386` 与 Android `af9491ecc` 之后的未提交修复；只读审查，未改仓库。

**硬性规则：未发现新增的确认违规。** `settledAttempt` 只复制 dsh 原生 committed end 的 attemptId/seq；代际恢复归零、abandoned 清空，未复制消息或活动权威。固定 dsh `packages/core/agent/src/runtime-types.ts:148` 和 `packages/core/agent-loop/src/assistant-stream.ts:91` 支持此契约。可选字段默认 null，现有 JSON 解码忽略未知键，兼容旧组合。

实际 UI 从 `RemoteChatPanel` 传入 generation/attemptId/seq；`RemoteTranscriptPresentation` 只保留已观察 live 行的局部 key 别名与格式延后，按精确 seq 接续，离开可见区或回到尾部即释放，冷历史不延后。未引入数据库、权限或持久化状态。

* *测试与证据：**  为真实公开 HTTP 断言失败， 8/8 通过； 为运行时断言失败， 通过。 是新类型不存在导致编译失败，应明确该性质； 名称虽含 green，实际编译失败，随后  与  成功。`11-npm-final.log:141` 仍有 PDF worker-unavailable 失败，最终完整检查门槛尚未满足，不能以 Android 成功替代。原 T19 首批实现后首绿的历史流程偏离保持原记录。

**Fowler 判断项：** 未发现值得增加抽象的异味。局部行类型与可见性状态服务已观察的阅读跳变，规模合适；不建议为可选 hint 再建事件、缓存或通用过渡框架。

源码已保存到 `standards-fix-sources/`；两仓 diff 独立保存在 `standards-*-fix-snapshot.diff`；逐文件 SHA256 与受审 HEAD 见 `standards-fix-source-hashes.json`。完成提交后只需核对源码一致性。本次未重跑长测试，以日志原文及实际接线为依据；最终 npm/combo 检查由集成负责人继续完成。

最终提交复核：OurFairy `7dae93a9591c2d911bd42b56779f06bd2439012c` 的三文件、Android `771bffd1424da0f8537507caec028e77d0b8b7bc` 的六文件，逐文件 SHA256 全部与受审快照一致。核验原文见 `standards-ourfairy-committed-source-check.json`、`standards-android-committed-source-check.json`；集成负责人独立复核见 `final-committed-source-check.json`。本次未重新运行测试。
