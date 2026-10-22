# OurFairy

面向受邀小群体、以 Android 为首个客户端的 Fairy 产品仓库。后端与客户端在同一个检出里，产品版本由
本仓库的一个提交表达。

产品由三部分咬合而成：`android/` 是一个前端壳，只做呈现与提交；`backend/` 是产品的业务插件，
以 dsh 插件（深模块、窄接口）的形式挂进后端；真正执行 agent 的是外部 fork 的 deepseek-harness。
凡是能靠原生接缝做到的就不自己写，刻意不采用的那几处连同理由与重新评估条件都写在
[生态边界：并行传输与保留的产品实现](docs/architecture/dsh-ecosystem-boundary.md)。

## 目录

| 目录 | 内容 |
| --- | --- |
| `backend/` | 产品模块与显式后端装配（dsh profile 的 bundle 与各产品包） |
| `android/` | Android 客户端。正常的 Gradle 工程，内部结构与上游 RikkaHub 保持原相对位置 |
| `scripts/` | 后端入口 `ourfairy-backend.mjs`、版本组合 `combo.mjs`、验收与基准脚本 |
| `tests/` | 产品测试与仓库结构检查：行为测试经启动器驱动真实后端，模型与网络使用替身 |
| `docs/` | 规格、架构边界、决策与调查 |
| `work/` | 实施期的工作区：票面副本与交付证据 |

## 先决条件

| 需要 | 版本 / 位置 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24` |
| pnpm | 用 corepack 固定：`corepack pnpm@11.28.5` |
| deepseek-harness 检出 | 路径与锁定提交见 [combo.json](combo.json) 的 `repos.dsh` |
| Linux 沙箱 | bubblewrap（`bwrap`），并允许创建非特权用户命名空间 |
| PDF 页面渲染 | Poppler（`poppler-utils` 提供的 `/usr/bin/pdftoppm`） |
| JDK / Android SDK | 只在构建客户端时需要，见下文 |

后端测试驱动的是**真实的** dsh 启动链路，所以那个检出必须先按 `combo.json` 的 `repos.dsh.requiredBuild`
四条命令构建过（`build:lib:host`、`build:lib:client`、`build:native-system` 各管一段，少跑一条会在
运行期以缺模块的形式失败）。`npm run backend:doctor` 的 `dsh CLI build` 一项会先替你确认。

## 跑测试

```sh
npm test            # 全量：node --test "tests/**/*.test.mjs"
npm run combo:verify   # 版本组合：本仓库、dsh、客户端来源三条
npm run backend:doctor # 环境自检：工具链、profile 装配、包与行、插件兼容、原生能力
npm run specs:status   # 每张 spec 的分支、推送、落地与 worktree 现状（--offline 跳过 tracker）
```

`npm test` 不联网、不调用真实模型：它经启动器起真实后端，模型与网络走替身。耗时随机器与并发负载
变化，以测试输出的 `duration_ms` 为准；本次环境修复的测量见
[验证记录](work/implementation/evidence/repo-environment-2026-10-22/README.md)。

单独跑一个文件：

```sh
node --test tests/chat-read-window.test.mjs
```

几个常看的入口：`tests/owned-sessions.test.mjs`（会话归属与管理身份不越权）、
`tests/bundle-packages.test.mjs`（bundle 行与包集合一致）、`tests/native-capabilities.test.mjs`
（四项原生能力在位）、`tests/android-source.test.mjs`（客户端来源声明与组合一致）。

### 提交前钩子

```sh
npm run hooks:install   # git config core.hooksPath .githooks
```

之后每次提交都会过一道门禁，按改动内容分流（`scripts/precommit.mjs`）：只改 Markdown 时跑
`tests/docs.test.mjs` 与 `npm run combo:verify`，其余改动跑 `npm test` 与 `npm run combo:verify`。
任一失败即阻止提交；检查针对当前工作树，未暂存的改动同样会影响结果。全量 `npm test` 仍在交付前与
CI 上跑，钩子只是不再让每条证据提交都等它。

### CI

`.github/workflows/check.yml` 在 push 到 `main` 或 `integration/**`、以及每个 PR 上跑同一道全量门禁：
按 `combo.json` 的锁检出并构建 dsh，再跑 `npm test` 与 `npm run combo:verify`。本地钩子可以被
`--no-verify` 跳过，服务器上的这次不会。

## 跑后端

```sh
npm run backend:start    # 起在隔离 home 里，profile 由 bundle 生成
npm run backend:status
npm run backend:stop
npm run backend:doctor
```

隔离 home 默认落在 `<worktree>/.ourfairy`，可用 `OURFAIRY_HOME` 覆盖；引擎自己的 home 在其下的
`dsh-home`（`DSH_HOME`）。改了产品包内容后启动器会按内容哈希自动重装 profile；要强制重装加
`-- --reinstall`；要看机器可读的自检结果用 `-- --json`。
产品包以独立副本安装，修改一个 profile 的文件不会改动仓库或其他 profile。

## 构建客户端

客户端是独立的 Gradle 工程，根 `package.json` **不**包装它——一条命令不该同时做两件耗时的事。
所有命令都在 `android/` 里发起。

```sh
cd android

# 单测与静态检查
./gradlew test lintDebug

# 调试包
./gradlew assembleDebug

# 发布包（必须给出后端身份入口）
./gradlew assembleRelease -Pourfairy.identityEndpoint=https://your-backend.example
```

需要 `ANDROID_HOME` 指到 SDK 根目录，并准备好下列**本地文件**（都不入库）：

- `android/local.properties`：`sdk.dir=/path/to/Android/Sdk`；发布签名另需 `storeFile`、`storePassword`、
  `keyAlias`、`keyPassword`。
- `android/app/google-services.json`：Google Services 插件缺它会硬失败，需要一个**桩文件**。桩里的 key
  是假的，Firebase/Crashlytics 运行时不可用——任何崩溃上报或真机结论都必须声明这一点。

实测的 SDK 工具链：客户端的 `compileSdk` 解析到 `android-37.2` 平台（取值见
`android/app/build.gradle.kts`），AGP 会自动安装该平台，首次安装会拖长构建；构建还使用 build-tools `37.0.0` 与 NDK `28.2.13676358`。

测试通过、APK 构建成功、真机验收是三件不同的事，分别报告。

## 版本组合

[combo.json](combo.json) 记录当前产品组合：本仓库锁集成分支，dsh 锁提交，客户端记来源提交。
`npm run combo:verify` 打印三行——两行仓库、一行 `android source`，最后一行把 `combo.json` 记录的
来源提交与 `android/ourfairy-source.json` 的声明比对，不一致即失败。

`doctor` 的 `combo combination` 报告里也出现同一行同一个提交，由 `tests/lifecycle.test.mjs` 断言；
这两个文件是唯一的两处来源记录，改一处而另一处不动，校验会失败。

研究用上游 SHA 是调研基线，不等于产品提交；任何报告不得把它当作已含产品改动。

## 基准

```sh
npm run bench:projection -- --label after --out /tmp/after.json   # 真实启动器 + 模型替身，约一分钟
npm run bench:gate -- --baseline <before...> --after /tmp/after.json
```

`bench:gate` 只看相对比值，不设绝对毫秒门槛。

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
