# OurFairy

面向受邀小群体的产品。以 dsh 为底层操作系统，运行于远程服务器，通过插件补充功能，Android app 作为客户端。

- `android/`：前端壳，负责视觉与交互。
- `backend/`：产品业务插件，以 dsh 插件形式挂载；优先复用 dsh 上游功能。刻意不采用的部分及理由见 [生态边界](docs/architecture/dsh-ecosystem-boundary.md)。

服务端源码为 TypeScript，Android 端为 Kotlin。

## 目录

| 目录 | 内容 |
| --- | --- |
| `backend/` | 产品模块与显式后端装配（dsh profile 的 bundle 与各产品包） |
| `android/` | Android 客户端。标准 Gradle 工程，内部结构与上游 RikkaHub 保持原相对位置 |
| `scripts/` | 后端入口 `ourfairy-backend.ts`、版本组合 `combo.ts`、验收与基准脚本 |
| `tests/` | 产品测试与仓库结构检查：行为测试经启动器驱动真实后端，模型与网络使用替身 |
| `docs/` | 规格、架构边界、决策与调查 |
| `work/` | 实施期工作区：票面副本与交付证据 |

## 条件

| 需要 | 版本 / 位置 |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.2.0`（`import.meta.main` 自 22.18.0 与 24.2.0 起提供） |
| pnpm | 经 corepack 固定：`corepack pnpm@11.28.5` |
| deepseek-harness 检出 | `combo.json` 的 `repos.dsh.localPath` 为默认位置提示，相对路径按主检出解析；检出不在该处时用 `OURFAIRY_DSH_DIR=/path/to/deepseek-harness` 覆盖，命令与测试均识别 |
| Linux 沙箱 | bubblewrap（`bwrap`），允许创建非特权用户命名空间 |
| 构建互斥 | util-linux 的 `flock` |
| PDF 页面渲染 | Poppler（`poppler-utils` 的 `/usr/bin/pdftoppm`） |
| JDK / Android SDK | 仅构建客户端时需要，见下文 |

后端测试驱动真实 dsh 启动链路，因此 dsh 检出须先按 `combo.json` 的 `repos.dsh.requiredBuild` 四条命令构建：`build:lib:host`、`build:lib:client`、`build:native-system`。缺任一条会在运行期以缺模块失败。CI 构建步骤为 `node scripts/combo.ts build`，直接执行该记录。

`npm run backend:doctor` 的 `dsh CLI build` 项仅确认 `build:lib:host` 的 CLI 产物（`apps/cli/lib/bin.js`）与锁定提交；`build:lib:client` 与 `build:native-system` 无前置检查，缺失会在加载客户端入口或打开 JSONL 会话日志时失败。

## 测试

```sh
npm run build       # 编译产品包：链接类型、清理产物、tsc -b
npm test            # 构建并持锁运行 tests/**/*.test.mjs
npm run combo:verify   # 组合登记表自洽：本仓库、dsh、客户端来源三条
npm run backend:doctor # 本机检出可用：工具链、profile 装配、包与行、插件兼容、原生能力
npm run specs:status   # spec 与小修批次的推送、合并、内容落地与 worktree（--offline 跳过 tracker）
```

`combo:verify` 校验登记表；`backend:doctor` 校验本机环境。

本机无 dsh 检出且未设置 `OURFAIRY_DSH_DIR` 时，`combo:verify` 将 dsh 行记为 skipped，不算组合失败，提交门禁不会因环境缺检出而拒绝；显式覆盖指向不存在路径仍失败，`backend:doctor` 也要求检出存在。

| 命令 | 检查的事实 |
| --- | --- |
| `combo:verify` | 组合登记表自洽：本仓库基于集成分支、dsh 分支 tip 等于锁定提交（本机无检出时该行记 skipped）、客户端来源与声明一致 |
| `backend:doctor` | 本机检出可用：dsh 检出存在、处在锁定提交、`build:lib:host` 的 CLI 产物（`apps/cli/lib/bin.js`）存在、profile 装配与插件兼容 |

两者分工：dsh 分支 tip 一致但工作树停在别的提交时，`combo:verify` 通过而 `backend:doctor` 失败——后者依次检查检出存在、`apps/cli/lib/bin.js` 已构建、工作树 HEAD 与锁定提交一致。

`npm test` 不联网、不调用真实模型：经启动器起真实后端，模型与网络使用替身。耗时以输出的 `duration_ms` 为准，测量见 [验证记录](work/implementation/evidence/repo-environment-2026-10-22/README.md)。

产品包源码为 TypeScript。`npm test` 通过 `scripts/test.ts` 先编译，并从构建到测试结束持有工作树文件锁。另一条 `npm test`、`npm run build`、`npm run typecheck` 或 `npm run clean` 会等待该锁；测试文件之间由 Node 并行执行。锁随持有进程退出释放，不按 PID 或文件年龄抢锁。回归检查见 `tests/build-lock.test.mjs` 与 `tests/test-runner.test.mjs`。TypeScript 取自 `combo.json` 锁定的 dsh 检出，非本仓库依赖。

单独运行一个文件时使用同一入口：

```sh
npm test -- tests/chat-read-window.test.mjs
```

`node --test` 可用于已完成构建后的直接调试，但绕过工作树锁，不应与构建同时运行。

常用测试入口：`tests/owned-sessions.test.mjs`（会话归属与管理身份不越权）、`tests/bundle-packages.test.mjs`（bundle 行与包集合一致）、`tests/native-capabilities.test.mjs`（四项原生能力在位）、`tests/android-source.test.mjs`（客户端来源声明与组合一致）。

### 提交前钩子

```sh
npm run hooks:install   # git config core.hooksPath .githooks
```

之后每次提交（含合并提交）经过门禁：`.githooks/` 提供 `pre-commit` 与 `pre-merge-commit`，均执行 `scripts/precommit.ts`（结构由 `tests/precommit.test.mjs` 固定）。

门禁按改动内容分四类：

- 仅改 Markdown：跑 `tests/docs.test.mjs`；
- 能选出相关测试：通过 `scripts/test.ts` 构建并运行选中测试文件；
- 源码改动但无法选出相关测试：跑 `npm run typecheck`；
- 根构建权威、包 manifest、共享 fixture、合并提交或 `--full`：跑全量 `npm test`。

四类均保留 `npm run combo:verify`；`android/` 的非 Markdown 改动另运行 `cd android && ./gradlew test lintDebug`。失败即阻止提交或合并；检查针对当前工作树，未暂存改动同样影响结果。全量检查仍在交付前与 CI 运行。

### CI

`.github/workflows/check.yml` 在 push 到 `main` 或 `integration/**`、以及手动触发时运行 Node 全量门禁：按组合锁检出并构建 dsh，运行 `npm test`（含产品构建）与 `npm run combo:verify`。产品构建与测试在同一工作树锁内完成。

独立的 `android` job 用 JDK 17 在 `android/` 运行 `./gradlew test lintDebug`，Google Services 配置由伪造 fixture 合成。

PR 同步不触发——带改动的 integration 推送会运行一次，重复触发只是把同一套件跑两遍。本地钩子可被 `--no-verify` 跳过，服务器端不会。

## 真实服务验收

```sh
npm run acceptance:real
npm run acceptance:real -- --skip-pdf --skip-asr
npm run acceptance:real -- --plan --skip-pdf --skip-asr
```

`acceptance:real` 为操作者显式发起的真实服务验收，不属于 `npm test` 或 CI。默认调用当前组合的真实云模型、执行 PDF 扫描页路径并调用 TTS/ASR 外部服务，需相应凭据。`--skip-pdf --skip-asr` 仅保留真实文字模型路径，不要求 `VOICE_API_KEY`，不调用 TTS/ASR；跳过项记入报告 `unexecuted`。`--plan` 仅预览选择，不读取凭据、不启动后端、不调用服务。

```sh
set -a; . /path/to/MINIMAX_API_KEY.env; set +a
export MINIMAX_CN_API_KEY="$MINIMAX_API_KEY"
npm run acceptance:memory
npm run acceptance:memory -- --plan
npm run acceptance:memory -- --only supersede,maintenance-skip
```

`acceptance:memory` 为记忆增量（规格 #240）的真实轻量模型质量样本，不属于 `npm test` 或 CI。使用真实 MiniMax 路由启动产品后端，拒绝回环模型替身，逐条记录提示词、模型工具决定与最终数据库行。维护门槛通过真实 `/gateway/maintenance` 路由降至 5 回合 / 3 小时，不伪造 15 轮噪声。stdout 为完整 JSON 报告，`--plan` 仅列出案例；未执行案例不计为通过。证据见 [`work/implementation/evidence/248-memory-integration-acceptance/`](work/implementation/evidence/248-memory-integration-acceptance/README.md)。

```sh
npm run acceptance:persona -- --plan
npm run acceptance:persona -- --samples 3 --out /tmp/persona.json
```

`acceptance:persona` 经真实产品启动器与聊天入口采样，包含当前工具、运行时事实与印象。模型路由来自运行中网关，报告保留回复、工具结果、用量与装配清单。自动检查仅检查采样完整性与实际工具证据，不按词汇、格式或字数评价人格；通过的样本仍标为 `review-required`。人工复核需结合完整对话，关注 Fairy 人格、潜台词、自然互动、多轮连续性与任务质量，并核对称呼、来源声称与实际动作。失败与未执行不计为通过。需真实模型凭据，不属于 `npm test` 或 CI。

## 服务端测试

```sh
npm run backend:start    # 起在隔离 home 里，profile 由 bundle 生成
npm run backend:status
npm run backend:stop
npm run backend:doctor
```

隔离 home 默认位于 `<worktree>/.ourfairy`，可用 `OURFAIRY_HOME` 覆盖；引擎 home 为其下的 `dsh-home`（`DSH_HOME`）。修改产品包内容后，启动器按内容哈希自动重装 profile；强制重装加 `-- --reinstall`；机器可读自检结果用 `-- --json`。产品包以独立副本安装，修改一个 profile 的文件不影响仓库或其他 profile。

## 构建客户端

客户端为独立 Gradle 工程，根 `package.json` 不包装它。命令均在 `android/` 内发起。

```sh
cd android

# 单测与静态检查
./gradlew test lintDebug

# 调试包
./gradlew assembleDebug

# 发布包（必须给出后端身份入口）
./gradlew assembleRelease -Pourfairy.identityEndpoint=https://your-backend.example
```

需要 `ANDROID_HOME` 指向 SDK 根目录，并准备下列本地文件（均不入库）：

- `android/local.properties`：`sdk.dir=/path/to/Android/Sdk`；发布签名另需 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。
- `android/app/google-services.json`：Google Services 插件缺它会硬失败，需要桩文件。桩中的 key 为假，Firebase/Crashlytics 运行时不可用——任何崩溃上报或真机结论都必须声明这一点。

实测 SDK 工具链：`compileSdk` 解析到 `android-37.2`（见 `android/app/build.gradle.kts`），AGP 自动安装该平台，首次安装会延长构建；构建使用 build-tools `37.0.0` 与 NDK `28.2.13676358`。

测试通过、APK 构建成功、真机验收为三件不同的事，分别报告。

## 版本组合

[combo.json](combo.json) 记录当前产品组合：本仓库锁集成分支，dsh 锁提交，客户端记来源提交。`npm run combo:verify` 打印三行——两行仓库、一行 `android source`，最后一行比对 `combo.json` 的来源提交与 `android/ourfairy-source.json` 的声明，不一致即失败。

`doctor` 的 `combo combination` 报告中也出现同一行同一提交，由 `tests/lifecycle.test.mjs` 断言。这两个文件是唯一的两处来源记录，改一处而另一处不动会导致校验失败。

研究用上游 SHA 是调研基线，不等于产品提交；任何报告不得将其视为已含产品改动。

## 基准

```sh
npm run bench:projection -- --label after --out /tmp/after.json   # 真实启动器 + 模型替身，约一分钟
npm run bench:gate -- --baseline <before...> --after /tmp/after.json
```

`bench:gate` 只看相对比值，不设绝对毫秒门槛。

## 来源与许可证

本仓库按 [AGPL-3.0](LICENSE) 授权。客户端派生自 [RikkaHub](https://github.com/rikkahub/rikkahub)，沿用同一许可证——根 `LICENSE` 与 `android/LICENSE` 必须同文，`tests/android-source.test.mjs` 对此断言。Fairy 视觉实现包含 Fairybot 的 MIT 许可代码，原声明随客户端保留在 [FAIRYBOT_MIT.txt](android/app/src/main/assets/licenses/FAIRYBOT_MIT.txt)。

客户端以快照方式并入，来源分支与提交记录在 [android/ourfairy-source.json](android/ourfairy-source.json)，与 `combo.json` 的 `androidSource` 由组合校验比对。它不再跟随上游，不存在例行合并。

将来取上游修复时手工挑选：从归档的 `eafen405/rikkahub` 取出某提交，评估后在 `android/` 落地，并在提交说明中写明来源提交与理由。声明中的来源提交保持为快照基线；仅整体重新导入快照时修改。

## 历史证据与旧路径
`work/implementation/evidence/` 与 `docs/research/` 下 2026-10-20 之前的记录。
