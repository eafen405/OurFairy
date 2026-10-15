# #24–#27 阶段交接与停工点

用户要求本阶段收尾后停止，#28 尚未开始实现。下一次工作从读取最新 GitHub 依赖、集成分支和本文件开始，不自动推进。

## 已发布结果

- OurFairy：`integration/ourfairy-v1`；产品组合与最终验收提交 `9feb689`，用户 AGENTS.md 单独提交 `86c561f`，之后只有阶段记录收尾。
- dsh：`product/ourfairy-v1`，`d3fe98f969c3963c6d193e74c776692e33c1eb64`。
- rikkahub：`product/ourfairy-v1`，`fd04aab78919a7816e6eb962949a6eaf13a41532`。
- 三仓均正常推送，无强制推送或钩子绕过。dsh 正常推送前类型检查通过；两 fork 的该提交目前没有 GitHub Actions 运行记录，不将无记录当作 CI 通过。

#24–#26 已完成两轴阶段性审查：Standards3项、Spec3项，均已在所属模块修复。见 `../evidence/review-24-26/README.md`。

#27 两端已集成；最终完整产品套件40/40，dsh导出80/80与干净Host构建，Android定向42/42与debugAPK通过。证据见 `../evidence/04-owned-sessions-backend/` 和 `../evidence/04-owned-sessions-android/`。#27交付评论与关闭按已发布结果同步。#23保持打开。

未执行真机/Compose运行、APK到真实后端连接、签名release或真实云模型/ASR调用。已有Firebase假key桩不支持运行验收。保留这些边界，勿把JVM/构建结果改写为真机通过。

## 后续实现的最小接口

#27只保存正式空会话header并关闭writer，归属权威仅SessionHeader.owner；固定主会话ID来自不可变用户编号，无新业务表。`ctx.ourfairySessions`已经按Cordis Service发布，普通内部成员可被代理调用。#28先检查归属，再复用原生agents.resume接管空会话；实际接管测试已通过，owner/id不变。无需新增Agent attach接口或竞争writer。

#28只读接口定位与准备文件在 `/tmp/ourfairy-stage-review/ticket28-seams.md` 和 `ticket28-ready-handoff.md`。它们是准备材料，不能当作已实现或已测试的#28功能。可复用正式inbox insertion日志做requestId接纳对账，避免第二个消息/receipt库。详细人格文本选择尚未收到用户答复；部署人格与外部来源区分的规格保持适用。

## 工作方式与保护范围

- 非审查任务优先经delegate-harness派给mcode（用户说明模型M3.1），给定具体边界和公开验收接口，核验实际diff/日志，退出0不自动代表完成。
- 用户已授权dsh使用完全权限，继续沿用dsh web选择的luo路由；模型报错时转自己的实现子代理。调用前核实当前CLI支持的权限选项，不用猜参数、不泄露配置凭据。
- 相关一张或几张ticket完成后用code-review两轴子代理评审；下一检查点是#28纵向链路完成后，增量基点为本轮审查完成后`f8bb706`，不是每个修正单独评审。
- 最新AGENTS要求涉及数据结构的改动在设计阶段明确告知用户；不能因测试通过便认定新增结构有必要。
- dsh根目录16个既有未提交文件仍原字节保留；不要混入后续实现或撤销。各实现分支在独立worktree，旧研究与源码事实分开。
