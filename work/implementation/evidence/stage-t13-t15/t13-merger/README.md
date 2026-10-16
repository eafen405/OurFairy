# T13 独立合并验证

已将精确提交快进到对应集成分支：OurFairy `40bb5153a7ce60e50c749059cbb539ab83975e6d`、dsh `fc5c7ac0220cf48c404cda34d1584901387eea06`、Android `bb29c98b9a626e7c9781ac24b4fa185c092a6f4c`。`combo.json` 已锁定外部精确提交。

默认根目录 dsh 的源码已更新而 `lib/` 仍旧，先按源码项目和普通构建配置对齐三个改变的生产产物：

```sh
node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b packages/core/session/tsconfig.json packages/jobs/jobs/tsconfig.json packages/jobs/tool-jobs/tsconfig.json
corepack pnpm@11.28.5 exec tsdown --config-loader native --env.DSH_BUILD_FACE host --filter '@deepseek-ai/dsh-session' --filter '@deepseek-ai/dsh-jobs' --filter '@deepseek-ai/dsh-tool-jobs'
```

均退出 0；构建输出确认恰好三个目标包。`runtime-artifacts.json` 记录实际 lib 哈希及 lifecycle/report、代际字段检查。未声称根目录完整 host build 通过：其两个已有未提交测试类型错误仍保留。owner 的干净票目录完整 host/client 构建与 301 个原生测试证据见 `../../13-jobs/README.md`。

在 OurFairy 集成根目录、默认 dsh 路径独立运行：

- `node --test tests/jobs.test.mjs`：5/5，通过真实 profile、受限子进程、日志与本地模型网络替身。
- `npm test`：98/98，通过。
- `npm run combo:verify`：通过。
- `npm run backend:doctor -- --home /tmp/stage1315-t13-preintegration/doctor-home`：通过。
- `git diff --check`：通过。

原始 CLI 输出无损保存在同目录 `.log.gz`。未执行真实云模型、手机/模拟器、APK 连接实际后端、性能或最终整体验收。阶段两轴 code-review 在 T13–T15 全批完成后统一进行。

## 已有工作保留

原有 16 个 dsh 脏路径保持未暂存，13 个文件字节不变；3 个重叠生成文件只加入已提交 T13 变化，原来的未提交 hunk 内容完全相同（blob id 与位置因新提交变化）。`dirty-preservation.json` 保存逐文件前后哈希；构建及独立检查后再次核验相同。Android 仅保留原有 `?? .worktrees/`。未覆盖或提交这些已有修改。

正常推送和远端精确提交核验在以上检查及本证据提交之后执行；其原文写入 `/tmp/stage1315-t13-preintegration/` 并向 Lead 报告。不绕过 hooks、不强推。
