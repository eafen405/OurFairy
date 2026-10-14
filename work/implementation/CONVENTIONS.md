# OurFairy 首版实施：团队协作约定（唯一入口）

本文件是全体实施者与验证者的**共同上下文入口**。阅读本文件后，按其中指针读取规格、票面和研究，不要凭记忆或猜测行事。

## 0. 权威来源（按优先级）

1. 父规格：<https://github.com/eafen405/OurFairy/issues/23>（本地副本 `docs/specs/ourfairy-v1.md`）
2. 实施路线最终决议：<https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227>（本地 `docs/decisions/v1-implementation-route.md`）
3. 22 张实施票：GitHub issues #24–#45，本地副本 `work/tickets/ourfairy-v1/*.md`，任务图见 `work/tickets/ourfairy-v1/README.md`
4. 装配与适配研究：`docs/research/v1-backend-readiness.md`、`docs/research/v1-client-contract.md`、`docs/research/v1-input-path.md`、`docs/research/rikkahub-architecture.md`
5. 术语：`GLOSSARY.md`

票的依赖图以 GitHub 原生 blocked-by 为准（可用 `gh api graphql` 查询）。**票未解除阻塞前不要开始实现该票。**

## 1. 仓库拓扑与固定版本

本产品跨三个仓库；三者各自有集成分支，跨仓库不共享 Git 历史，集成结果由**版本组合**锁定。

| 仓库 | 本地路径 | 集成分支 | fork 远端 |
| --- | --- | --- | --- |
| OurFairy（产品） | `/home/eafen405/projects/OurFairy` | `integration/ourfairy-v1` | origin（本仓库） |
| dsh fork | `/home/eafen405/projects/deepseek-harness` | `product/ourfairy-v1` | `fork` = `eafen405/deepseek-harness` |
| rikkahub fork | `/home/eafen405/projects/rikkahub` | `product/ourfairy-v1` | `fork` = `eafen405/rikkahub` |

**固定基线提交（研究用上游 SHA，产品改动从其之上开始）：**

- dsh 上游基线：`d743267388641bc76f17c45ce8b4c231aed1d32c`（master）
- rikkahub 上游基线：`0966502c4d65c1ee4b2a3e49a19703bb1978016c`（master）
- Fairybot 参考实现（只读参考，不改）：`095efdd84fd7ab2215a0b5b03369aac4f1303108`，本地 `/home/eafen405/projects/Fairybot`

`combo.json`（在 OurFairy 集成分支根目录）记录**当前产品组合**：三个仓库的 fork URL / 分支 / 提交。每张票合并后更新它。研究用上游 SHA ≠ 产品提交，任何报告不得把上游 SHA 当作已含产品改动。

## 2. 分支与 worktree 协议

每票在**自己仓库**的独立 worktree 中工作，分支名 `ticket/<NN>-<slug>`（NN 为票序号 1–22）：

```bash
# OurFairy 侧（本仓库）
git -C /home/eafen405/projects/OurFairy worktree add \
  /home/eafen405/projects/OurFairy/.worktrees/<NN>-<slug> -b ticket/<NN>-<slug> integration/ourfairy-v1

# dsh 侧（仅当该票要改 dsh）
git -C /home/eafen405/projects/deepseek-harness worktree add \
  /home/eafen405/projects/deepseek-harness/.worktrees/<NN>-<slug> -b ticket/<NN>-<slug> product/ourfairy-v1

# rikkahub 侧（仅当该票要改客户端）
git -C /home/eafen405/projects/rikkahub worktree add \
  /home/eafen405/projects/rikkahub/.worktrees/<NN>-<slug> -b ticket/<NN>-<slug> product/ourfairy-v1
```

规则：

- 开工前确认 worktree 基线是目标集成分支的最新提交；不是则先 `git merge` 集成分支最新提交再开始。
- **合并前**再把集成分支 tip 合进自己的票分支，解决冲突后报告，不要等 Lead 替你解冲突。
- 每张票只写自己声明过的写范围；跨票公共文件（`combo.json`、profile 装配、公共类型）由 Lead 协调。
- 完成后由 Lead 指定的 merger 把票分支合入对应集成分支，并更新 `combo.json`。
- worktree 任务结束后由 Lead 清理；不要自行 `git worktree remove` 别人的。

## 3. 工具链（已就绪，勿重装）

| 工具 | 位置 / 用法 |
| --- | --- |
| Node | `node` v24.18.0（dsh 要求 `^22.19.0 \|\| >=24`） |
| pnpm | **必须用 corepack 固定版本**：`corepack pnpm@11.28.5 <cmd>`（`PATH` 上的 pnpm 12 来自 Windows，勿用） |
| JDK | `java` = Temurin 21（`/home/eafen405/.local/bin/java`） |
| Android SDK | `ANDROID_HOME=/home/eafen405/Android/Sdk`（已装 `platforms;android-36`、`android-37.0`、`android-37.2`、`build-tools;37.0.0`、`platform-tools`、`ndk;28.2.13676358`、`cmake`） |
| Gradle | wrapper 会下载 9.6.0；缓存 `/home/eafen405/.gradle`（已有 3.7G） |
| gh CLI | 已登录 `eafen405`，token 有 `repo` scope；git 走 HTTPS（已配置 credential helper） |

**Android 构建必须显式设置**：`export ANDROID_HOME=/home/eafen405/Android/Sdk`，并在 rikkahub 检出目录写 `local.properties` 指向 `sdk.dir=/home/eafen405/Android/Sdk`（该文件不入库）。

### 3.1 Android 构建实测踩坑（2026-10-14 由侦察票实测，勿重复踩）

以下每条都是**实测结论**，不是推测：

| 现象 | 事实与对策 |
| --- | --- |
| `./gradlew` 下载 Gradle 发行版超时 | 本机 HTTP 代理只以**环境变量**形式存在（`http_proxy/https_proxy=http://127.0.0.1:7890`），**Java/Gradle 不读环境变量代理**。对策：用 `curl` 走代理把 `gradle-9.6.0-bin.zip` 下到 `~/.gradle/wrapper/dists/gradle-9.6.0-bin/<base36(md5(url))>/`，用 python3 `zipfile` 解压（本机**没有 `unzip`**），`chmod +x gradle-9.6.0/bin/*`，再 `touch gradle-9.6.0-bin.zip.ok`。 |
| 依赖解析长时间无输出 | Gradle 只在任务完成时打印 `> Task`，大量依赖元数据下载期间日志会长时间静止——**这是正常推进，不是卡死**。判据：`~/.gradle/caches/modules-2/metadata-*/descriptors/` 有新文件写入。 |
| 构建极慢／单 worker | 用户级 `~/.gradle/gradle.properties` 含 `-Xmx2560m`、`org.gradle.workers.max=1`、`org.gradle.parallel=false`、`kotlin.compiler.execution.strategy=in-process`。**不要改这个共享文件**（其他队友也在用）；用命令行覆盖：`-Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8" --max-workers=8 --parallel`。 |
| `compileSdk` 与已装平台不符 | rikkahub 用 `compileSdk { version = release(37) { minorApiLevel = 2 } }`，实际解析到 **`android-37.2`**（不是 `android-37.0`）。AGP 会自动装（license 已接受），但首次会拖长构建。 |
| 缺 `app/google-services.json` | `:app:processDebugGoogleServices` 会硬失败（`File google-services.json is missing`）。该文件被 `app/.gitignore` 忽略，需要自备桩文件；**桩里的 key 是假的，Firebase/Crashlytics 运行时不可用**，任何真机/崩溃上报结论都必须声明这一点。 |
| 子模块未初始化 | `material3/material-color-utilities` 未 init 时 `:material3` 编译会失败；需 `git submodule update --init --recursive`。 |
| `web` 模块 preBuild 跑 pnpm | `web/build.gradle.kts` 的 `buildWebUi` 只跑 `pnpm run build`，**不跑 install**；必须在 `web-ui/` 先 `pnpm install --frozen-lockfile`。pnpm 必须是 `corepack pnpm@11.28.5`（PATH 上的 12 是 Windows 版）。 |

**长构建请用 `setsid nohup ... &` 脱离 agent turn 运行**：队友 turn 结束时其后台任务会被回收，构建日志要落到 `work/implementation/evidence/<票>/` 下供任何人轮询。

## 4. 常用命令

```bash
# dsh：安装（已装，勿重复全量装）
cd /home/eafen405/projects/deepseek-harness && corepack pnpm@11.28.5 install
# dsh：构建宿主库（改动 src 后必须重建，否则测试跑的是旧产物）
corepack pnpm@11.28.5 run build:lib:host
# dsh：跑相关测试（示例）
corepack pnpm@11.28.5 exec vitest run <path>

# OurFairy：产品侧命令由票 #24 建立（scripts/ 下），建立后以该票记录为准
```

## 5. 证据协议

每张票的交付必须留下**可复查的证据**，写在 `work/implementation/evidence/<NN>-<slug>/`：

- `README.md`：做了什么、影响哪些仓库与提交、**实际执行的命令**、**实际输出摘要**、未执行/失败项及原因。
- 运行日志原文放同目录（`*.log`），不要只写结论。
- 明确区分：**替身测试**（模型/网络/平台替身）与**真实服务**（官方 DeepSeek、硅基流动 ASR）证据；**模拟器/构建成功**与**真机**证据。
- 断言真实行为：禁止用「编译通过」「Loader 未抛异常」「构建成功」冒充运行时就绪或验收通过。

## 6. 工作纪律

- **先测试后实现。** 开工时调用 Skill 工具加载 `tdd`，按红—绿—重构推进；测试断言用户可观察行为，不断言私有实现细节。
- **不要猜。** 不确定的 API、字段、行为一律去读固定提交的源码或派同伴查证；写到报告里的每条事实都要有来源（文件路径 + 行号 或 命令输出）。
- **不要伪造通过。** 条件不具备（无凭据、无设备、无内核隔离能力）时如实记录为未完成门槛，不降低标准、不换指标、不静默跳过。
- **小步提交。** 每个有意义的红→绿循环提交一次，提交信息说明行为变化。
- **只做本票范围。** 发现范围外问题时记录到 `work/implementation/notes/` 并通知 Lead，不顺手扩散改动。

## 7. 沟通

- 与 Lead 的通信保持稀疏，用**指针**（票号、提交 SHA、文件路径、命令），不要复述文档。
- 阻塞时立即上报：说清「卡在哪一步、试过什么、需要什么决定或权限」。
- 完成后向 Lead 报告：票号、分支、提交 SHA、变更仓库、证据目录、未完成项。
