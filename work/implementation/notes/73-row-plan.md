# #73 行拆分与契约清单（实现者共享上下文）

票面是行为权威；本文件只写**经过代码核对的落点**，避免四张票各自发明结构。

## 共同前提

- bundle 的 `dependencies` 是产品包集合的唯一权威（#96 之后）。新增包 = 新目录 `backend/<name>` + 在 bundle `dependencies` 加 `file:../<name>` + 在 `backend/v1-bundle/package.json` 的 `files` 无需改动（files 只覆盖 bundle 自身）。
- 新增行写在 `backend/v1-bundle/cordis.patch.yml`，行 id 稳定、全小写短横线；行名用包名或包名子路径。
- 每个新产品包的 `peerDependencies` 用明确 semver（#98 统一改）；`files: ["src","README.md"]`。
- 产品包**不能**导入只在 profile 安装域的包；可导入的 dsh 包见 `spec71-boundary.md`「产品包可解析的 dsh 包」。

## #99 投递行

- 新包 `backend/delivery`（`@ourfairy/dsh-delivery`）：把 `backend/chat/src/delivery.mjs` 整体移入 `src/index.mjs`（`installDelivery` 逻辑不变），文件名与包 README 说明它是独立行。
- chat 只暴露窄运行时服务：新文件 `backend/chat/src/runtime-facade.mjs`（**不要改 runtime.mjs / service.mjs**，它们归 #72），内容是一个 `Service`（名字 `ourfairyChatRuntime`），构造参数是现有 `SessionRuntime` 实例，方法仅：`runSession`、`runDelivery`、`live`、`events`、`barrier`。在 `chat/src/index.mjs` 里注册它，并删除 `installDelivery(ctx, runtime)` 调用。
- 投递行 `inject`：`identity`、`ourfairySessions`、`ourfairyAttachments`、`ourfairyChatRuntime`、`sessions`、`sessionPersistence`、`tools`、`agents`。
- 通知出口事件名保持 `ourfairy/delivery`（测试 `chat/test-support/fail-outlets.mjs` 依赖它）。
- disable 投递行后：`deliver_message` 工具缺席、待协调投递不再恢复；chat 四条路由仍工作。

## #100 群组行

- 新包 `backend/groups`（`@ourfairy/dsh-groups`）：把 `backend/spaces/src/groups.mjs` 整体移入 `src/index.mjs`，导出 `name`/`inject`/`apply`。
- `inject`：`ourfairySpaces`、`identity`、`agents`。群组根仍经 `ctx.ourfairySpaces.contributeExtraRoots` 注册；不复制任何 scope 计算。
- 删除 `backend/spaces/src/index.mjs` 里的 `ctx.inject(['identity','agents'], context => installGroups(context))`。
- bundle 行：`groups` → `@ourfairy/dsh-groups`。

## #101 scoped provider 各自成行

`backend/spaces` 保留 `SpaceScope`（scope.mjs）、`bwrap.mjs`、`policy.mjs` 与 systemPrompt 贡献；四个 provider 各自成为模块 + 行：

| 模块（新） | 行 id | 行名 | 源码来源 |
| --- | --- | --- | --- |
| `src/fs.mjs`（已存在）导出 default class | `scoped-fs` | `@ourfairy/dsh-spaces/fs` | 现有 `ScopedFileSystem` |
| `src/sandbox.mjs` | `scoped-sandbox` | `@ourfairy/dsh-spaces/sandbox` | 现有 `ScopedSandbox` |
| `src/bash.mjs` | `scoped-bash` | `@ourfairy/dsh-spaces/bash` | 现有 `ScopedBash` |
| `src/directory.mjs` | `scoped-directory` | `@ourfairy/dsh-spaces/directory` | 现有 `ScopedDirectory` |

- spaces 行只做：创建 `SpaceScope` 服务、`tools/execute` 作用域包裹、systemPrompt 贡献。
- `src/fs.mjs` 改为 `export default ScopedFileSystem` + `static Config`（`cwd`、`diffBasisMaxBytes`），bundle 行把原 `apply()` 里传的值写进行 config（`cwd: !!js dshHomePath('spaces')`，`diffBasisMaxBytes: 10485760`）。
- 包 `exports` 增加 `./fs`、`./sandbox`、`./bash`、`./directory`；`files` 已含 `src`。
- disable 任一 provider 行时：依赖它的能力必须**明确失败**。具体表现：缺 `fs` → 文件工具注入等待（未激活）→ 探针报该 provider 行未激活；缺 `sandbox`/`bash` → 脚本工具失败。不得挂载未加 scope 的原生 provider（bundle 里本来就没有它们，行改名后也不会新增）。
- 探针的 `SERVICE_ROWS` 里 `fs`/`shell`/`sandbox`/`workingDirectory` 的 expected row 需要从 `spaces` 改为对应行 id（#102 会改成"bundle 产品行全部 active"的事实检查，届时同步）。

## #102 Config 与启动期失败

- identity：现有 `resolveConfig()` 保留，改为先经 `Config`（schemastery，`@deepseek-ai/schemastery`）校验，再交给 `resolveConfig`；必填 `path`、`sessionTtlDays` 正整数。
- spaces：`Config = z.object({ root: z.string().required() })`；`SpaceScope` 直接收已校验 config。
- attachments：`Config = z.object({ root: z.string().required() })`；`AttachmentService` 已只用 `root`。
- speech 已有 Config，不动。
- 探针新增事实检查：遍历 `loader.entries()`，凡是 `name` 以 `@ourfairy/` 开头、且不是探针自身（`ourfairy-baseline-probe`）的行，若 `disabled` 或 `fiberState !== 'active'`，记一条失败 `row "<id>" (<name>) is not active`。这样非法 config 不再只是 3 号退出码以外的情况：`start`/`probe` 直接失败。
- 保留现有 `SERVICE_ROWS` 的服务 liveness 断言，但把 `spaces`/`sandbox-policy` 之外四个 provider 的 expected row 更新为 #101 的行 id。

## #103 单一模型权威

- 删除 `combo.json` 的 `backend.agentModel` 与 `agentModelNote`（并把 `description`/note 中"两处声明"的措辞改掉）。
- `scripts/ourfairy-backend.mjs`：删除 `readCombination()` 里对 `agentModel` 的校验、`bundleAgentModel()`/`bundleDeclaresAgentModel()`、`doctor` 的 `bundle agent model` 检查、`childEnv` 里的 `OURFAIRY_PROBE_PROVIDER/MODEL/REASONING_EFFORT`。
- 探针：`runTurn` 用 `ctx.get('agentDefaultModel').currentSelection()` 作为 `agentOptions`；boot 模式也把该 selection 写进 `report.model.selection`（或新字段 `report.initialModel`）以便外部断言组合值。缺 `agentDefaultModel` 时明确失败。
- 删除 `tests/executable-claims.test.mjs` 的双声明用例，替换为 `tests/bundle-manifest.test.mjs` 的 manifest 一致性用例：复制仓库 → 改 bundle 的 `agent-default-model` 行 model → 探针 boot 报告读到新值（且不再有第二份声明可漂移：combo.json 中没有 `agentModel`）。

## 探针/测试的期望归属

- `tests/baseline-boot.test.mjs` 的 `REQUIRED_SERVICES` 与 `FORBIDDEN_ROW_IDS` 保留为**测试的期望**；探针只报事实（行、服务、未激活行）。#102 的"bundle 产品行全部 active"由探针作为事实检查（失败即 report.ok=false），它不是把期望搬进探针：探针只断言"bundle 自己声明的行都活着"，不判断哪些行该缺席。
