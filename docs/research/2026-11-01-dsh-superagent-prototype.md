> 2026-11-01 状态：日期化记录。本文记录 2026-11-01 的判断，不描述当前实现。

# dsh-superagent 原型的参考结论：可复用的接缝与不可复用的假设（2026-11-01）

日期：2026-11-01。研究基线：`deepseek-ai/dsh-superagent-prototype` 的 `main` @ `6337fc823ce20251c8de8085948165c81aaa701e`（2026-10-31T20:05:39+08:00，提交信息 `feat: add the dsh-superagent research prototype`）。上游只有**一个提交**：`git rev-list --count HEAD` 为 1，`git rev-parse --is-shallow-repository` 为 `false`、无 `.git/shallow`——即一次性落地的完整单提交仓库，不是浅克隆；无 tag、无 `.github/`、无 CHANGELOG。以下所有「原型」路径均相对该仓库根。

对照用的 dsh 源码是我们的 fork 检出 `/home/eafen405/projects/deepseek-harness`，HEAD = `d80522d276dd5a839a2b5ea8afcc78af898b6688`（`git describe` 为 `dsh-v0.2.1-rc.2-31-gd80522d276`），与 [`combo.json`](../../combo.json) 的 `repos.dsh.productCommit` 一致；源码路径写作 `packages/…`。另对照本机安装的 npm 包 `@deepseek-ai/dsh@0.2.1-rc.5`，只用于确认版本差，不用它做 API 断言。

方法：读原型的 README、SETUP、`package.json`、`cordis.patch.yml`、`tsdown.config.ts`、`vitest.config.ts`、`docs/007-architecture.md` 全文、`prompts/`、`skills/`、`src/index.ts`、`src/app/{sessions,runtime,http,prompts,skill-files,delivery}.ts`、`src/executor/{dsh,background}.ts`、`src/kv.ts` 与全部测试文件名；对每条原生 API 再去 dsh 源码里找 `Service` 的 `super(ctx, '<name>')` 或方法签名。**没有** `pnpm install`、没有运行它的测试或构建、没有把它装进任何 profile——文中规模与用例数是 `wc -l` 和 `grep -c` 的计数，不是运行结果。

## 结论

1. **它是「单仓库、单 operator」的主动式编码 agent，不是通用 superagent 框架。** 自述：监听 GitHub（可选飞书）→ 按 Policy 评估请求 → 生成 Ticket → 在自己的 Session 与目录里执行 → 回到原会话答复，并给一个 Web 面板（`README.md:7`）。目标用户是「一个团队、一个 GitHub 仓库」；没有多用户、没有 owner 概念。
2. **「实验性」只有一句免责声明，没有任何维护承诺。** README 首段自称 research prototype、可能有 bug、风格可能不一致、要先 review 再改（`README.md:3`），并声明与内部版本及论文所述实现不同、论文里有些设计只是未来方向（`README.md:5`）。仓库 `private: true`、版本 `0.1.0`（`package.json:5-6`），单提交落地，无 CI、无发布、无变更日志。**判断：不可当作有 SLA 的上游依赖，只能当作可读的参考实现。**
3. **挂载形态与我们同族，没有新机制。** 主插件是 `name`/`inject`/`apply(ctx, config)` + `export const Config`（`src/index.ts:7-25`），bundle 用 `dsh.bundle.patch` 声明 patch（`package.json:30-33`），patch 里 `insert` 三行插件（`cordis.patch.yml:4-12`）。这与我们 `backend/` 各行的形态一致，`dsh.bundle.patch` 字段在我们的 dsh 里是既有类型（`packages/util/package-manifest/src/types.ts:69-72`）。
4. **它 inject 的 11 个原生服务里有 4 个我们的组合没有挂载**：`sessionController`、`workspaceRegistry`、`permissionPresets`、`skills`（`src/index.ts:8` 对比 `backend/v1-bundle/cordis.patch.yml`）。Cordis 的 `inject` 语义是「服务齐了才 apply」，所以这些包不是「装上就能跑」，而是**先要往我们的 bundle 里加 4 行原生包**；其中 `session-controller` 是 `TypertRemoteService`（`packages/api/session-controller/src/index.ts:119`），正是[生态边界](../architecture/dsh-ecosystem-boundary.md)写着不采用的那层。
5. **它的「superagent」不是 subagent。** 每个 Ticket 有自己的 dsh Session，id 由 `worker-<ticketId>` 推导（`src/executor/dsh.ts:24-26`），用 `sessionController.create({ sessionId, workspaceId, agentPreset })` 建（`src/app/sessions.ts:144-145`）；worker 内部还能再 spawn subagent（预设里带 `tool-subagent`，`cordis.patch.yml:102-111`），由 `background.ts` 收集与停止（`src/executor/background.ts:145`）。所以它是「一个主 Session 当路由器 + 每票一个 worker Session」的两层，不是 agent 树。
6. **编排的实质是自建的持久化工作流引擎，不是提示词技巧。** `Engine` 五个 part 独占写入（`docs/007-architecture.md:52-62`）、`Effects` 是 durable 副作用队列（`:164-181`）、`Outbox` 管回执（`:41`），状态落在一个 SQLite 文件（`:450-466`）。这是全仓最重的部分，也正是与「个人项目、少量受邀用户」规模最不匹配的部分。
7. **它的权限边界与我们的方向相反，是明确的反例。** 所有受管 Session 被硬设为 `danger-full-access`（`src/app/sessions.ts:152`），文档自述 worker 以 operator 的 OS 用户运行、可读家目录，隔离办法是「另开一个 OS 账户」（`docs/006-deployment.md:19`）。我们的 `spaces` 在策略层直接拒绝该模式（`backend/spaces/src/policy.ts:29`），边界文档把它列为保留的产品实现（[§3.3](../architecture/dsh-ecosystem-boundary.md)）。
8. **可立刻跟进的是三条门禁做法，不是它的架构。** 用 dsh 自己的 loader 读 patch 并断言行与预设内容（`tests/bundle-patch.spec.ts:10-26`）、让架构文档的模块表/测试表与 `src`、`tests` 目录反向对账（`tests/docs.spec.ts:58,63`）、给模型可见面设字符预算（`tests/model-surface.spec.ts:44-46`）。第一条第我们已经做到（`tests/ecosystem-boundary.test.mjs` 用 `loadOverlayPatches`/`composeEntries`），后两条我们还没有。
9. **许可允许搬代码，但搬进来要重做身份层。** MIT（`LICENSE:1-3`），保留版权与许可文本即可；本仓已有同类先例（`README.md:182-183` 为 Fairybot 的 MIT 代码保留 `android/app/src/main/assets/licenses/FAIRYBOT_MIT.txt`）。但它是单 operator、无 `SessionHeader.owner`，而我们的默认工具面判定就建立在 `owner`/`parentSession`/`agentPreset` 三个 header 事实上（`backend/identity/src/session.ts:28-33`）。
10. **「要不要搬」与「值不值得借」是两个问题，本文分开回答。** §5.1–§5.4 判断移植，结论是不移植；§5.5 单独抽出 11 条机制（M1–M11），其中 M9 提示词资产化、M10 两条门禁、M11 SETUP 协议不需要动任何行就能借；M4 后半、M5 的 guard、M6、M7 是真的缺口，但各带触发条件。参考价值主要落在这一节，而不是移植结论。

## 1. 它是什么

### 1.1 自述事实

| 维度 | 事实 | 出处 |
| --- | --- | --- |
| 一句话定位 | 一个 GitHub 仓库的主动式编码 agent，打成 dsh bundle | `README.md:7` |
| 工作方式 | 有人（在允许名单里）要它干活，它开工单、在自己的 Session 与目录里做、回原会话答复（例如给一个 PR） | `README.md:7` |
| 设计信条 | 「占用尽量少的人类注意力，产出尽量多的价值」；只在被要求或团队写下的规则允许时行动，只在有人必须行动或能用上结果时说话 | `README.md:9` |
| 载体 | dsh bundle + Web 管理面板（侧栏一个 Superagent 入口） | `package.json:30-44`、`SETUP.md:76` |
| 安装方式 | 由人让 coding agent 读 `SETUP.md` 一步步装：一次只问一个问题、先给完整计划再执行、密钥类步骤只给命令不贴聊天里 | `SETUP.md:5-14`、`README.md:13-17` |
| 许可 | MIT，`Copyright (c) 2026 DeepSeek Harness Team` | `LICENSE:1-3` |
| 版本 / 发布 | `0.1.0`，`private: true` | `package.json:5-6` |

### 1.2 「实验性」的准确含义

**事实层**：全仓只有 `README.md:3` 一处成熟度声明，措辞是「仅供参照的研究原型，不是官方 DeepSeek 产品」「研究代码而非可投产软件」「可能有 bug，编码风格与工程实践可能不一致」「在你自己的环境使用前请 review 与改写」。`README.md:5` 另说明为公开做过改写，与内部版本及论文实现不同。

**事实层**：仓库本身没有任何维护信号——`git ls-files` 无 `.github/`（无 CI、无 issue 模板）、无 `CHANGELOG`、无 tag、单提交（`git rev-list --count HEAD` = 1）。唯一形式化的兼容声明是 `package.json` 的 `engines.dsh: ^0.2.1-alpha.2`（`:55`）与 23 个 `@deepseek-ai/*` peer 依赖都钉在 `^0.2.1-alpha.2`（`:62-85`）。

**判断**：这里的「实验性」不是「alpha 但会维护」的意思，而是「一次性放出的参考实现」。它没有对 API 稳定性、回归修复或问题响应做出任何承诺，也没有可观察的历史来估计活跃度。对我们的含义是：**可以读、可以抄做法与片段，不能当作会被修的上游依赖**；一旦跟进，适配成本全在我们这边。

### 1.3 规模（计数，非运行）

| 项 | 数量 | 依据 |
| --- | --- | --- |
| 跟踪文件 | 216 | `git ls-files \| wc -l` |
| `.ts`/`.tsx` 行数 | 30,182 | `wc -l` over `git ls-files '*.ts' '*.tsx'` |
| 测试文件 | 59 | `ls tests/*.spec.ts*` |
| 测试用例（匹配计数） | ~794 | `grep -c '^\s*\(it\|test\)('` 求和；未运行 |
| 归档文档 | 9 篇编号文档；`docs/007-architecture.md` 617 行 | `wc -l docs/*.md` |
| 提示词与技能 | `prompts/` 15 个文件 + `skills/` 2 个 `SKILL.md`，合计 464 行 | `wc -l prompts/*.md prompts/team/*.md skills/*/SKILL.md` |

## 2. 它怎么挂进 dsh

### 2.1 三个插件入口与 manifest

| 入口 | 源 | 产物 | 形态 |
| --- | --- | --- | --- |
| `dsh-superagent`（主插件） | `src/index.ts` | `lib/index.js` | 函数式插件：`name` + `inject`（11 项）+ `apply(ctx, config)`，另导出 `Config`（schemastery 对象，`stateDir` 必填） |
| `dsh-superagent/github-watch` | `src/sources/github.ts` | `lib/github-watch.js` | 同族的第二个插件入口，bundle 里默认启用 |
| `dsh-superagent/feishu-watch` | `src/sources/feishu.ts` | `lib/feishu-watch.js` | 同族，bundle 里 `disabled: true`（`cordis.patch.yml:9-12`） |
| `dsh-superagent/client` | `src/client/index.tsx` | `lib/client.js` | 浏览器 CJS 包，用 `window.__ModuleLoader__.load({ id, factory })` 外壳包起来（`tsdown.config.ts:13`） |

`package.json` 的 `dsh` 字段三块：`bundle.patch` 指向 `./cordis.patch.yml`、`client.platform: "web"` 与 6 个 `inject` 包名、`manifestVersion: 1`（`:30-46`）。`client.inject` 是「信息性的包名依赖，不是 Cordis 服务注入」——这是 dsh 自己的类型注释（`packages/util/package-manifest/src/types.ts:84-85`），容易误读为服务依赖。

`exports` 把 4 个入口 + `locale/*.json` 暴露出去（`package.json:11-21`），`files` 发布 `lib`、patch、`locale`、`README`、`prompts`、`skills`（`:22-29`）——**`prompts/` 与 `skills/` 是运行期资产，打进包**，不是文档。

### 2.2 bundle patch：三行插件 + 两个 agent preset

`cordis.patch.yml` 一个 `insert`，5 行：

| 行 | 作用 | 关键内容 |
| --- | --- | --- |
| `dsh-superagent` | 主插件 | 无配置；`stateDir` 由 profile 层给（`examples/profile.cordis.patch.yml:7-9`），插件缺它就拒绝启动（`cordis.patch.yml:1-3` 注释） |
| `dsh-superagent-github` | GitHub Source | 默认启用 |
| `dsh-superagent-feishu` | 飞书 Source | `disabled: true`，启用后还要配 bot CLI |
| `dsh-superagent-worker-preset` | 执行器 Session 的 `@deepseek-ai/dsh-agent-preset` 行 | `id: dsh-superagent-worker`、`order: 90`，一整套插件列表 |
| `dsh-superagent-router-preset` | 主 Session 的 preset 行 | `id: dsh-superagent-router`、`order: 91` |

两个 preset 是本仓最值得读的配置实践（`cordis.patch.yml:20-120` 与 `:125-193`）：

- **用超时把「等」变短。** `bash-sandbox`/`pwsh-sandbox` 的 `timeoutMs`/`maxTimeoutMs` 都设 5000（`:45-56`），`tool-jobs` 的 `waitTimeoutMs`/`maxWaitTimeoutMs` 也设 5000（`:70-74`）。理由写在注释里：前台命令超过 5 秒转入后台，人的消息在下一步就能被吃到（`:13-16`、`:38`、`:69`）。
- **按角色裁工具面。** worker 有 fs/搜索/shell/jobs/skill/todo/subagent/web；router 只有读类 fs（`write: false, edit: false`，`:163-167`）、shell、jobs、skill，显式不带 subagent、web、todo、问人、present、plan mode、插件管理、调度、goal、workflow（`:121-124` 注释 + `:132-193`）。
- **用 group + isolate 做局部替换。** `shell`、`compaction`、`delegation` 三个 `cordis:group` 带 `isolate`，把 `shell`/`compaction`/`workflowEngine` 服务限制在这组里（`:39-44`、`:79-84`、`:96-100`）。
- **跨平台用 `!!js` 表达式禁用。** `disabled: !!js process.platform === 'win32'`（`:47`），loader 求值。
- **它自己承认一个缺口**：preset 行没有「从选择器里藏起来」的设置，所以只能在名字和描述里写明「不供手动选择」（`:18-19`）。

### 2.3 用到的原生 API 与我们的挂载状态

每个断言都对到了 dsh 源码里的服务注册或方法签名。右列「我们的组合」以 `backend/v1-bundle/cordis.patch.yml` 的行集合为准。

| 原型用法 | 原型位置 | dsh 提供者（rc.2 源码） | 我们的组合 |
| --- | --- | --- | --- |
| `ctx.agents.get(id)` | `src/app/sessions.ts:115` | `@deepseek-ai/dsh-agent`，`super(ctx,'agents')`（`packages/core/agent/src/index.ts:259`） | 已挂（kernel `agent` 行，`cordis.patch.yml:35-36`） |
| `ctx.sessionController.resolveAgent/create/rename/modelCatalog` | `src/app/sessions.ts:140-153`、`src/app/runtime.ts:226` | `SessionController extends TypertRemoteService`（`packages/api/session-controller/src/index.ts:119`），`super(ctx,'sessionController')`（`:158`） | **未挂** |
| `ctx.workspaceRegistry.create(cwd)` | `src/app/sessions.ts:142` | `packages/workspace/workspace/src/index.ts:195`（`super(ctx,'workspaceRegistry')`）、`create(path, title?)`（`:238`） | **未挂** |
| `ctx.permissionPresets.set(session, 'danger-full-access')` | `src/app/sessions.ts:152` | `PermissionPresetService extends TypertRemoteService`（`packages/interaction/permission-presets/src/index.ts:180`），`set`（`:398`）；预设名与语义在 `:193-195` | **未挂** |
| `agent.ctx.tools.register/restrict/guard/get` | `src/app/sessions.ts:208,263,292` | `packages/core/tools/src/index.ts:851`（`super(ctx,'tools')`）、`:1071,1105,1144,1238` | 已挂（`:52-53`） |
| `agent.ctx.systemPrompt.section({ name, order, interpolate, text, complete })` | `src/app/sessions.ts:244-249` | `packages/core/system-prompt/src/index.ts:478`；`PromptSection` 字段含 `complete`（`:74`）、`interpolate`（`:68`） | 已挂（`:42-46`） |
| `agent.ctx.inject(['skills'])` 后 `scope.skills.register({ name, description, content, source: 'runtime', resourceBase })` | `src/app/sessions.ts:251-257, 323-324` | `packages/skill/skill/src/index.ts:374`（`super(ctx,'skills')`）、`register`（`:439`）；`SkillSummary` 有 `source`/`resourceBase`（`:69,73`） | **未挂**（`tests/baseline-boot.test.mjs:63-65` 明列 `skill`/`skill-filesystem`/`tool-skill` 为禁止行） |
| `ctx.sessionPersistence.flush/open` | `src/app/delivery.ts:45-46`、`src/app/runtime.ts:243` | `packages/session/session-persistence/src/index.ts:142`（`super`）、抽象 `open`（`:167`）、`flush`（`:180`） | 已挂（`:142-145`） |
| `ctx.webServer.register({ kind: 'prefix', path, handler })`、`.host`、`.port` | `src/app/http.ts:231-237` | `packages/host/webserver/src/index.ts:366`（`register`）、`:327`（`port`）、`:332`（`host`） | 已挂（`:205-209`） |
| `ctx.llm.resolveCallConfig({ provider, model, … })` | `src/app/role-models.ts:9` | `packages/llm/llm/src/index.ts:894` | 已挂（`:39-40`） |
| `ctx.subprocess.*`（经 `workerProbe`） | `src/deployment.ts:73` | `packages/subprocess/subprocess/src/index.ts:119`（`super(ctx,'subprocess')`） | 已挂（`subprocess` 行，`:343-344`） |
| `ctx.settings.configure({ auto: false }, ctx.fiber)`、`ctx.get('settings')?.describe()`、`ctx.fiber.restart()` | `src/index.ts:13,19` | `packages/settings/settings/src/index.ts:266`（`configure`） | 已挂（`settings` 行，`:243-244`） |
| `agentPresets`（可选注入：`ctx.inject(['agentPresets'], …)`、`ctx.get('agentPresets')`） | `src/app/sessions.ts:124-131, 276-279` | `packages/preset/agent-preset-registry/src/index.ts:65`（`super(ctx,'agentPresets')`）；事件 `agent-preset/selected`（`src/types.ts:69`） | **未挂**，且 bundle 里没有任何 preset 行 |
| 事件 `agent/created`、`agent/disposed`、`agent/status`、`session/event`、`agent/inbox/claimed`、`agent/error` | `src/app/sessions.ts:110-135`、`src/executor/dsh.ts:479-505` | `packages/core/agent/src/runtime-types.ts:261,270,280,299,393`；`packages/core/session/src/index.ts:74` | 事件可用（`dsh-agent` 已挂） |

**结论（事实）**：它没有使用未导出的私有 API，全部走 Service 方法、事件与类型子路径；唯一的「半内部」是对 `agent-preset/selected` 的 `declare module` 事件合并（`src/app/sessions.ts:49-54`），该事件在 rc.2 里确实存在（`packages/preset/agent-preset-registry/src/types.ts:69`）。

### 2.4 缺口：四个必需服务在我们的组合里不存在

`inject` 列 11 项（`src/index.ts:8`），我们的 bundle 提供 7 项，缺 `sessionController`、`workspaceRegistry`、`permissionPresets`、`skills`。Cordis 的 `inject` 是「依赖服务可用才 apply」——我们自己的 bundle 注释就是这个意思：「Disabling one leaves the depending capability waiting」（`backend/v1-bundle/cordis.patch.yml:328-331`）。所以最小可运行改动不是「装一个包」，而是：

1. 加 `@deepseek-ai/dsh-api-session-controller` 行：它 `extends TypertRemoteService`，会带进我们刻意不用的 Remote face（[边界 §1.2](../architecture/dsh-ecosystem-boundary.md) 第 32-33 行的「api-remotes 的客户端装配、session-controller/job-controller 命名空间：未挂载、未使用」）。
2. 加 `@deepseek-ai/dsh-workspace` 行：它的 `create(path)` 会创建 workspace 实体，而我们的会话目录语义是 `spaces` 的 scoped 根（`backend/spaces`），两套目录权威会并存（违反 [`AGENTS.md:11`](../../AGENTS.md)「权威唯一」）。
3. 加 `@deepseek-ai/dsh-permission-presets` 行：直接与 `backend/spaces/src/policy.ts:29` 的拒绝逻辑相对。
4. 加 `@deepseek-ai/dsh-skill` 行：`tests/baseline-boot.test.mjs:63-65` 把它列为禁止行，要加就得同时改那条断言与边界文档。

**判断**：这不是「多挂四行」的成本，而是「换一套会话创建与权限模型」的成本。§5 会把它归入不可复用。

**2026-11-01 部署实测（追加）**：把插件挂进一个只有 `@deepseek-ai/dsh-base` 的 profile 时，启动日志列出 4 个条目 pending（`sessionController`、`workspaceRegistry`、`webServer`、`agentPresets`）；把该 profile 的 bundle 换成 `base + @deepseek-ai/dsh-web-app + 插件` 后全部激活并成功监听。所以这四项由 **dsh-web-app** bundle 提供（webserver、workspace、session-controller、agent-preset-registry），`skill` 与 `permission-presets` 由 base 提供。缺口更准确的说法是「我们不是 web 形态的 dsh」，而不是「需要额外接线」；独立部署的正确栈也因此是 `base + web-app + 插件`。

### 2.5 与我们的 agent 语义冲突

原型的每个受管 Session 都带 `agentPreset`（`src/app/sessions.ts:144-145` 的 `agentPreset: WORKER_PRESET | ROUTER_PRESET`）。我们的默认工具面判定把 `agentPreset !== undefined` 直接归为「不是用户自己的会话」（`backend/identity/src/session.ts:28-33`），按[Agent 能力面](../architecture/agent-capabilities.md)的规则，这类 agent 默认拿到**空工具面**，由创建者显式授予。

也就是说：即便把四行原生包装上，原型创建的 agent 在我们的树里也是「默认什么都不给」的第三方 agent，必须逐个 Ticket 显式授权产品工具——这与原型「worker 拿到整套工作工具」的假设正好相反。**判断**：这是语义级不兼容，不是配置级。

## 3. 核心机制

### 3.1 分层与目录职责

文件数与行数取自 `git ls-files` + `wc -l`（只计 `.ts`/`.tsx`）；职责按 `docs/007-architecture.md:289-398` 的模块表归纳，并标注我实际读过的文件。

| 层 | 路径 | 职责 | 规模 |
| --- | --- | --- | --- |
| 领域核心 | `src/core/` | 纯领域：`Engine`（唯一写者）+ 5 个 part（Intake/Evals/Tickets/Assignments/Replies）、`model.ts` 类型、`ports.ts` 端口、`stage.ts` 阶段表、`errors.ts`/`reasons.ts` 固定拒绝与理由码、`memory.ts` 内存仓储。**不 import 外部，除 Node 的 crypto/hash，且不做 I/O**（`docs/007-architecture.md:258`） | 15 文件，2,088 行 |
| 应用层 | `src/app/` | 组合根 `runtime.ts`、`store.ts`（SQLite）、`effects.ts`（durable 队列）、`outbox.ts`（回执）、`settings.ts`、`prompts.ts`、`sessions.ts`（Session 装饰）、`assessment.ts`（主 Session 评估）、`http.ts`+`views/`（管理 API 与视图）、`tools/`（两套工具）、`migration.ts` | 38 文件，5,292 行 |
| 执行层 | `src/executor/` | `dsh.ts`（每票一个 Session、`WorkerSlots`、输入渲染）、`background.ts`（worker 的 shell jobs 与 subagent 的收尾） | 2 文件，838 行 |
| 来源层 | `src/sources/` | GitHub/Feishu 两种 `SourceKind`、registry、poll、channel、read、图片 | 16 文件，2,059 行 |
| 基础设施 | `src/infra/` | CLI 传输（gh/lark/git）、进程环境、路径、文本、健康板 | 5 文件，347 行 |
| 客户端 | `src/client/` | React 面板：路由、概览、各阶段页、设置、提示词编辑、Markdown、复制 | 26 个 `.ts`/`.tsx` + `client.css`，4,037 行 |
| 顶层 | `src/{index,deployment,policy,admission,limits,kv,navigation,setup}.ts` | 插件入口、`Config`、Policy（schema + gate + 重新校验）、准入表、限制、KV 键、会话跳转 | 8 文件 |
| 提示词 | `prompts/` | 15 个 `.md`：`shared`/`orchestrator`/`worker`/`admission`/`dispatch`/`work`/`handoff*`/`replies`/`subscriptions`/`cli` 与 `team/{scope,communication,delivery}` | 464 行（含 skills） |
| 技能 | `skills/dsh-superagent-{github,feishu}/SKILL.md` | 带 YAML frontmatter（`name`/`description`）的操作说明 | 2 文件 |

值得注意的结构事实：

- **`src/client/` 不 import dsh 的 UI primitives**，而是本地复制控件，理由是「bundle 不 import `@deepseek-ai/dsh-client-ui-primitives`；它们跟随 dsh 的 markup、键盘行为与 design token」（`docs/007-architecture.md:391`）。这是升级 dsh 时少一处适配面的做法。
- **客户端只 import 类型**：`src/app/api.ts` 只导类型，所以面板能 bundle 它（`docs/007-architecture.md:346`）。
- **源码用 `.ts` 后缀 import**（`import { Runtime } from './app/runtime.ts'`，`src/index.ts:4`），靠 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`（`tsconfig.json:14-15`）与 tsdown 处理。

### 3.2 `prompts/` 与 `skills/` 的组织

| 机制 | 做法 | 出处 |
| --- | --- | --- |
| 文件格式 | **一句一行**，便于 diff；`promptFile` 把段落内的行用空格接起来，空行保留为段落分隔 | `src/app/skill-files.ts:25-32`；`prompts/work.md` 实际就是这样排的 |
| 打包与校验 | `packaged()` 读包内文件，缺文件或空白抛错并点名路径（启动即失败，不留半套） | `src/app/skill-files.ts:8-17` |
| 组装顺序 | `promptParts` 固定前缀 `runtime/shared` + `runtime/<role>`，再插团队三段，再 `subscriptions`/`replies`/角色段/`admission`（仅主）/`handoff`，最后是生成的 environment 与 policy 段 | `src/app/prompts.ts:102-111` |
| 可覆盖 | 每个内置片段有 `PartKey`，团队可覆盖；覆盖记录 `text` 与它改写自的 `base`，升级时能报「默认文本变了」 | `docs/007-architecture.md:229-231`；`src/kv.ts:29-31` |
| 版本化 | Prompt 配置按编号快照存 KV，Session 记录它跑过哪些 revision，`mayRead` 限制 worker 只能读自己跑过的 | `src/app/sessions.ts:196-204, 335-338` |
| 注入点 | `systemPrompt.section({ name, order: 9999, interpolate: false, complete: true（仅主）})`，每次组装时现算 | `src/app/sessions.ts:244-249` |
| 技能 | `agent.ctx.inject(['skills'])` 拿一个 scope，`scope.skills.register(...)` 注册；名字统一加 `dsh-superagent-` 前缀；重新加绑时先 dispose 旧版本 | `src/app/sessions.ts:251-257, 313-327` |
| 技能资源 | 内置技能从 `skills/` 读，`resourceBase` 指到该技能的目录，模型可读同目录资源 | `src/app/skill-files.ts:18-24`；`src/app/sessions.ts:323-324` |

**判断**：这一层是**可复用的**——「一句一行 + 打包时校验 + 版本快照 + 每次组装现算」四项都不依赖它的工作流引擎，成本也很低。我们的提示词目前散在各 row 与 `prompts` 常量里（例如 memory 的 `MAINTENANCE_POLICY` 直接写在 `backend/memory/src/maintenance.ts`），没有统一的一句话一行与版本化。

### 3.3 编排路径：两层 Session，不是 agent 树

按事实顺序（每步给文件）：

| # | 发生什么 | 出处 |
| --- | --- | --- |
| 1 | Source 轮询（GitHub 通知、订阅 thread、开放 Ticket 的 PR 的 CI；飞书事件/历史/话题）产出 Trigger | `docs/007-architecture.md:364-375` |
| 2 | Engine 的 `Intake` 存 Trigger、记 disposition、扇出到订阅它的 Ticket；不是「人发给 Ticket 的消息」就进 Eval 队列 | `docs/007-architecture.md:56` |
| 3 | `Passes` 每 2 秒跑一次（或被命令唤醒）：先跑到期 effects，再 `Engine.evaluateDue` | `docs/007-architecture.md:40` |
| 4 | `MasterAssessor` 用主 Session 的 `orchestrator_eval*` 工具评估候选，给 `accept/stop/ignore/unavailable` | `docs/007-architecture.md:209-215`、`:499` |
| 5 | accept 在一个事务里创 Ticket + Mandate + Assignment + Subscription + 回执 | `docs/007-architecture.md:73` |
| 6 | `Effects` 的 `launch` 由 `DshExecutor` 处理：prepare 命令 → 起 Executor Session → 发 assignment 消息 | `docs/007-architecture.md:175` |
| 7 | Session 通过 `sessionController.create({ sessionId: 'worker-<ticketId>', workspaceId, agentPreset })` 建；再 `permissionPresets.set(..., 'danger-full-access')` 与 `rename` | `src/app/sessions.ts:140-155` |
| 8 | worker 用 `orchestrator_report`/`orchestrator_ack`/`orchestrator_thread_*` 回报；report 经 `relay` effect 送回主 Session | `docs/007-architecture.md:517-532`、`:177` |
| 9 | thread 关闭、report `dropped` 或人的 stop → Ticket 结束；未读 follow-up 回到 Eval | `docs/007-architecture.md:70, 88, 103` |

**主 Session 的工具面只有 14 个应用工具**（`docs/007-architecture.md:492-501`），且被 `tools.restrict` 压到 `['skill','bash','read','read_image','job_output','job_list','job_kill']` 再加一个「不许等」的 guard（`src/app/sessions.ts:262-264`、`noWait` 在 `:77-86`）。worker 的白名单是 `WORK_TOOLS` 20 个（`:61-62`），并按 `tools.get(name, parent)` 过滤掉 profile 里没有的（`:289-296`）。

**判断**：真正让它「像 superagent」的不是更强的模型或提示词，而是**把「谁该干什么」变成数据库状态机 + 事务 + durable 队列**。其中 `waitForPerson`/`followupOwners`/`settled`/`ticketStage` 这些谓词（`docs/007-architecture.md:96-103`）是全部复杂度的来源。这套东西只有在「多个请求持续涌入、进程会重启、必须不丢不重」的前提下才划算。

### 3.4 状态与持久化

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 主库 | `<stateDir>/orchestrator.sqlite`，只有 `Store` 打开 | `docs/007-architecture.md:452` |
| 表 | `trigger`、`disposition`、`trigger_thread`、`thread`、`ticket`、`decision`、`effect`、`outbox`、`kv` | `:454-464` |
| 生成列 | `thread.active`/`subscribed`、`ticket.open`/`active`、`outbox.dropped`，每个带索引，让一次 pass 只读活跃工作 | `:466` |
| 进程锁 | `proper-lockfile` 在打开 SQLite 前锁状态目录，防第二个进程迁移或写 | `src/app/runtime.ts:57` 注释、`:15` import |
| KV | 类型化键族（`Key<V>`/`Family<V,A>`），每个族声明**唯一写者** | `src/kv.ts:10-19`、`docs/007-architecture.md:261-270` |
| 迁移 | `SCHEMA_VERSION` 只增；预发布的 schema 10 在启动时升一次；比代码新的库拒绝启动，更老的库也拒绝 | `docs/007-architecture.md:486` |
| 删除 | **没有删除，表无限增长**：trigger/disposition/decision、结束的 Ticket 与 Thread、outbox 回执、每个 settings/prompt 版本 | `:484` |
| 缓存 | 有界内存 `TextCache`，重启即失；读指针要在重启后从 offset 0 重读 | `:482` |

**与我们的规则冲突（事实）**：我们的业务表要求逻辑删除字段、关联人员与时间戳、数字枚举（[`AGENTS.md:19-20`](../../AGENTS.md)）。原型的表用文本状态、无 `deleted_at`、并明确「什么都不删」。**判断**：`Store` 的「一个写者 + 事务 + 生成列做索引」思想可以参考，表结构不能照搬，代码片段也不能直接进 `backend/`。

### 3.5 权限与沙箱边界

| 层 | 原型怎么做的 | 出处 |
| --- | --- | --- |
| 会话权限 | 所有受管 Session 一律 `danger-full-access` | `src/app/sessions.ts:152` |
| 进程身份 | 以 operator 的 OS 用户运行；worker 能按路径执行程序、读 operator 家目录；隔离办法是「用专用 OS 账户，只放 agent 的凭据」 | `docs/006-deployment.md:19` |
| 工具面 | 主 Session 7 个工具 + guard；worker 20 个白名单；Ticket 结束即拒绝（`guard` 返回 `'Ticket ended; …'`） | `src/app/sessions.ts:262-264, 289-296, 303-312` |
| subagent | 只能在 worker 下跑，走 dsh 的 `standard` preset「with the worker's permissions」，继承工作工具白名单，Ticket 结束一并失效 | `docs/003-execution.md:47`、`src/app/sessions.ts:303-312` |
| 管理面 | 只挂 `prefix /orchestrator`；**要求 webServer 绑 `127.0.0.1`**，否则启动即抛错；每个请求查 same-origin | `src/app/http.ts:231, 234, 237` |
| 授权 | 允许名单（按 Source 的 scope）、admission 表、规则、Mandate 重新校验 | `docs/002-authorization.md:5`、`src/policy.ts` |
| 提示词边界 | 明确写「提示词改变告诉 agent 什么，不改变 dsh-superagent 允许什么：工具权限、gate、账户包装都不变」 | `src/app/prompts.ts:200` |

**判断**：它的「权限」是**工具面 + 允许名单 + 提示词自律**，不是文件系统或进程隔离；`docs/006-deployment.md:19` 自己承认 worker 能读 operator 家目录。这与我们的空间模型是两种东西：我们的 `spaces` 每次操作重算允许根、用 `/proc/self/fd` 核对实际对象、在只绑定这些根的 bwrap 里跑脚本，并在 policy 层拒绝 `danger-full-access`（[边界 §3.3](../architecture/dsh-ecosystem-boundary.md)、`backend/spaces/src/policy.ts:29`）。

## 4. 测试与构建

### 4.1 工具链对照

| 项 | 原型 | 我们的现状 |
| --- | --- | --- |
| 运行时 / 包管理 | Node `^22.19.0 \|\| >=24`，pnpm 11.7.0（`package.json:53-57`） | Node 同区间，corepack 钉 pnpm 11.28.5（[`README.md:27-28`](../../README.md)） |
| 类型检查 | `tsc --noEmit`，`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`（`tsconfig.json:10-15`） | `tsc -b`（build 即类型检查），strict（[`README.md:41`](../../README.md)、[研究 2026-10-23](2026-10-23-typescript-build-route.md)） |
| 构建 | `tsdown` 0.22.14，两份 config：host ESM + client CJS（`tsdown.config.ts:9-13`） | `tsc -b` 每包 `dist/`，不用 bundler |
| 测试 | vitest 4.1.8；`include: tests/**/*.spec.{ts,tsx}`；面板测试用文件头 `// @vitest-environment jsdom` | `node --test "tests/**/*.test.mjs"` |
| 门禁入口 | `pnpm check` = typecheck && test && build（`package.json:51`） | `npm run build` / `npm test` / `npm run combo:verify` / precommit 四档（[`README.md:42-46, 67-76`](../../README.md)） |
| CI | **无**（无 `.github/`） | `.github/workflows/check.yml`，push 到 `main`/`integration/**` 与手动触发 |
| 测试夹具 | `tests/fixtures/host.ts` 起一个内存 dsh 主机（假 agent、假 job registry、假 HTTP），`fixtures/panel-server.ts` 按路由假管理 API | `tests/fixtures/` + 启动器驱动真实后端（[`README.md:19`](../../README.md)） |

### 4.2 `tests/` 覆盖了什么

59 个 spec 覆盖面很宽，按 `docs/007-architecture.md:402-448` 的分组：领域规则（`core-engine`、`stage`、`policy`、`registry`、`sources`）、副作用与调度（`effects`、`passes`、`outbox`、`queue`、`runtime-concurrency`）、Session 与模型面（`runtime`、`tools`、`model-surface`、`role-models`、`retry-health`）、存储与迁移（`store`、`migration`、`timeline`）、面板（9 个 `panel-*.spec.tsx` + `client`/`controls`/`draft`/`navigation`）、结构与体例（`bundle-patch`、`docs`、`class-docs`、`locales`、`styles`）、安装脚本（`service-script`）。

其中有三个 spec 是**元检查**，也是最值得单独看的部分：

| 检查 | 断言什么 | 出处 |
| --- | --- | --- |
| `bundle-patch.spec.ts` | 用 dsh 自己的 `cordis-plugin-include` 的 `entryListSchema`/`applyEntryPatches` + `js-yaml` 读 `cordis.patch.yml`，断言行顺序、两个 preset 的 id/order、沙箱与 jobs 的 5 秒数字、subagent 走 `standard`、以及「不该出现的插件一个都不在」 | `tests/bundle-patch.spec.ts:10-26, 29, 54` |
| `docs.spec.ts` | 文档编号从 000 连续；编号文档只链更早的；所有本地链接能解析；无冲突标记；**007 的模块表恰好列出 `src` 下每个文件、测试表恰好列出 `tests` 下每个文件** | `tests/docs.spec.ts:52-63` |
| `model-surface.spec.ts` | 两个角色的「系统提示 + 工具定义」合计字符数不超预算（`orchestrator: 59_000`、`worker: 40_500`），且文案里不出现已废弃术语 | `tests/model-surface.spec.ts:44-46` |
| `class-docs.spec.ts` | `src` 里每个 class 前都有 JSDoc | `docs/007-architecture.md:445` |

### 4.3 可照搬的门禁做法（含我们已有的）

| 做法 | 原型出处 | 我们的现状 | 判定 |
| --- | --- | --- | --- |
| 用真 loader 读 patch，断言行与预设内容 | `tests/bundle-patch.spec.ts:10-26` | **已有等价物**：`tests/ecosystem-boundary.test.mjs` 用 `loadOverlayPatches`/`composeEntries` 读行集合；`tests/baseline-boot.test.mjs:40-86` 断言禁止行 | 不必搬 |
| 架构文档的模块表/测试表与目录反向对账 | `tests/docs.spec.ts:58,63` | **没有**：`tests/docs.test.mjs:28-40` 只查相对链接能否解析 | 值得搬（低成本、直接对齐 [`CODING_STANDARDS.md:7`](../../CODING_STANDARDS.md)「声称须可执行」） |
| 模型可见面字符预算 | `tests/model-surface.spec.ts:44-46` | **部分**：`tests/model-double.test.mjs` 只固定工具数量（见 [Agent 能力面:58-59](../architecture/agent-capabilities.md)） | 值得搬：上下文成本会随 row 增加而上涨，数量断言看不出来 |
| 每个 class 的 JSDoc 检查 | `class-docs.spec.ts` | 无 | 不搬：对个人项目收益低于维护成本（[`AGENTS.md:14`](../../AGENTS.md)） |

## 5. 复用判断

本节回答两个不同的问题，读的时候不要混：§5.1–§5.4 是「要不要用它的实现」（移植判断，结论是不用），§5.5 是「它的机制里哪些值得借」（机制参考，与是否移植无关）。后者的价值不依赖前者。

### 5.1 可复用（按性价比排序）

| # | 结论 | 依据 | 我们的现状 | 动作 |
| --- | --- | --- | --- | --- |
| R1 | 「一句一行 + 打包时校验 + 每次组装现算 + 版本快照」的提示词工程可以直接借 | `src/app/skill-files.ts:25-32`、`src/app/prompts.ts:102-111`、`src/app/sessions.ts:244-249, 335-338` | 提示词散在各 row（如 `backend/memory/src/maintenance.ts` 的 `MAINTENANCE_POLICY`），无统一排版与版本 | 若将来提示词超过两三处，再统一；现在只借「一句一行 + 加载时校验非空」两条 |
| R2 | 把技能做成包内资产 + `skills.register` + `resourceBase` | `src/app/skill-files.ts:18-24`、`src/app/sessions.ts:313-327` | 我们的 `skill` 行在禁止清单里（`tests/baseline-boot.test.mjs:63-65`），目前不用技能机制 | 只要仍禁止 `skill` 行就不适用；若将来解禁，这套是最小样板 |
| R3 | 架构文档的模块表/测试表由测试反向对账 | `tests/docs.spec.ts:58,63` | 没有；文档漂移只能靠 review | 值得单独一票，用 `node:test` 重写十几行即可 |
| R4 | 模型可见面的字符预算 | `tests/model-surface.spec.ts:44-46` | 只有工具数量断言 | 值得单独一票，与 `#240` 的上下文治理同向 |
| R5 | 每票一个 Session、目录与 id 由票派生（`worker-<id>`） | `src/executor/dsh.ts:24-26` | 我们已有等价做法：主会话 + 记忆维护子由创建者 `agents.create({ meta: { parentSession, agentPreset } })` 组合（`backend/memory/src/maintenance.ts:434-449`） | 已具备，不需要照搬 |
| R6 | 「等」要显式化：前台命令超时转后台、job 等待有上限、guard 拒绝 `sleep` | `cordis.patch.yml:38-74`、`src/app/sessions.ts:77-86` | 我们的 `tool-bash` 已 `promoteOnTimeout: true`、`tool-jobs` 已 `completionDelivery: wakeup`（`backend/v1-bundle/cordis.patch.yml:351-359`），但没有「拒绝 sleep」这类 guard | 借 guard 思路，不抄正则；等出现具体浪费再加（[`AGENTS.md:14`](../../AGENTS.md)） |
| R7 | 管理面「只绑 loopback + 同源检查」的默认姿态 | `src/app/http.ts:231,237` | 我们相反：Android 从非 loopback 地址访问，靠 `trustedHosts` + `ctx.connection.fence`（`backend/v1-bundle/cordis.patch.yml:213-216`、`backend/http/src/http.ts:236`） | 不适用，见 5.2 |
| R8 | 「安装由 agent 按文档逐步执行」的 SETUP 协议 | `SETUP.md:5-14, 61-78` | 我们有 `npm run backend:doctor` 与安装链研究，但没写成 agent 可执行的对话协议 | 可在写部署文档时借结构（先探测、一次一问、先给计划） |

### 5.2 不可复用（逐条给理由）

| # | 结论 | 依据 | 我们的现状 |
| --- | --- | --- | --- |
| N1 | 自建工作流引擎（Engine 五 part + Effects + Outbox + 9 张表） | `docs/007-architecture.md:52-62, 164-181, 450-466` | 我们的编排是「每行一个能力，会话之间靠 dsh 原生 inbox/agent」：`backend/chat`、`backend/delivery`、`backend/sessions` 各管一段，没有集中状态机 |
| N2 | 每票一个 worker Session + `sessionController` + `workspaceRegistry` | `src/app/sessions.ts:140-155` | 我们用更低层的 `ctx.agents.create/resume` + `ctx.sessions.prepare`（`backend/chat/src/runtime.ts:274, 289`、`backend/memory/src/maintenance.ts:436`、`backend/sessions/src/service.ts:204`），不挂 `session-controller` |
| N3 | agent preset 注册表与两套 preset | `cordis.patch.yml:20-193` | 我们没挂 `agent-preset-registry`，且 `agentPreset` 一出现就不是用户会话（`backend/identity/src/session.ts:28-33`） |
| N4 | `danger-full-access` + OS 账户隔离 | `src/app/sessions.ts:152`、`docs/006-deployment.md:19` | 我们 policy 层直接拒绝（`backend/spaces/src/policy.ts:29`），bwrap 绑定允许根 |
| N5 | 前缀路由 + loopback 限定 | `src/app/http.ts:231-237` | 我们 `exact` 路由逐条注册（`backend/http/src/http.ts:207`），Android 必须能从局域网访问 |
| N6 | React 面板与 `dsh.client` 装配 | `package.json:34-44`、`tsdown.config.ts:11-13` | 我们没有 dsh Web 客户端；首版客户端是 Android（[`README.md:16-17`](../../README.md)） |
| N7 | 业务表结构（文本状态、无逻辑删除、无关联人员） | `docs/007-architecture.md:454-484` | 与 [`AGENTS.md:19-20`](../../AGENTS.md) 正面冲突 |
| N8 | 单 operator 假设（无 `SessionHeader.owner`） | `README.md:7`、`docs/006-deployment.md:19` | 我们的工具面判定以 `owner` 为首要事实（`backend/identity/src/session.ts:28-33`、[Agent 能力面:5-21](../architecture/agent-capabilities.md)） |
| N9 | 无删除策略（表与回执永久增长） | `docs/007-architecture.md:484` | 我们已有逻辑删除与 ADR-0002 的物理删除例外，不能改成「不删」 |

### 5.3 与生态边界文档的关系

**明确冲突，不是补充。** 三条都能指到具体行：

| 冲突点 | 原型的做法 | 边界文档的现状 | 结论 |
| --- | --- | --- | --- |
| Remote / Typert 面 | `inject` `sessionController` 并调 `create`/`rename`/`modelCatalog`（`src/app/sessions.ts:140-153`），该服务是 `TypertRemoteService`（`packages/api/session-controller/src/index.ts:119`） | 「api-remotes 的客户端装配、session-controller/job-controller 命名空间：未挂载、未使用」（[§1.2](../architecture/dsh-ecosystem-boundary.md)） | 采纳原型 = 推翻 §1.2 与 §1.3 的取舍 |
| 权限预设 | 硬设 `danger-full-access`（`src/app/sessions.ts:152`） | 原生被列在「缺什么」的一条正是「不拒绝 `danger-full-access` 绕过」，产品因此自己保留实现并拒绝它（[§3.3](../architecture/dsh-ecosystem-boundary.md)、`backend/spaces/src/policy.ts:29`） | 正面冲突 |
| 技能与 subagent 行 | 两个 preset 必装 `skill`/`tool-skill`/`tool-subagent`（`cordis.patch.yml:75-78, 102-111`） | `tests/baseline-boot.test.mjs:63-65, 70-76` 把它们列为禁止行；[§5](../architecture/dsh-ecosystem-boundary.md) 把「运行时插件安装/启停」列为不在范围 | 要采纳先改禁止清单 |

**判断**：边界文档 §1.4 与 §3.3 都写了「重新评估条件」——原型的出现**不构成**这些条件被满足。它是**另一个部署姿态下的完整实现**（单 operator、无隔离、有 Web 客户端），不是我们边界的反例修正。正确的用法是把它当作「如果 OurFairy 是单人工具会长成什么样」的对照样本。

### 5.4 四条原则逐条对照

| 原则（[`AGENTS.md`](../../AGENTS.md)） | 原型 | 我们若跟进会怎样 | 判定 |
| --- | --- | --- | --- |
| 复用优先（`:8`） | 它复用了 dsh 的 Session/工具/提示词/技能/预设接缝，自建了 work item 领域 | 我们要复用的是它**已有的**东西（提示词工程、门禁），而不是它的领域层；领域层与我们的 `chat`/`sessions`/`delivery` 重复 | 只复用 R3/R4 |
| 结构按需（`:10`） | 9 张表、5 个 part、6 类 effect、14+6 个工具——为「多请求持续涌入 + 重启不丢」设计 | 我们是「少量受邀用户、每条会话一个人」；同样的表结构没有对应的生命周期与并发压力 | 不跟进 |
| 规模校准（`:14`） | 30k 行、59 个 spec、794 个用例、一个 React 面板 | 引入后我们的测试面与升级适配面都会翻倍，而收益是「更少的人类注意力」——这一条我们已用「会话 + 记忆 + 投递」在解 | 不跟进 |
| 插件理念（`:15`） | **做得好**：三个插件入口、窄接口（`SourceHost`/`SourceContext`/各 `*Host` 为 `Pick` 类型）、`src/core` 零 I/O、一个状态一个写者 | 我们已在做（每能力一行、深模块）；它的「一个状态一个写者」表（`docs/007-architecture.md:261-270`）可作为我们审查时的检查表 | 借检查表，不借实现 |

### 5.5 机制参考（与是否移植无关）

只抽机制：它长什么样、解决什么问题、我们哪一处接缝在解同一个问题、值得借的是「思想」还是「几行代码」。右两列与本仓现状对应，不表示我们缺能力；同一机制换位置实现也算已有。

| # | 机制 | 它解决什么 | 原型出处 | 我们的对应接缝 | 可借的一层 |
| --- | --- | --- | --- | --- | --- |
| M1 | 准入双层：确定性 gate 先判「谁、以多强的依据」，模型只判「要不要做」 | 权限判断不写进提示词，模型说服不了 gate | `src/policy.ts`、`src/app/assessment.ts`、`docs/002-authorization.md:9-18` | 归属与资格都在代码里判（`backend/identity/src/session.ts:28`），但「要不要做」没有独立一层 | 思想：将来做主动发言，先用代码判资格，再让模型判价值 |
| M2 | Mandate：accept 时冻结授权（范围、强度、策略版本），策略变更只投递、不撤销，恢复前重新校验 | 授权是可审计的一等对象，不是提示词里的承诺 | `docs/001-domain.md`（Mandate 行）、`docs/002-authorization.md:5` | `spaces` 每次操作现算允许根，本就不可缓存 | 思想已一致；可借「记录依据」：允许根的推导没有留审计记录 |
| M3 | 一个聚合一个写者 + 命令级事务；外部副作用进 durable 队列，提交后才执行 | 状态机与副作用解耦，崩溃后可恢复 | `docs/007-architecture.md:52-62, 164-181` | `chat` 的 `appendOnce` + 请求队列、`delivery` 的持久行与启动恢复（`backend/chat/README.md`、`backend/delivery/README.md`） | 基本已有；差别在它是引擎级事务，我们是请求级 |
| M4 | 「等」显式化：前台命令与等待有上限 → 转后台 → 完成唤醒；turn 结束时仍有后台工作就继续占用，超 30 分钟才收 | 人不被一个长命令挡住，等待变成可观测状态 | `cordis.patch.yml:38-74`、`docs/003-execution.md:26-40` | `tool-bash` 已 `promoteOnTimeout`、`tool-jobs` 已 `completionDelivery: wakeup`（前半） | **后半是真缺口**：turn 结束时的后台工作归属与上限，我们无对应概念 |
| M5 | 按角色裁工具面 + guard 拒绝等待类动作（`sleep`、阻塞等待） | 能力面按角色收窄；行为约束用代码而非提示词 | `src/app/sessions.ts:77-86, 262-312` | `backend/memory/src/maintenance.ts:456-461` 已是同一套（`tools.restrict({allow: []})` + 专属 section） | guard 这一层：把「不许等」写成工具守卫 |
| M6 | 消息归属与交还：owned follow-up 不进 Eval，结束未读则释放，交还后才重新评估 | 同一条输入不会被两处各处理一遍 | `docs/002-authorization.md:21-40` | session owner 只判「谁能访问」，没有「这条输入正由谁处理」 | 思想：一旦有第二个消费者（主动消息、通知），重复处理必然出现 |
| M7 | 并发槽位，且给人留一个额外槽 | 人的请求不排在批处理之后 | `docs/003-execution.md:66-72` | 无：`backend/` 各 row 没有并发槽位概念 | 等真出现排队再借 |
| M8 | 阶段表：等谁由状态算出，表序即优先级，第一行命中 | 派生状态不落库，避免两份权威 | `docs/003-execution.md:7-16` | `chat` 的投影派生值同思想 | 已具备；可当审查清单 |
| M9 | 提示词资产化：一句一行便于 diff、载入即校验非空、按版本快照、覆盖记录 base | 提示词像代码一样可审、可回退 | `src/app/skill-files.ts:25-32`、`src/app/prompts.ts:102-111`、`src/kv.ts:29-31` | 提示词散在各 row 的常量里（如 `MAINTENANCE_POLICY`） | **直接可借**，零依赖 |
| M10 | 门禁：文档表与目录反向对账、模型可见面字符预算 | 文档漂移与上下文膨胀能被测试挡住 | `tests/docs.spec.ts:58,63`、`tests/model-surface.spec.ts:44-46` | `tests/docs.test.mjs` 只查链接；`tests/model-double.test.mjs` 只数工具 | **直接可借**，各十几行 |
| M11 | SETUP 协议：安装写成 agent 可执行的对话协议（先探测、一次一问、先给完整计划、密钥只给命令） | 部署步骤不靠人读长文 | `SETUP.md:5-14`、`README.md:13-17` | `npm run backend:doctor` + 安装链研究 | 结构可借，写部署文档时用 |

三档判断：

- **已有等价物**（M1/M2/M3/M8）：价值在「同一问题的另一种切法」，读它是为了确认我们的选择不是随机的，不是为了替换。
- **低成本直接借**（M9/M10/M11）：不需要动任何行、不引入依赖。
- **真缺口**（M4 后半、M5 的 guard、M6、M7）：都成立，但都需要触发条件——M4/M6 等「主动工作会跨 turn 持续存在」，M5 等出现具体的等待浪费，M7 等并发真的开始排队。现在做就是给不存在的故障写防御（[`AGENTS.md:14`](../../AGENTS.md)）。

## 6. 风险与不适用条件

| 风险 | 事实 | 影响 | 出处 |
| --- | --- | --- | --- |
| 版本假设 | 声明 `engines.dsh: ^0.2.1-alpha.2`、peer 依赖同区间；我们的 fork 是 `0.2.1-rc.2` + 31 个产品提交，安装包是 `rc.5` | 名义兼容（rc 在 `^0.2.1-alpha.2` 内），本文核对的 14 组 API 在 rc.2 全部存在；但它的行为验证只覆盖 alpha.2，跑在 rc.2 上是否等价**未核实** | `package.json:55, 62-85`；`git describe` |
| 未发布 API | 无。全部是 Service 方法/事件/类型子路径；唯一「半内部」是 `agent-preset/selected` 的模块声明合并，rc.2 有该事件 | 升级 dsh 时它没有编译期保护，只有它自己的 794 个用例 | `src/app/sessions.ts:49-54`；`packages/preset/agent-preset-registry/src/types.ts:69` |
| 许可 | MIT，需保留版权与许可文本 | 可以搬代码；本仓是 AGPL-3.0，已有「随代码保留上游 MIT 声明」的先例 | `LICENSE:1-13`；[`README.md:182-183`](../../README.md) |
| 维护成本 | 单提交、无 CI、无 issue 模板、无版本策略 | 上游不会修我们的 bug；跟进后每次 dsh 升级由我们适配 | §1.2 |
| 不适用条件 1 | 需要多用户/owner 隔离 | 它的世界只有一个 operator，worker 与主 Session 同权限 | `docs/006-deployment.md:19` |
| 不适用条件 2 | 需要文件级隔离 | 它只有工具面与提示词边界 | `src/app/sessions.ts:152` |
| 不适用条件 3 | 客户端不是 dsh Web | 面板是 `dsh.client` 的 web 装配，Android 用不上 | `package.json:34-44` |
| 不适用条件 4 | 请求是低频、人触发 | 它的复杂度买的是「多请求 + 重启不丢」；低频场景下这些表与队列是净成本 | `docs/007-architecture.md:52-62, 164-181` |

## 7. 未核实与卡点

1. **未运行**：没有 `pnpm install`，没有跑 `pnpm check`，没有把它装进任何 profile。文中「59 个 spec / ~794 用例」是文件名与正则匹配计数，不代表通过。
2. **上游只有 1 个提交**（不是浅克隆，见文首），无法评估活跃度、提交节奏或历史修复；「无维护承诺」是从「无 CI/无 tag/无 CHANGELOG/单提交」推出的事实性判断，不是从声明读到的。
3. **rc.2 上的实际可运行性未验证**：即便补上 §2.4 的四行，`sessionController.create` 的 `agentPreset` 参数在 rc.2 的行为、`workspaceRegistry.create` 与 `spaces` 根目录的相互影响，都只做了签名级核对。
4. **`docs/006-deployment.md:19` 的「worker 可读家目录」是它的自述**，我没有在容器里复现。
5. **测试预算数值会漂移**：`BUDGET` 是当时的基线（`tests/model-surface.spec.ts:44-46` 注释说「~5% above baseline」），照搬时需要按我们的模型面重量。

## 8. 建议（判断，不是结论）

| 优先级 | 动作 | 理由 | 成本 |
| --- | --- | --- | --- |
| 立刻 | 不引入其架构；把 R3（文档表对账）与 R4（模型面字符预算）各开一票 | 两条都直接对齐 `CODING_STANDARDS.md:7`「声称须可执行」，且与我们的 `node:test` 现成结构兼容 | 每票十几到几十行测试 |
| 立刻 | 在需要写提示词的地方采用「一句一行 + 加载时校验非空」 | R1，零依赖 | 约定级 |
| 知悉 | 保留本文作为「单 operator 形态」的对照样本；若将来要评估 agent preset 或 subagent 编排，先回看 §2.4/§2.5 的四行缺口与 header 语义 | 避免重复调查 | 0 |
| 暂不做 | 工作流引擎、Ticket/Outbox/Effects、React 面板、preset 注册表 | §5.2、§5.4 | — |
| 触发条件 | 若产品真出现「多个来源持续涌入 + 必须跨重启不丢 + 需要人工路由」的需求，再回来读 `docs/007-architecture.md` 的 5 个 part 与 9 张表 | 那才是它解决的问题；现在没有 | — |
