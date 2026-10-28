# OurFairy 仓库环境清扫

状态：本地 ticket 草案，尚未发布到 GitHub；发布前以 `CLEAN-xx` 引用，发布后替换为真实票号并设置原生 blocked-by。
探查基线：`main` @ `90dbdb6dc5e23f92cdf8d6054fba51f54308b153`。开工时以最新集成分支为准，重新核实所有现状。

## 目标

让 Agent 能信任仓库给出的状态、测试选择与文档导航，再以小型、可验证的改动消除明确的重复权威和快照残留；本地磁盘清理由独立票执行，不与产品代码交付混合。

## 任务图

| 文件 | 本地 ID | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-precommit-related-tests.md` | CLEAN-01 | 修复 related 门禁漏选已有行为测试 | 无 |
| `02-specs-status-ticket-copies.md` | CLEAN-02 | 修复命名票目录的 spec 发现与副本状态 | 无 |
| `03-agent-navigation.md` | CLEAN-03 | 修正现行文档入口与证据索引漏项 | 无 |
| `04-benchmark-workload-authority.md` | CLEAN-04 | 收敛基准工作负载形状的唯一来源 | 无 |
| `05-maintenance-policy-authority.md` | CLEAN-05 | 收敛记忆维护设置的代码策略来源 | 无 |
| `06-android-snapshot-residue.md` | CLEAN-06 | 删除高置信 Android 快照残留 | 无 |
| `07-generated-artifacts.md` | CLEAN-07 | 确认并回收本地可再生产物 | 无；不阻塞合并 |
| `08-closeout.md` | CLEAN-08 | 两轴评审、证据与全量门禁 | CLEAN-01～CLEAN-06 |

CLEAN-01～CLEAN-06 可按写范围并行。CLEAN-07 只操作本机产物，建议在 CLEAN-08 前完成，以让最终 Android 门禁覆盖一次真实重建；它不是代码合并依赖。

## 共同约定

- 每张代码票在自己的 worktree 中工作，先调用 `tdd` skill；重构票先固定现有行为，再改结构。
- 只写票面声明的范围，不做全仓格式化、依赖升级、上游同步或顺带重构。
- 不引入新的 lint、复杂度、重复率或 mutation 工具作为本轮前置条件；现有行为测试和门禁是验收权威。
- 不改写 `docs/research/`、历史证据与日期化决策的正文，不用测试判断文档内容是否正确。
- 主工作树现有未提交内容均属于活跃工作。特别避开 `GLOSSARY.md`、`docs/glossary/memory.md`、
  `android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentityPages.kt`、
  `android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt` 和未跟踪文件。
- 不接管现有 ticket/spec worktree，不删除 Git 引用、stash、恢复 bundle 或运行目录。探查时
  `ticket/249-fairy-persona` 有未推送提交，另一个 worktree 仍有后端进程；执行前必须重新核实。
- 每票按改动面跑测试；CLEAN-08 在最终集成状态运行全量后端与 Android 门禁。
- 交付证据遵循 `work/implementation/CONVENTIONS.md`；测试通过、构建成功与真实设备/服务验收分开报告。
