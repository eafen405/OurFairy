# 会话命令集成收口、审查与交付证据

Part of #342。依赖 Android 接线与保留/恢复组合验收两票，GitHub 原生 blocked-by 为实时权威。

## 目标

以 [正式规格](../../../docs/specs/session-commands.md) 为依据，在单一 `integration/spec-342` 分支收口，不扩展功能范围。

## 交付

- 调用 `tdd` skill（本票以现有检查与行为缺口补测为主，不为文档创建镜像测试）。核对规格必测场景与已有测试、证据；仅为未覆盖的真实行为补测试/必要修复。
- 更新实施证据索引和增量规格入口；数据变化明确为现有日志事件/投影与客户端恢复元数据，不增加业务表或记忆/技能库迁移。
- 集成状态独占运行 `npm test`、`npm run combo:verify` 与 `cd android && ./gradlew test lintDebug`，记录结果、工具链、替身边界与未执行的设备/真实服务验收。
- Lead 在全部子票完成后调用一次 `code-review` 对固定基线运行 Standards/Spec 两轴，并核对可执行声称；发现问题由单一 fresh implementer 修复所属模块，再按影响面复验。
- 清理本轮 implementer worktree/临时产物；发布集成分支与提交证据，按 issue tracker 关闭完成票与父规格。未经实测不宣称真机通过。

本票写范围主要为 `work/implementation/evidence/342-session-commands/`、对应 evidence/index 描述、`work/tickets/342/`、实施约定的规格登记及必要的局部验收缺口。完成前合入集成 tip，返回 SHA/证据。
