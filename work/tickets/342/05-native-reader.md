# DSH V4 冷读取器识别投递消息的 surface 位置

Part of #342。#345 的真实投递/clear 竞争回归发现本前置缺口。此次原生补丁仅修正现有投递事件的校验与重放，不增加命令能力、事件类型、业务表或数据格式版本。

## 已复现的缺口

产品测试：`tests/session-commands-recovery.test.mjs` 中 `real cross-user delivery`，两轮投递与 clear 后在线正常、冷读 `/chat/read` 返回 500；减少为一轮通过。确切栈：`SessionPersistenceCorruptionError → SessionFormatError: compaction/prune shadowedSeqs do not name an exact current surface span`。

锁定 DSH `ae2adffd8d67773e125b8048120cf9ad2ba7edf3` 的 `packages/session/session-format-v3-to-v4/src/relationships.ts`，`SURFACE_TYPES` 缺少 core 会话已支持的 `delivery/message`，`accept` 因关系类型集合过滤而跳过投递；校验器维护的 current surface 与真正写出的 surface 不一致。不能通过删除真实 shadowedSeqs 规避验证。

## 最小交付

- 在 DSH 自己的独立 `ticket/<票号>-delivery-v4-surface` worktree 从锁定 `master` 开始；修复范围优先只在 V4 relationships 与所属回归测试/必要包文档。
- 先调用 `tdd`，沿原生既有格式读取/重放 seam 建立秒级失败回归：合法完整 surface 包含投递节点的 prune/replacement 可以冷读、恢复相同有效内容；第二轮 replacement 仍成立。
- 保持完整校验：遗漏真实投递节点、不存在/乱序端点或错误 sourceEventSeqs 的无效 span 仍拒绝。只修已知事件遗漏，不泛化为新框架或削弱校验。
- 使用 `diagnosing-bugs` 记录原始产品失败、最小原生回归红灯、单变量最小修复与绿灯；最终移除临时 debug 日志。原产品回归在新的锁定组合重新运行。
- 不改变公开类型、事件结构、格式版本或其他格式代际；若发现额外必要修改，先报告证据与最小范围。
- 提交后交 Lead 指定 merger 合入 DSH fork 的 `master`，按组合约定构建必需产物，并将本产品 `combo.json` 更新到修复提交。各层分别记录实际命令与结果；DSH fork 与产品集成分支在收口时统一推送。

## 验证与证据

原生遵循该仓库 `AGENTS.md`、`packages/AGENTS.md`、架构/持久格式及 pre-push 指针，跑相关格式/持久化回归与必要类型/构建检查，不默认跑原生全量。产品的最终全量由 #346 执行。产品证据记录在 `work/implementation/evidence/342-session-commands/05-native-reader/README.md`，含原生提交、固定版本、红绿命令、未执行项和不改格式的依据。

本票完成并更新产品锁后解阻 #345。实现者不直接 push/关闭票；由 Lead merger 与收口处理。
