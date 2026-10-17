# T13–T15 阶段证据

## 开工基线（2026-10-16）

已完成 retro 调整通过正常 `git merge --ff-only integration/retro-guardrails` 合入 `integration/ourfairy-v1`。
本阶段产品增量审查从以下固定组合起算；retro 本身属于基线：

| 仓库 | 分支 | 基线提交 |
| --- | --- | --- |
| OurFairy | integration/ourfairy-v1 | ecd345327225100e252d665039e9ad668ea4c3bb |
| dsh | product/ourfairy-v1 | 173e155a85305db378dd92b1fa057ac6e6dea86e |
| rikkahub | product/ourfairy-v1 | b0911d34bdbe6ee8f559167ede41da95a9f082f8 |

实际命令及结果：

- `npm test`：93/93 通过，退出码 0；原文。
- `npm run combo:verify`：三个仓库组合核验通过，退出码 0；原文。
- 以上在允许本地网络/监听的沙箱外上下文运行；不是云服务、Android 平台或真机验收。

`baseline/initial-repositories.json` 与 `baseline/final-repositories.json` 保存分支、提交、全部已有脏路径及文件 SHA-256； 保存原始 porcelain 状态。快进与验证后 dsh 的 16 个已有脏文件字节不变，Android 原有 `??.worktrees/` 保留，OurFairy 干净。`baseline/summary.json` 为核验摘要。此前 /tmp 原始日志也保留。

本阶段计划见 `../../notes/stage-t13-t15-plan.md`。后续票面证据归各票目录，本目录用于阶段整合与审查。

首次文档提交的正常 pre-commit 检查出现既有 reconnect 测试读取尚未完整 JSON 的失败（92/93）；失败摘录在。未修改产品或测试，随后正常重试提交并保留检查结果。

## 阶段收尾

T13/#36、T14/#37、T15/#38 均已关闭；两轴审查 Standards 唯一 P3 已修、Spec 0。最终发布组合及精确 11 个 worktree 清理结果见 `closeout/README.md`，恢复指针为 `../../notes/stage-t13-t15-handoff.md`。本阶段完成后已停止，不启动后续票。
