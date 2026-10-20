# OurFairy

OurFairy 是面向受邀小群体、配有 Android 客户端的 Fairy 后端项目。

安装版本化的提交前检查：

```sh
npm run hooks:install
```

该命令设置仓库的 `core.hooksPath=.githooks`，提交前依次执行：

- `npm test`：运行现有测试，包括外部模型替身测试。
- `npm run combo:verify`：核对 companion 提交及集成分支基线。

任一命令失败都会阻止提交，并保留原退出码。

检查依赖本地 `deepseek-harness` 与 `rikkahub` companion 目录；默认路径见
`combo.json` 的 `repos.*.localPath`。测试也使用 dsh 的模型替身服务。
路径覆盖变量 `OURFAIRY_DSH_DIR`、`OURFAIRY_RIKKAHUB_DIR`、
`OURFAIRY_REPO_DIR` 及其解析规则见 `scripts/combo.mjs`。

仓库当前未启用 `extensions.worktreeConfig`，安装命令会修改 worktree
共享的 Git config；各 worktree 从自己的 `.githooks` 运行检查。
检查针对当前工作树，未暂存的修改也会影响结果，并非仅验证暂存快照。

## 架构

后端以 dsh profile 的插件组合运行。哪些原生接缝**没有**使用、哪些能力保留产品实现及理由，
以及各自的重新评估条件，见[生态边界：并行传输与保留的产品实现](docs/architecture/dsh-ecosystem-boundary.md)。
行与包的权威见 `backend/v1-bundle/cordis.patch.yml` 与 `backend/v1-bundle/package.json`。
