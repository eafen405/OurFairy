# 会话命令后端：复用原生压缩与轻量上下文重置

Part of #342。

## 目标与边界

读取父规格 [#342](https://github.com/eafen405/OurFairy/issues/342) 与本地 [session-commands.md](../../../docs/specs/session-commands.md)。在现有 chat 插件中接入命令，不建立通用命令平台。`/compact` 直接调用锁定 DSH 的 `ctx.compaction.compactNow`；用户已澄清 `/clear` 尚未实现，用既有 surface replacement、maintenance 和持久化接缝完成同会话重置，优先不改 DSH。

## 写范围

`backend/chat/`、必要的既有同会话协调接缝、`tests/session-commands.test.mjs`、受新增路由影响的既有路由与投影测试。本票证据放 `work/implementation/evidence/342-session-commands/01-backend/README.md`。协议记录放该证据目录或 `backend/chat/README.md`，由后继票复用。

## 可观察交付

- 认证后的命令执行与结果查询，绑定本人目标会话、稳定操作身份和数字命令/结果编码；匿名、无归属及跨用户（含管理员）在副作用前拒绝。
- 命令不形成用户消息或 Fairy 普通聊天回合；反馈区分进行中、已压缩、无需压缩、已重置与具体失败。原生压缩设置不变。
- `/clear` 保持主/普通会话身份，旧原文、摘要、工具结果及激活技能正文退出后续模型请求；原日志继续追加，历史仍可读，系统装配保留。
- 复用 `runSession`、`runMaintenance`、持久 barrier；正在回复、有排队输入或未结束后台任务时即时拒绝，不停止、不排队命令。与新消息和投递协调，维护期间不能仅信 public idle。
- 沿现有日志表达受理、结果和重置边界，投影/page/observe 从该日志恢复系统状态与分界。无新业务表或第二份聊天权威。
- 同操作并发/迟到重试、写入失败及重启从持久事实恢复；不能再次清掉后续新消息。原生 `sourceCommandId` 是关联字段，产品仍需稳定操作去重。

## 验证

调用 `tdd` skill，经真实产品认证 HTTP 入口、确定性模型替身捕获后续模型请求，先验证命令、权限、忙态、同身份重试、耐久分界、旧历史与冷恢复。不得用扫源码测试代替行为。先跑相关测试，交付报告准确记录命令与未执行项。记忆/技能完整保留场景由后继集成测试票扩展。

从 `integration/spec-342` 最新 tip 开独立 worktree，完成前合入其最新 tip；提交并返回 SHA、协议指针和证据。
