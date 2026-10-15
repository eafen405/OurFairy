# 票 #24 证据：建立可启动后端与可复现集成基线

票面：<https://github.com/eafen405/OurFairy/issues/24> · 父规格 <https://github.com/eafen405/OurFairy/issues/23>
本地票面：`work/tickets/ourfairy-v1/01-baseline.md`

本票交付一个**真实可启动**的 OurFairy v1 后端装配、可复现的版本组合，以及后续所有票共用的构建/测试入口。本票**不**交付尚未适配的工具能力。

原始日志同目录：`test-suite.log`（全套，合并 tip 上重跑）、`combo-verify.log`、`boot-and-doctor.log`（probe / boot-product / start / status / stop）、`doctor.log`。

## 组合与提交

| 仓库 | 集成分支 | 锁定提交 |
| --- | --- | --- |
| OurFairy（本仓库） | `integration/ourfairy-v1` | 本票分支 `ticket/01-baseline`，当前 = 集成分支 tip `de2ded1afa13` |
| dsh fork | `product/ourfairy-v1` | `2f084be06e75cd56c2a7ac9a31e155db9f4deee0` |
| rikkahub fork | `product/ourfairy-v1` | `ffc88e306b0f55cf` |

`combo.json` 显式区分两类事实：`productCommit`（产品实际消费的提交）与 `researchUpstreamSha`（研究撰写时所依据的上游提交，**永不作为产品交付物**）。三个仓库的研究基线分别是 dsh `d743267388641bc76f17c45ce8b4c231aed1d32c`、rikkahub `0966502c4d65c1ee4b2a3e49a19703bb1978016c`；产品提交在这两个上游基线之上继续前进，两者不可混为一谈。

本票**不修改 dsh 源码**：基线装配完全通过受支持的 profile/bundle 机制完成（见验收 2）。

## 逐条验收

### 1. 主线集成目标与各 fork 来源/版本记录

`combo.json` 记录三个仓库的角色、fork URL、集成分支与锁定值。自仓库（OurFairy）用 `"lock": "integration-branch"` 而不是锁死自己的 commit —— 自指且每次合并都会过期；判定语义是「集成分支 tip 是 HEAD 的祖先或等于 HEAD」。

```
$ node scripts/combo.mjs verify
repo      branch                   expected          actual            result
ourfairy  integration/ourfairy-v1  based on integra  de2ded1afa13a6a4  ok (worktree is the integration tip)
dsh       product/ourfairy-v1      2f084be06e75cd56  2f084be06e75cd56  ok
rikkahub  product/ourfairy-v1      ffc88e306b0f55cf  ffc88e306b0f55cf  ok
combo: combination verified
EXIT=0
```

（原始输出：`combo-verify.log`。）

新工作树取得同一组合的方式：`git worktree add <dir> -b ticket/<NN>-<slug> integration/ourfairy-v1`，dsh/rikkahub 侧的提交由 `combo.json` 锁定，可用 `OURFAIRY_DSH_DIR` / `OURFAIRY_RIKKAHUB_DIR` 覆盖检出路径。**漂移是硬失败**：把 dsh 指到不存在的路径时 `combo verify` 退出 1，并打印带补救命令的具体错误（由 `tests/lifecycle.test.mjs` 的最后一个用例覆盖）。

### 2. 真实 profile 启动 + 活性断言 + 外部模型替身

装配不是手工拼插件：`scripts/ourfairy-backend.mjs` 在隔离 `OURFAIRY_HOME` 下生成 profile 目录（`package.json` 的 `dsh.profile.bundles` + `file:` 依赖、`cordis.patch.yml`、`pnpm-workspace.yaml`），然后用**真实 dsh CLI** 启动：

```
node <dsh>/apps/cli/lib/bin.js --profile ourfairy --patch <probe overlay>
```

活性断言由仅测试使用的 probe 插件（`backend/probe/`，只通过 `--patch` overlay 挂载，**不在产品组合里**）在 `appReady` 之后、真实进程内执行：逐个 `ctx.get(<service>)` 取到服务、逐个 `ctx.loader.entries()` 核对行 id 的挂载与 fiber 状态。**不以「Loader 没抛异常」代替活性检查。**

```
$ OURFAIRY_HOME=<isolated> OURFAIRY_PORT=0 node scripts/ourfairy-backend.mjs probe
ourfairy-baseline-probe: ok (11 services live, 21 rows composed, mode boot)
EXIT=0
```

**行数是随组合变化的实测事实，不是固定期望**（下面数字各有其测量时点）：

- 本票成票时：产品自有 **15 行** → 组合后 **17 行**。多出的两行是「组合根 `include` 行」与「测试专用 probe overlay 行」——组合树始终包含 Loader 的根 include，而 probe 只在带 overlay 的检查里出现。
- 现在：`backend/v1-bundle/cordis.patch.yml` 已有 **19 行** —— `agent session llm system-prompt session-projection tools tool-todo agent-loop agent-default-model llm-deepseek-api-key session-persistence-jsonl session-checkpoint-policy session-query-sqlite jobs-local attachment-local credentials webserver connection identity`。
- 增量来自身份/接入四行（credentials、webserver、connection、identity，由 #26/#03 落地并已合并进集成分支）。
- 因此 probe 现在实测 **21 行组合** = `include` + 19 行 + `ourfairy-baseline-probe`，且 **11/11 服务 live**。今后再加行，这个数字会继续变；测试断言的是「哪些 id 必须缺席」与「服务是否 live」，不锁行数。

模型接口的真实性用一个**外部 loopback 模型替身**证明，而不是靠装配成功推断：`packages/test-support/llm-mock-server` 起真实 HTTP 服务，通过真实的部署面 `DEEPSEEK_BASE_URL` / `DEEPSEEK_API_KEY` 接入，然后断言**真的有线上请求到达**（`one real turn reaches the external model double, registers tools, and persists the session`）。

该用例断言：`server.requests.length >= 1`、`requests[0].path === '/v1/messages'`、请求携带的工具目录含 `todo_write` 且**不含** bash/文件工具、turn 产出非空 assistant 文本、会话日志在隔离 home 内落盘（`session.v4.jsonl.zstd`）。

一个真实的行为事实（已写进 `backend/v1-bundle/README.md`，避免后来者误改）：`agent-default-model` 只**提供** `agentDefaultModel` 服务，消费方是入口层（`packages/api/session-controller/src/agent.ts:293,498`、`packages/bundle/headless/src/index.ts:316`）。v1 基线两者都没挂，所以 probe 直接经 agent 工厂建会话时**必须显式传 `agentOptions`**；模型档位由 `combo.json` 的 `backend.agentModel` 单点声明，launcher 经 env 传给 probe，`doctor` 校验两处声明不漂移。基线不依赖任何隐式默认模型。

### 3. 锁定依赖与构建环境、可重复启动/停止、失败诊断、不泄漏

`doctor` 把所有执行前置逐项报告（缺任何一项都是硬失败）：

```
$ OURFAIRY_HOME=<isolated> node scripts/ourfairy-backend.mjs doctor --json
ok=true（DOCTOR_EXIT=0）
  OK   node version — 24.18.0 satisfies ^22.19.0 || >=24
  OK   corepack pnpm pin available — 11.28.5 (COREPACK_HOME=…/.corepack)
  OK   combo combination — ourfairy@de2ded1afa13, dsh@2f084be06e75, rikkahub@ffc88e306b0f
  OK   dsh CLI build — /home/eafen405/projects/deepseek-harness/apps/cli/lib/bin.js (2f084be06e75)
  OK   product packages — backend/v1-bundle/package.json, backend/v1-bundle/cordis.patch.yml,
       backend/probe/package.json, backend/probe/src/index.mjs, backend/probe/overlay.patch.yml,
       backend/identity/package.json, backend/identity/src/codes.mjs, backend/identity/src/store.mjs,
       backend/identity/src/http.mjs, backend/identity/src/index.mjs
  OK   isolated home — <OURFAIRY_HOME>
  OK   profile project linked — <OURFAIRY_HOME>/dsh-home/profiles/ourfairy (cached)
  OK   model double — not configured (keyless startup only)
```

（原始输出：`doctor.log`。）

**缺必要配置明确失败**（不是静默回落）：请求一次 turn 而不给模型凭据时，probe 以 **exit 3** 退出，并在诊断里点名缺失变量：

```
- ProbeConfigError: missing required configuration DEEPSEEK_API_KEY: the requested turn needs a model credential.
  Export DEEPSEEK_API_KEY (and DEEPSEEK_BASE_URL when driving the external model double) before starting the backend.
```

**后端绑端口，并且证明端口会被释放**（这是本票 AC3 的真实语义）：v1 组合挂了产品自己的 web carrier，所以它**必须**绑一个端口；默认 3080 与 `dsh web`（本机 harness GUI）冲突，因此所有起组合的测试/命令用 `OURFAIRY_PORT=0` 取**临时端口**。真实输出：

```
$ OURFAIRY_PORT=0 node scripts/ourfairy-backend.mjs start --json
{ "pid": 47004, "ready": true, "listeningPorts": [57488], "installMode": "cached", … }        # START_EXIT=0
$ node scripts/ourfairy-backend.mjs status
{ "running": true, "ready": true, "listeningPorts": [57488], "probe": { "ok": true, "failures": [], "mode": "hold" } }
$ node scripts/ourfairy-backend.mjs stop --json
{ "pid": 47004, "exited": true, "forced": false, "portsBefore": [57488], "portsAfter": [], "leakedProcesses": [] }   # STOP_EXIT=0
```

「不泄漏」的证据就是 `portsAfter: []` 与 `leakedProcesses: []`（`lifecycle.test.mjs` 两轮循环都断言它们，且对已停止的后端再 `stop` 是幂等成功）。**不要把它读成「组合不绑端口」——它绑，而且停得干净。**

**为什么不以 `boot-product` 的「干净退出」为就绪判据**：组合挂上 web carrier 后进程**不再自己退出**，若等进程退出只会 300 秒超时、把健康后端报成失败。改成 detached 起、**以组合自己的监听端口为就绪证据**、再停掉并记录释放：

```
$ OURFAIRY_PORT=0 node scripts/ourfairy-backend.mjs boot-product --report <path>              # BOOT_PRODUCT_EXIT=0
{ "command": "boot-product (no --patch overlay)", "ok": true, "overlaysApplied": [],
  "listeningPorts": [57310], "portsAfter": [], "processExited": true,
  "installMode": "cached", "dshDrifted": false }
```

这比「干净退出」更强，也正是本票 AC2 要的「确认服务真实就绪，不以 Loader 未抛错代替活性检查」。实现时踩到一个坑，记录以免复发：`waitFor` 把谓词当布尔用，写成 `async` 谓词会返回 Promise（恒真），第一个 tick 就误判进程已退出、跳过 SIGKILL —— 已改为同步谓词。

**构建前置**（新检出必须跑，否则持久化写入或某些行会失败）：

```
corepack pnpm@11.28.5 install
corepack pnpm@11.28.5 run build:lib:host
corepack pnpm@11.28.5 run build:lib:client
corepack pnpm@11.28.5 run build:native-system
```

四条都写在 `combo.json` 的 `dsh.requiredBuild` 里，各自的原因：

- `build:lib:host`：CLI/host 侧库。
- `build:lib:client`：**client face 的产物**。`packages/client/tsdown.client.ts:120` 在 host pass 对没有 `hostPhase` 的 `clientBundle()` 包返回 `SKIP_WORKSPACE_BUILD`，所以 `packages/client/connection/lib/index.js` **只由 client face 产出**；缺它时挂 `connection` 行的 profile 报 `1 required plugin did not activate`（本票在合并 #26 后正是踩了这个坑：主检出只跑过 `build:lib:host`，补跑 `build:lib:client` 后恢复）。
- `build:native-system`：产出 `native/system/packages/linux-x64/bin/glibc/system.node`，dsh 的 JSONL 写入器依赖这个 native flock 插件；缺它时会话 flush 会报找不到 `system.node`。

**隔离与工具缓存（有意识的取舍）**：launcher 把 `HOME`、`DSH_HOME`、`XDG_*`、pnpm 的 cache/store（`npm_config_cache`、`npm_config_store_dir`）与 `PNPM_HOME` 全部钉进 `OURFAIRY_HOME` —— 那是产品运行状态，必须隔离。`COREPACK_HOME` 例外，指向**仓内共享** `<repoRoot>/.corepack`：corepack 缓存里是下载下来的工具链压缩包（工具缓存，不是产品状态），每个隔离 home 重建一次要重新解包约 98MB，曾把单测从 ~1s 抬到 35–42s；它留在仓内而不是宿主 home，所以「不写宿主真实 home」这条性质仍然成立。实测：

```
$ env -u … node --test 'tests/**/*.test.mjs'      # 见 test-suite.log
EXIT=0   WALL=10s   ℹ tests 18 / pass 18 / fail 0 / duration_ms 10217.078747
HOST_WRITES=0        # find /home/eafen405/.cache/pnpm /home/eafen405/.cache/node/corepack -newermt "@$START" | wc -l
$ du -sh .corepack
24M
```

逐条耗时（`test-suite.log`）：baseline 组合套件 10038.9ms（子用例 8247.3 / 384.7 / 652.4 / 378.2 / 375.3）、identity over real HTTP 713.1ms（8 例）、lifecycle 9699.7ms、doctor 424.0ms、missing dsh checkout 35.8ms、model double 4578.5ms、keyless turn 5141.0ms。工作树里的 suite 现在共 18 例，其中 8 例是随集成合并进来的 identity 模块的真实 HTTP 用例。

### 4. 未适配能力保持不可用

`backend/v1-bundle/cordis.patch.yml` **不继承 `@deepseek-ai/dsh-base`**：base 会连带挂上首版明确排除的能力（skill、goal、subagent、telemetry、web 工具）以及权限适配尚未落地的文件/shell/sandbox 默认行。v1 的行集是逐条显式列出的（见验收 2 的当前 19 行）。测试断言这些 id **没有**被挂载，且失败信息会指出具体混进来的 id。

被显式排除并在测试中断言的组：`tool-fs` / `tool-fs-search` / `fs-sandbox` / `fs-observation-policy` / `working-directory` / `tool-working-directory` / `tool-bash` / `bash-sandbox` / `pwsh-sandbox` / `tool-pwsh` / `sandbox` / `sandbox-policy` / `approval` / `permission` / `shell-env` / `subprocess` / `skill*` / `goal*` / `subagent*` / `otel` / `web*` / `mcp-resources` / `plan-mode` / `workflow-ptc` 等。

两处**有意选择**已写进 `backend/v1-bundle/README.md`，避免评审误判为漏配：

- `session-query-sqlite` 的 `openAt: never`：研究已核实 `never` 是 **base patch 的值**而非插件自身默认（插件默认是 `startup`）。本 bundle 不继承 base，所以这里的 `never` 是**显式写出**的选择——挂上 query 服务、保留精确读取与标题，但内容检索关闭。检索由票 #33 打开，不是缺配置。
- 模型档位双处声明来自单一来源（见验收 2）。

隔离性：所有持久路径都从 `DSH_HOME` 派生，launcher 把 `HOME` 与 `DSH_HOME` 都钉在隔离 home 内，并**拒绝**把 home 解析到宿主真实 home、`/` 或宿主 home 的祖先目录。

### 5. Android 来源与工具链记录

`combo.json` 的 `androidToolchain` 记录本地实测的工具链，而不是文档抄写：`ANDROID_HOME=/home/eafen405/Android/Sdk`、**实测 AGP 自动安装 `platforms;android-37.2`**（rikkahub 用 `compileSdk { version = release(37) { minorApiLevel = 2 } }`，不是 `android-37.0`）、`build-tools;37.0.0`、NDK `28.2.13676358`、Temurin 21、gradle wrapper；`measuredNotes` 另有本机代理/JVM 参数与 google-services 桩等实测记录。

关于 `work/implementation/evidence/00-android-recon/`：那份侦察（本地 debug APK 构建可行性、3 个 debug APK 的实测产物）是**本票的前置工作**，用来证明「缺 Android 构建环境」不是后端改造的虚假阻塞；它**不是票 #26 的验收证据**——首次 APK 构建按票面由 #26 自己验收，本票只负责记录来源与工具链事实。

### 6. 无凭据启动验证与基线记录

上面的 `probe` / `boot-product` / `doctor` 输出即无凭据启动记录：不设任何云凭据时，真实 profile 启动成功、**11 个服务全部 live**、**21 行组合**全部挂载，且**没有**发起任何真实模型调用（模型替身那组用例显式使用 loopback 替身）。同一份组合在带 `--patch` overlay 与不带 overlay 两种路径下都被启动过：`probe` 走 overlay 做活性断言，`boot-product` 不带任何 overlay、以自身监听端口为就绪判据（`overlaysApplied: []`）。

## 未完成 / 不在本票范围

- 本票不交付任何尚未适配的工具能力：文件、shell、sandbox、working-directory、jobs 的 shell 工具、附件消费通路等都留待各自票接入（验收 4 的排除清单即当前边界）。
- `session-query-sqlite` 的内容检索通路（`openAt: never` 是显式选择）由票 #33 打开；真实模型图片通路、Android 端任何 UI 均未在本票落地。
- 真实云服务（官方 DeepSeek、硅基流动 ASR）未在装配阶段调用，按规格由后续票与集成票验收。
- 首次 APK 构建属于票 #26；本票只记录并实测了构建前置（见验收 5）。
- 本票的 dsh 侧固定提交 `2f084be0` 已包含后续票的原生改动；`combo.json` 的 `researchUpstreamSha` 仍指向研究基线，二者不可互换引用。
