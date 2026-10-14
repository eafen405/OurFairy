# 票 #24 证据：建立可启动后端与可复现集成基线

票面：<https://github.com/eafen405/OurFairy/issues/24> · 父规格 <https://github.com/eafen405/OurFairy/issues/23>
本地票面：`work/tickets/ourfairy-v1/01-baseline.md`

本票交付一个**真实可启动**的 OurFairy v1 后端装配、可复现的版本组合，以及后续所有票共用的构建/测试入口。本票**不**交付尚未适配的工具能力。

原始日志同目录：`test-suite.log`、`combo-verify.log`、`boot-and-doctor.log`。

## 组合与提交

| 仓库 | 集成分支 | 本票提交 |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | 见分支 tip（本票分支 `ticket/01-baseline`） |
| dsh fork | `product/ourfairy-v1` | `d743267388641bc76f17c45ce8b4c231aed1d32c`（= 研究用上游 SHA，尚未有产品提交） |
| rikkahub fork | `product/ourfairy-v1` | `0966502c4d65c1ee4b2a3e49a19703bb1978016c`（= 研究用上游 SHA，尚未有产品提交） |

本票**不修改 dsh**：基线装配完全通过受支持的 profile/bundle 机制完成，dsh 保持在上游固定提交上，因此 `dsh.productCommit == researchUpstreamSha` 在这里是**真实状态**而非未更新。

## 逐条验收

### 1. 主线集成目标与各 fork 来源/版本记录

`combo.json` 记录三个仓库的角色、fork URL、集成分支与锁定值，并**显式区分** `productCommit`（产品实际消费的提交）与 `researchUpstreamSha`（研究撰写时所依据的上游提交，永不作为产品交付物）。

自仓库（OurFairy）用 `"lock": "integration-branch"` 而不是锁死自己的 commit —— 自指且每次合并都会过期。判定语义是「集成分支 tip 是 HEAD 的祖先或等于 HEAD」。

```
$ node scripts/combo.mjs verify
repo      branch                   expected          actual            result
ourfairy  integration/ourfairy-v1  based on integra  83d72dc229b0567f  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      d743267388641bc7  d743267388641bc7  ok (research upstream only; no product commits yet)
rikkahub  product/ourfairy-v1      0966502c4d65c1ee  0966502c4d65c1ee  ok (research upstream only; no product commits yet)
combo: combination verified
EXIT=0
```

新工作树取得同一组合的方式：`git worktree add <dir> -b ticket/<NN>-<slug> integration/ourfairy-v1`，dsh/rikkahub 侧的提交由 `combo.json` 锁定并可用 `OURFAIRY_DSH_DIR` / `OURFAIRY_RIKKAHUB_DIR` 覆盖路径。**漂移是硬失败**：把 dsh 指到不存在的路径时，`combo verify` 退出 1 并打印带补救命令的具体错误（`lifecycle.test.mjs` 的最后一个用例覆盖这一行为）。

### 2. 真实 profile 启动 + 活性断言 + 外部模型替身

装配不是手工拼插件：`scripts/ourfairy-backend.mjs` 在隔离 `OURFAIRY_HOME` 下生成 profile 目录（`package.json` 的 `dsh.profile.bundles` + `file:` 依赖、`cordis.patch.yml`、`pnpm-workspace.yaml`），然后用**真实 dsh CLI** 启动：

```
node <dsh>/apps/cli/lib/bin.js --profile ourfairy --patch <probe overlay>
```

活性断言由仅测试使用的 probe 插件（`backend/probe/`，只通过 `--patch` overlay 挂载，不在产品组合里）在 `appReady` 之后、真实进程内执行：逐个 `ctx.get(<service>)` 取到服务、逐个 `ctx.loader.entries()` 核对行 id 的挂载与 fiber 状态。**不以「Loader 没抛异常」代替活性检查。**

```
$ OURFAIRY_HOME=<isolated> node scripts/ourfairy-backend.mjs probe
ourfairy-baseline-probe: ok (11 services live, 17 rows composed, mode boot)
EXIT=0
```

模型接口的真实性用一个**外部 loopback 模型替身**证明，而不是靠装配成功推断：`packages/test-support/llm-mock-server` 起真实 HTTP 服务，通过真实的部署面 `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` 接入，然后断言**真的有线上的请求到达**：

```
✔ one real turn reaches the external model double, registers tools, and persists the session (1236ms)
```

该用例断言：`server.requests.length >= 1`、`requests[0].path === '/v1/messages'`、请求携带的工具目录含 `todo_write` 且**不含** bash/文件工具、turn 产出非空 assistant 文本、会话日志在隔离 home 内落盘（`session.v4.jsonl.zstd`）。

一个真实的行为事实（写进 `backend/v1-bundle/README.md`，避免后来者误改）：`agent-default-model` 只**提供** `agentDefaultModel` 服务，消费方是入口层（`packages/api/session-controller/src/agent.ts:293,498`、`packages/bundle/headless/src/index.ts:316`）。v1 基线两者都没挂，所以 probe 直接经 agent 工厂建会话时**必须显式传 `agentOptions`**；模型档位由 `combo.json` 的 `backend.agentModel` 单点声明，launcher 经 env 传给 probe，`doctor` 校验两处声明不漂移。基线不依赖任何隐式默认模型。

### 3. 锁定依赖与构建环境、可重复启动/停止、失败诊断、不泄漏

`doctor` 把所有执行前置逐项报告（缺任何一项都是硬失败）：

```
$ OURFAIRY_HOME=<isolated> node scripts/ourfairy-backend.mjs doctor --json
ok=true
  OK   node version — 24.18.0
  OK   corepack pnpm pin available — 11.28.5
  OK   combo combination — ourfairy@83d72dc229b0, dsh@d74326738864, rikkahub@0966502c4d65
  OK   dsh CLI build — /home/eafen405/projects/deepseek-harness/apps/cli/lib/bin.js (d74326738864)
  OK   product packages — backend/v1-bundle/package.json, backend/v1-bundle/cordis.patch.yml, backend/probe/package.json, backend/probe/src/index.mjs, backend/probe/overlay.patch.yml
  OK   isolated home — /tmp/of-ev-DuAO
  OK   profile project linked — /tmp/of-ev-DuAO/dsh-home/profiles/ourfairy (cached)
  OK   model double — not configured (keyless startup only)
```

**缺必要配置明确失败**（不是静默回落）：

```
$ (unset DEEPSEEK_API_KEY) node scripts/ourfairy-backend.mjs probe --turn
ourfairy-baseline-probe: 1 failure(s)
  - Error: missing required configuration DEEPSEEK_API_KEY: the requested turn needs a model credential.
    Export DEEPSEEK_API_KEY (and DEEPSEEK_BASE_URL when driving the external model double) before starting the backend.
```

**重复启动/停止不泄漏**（`lifecycle.test.mjs`，两轮循环）：start 等待 probe 就绪后才返回；第二次 start 被拒（`already running`）；stop 后 `exited: true`、`leakedProcesses: []`、`portsAfter: []`；对已停止的后端再 stop 是幂等成功；status 在前后都给出可解析的 JSON。

一条必须记录的执行前置（否则持久化写入会失败）：dsh 的 JSONL 写入器依赖 native flock 插件，**新检出必须跑**

```
corepack pnpm@11.28.5 install
corepack pnpm@11.28.5 run build:lib:host
corepack pnpm@11.28.5 run build:native-system   # 产出 native/system/packages/linux-x64/bin/glibc/system.node
```

这三条已写入 `combo.json` 的 `dsh.requiredBuild`，并附原因说明。

### 4. 未适配能力保持不可用

`backend/v1-bundle/cordis.patch.yml` **不继承 `@deepseek-ai/dsh-base`**：base 会连带挂上首版明确排除的能力（skill、goal、subagent、telemetry、web 工具）以及权限适配尚未落地的文件/shell/sandbox 默认行。v1 的行集是逐条显式列出的（15 行）。测试断言这些 id **没有**被挂载，且失败信息会指出具体混进来的 id：

```
✔ OurFairy v1 baseline composition (2304ms)
```

被显式排除并在测试中断言的组：`tool-fs` / `tool-fs-search` / `fs-sandbox` / `fs-observation-policy` / `working-directory` / `tool-working-directory` / `tool-bash` / `bash-sandbox` / `pwsh-sandbox` / `tool-pwsh` / `sandbox` / `sandbox-policy` / `approval` / `permission` / `shell-env` / `subprocess` / `skill*` / `goal*` / `subagent*` / `otel` / `web*` / `mcp-resources` / `plan-mode` / `workflow-ptc` 等。

两处**有意选择**已写进 `backend/v1-bundle/README.md`，避免评审误判为漏配：

- `session-query-sqlite` 的 `openAt: never`：研究已核实 `never` 是 **base patch 的值**而非插件自身默认（插件默认是 `startup`）。本 bundle 不继承 base，所以这里的 `never` 是**显式写出**的选择——挂上 query 服务、保留精确读取与标题，但内容检索关闭。检索由票 #33 打开，不是缺配置。
- 模型档位双处声明来自单一来源（见验收 2）。

隔离性：所有持久路径都从 `DSH_HOME` 派生，launcher 把 `HOME` 与 `DSH_HOME` 都钉在隔离 home 内，并**拒绝**把 home 解析到宿主真实 home、`/` 或宿主 home 的祖先目录。

### 5. Android 来源与工具链记录

`combo.json` 的 `androidToolchain` 记录本地实测的工具链，而不是文档抄写：`ANDROID_HOME=/home/eafen405/Android/Sdk`、**实测 AGP 自动安装 `platforms;android-37.2`**（rikkahub 用 `compileSdk { version = release(37) { minorApiLevel = 2 } }`，不是 `android-37.0`）、`build-tools;37.0.0`、NDK `28.2.13676358`、Temurin 21、gradle wrapper。

首次 APK 构建按票面由票 #26 验收；本票已单独完成该前置侦察并**实测构建成功**（3 个 debug APK，见 `work/implementation/evidence/00-android-recon/`），因此后续票没有 Android 构建环境方面的虚假阻塞。

### 6. 无凭据启动验证与基线记录

上面的 `probe`/`doctor` 输出即无凭据启动记录：不设任何云凭据时，真实 profile 启动成功、11 个服务全部 active、17 行全部挂载，且**没有**发起任何真实模型调用（模型替身那组用例显式使用 loopback 替身）。

## 未完成 / 不在本票范围

- 本票不交付任何尚未适配的工具能力：文件、shell、sandbox、working-directory、jobs 的 shell 工具、附件消费通路等都留待各自票接入。
- 真实云服务（官方 DeepSeek、硅基流动 ASR）未在装配阶段调用，按规格由后续票与集成票验收。
- 首次 APK 构建属于票 #26；本票只记录并实测了构建前置。
- `session-query-sqlite` 的检索通路、真实模型图片通路、Android 端任何 UI 均未在本票落地。
