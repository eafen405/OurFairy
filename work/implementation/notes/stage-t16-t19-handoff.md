# T16–T19 阶段交接

用户授权的 T16/#39、T17/#40、T18/#41、T19/#42 已实现、发布并关闭。阶段 Standards + Spec 审查及修复复查已完成，本批 8 个 worktree 已清理；在此停止，不启动 T20。

起点与既有脏文件保护记录：`work/implementation/evidence/stage-t16-t19/baseline.json`。固定评审起点 OurFairy `1807199ffd86b1d1c2bfa816344d4e69f867b5cc`、dsh `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`、Android `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6`。沿用三仓现有集成分支。

依赖按实时状态实施：T17/#40 先完成并关闭，确认 T18/#41 的 blocked=0 后才启动 T18。四票现均 closed，父 #23 保持 open；阶段指针为 <https://github.com/eafen405/OurFairy/issues/23#issuecomment-6218948399>。

优先 mcode 承担有限搬运/UI/格式整理，困难权限与生命周期由经验子代理负责，独立子代理两轴审查。mcode 0.6.11 --check 已通过；用户已授权沙箱外运行与模型服务/运行目录访问。root notify thread `01a13eda-39df-73a2-8a68-bd210952941e`。

## 最终组合与检查

OurFairy 行为组合及审查闭环提交为 `d189d85bda0b6d0230b3fb96215e5d40f878a8a2`，之后只有本收尾文档；本仓自身仍以 `integration/ourfairy-v1` 锁定。Android `product/ourfairy-v1` 为 `771bffd1424da0f8537507caec028e77d0b8b7bc`，dsh 为 `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`。`combo.json` 已锁定，产品与 Android 均通过 SSH 正常发布并核对远端提交；dsh 本批无源码变更。

最终行为组合的正常 pre-commit：完整 `npm test` 109/109、`npm run combo:verify` 通过。Android 全量 JVM 515/515、release 构建通过。日志、发布和关票原文见 `work/implementation/evidence/stage-t16-t19/closeout/`。测试签名 arm64 APK 保留在 `/tmp/ourfairy-t16-t19-release/app-arm64-v8a-release.apk`，SHA256、来源提交和签名边界见 `closeout/release-artifact.json`。

## 实现与审查指针

- T16 后端认证 ASR、部署预算和 Android 录音/可编辑草稿：`work/implementation/evidence/16-asr/README.md`；真实账号/录音容器场景为同目录 `real-siliconflow-scene.md`。
- T17 复用附件资格、pypdf 与受控 worker，按页读文字并保留原件：`work/implementation/evidence/17-pdf-text/README.md`。
- T18 使用现装 Poppler 按选择页渲染，沿原生图像/官方 provider 工具结果通路：`work/implementation/evidence/18-pdf-vision/README.md`；官方真实联调入口为 `scripts/pdf-flash-smoke.mjs` 与同目录 `flash-smoke.md`。
- T19 保留 Fairybot 视觉、复用本地偏好/富文本与最新快照：`work/implementation/evidence/19-presentation/README.md`；固定负载、主机基线及 release 测量入口见同目录 `measurements.md`。

原两轴报告、修复复查及逐文件源码一致性核验在 `work/implementation/evidence/review-t16-t19/`。Spec 的唯一 P2 是长单条纯文本切换 Markdown 可能破坏阅读位置，已在独立修复分支解决：正在阅读的 live 行保留原文布局，离开该条或回尾后展示缓存的完整格式；使用 dsh 原生结算序号关联正式消息，避免按文字猜测。修复提交 OurFairy `7dae93a9591c2d911bd42b56779f06bd2439012c`、Android `771bffd1424da0f8537507caec028e77d0b8b7bc`，真实 red/green、全量检查及失败原文在 `work/implementation/evidence/review-t16-t19-fix/`。

Standards 确认 T19 首批测试未先复现的历史流程偏离；记录如实保留，不补造 red。后续修复已有真实公开接缝 red/green。构建并发期间曾出现 PDF 资源用例返回 `worker-unavailable` 而非预期 `resource-limit`；原因未确认，失败日志保留，未声称修复 PDF。最终正常提交检查 109/109 通过。

## 清理与验收边界

本批 8 个 worktree 全部移除，精确清单与前后记录见 `closeout/cleanup.json`。实现/修复分支、其他阶段 worktree、共享 node_modules 目标均保留；只 unlink 本批 worktree 的依赖链接。最后一个 review 子模块的临时 gitdir 指向已删除的 T19 路径，清理前以显式 work-tree 核验其固定提交及干净状态，未改共享配置。dsh 原有 16 个未提交文件内容哈希全部保留，见 `closeout/protected-dsh-final.json`。

真实硅基账号/手机麦克风、官方云图像理解，以及 vivo S50 帧耗时、内存和视觉连续性尚未运行。替身、JVM 和 release 构建不代替最终集成/真机验收。没有数据库结构变更，不新增活动或权限权威；后续按既定 T20–T22 票另行授权推进。
