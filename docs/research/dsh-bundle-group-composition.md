> 2026-10-21 状态：日期化记录。本文记录 2026-10-21 的判断，不描述当前实现。

# dsh 组合的 group 化：bundle 拆成 kernel / plugins 两段，与四个缺席行的归因

日期：2026-10-21。dsh 检出 `/home/eafen405/projects/deepseek-harness`，HEAD = `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`，与 [`combo.json`](../../combo.json) 的 `repos.dsh.productCommit` 一致（`dsh-v0.2.1-alpha.2-25-g5b8ec0f175`）；工作树有 16 个未提交改动（docs、若干测试、`tool-cordis/src/api-catalog.ts`），**本文引用的文件都不在其中**。产品侧读 `backend/v1-bundle/cordis.patch.yml`（46 个顶层行）、`scripts/combo.mjs`、`backend/probe/src/index.mjs` 与相关测试。

方法：dsh 源码实读（`vendor/loader`、`vendor/include`、`packages/boot/app-boot`），外加一次离线合成实验——用 dsh 自己的 `applyEntryPatches` / `Loader` 对产品真实 bundle patch 做分组改写并跑 15 项断言，全部通过；实验脚本跑完即删，未入库。

## 结论

1. **可以用 loader 原生 `group: true` 拆成两段。** product bundle 的 patch 顶层 `- insert:` 里**可以直接放 group 行**——这不是 web-app 的 preset 形式：dsh 自己的 bundle 级 patch 就是这么写的（`packages/experimental/terminal-bundle/cordis.patch.yml`、`packages/experimental/session-search/cordis.patch.yml`、`packages/experimental/ralph-bundle/cordis.patch.yml`）。group 行也**不需要在 `package.json` 里声明任何依赖**：`cordis:group` 是 app-boot 注册的 builtin（`packages/boot/app-boot/src/index.ts:565`），不经过 profile 的模块解析。
2. **现有检查里只有一处会真的断。** `nativeCapabilityFailures`（`scripts/combo.mjs:485`）按**顶层**行查表，四个必选原生行一旦进 group 就查不到。`tests/native-capabilities.test.mjs` 的同一处查表，以及它按**缩进字符串**替换 `llm-retry` 行的做法（`:106`），要一起改。
3. **其余检查都已经是 group-aware 的**：`flattenEntries`、`applyEntryPatches` 的 id 寻址、overlay 覆盖 group 内行、probe 的 rows 报告，都已实测可用。probe 的 rows 会多出两个 group 行（`kernel` / `plugins`），**不触发任何现有断言**。
4. **四个候选缺席行的归因**：`session-title` 与 `session-title-llm` 暂缓（产品需要但尚未适配）；`tool-fs-search` 与 scoped fs 冲突（需说明）；`user-questions` 写死排除（它唯一的出厂应答路径是产品刻意不接的 Typert/Remote 接缝）。
5. **两处缺席清单只有一处是清单。** `docs/architecture/dsh-ecosystem-boundary.md` 明确不列行清单（`:5-8`），§4 是「不在范围」；真正重复描述缺席的是 `backend/v1-bundle/README.md` 的「Absent rows」散文，而对账它的 `tests/bundle-readme.test.mjs` 已在 `0d31139` 被删——**今天没有任何检查读那份 README**。

## 1. group 的语法与寻址规则

### 1.1 最小可行示例

product bundle 的 patch 顶层：

```yaml
- insert:
    - id: kernel
      name: cordis:group
      group: true
      config:
        - id: llm-retry
          name: '@deepseek-ai/dsh-llm-retry'
```

四个必要条件：

| 条件 | 依据 |
| --- | --- |
| `name: cordis:group` | builtin 别名。`vendor/loader/src/config/tree.ts:113` 对 `cordis:` 前缀走 `ctx.loader.builtins[name]`，而 `builtins.group = Group` 由 app-boot 在 `packages/boot/app-boot/src/index.ts:565` 注册 |
| `group: true` | loader 判定「嵌套」的唯一依据是「truthy 的 `group` + 数组形态的 `config`」（`vendor/loader/src/config/entry.ts`、`vendor/include/src/index.ts:69`） |
| `config` 是**行数组**，不是配置对象 | 同上；`config` 给对象就是普通插件配置 |
| 行要能进 patch 顶层 `- insert:` | dsh 自己的 bundle 级 patch 就这么写（`packages/experimental/*-bundle/cordis.patch.yml`）；产品侧已有先例测试：`tests/bundle-packages.test.mjs:262`「a product row nested in a group is part of the package set」就是往 bundle patch 顶层追加一个 group 行 |

YAML 层面没有障碍：patch 与 entry list 用的是同一个开放 schema（`userPatchesSchema = entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)`，`packages/boot/app-boot/src/index.ts:266`、`vendor/include/src/index.ts:23`），`group` 键与数组 `config` 都是普通映射/序列。`!!js` 表达式在 group 子行里照样求值——`prepareProfilePatches` 的 visitor 显式递归（`packages/boot/app-boot/src/index.ts:354`）。

### 1.2 寻址规则

- **按 id 找行**：`applyEntryPatches` 建索引时递归进 group（`vendor/include/src/index.ts:66-74`，`if (entry.group && Array.isArray(entry.config)) buildMap(entry.config)`）。所以 patch 里写 `{ id: 'delivery', disabled: true }` 能命中 group 内的 `delivery` 行。实测通过。
- **按 id 往 group 里插**：`{ id: 'kernel', insert: [...] }` 会把行 append 进该 group 的 `config`（`vendor/include/src/index.ts:79-94`）。实测通过。
- **id 撞车**：后写入的覆盖先写入的（`entryMap.set`）。所以 group 内外的 id 必须全局唯一——本 bundle 的 46 个 id 互不重复，拆组不引入新 id，无碰撞风险。
- **运行时的 `Entry.id`**：probe 与 patch 层用的都是原始 `options.id`（`backend/probe/src/index.mjs:80`）；运行时 `Entry.id` 在顶层行与 group 内行之间形态一致，产品也不用它寻址。

### 1.3 disable 语义（group 特有）

- group 行**自身永远报告未禁用**：`Entry.disabled` 对 `options.group` 直接返回 false（`vendor/loader/src/config/entry.ts:76-78`）。
- 但**禁用 group 行会连带禁掉全部子行**：子行的 disabled 判定沿 `entry.parent.ctx.fiber.entry` 上溯到 group 行（`:79-84`）。也就是说 overlay 里 `{ id: 'kernel', disabled: true }` 会让 kernel 里的行全部停摆，而 probe 报出来的 `kernel` 行自己仍是 `disabled: false`。这一点在写新的 overlay 断言时要记住。

## 2. 会被影响的检查清单

以「kernel / plugins 两段、必选原生行放 kernel」为例（`kernel` 33 行 / `plugins` 13 行，合计仍是 46 行）。

| 检查 | 位置 | group 化后 | 处置 |
| --- | --- | --- | --- |
| `flattenEntries` | `scripts/combo.mjs:245` | **已展开嵌套**（`entry.group && Array.isArray(entry.config)`） | 无需改 |
| `verifyBundlePackages` | `scripts/combo.mjs:354`、`359-362` | group 行被 product scope 过滤掉（`cordis:group` 不以 `@ourfairy/` 开头），不算产品行；子行照常计入 | 无需改 |
| `nativeCapabilityFailures` | `scripts/combo.mjs:485-487` | **断**：`new Map(rows.map(row => [row.id, row]))` 只取顶层，四个必选原生行查不到 → 报「required native capability missing」 | **必须改**：查表前先 `flattenEntries(rows)` |
| `verifyInstalledNativeCapabilities` | `scripts/combo.mjs:540` | **断**：传给上一行的 `rows` 是未展开的 `boot.composeEntries(...)` | **必须改**（同上，一处改动即可覆盖） |
| `tests/native-capabilities.test.mjs` 的 `composedRows()` | 同文件 | **断**：与上同源，同样是顶层查表 | **必须改** |
| `tests/native-capabilities.test.mjs:106` | 字符串替换 `llm-retry` 行 | **断**：替换串写死了 4/6 空格缩进；进 group 后缩进变 8/10 空格 → 替换落空 → `assert.notEqual(removed, source)` 失败 | **必须改**：改成按 id 定位行，而不是按缩进做字符串替换 |
| `FORBIDDEN_ROW_IDS` | `tests/baseline-boot.test.mjs:38-73` | **不受影响**：多出的 `kernel` / `plugins` 不在禁用表里 | 无需改（可另加一条断言把 group 行钉住） |
| `tests/ecosystem-boundary.test.mjs` 的 `mountedRows()` | `:55-68` | **已 group-aware**：注释就写明「Group-nested rows are flattened by the helper `scripts/combo.mjs` already uses」 | 无需改 |
| `tests/bundle-packages.test.mjs:262` | — | **已覆盖 group 嵌套**：往 bundle patch 顶层追加 group 行并验证它进产品包集合 | 无需改 |
| overlay 寻址（`--patch`） | `tests/row-addressability.test.mjs:369`、`409`、`459` | **不受影响**：`applyEntryPatches` 的 id 索引递归进 group，实测 `{ id: 'delivery', disabled: true }` 能禁用 group 内的行 | 无需改 |
| probe 的 rows 报告 | `backend/probe/src/index.mjs:74-86` | **多报 2 行**（`kernel`、`plugins`，`name: cordis:group`）；子行照常按原始 id 报出 | 无需改 |
| probe 的非活跃产品行检查 | `backend/probe/src/index.mjs:107-119` | **不受影响**：按 `name.startsWith('@ourfairy/')` 过滤，group 行不是产品行 | 无需改 |
| `tests/row-addressability.test.mjs` 的行集差异 | `:548` 附近（disabled boot 与 baseline boot 的 rows 差集） | **不受影响**：两侧都含 group 行 | 无需改 |
| `tests/config-contracts.test.mjs`、`tests/scoped-provider-rows.test.mjs` | 按 id 查 `report.rows` | **不受影响**：probe 报的是原始 id | 无需改 |

一句话：**要改的只有 combo.mjs 的一处查表 + native-capabilities 测试的两处配套做法**；其余检查已经是 group-aware 的。

## 3. 四个候选缺席行的归因

这四个行在 dsh 的 base bundle 里都有（`packages/bundle/base/cordis.patch.yml`），本 bundle 不继承 base，所以它们现在都不在组合里。前三个**不在** `FORBIDDEN_ROW_IDS` 里，`tool-fs-search` 在。

### 3.1 `session-title` —— 产品需要但尚未适配（暂缓）

`@deepseek-ai/dsh-session-title` 提供 `ctx.sessionTitle`：从第一条合格人类消息派生确定性 fallback、可选的异步 provider、显式 `rename()`；标题是 `session/title` 日志事件，能随 replay / resume / paging 存活，且**不进模型输入**。它注册一个客户端可见的 `title` 投影单元和一个 host 专用的 `titleInput` 单元。依赖 `@deepseek-ai/dsh-session` 与 `@deepseek-ai/dsh-session-projection`——**这两个产品已经挂了**（行 `session`、`session-projection`）。base 的配置是 `fallbackMaxWords: 5 / fallbackMaxBytes: 40 / maxTitleBytes: 80`，三个字段都必填、无默认值。

**为什么暂缓而不是排除**：产品 `/sessions/*` 的会话投影目前是 `{ id, owner, primary, createdAt }`（`backend/sessions/src/service.mjs:59-66`），**没有标题字段**，客户端也没有消费 `title` 投影单元的位置。挂载它要同时改产品投影契约与客户端，属于「需要但尚未适配」。与 scoped fs 无关。

**建议的缺席理由**：「会话标题尚未进入产品的会话投影契约；挂载它要改 `/sessions/*` 的响应形状并让客户端消费 `title` 投影单元。」

### 3.2 `session-title-llm` —— 产品需要但尚未适配（暂缓，且依赖上一条）

`@deepseek-ai/dsh-session-title-first-prompt-llm` 是 `first-prompt` cadence 的 provider：把第一条合格人类消息总结成标题，只在全新会话首次创建 fallback 时自动跑一次，失败保留 fallback、只由 `ctx.sessionTitle.refresh()` 重试。依赖三样：`@deepseek-ai/dsh-session-title`（注册目标）、共享执行模块 `@deepseek-ai/dsh-session-title-llm`、以及 `ctx.llm` 路由。base 的配置是 `targetWords: 5 / targetCjkCharacters: 10 / maxInputBytes: 4096 / maxOutputTokens: 4096 / timeoutMs: 60000`；不写 `provider`/`model` 时它继承主请求记录下来的路由。

**为什么暂缓**：没有 `session-title` 就没有注册目标，它自己发不出请求；等标题真的落进产品投影后，它还要把辅助请求落到产品的 `llm-pi-ai` 路由上（base 那份配置没有指定 provider/model，走的是「当前已记录的主请求路由」，对产品而言不是显式值）。

**建议的缺席理由**：「它是标题服务的可选 provider，在 `session-title` 落地并把辅助请求接到产品的 `llm-pi-ai` 路由之前没有注册目标。」

### 3.3 `tool-fs-search` —— 与 scoped fs 冲突（需说明）

`@deepseek-ai/dsh-tool-fs-search` 给模型两个工具：`glob`（按路径模式找文件）与 `grep`（按内容搜索）。它**不经过 `ctx.fs`**，而是直接 spawn 打包的 `@vscode/ripgrep` 二进制（`packages/fs/tool-fs-search/src/search-core.ts`），只需要 `ctx.subprocess` 后端；base 的行带 `sampleOverCapGlobResults: false`。

与产品冲突在两处，都是结构性的：

1. **二进制在产品的执行命名空间里不可见。** `rgPath` 是宿主绝对路径，位于 dsh profile 的 `node_modules` 下。产品的 bwrap 命名空间只绑 `/usr`、`/lib`、`/lib64`、`/bin`、`/sbin`、运行时文件、`envRoot`、可写根与只读附件（`backend/spaces/src/bwrap.mjs:26-28`、`:50-77`；`backend/spaces/src/scope.mjs:23`），**不绑 profile 的 node_modules**。`envRoot` 是产品自己的运行时目录（`<data>/env`），与 dsh profile 目录是两棵树。→ 命名空间内 exec 找不到该文件，搜索会以 `SEARCH_FAILED` 失败。
2. **路径解析基准不同。** 工具返回的路径以会话 cwd 为基准，而产品的 `read`/`write` 走的是按归属派生的 scoped fs provider（`@ourfairy/dsh-spaces/fs`）。工具 README 自己就写明「returned paths are follow-up-readable with `read` only when that workdir and the filesystem root are the same workspace」——产品的「文件系统根」是按归属派生的私有/公有/群组根，不是一个全局 cwd，所以「搜到的路径能被 `read` 读到」这条前提不成立。

**附带一处文档失真**：`backend/v1-bundle/README.md:46-48` 把 `tool-fs-search` 归进「the remainder of that list are the unscoped file, shell and sandbox defaults the scoped adapters replace」。这个归类不准——它不是原生默认、也没有被 scoped 适配器替换，而是一项与 scoped 模型冲突的新能力。

**建议的缺席理由**：「搜索工具的二进制在产品的 bwrap 命名空间内不可见，且其路径基准与按归属派生的 scoped fs 不同；挂载它需要先给命名空间开一条放行路径并统一解析基准。」

### 3.4 `user-questions` —— 产品不需要（写死排除）

`@deepseek-ai/dsh-user-questions` 提供 `ctx.userQuestions`：`ask()` 阻塞等答案，`askTimed()` 允许代理先继续做别的事；`userQuestions` 投影从工具调用与答复派生。

**为什么写死排除**：它的唯一出厂应答路径就是 Typert/Remote。服务类 `extends TypertRemoteService`（`packages/interaction/user-questions/src/index.ts:79`），应答是 `@Remote answer(...)`（`:164`），等待计时是 `@Remote({ mode: 'stream' }) attachWait(...)`（`:215`）。而产品的生态边界已经明确记录「Typert 装饰器与生成的 `Remote` 描述符：**未使用**」（`docs/architecture/dsh-ecosystem-boundary.md` §1.2）——产品的传输是自有的 HTTP + SSE 路由，不接 Remote。模型侧消费者 `dsh-tool-ask-user` 产品也没挂，所以即便挂上服务也没有模型可见的入口。

**一条需要注意的细节**：`tests/ecosystem-boundary.test.mjs:188-197` 只按包名正则拦 `@deepseek-ai/dsh-api-*`、`@deepseek-ai/dsh-typert-*`、`@deepseek-ai/dsh-plugin-manager`。`@deepseek-ai/dsh-user-questions` **不匹配这些正则**，所以挂上它不会让那个测试变红，却会让 §1.2「未使用 Typert Remote 描述符」这条声称失真——而 §1.2 没有配一个失效即失败的检查。写死排除的理由要落在文档里，不能只靠那个正则。

**建议的缺席理由**：「它的唯一出厂应答路径是 Typert/Remote 方法，而产品的传输与模块形态刻意不接这条接缝；产品要做问答要走自己的路由。」

## 4. 两处缺席清单的现状

| 位置 | 有没有缺席清单 | 与 `FORBIDDEN_ROW_IDS` 的关系 |
| --- | --- | --- |
| `docs/architecture/dsh-ecosystem-boundary.md` | **没有**。开篇 `:5-8` 明确「本文不列行清单和包清单……缺席行的期望由 `tests/baseline-boot.test.mjs` 的 `FORBIDDEN_ROW_IDS` 拥有」。§4「不在范围」讲的是产品**不做**的事（不挂 plugin manager、不做 npm 发布、不把 Android API 迁到 `/api`、不把业务 SQLite 换成 storage-domain），每一项配一个失效即失败的检查，**不含任何行 id** | 指向它，不重复 |
| `backend/v1-bundle/README.md:40-48`「Absent rows」 | **有**：点名 `FORBIDDEN_ROW_IDS` 为权威（正确），外加一段手写散文，把 34 个 id 归成「skills/goal/subagent/telemetry/web/workflow/plan mode/MCP 资源」与「其余是被 scoped 适配器替换的原生文件/shell/sandbox 默认」两类 | **这是唯一重复描述缺席的地方**，且那段散文目前没有任何检查覆盖 |

**`tests/ecosystem-boundary.test.mjs` 只对账架构文档，不对账 bundle README。** 它的三项断言都针对 doc：doc 不得引用任何行 id 或已声明包名（`:141-173`）、doc 必须点名四个权威（`:141-153`）、doc 引用的测试标题必须还在（`:242-259`）。它**从不读** `backend/v1-bundle/README.md`。

**曾经对账过的那处检查已经没了。** `tests/bundle-readme.test.mjs` 是 #47 建的（`work/implementation/evidence/arch-47-bundle-readme/README.md`），它会解析 `FORBIDDEN_ROW_IDS`、比对 README 是否复述了列表、是否列了 bundle 没挂的行。该文件在 `0d31139`（2026-10-17，"remove defensive bloat, redundant comments and test-only source asserts"）被当作「断言源码文本而非行为」的测试删掉，理由是「Their behaviour is covered by the real-profile suites」。

**这个删除留下一个真实缺口**：`FORBIDDEN_ROW_IDS` 与 bundle README 之间现在没有可执行的对账，README 的散文可以漂移而不被发现——3.3 指出的 `tool-fs-search` 归类失真就是这样漂出来的。补 `FORBIDDEN_ROW_IDS` 的缺席理由时，同一处要么恢复一个行为级检查，要么把理由放进 `FORBIDDEN_ROW_IDS` 旁边的注释里（这份注释由 `tests/baseline-boot.test.mjs` 自己拥有，是唯一权威所在）。

## 5. 建议的下一步

1. **要拆组，先改查表。** `scripts/combo.mjs` 的 `nativeCapabilityFailures` 与 `tests/native-capabilities.test.mjs` 的 `composedRows()` 改用 `flattenEntries`；`tests/native-capabilities.test.mjs:106` 的字符串替换改成按 id 定位。这三处是 group 化的前置条件。
2. **必选原生行留在 kernel 顶层还是进 kernel 内？** 进 kernel 内也可以，但前提是第 1 步先落地；否则这四行必须留在顶层。两条路二选一，别混。
3. **缺席理由写在 `FORBIDDEN_ROW_IDS` 旁边**，因为那份列表是唯一权威；README 的散文按 #47 的教训不再复述列表。
4. **本记录未覆盖**：`plugin-manager` 对 group 内 id 的寻址（`packages/boot/plugin-manager/tests/manager.spec.ts:758` 有 dsh 自己的用例，但产品不挂 plugin manager）；`isolate` 在 group 行上的隔离语义（本记录只确认子行通过 ctx 原型链继承，dsh 的 preset 用它给一组行一份 realm）。

## 附：本文引用的一手位置

| 事实 | 位置 |
| --- | --- |
| `cordis:group` 是 app-boot 注册的 builtin | `packages/boot/app-boot/src/index.ts:565` |
| bundle 级 patch 顶层放 group 行的先例 | `packages/experimental/{terminal-bundle,session-search,ralph-bundle}/cordis.patch.yml` |
| id 索引递归进 group | `vendor/include/src/index.ts:66-74` |
| 按 id 往 group 里 insert | `vendor/include/src/index.ts:79-94` |
| group 行自身永不 disabled，子行沿 parent 上溯 | `vendor/loader/src/config/entry.ts:76-85` |
| `loader.entries()` 报告 group 行与子行 | `vendor/loader/src/config/tree.ts:27-33` |
| patch 与 entry list 共用开放 schema | `packages/boot/app-boot/src/index.ts:266`、`vendor/include/src/index.ts:23` |
| `!!js` 在 group 子行里求值 | `packages/boot/app-boot/src/index.ts:354` |
| 四个必选原生行（顶层查表） | `scripts/combo.mjs:469-474`、`485-487`、`540` |
| 已 group-aware 的展开 | `scripts/combo.mjs:245`、`tests/ecosystem-boundary.test.mjs:55-68` |
| probe 的 rows 报告与非活跃产品行检查 | `backend/probe/src/index.mjs:74-86`、`107-119` |
| bundle patch 顶层 group 行的既有测试 | `tests/bundle-packages.test.mjs:262` |
| 已删的 README 对账检查 | `work/implementation/evidence/arch-47-bundle-readme/README.md`、`git show 0d31139` |
