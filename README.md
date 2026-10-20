# OurFairy

OurFairy 是面向受邀小群体、配有 Android 客户端的 Fairy 产品仓库：后端与客户端在同一个检出里，
产品版本由本仓库的一个提交表达。

## 目录

| 目录 | 内容 |
| --- | --- |
| `backend/` | 产品模块与显式后端装配（dsh profile 的 bundle 与各产品包） |
| `scripts/` | 后端入口 `ourfairy-backend.mjs`、版本组合 `combo.mjs` 与测量/基准脚本 |
| `android/` | Android 客户端。正常的 Gradle 工程，内部结构与上游 RikkaHub 保持原相对位置 |
| `tests/` | 产品测试与仓库结构检查：行为测试经 launcher 驱动真实后端，模型与网络使用替身 |

外部依赖只剩一个：dsh fork 按提交锁定，因为它的上游仍在演进。客户端的来源是 `android/` 内的
声明文件，不再跟随上游（见[来源与许可证](#来源与许可证)）。

## 两个入口

后端与客户端各有入口，根 `package.json` **不**包装 Gradle——一条命令不应同时做两件耗时的事。

```sh
# 后端
npm test                  # 产品测试
npm run combo:verify      # 版本组合校验
node scripts/ourfairy-backend.mjs start|stop|status|doctor

# 客户端（在 android/ 内，入口仍是 wrapper）
cd android
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=https://your-backend.example
```

客户端自己的构建与模块说明见 [android/README.md](android/README.md)。

### 客户端构建前置条件

以下都是本地文件，**不入库**；`tests/android-source.test.mjs` 会对这些路径的忽略结果与已跟踪文件断言：

- JDK 21 与 Android SDK；SDK 版本由 Gradle 配置指定。
- `android/local.properties`：`sdk.dir=/path/to/Android/Sdk`；release 签名另需 `storeFile`、
  `storePassword`、`keyAlias`、`keyPassword`。
- `android/app/google-services.json`：Google Services 插件在缺失时会硬失败，需要自备**桩文件**。
  桩里的 key 是假的，Firebase/Crashlytics 运行时不可用，任何崩溃上报或真机结论都必须声明这一点。

## 版本组合

`combo.json` 记录当前组合：本仓库锁集成分支，dsh 锁提交，客户端记来源提交。
`npm run combo:verify` 打印三行——两行仓库、一行 `android source`；最后一行把
`combo.json` 里记录的来源提交与 `android/ourfairy-source.json` 的声明比对，不一致即失败。
`doctor` 的 `combo combination` 报告里也出现同一行与同一个提交，由 `tests/lifecycle.test.mjs` 断言；
这两个文件是唯一的两处来源记录，改一处而另一处不动，校验会失败。

研究用上游 SHA 是调研基线，不等于产品提交；任何报告不得把它当作已含产品改动。

## 提交前检查

```sh
npm run hooks:install
```

该命令设置仓库的 `core.hooksPath=.githooks`，提交前依次执行：

- `npm test`：运行现有测试，包括外部模型替身测试。
- `npm run combo:verify`：核对 dsh 锁定提交、集成分支基线与客户端来源声明。

任一命令失败都会阻止提交，并保留原退出码。

检查依赖本地 `deepseek-harness` companion 目录；默认路径见 `combo.json` 的
`repos.*.localPath`。测试也使用 dsh 的模型替身服务。路径覆盖变量 `OURFAIRY_DSH_DIR`
与 `OURFAIRY_REPO_DIR` 及其解析规则见 `scripts/combo.mjs`。

仓库当前未启用 `extensions.worktreeConfig`，安装命令会修改 worktree
共享的 Git config；各 worktree 从自己的 `.githooks` 运行检查。
检查针对当前工作树，未暂存的修改也会影响结果，并非仅验证暂存快照。

## 来源与许可证

本仓库按 [AGPL-3.0](LICENSE) 授权。客户端派生自 [RikkaHub](https://github.com/rikkahub/rikkahub)，
沿用同一许可证——根 `LICENSE` 与 `android/LICENSE` 必须同文，`tests/android-source.test.mjs` 对此断言；
Fairy 视觉实现包含 Fairybot 的 MIT 许可代码，原声明随客户端保留在
[FAIRYBOT_MIT.txt](android/app/src/main/assets/licenses/FAIRYBOT_MIT.txt)。

客户端以**快照**方式并入，来源分支与提交记录在
[android/ourfairy-source.json](android/ourfairy-source.json)，与 `combo.json` 的 `androidSource`
由组合校验比对。它不再跟随上游，也不存在例行合并。

将来要取一个上游修复，走**手工挑选**：从归档的 `eafen405/rikkahub` 取出某个提交，
评估后在 `android/` 落地，并在提交说明里写明取的是哪个提交、为什么。
声明里的来源提交保持为快照基线；只有整体重新导入快照时才改它。

## 历史证据与旧路径

`work/implementation/evidence/` 与 `docs/research/` 下 2026-10-20 之前的记录，用
`/home/eafen405/projects/rikkahub` 这样的绝对路径和那里的提交号指代客户端。
这些记录**按原样保留**——它们是当时的记录。旧仓库 `eafen405/rikkahub` 保留为历史归档：
客户端在 2026-10-20 之前的提交只存在于那里，所以旧证据里的路径与提交引用要回归档仓库查，
不要在本仓库找第二个客户端目录。归档分支的推送状态与命令见
[合仓证据](work/implementation/evidence/123-client-merge/README.md)。

客户端在 2026-10-20 之前的提交历史只存在于归档仓库；本仓库不重写它，也不复制它。

## 架构

后端以 dsh profile 的插件组合运行。哪些原生接缝**没有**使用、哪些能力保留产品实现及理由，
以及各自的重新评估条件，见[生态边界：并行传输与保留的产品实现](docs/architecture/dsh-ecosystem-boundary.md)。
行与包的权威见 `backend/v1-bundle/cordis.patch.yml` 与 `backend/v1-bundle/package.json`。
