# T14 独立合并验证

精确合入 OurFairy `450418776f73f925ff8429acc5af50c0f9ba8263` 与 Android `fa83e9ce29e33f4aa506f209903c54f85bce8cff`；dsh `fc5c7ac0220cf48c404cda34d1584901387eea06` 保持不变。组合锁已同步。

在实际集成根目录和默认 native 产物独立执行：

- `node --test --test-name-pattern='actual confined job survives|accepted consecutive turns' tests/jobs.test.mjs`：2/2，通过任务/报告连续活动及连续输入结算场景。
- `npm test`：102/102，通过。
- `npm run combo:verify`：通过。
- `npm run backend:doctor -- --home /tmp/stage1315-t14-integration/doctor-home`：通过。
- `git diff --check`：通过。

原始输出在本目录 `.log.gz`。完整 owner 实际 profile 15/15、Android JVM 57/57、APK 构建和实际后端样本的生产 serializer 检查见 `../../14-activity/README.md`。未重复所有 owner 检查。

验证使用真实 profile/Loader、会话日志、受限进程和本地模型网络替身；未执行官方云模型、设备/模拟器、APK 连接真实后端、性能或最终产品验收。两轴审查在 T13–T15 整批完成后运行。

根目录原有 16 个 dsh 脏文件的 post-T13 哈希全部相同、未暂存；快照见 `dirty-preservation.json`。Android 原有 `?? .worktrees/` 保留。正常提交与推送原文在 `/tmp/stage1315-t14-integration/`，远端精确核验随后向 Lead 报告；未变 dsh 仅核验，不重复推送。
