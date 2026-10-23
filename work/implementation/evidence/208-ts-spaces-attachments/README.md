# 208-ts-spaces-attachments — 票 #208（T3 spaces + attachments 迁 .ts）证据

分支 `ticket/208-ts-spaces-attachments`，基线 `integration/spec-205` @ `80dfc69fcb`。dsh 检出
`/home/eafen405/projects/deepseek-harness` @ `d1b6099ae716`（与 `combo.json` 锁定一致，已构建，本票未重建）。
Node v24.18.0，编译用 dsh 自带的 TypeScript 6.0.3。

`tdd` skill 在本会话不可用（子会话没有 `Skill` 工具），按同样的 red→green 纪律手工执行：先落断言看它红，
再让它绿，红绿都记在下面。

## 改了什么

### 两个包的源码（`.mjs` → `.ts`，包内原子）

| 包 | 文件 |
| --- | --- |
| `backend/spaces` | `src/{bash,bwrap,directory,fs,index,policy,sandbox,scope}.ts`（8 个，`.mjs` 源文件已删，不留 shim） |
| `backend/spaces` | `test-support/scope-contributors.ts`（测试专用行，见下「test-support 决定」） |
| `backend/attachments` | `src/{download,index,pdf,service}.ts`（4 个） |
| `backend/attachments` | `assets/pdf-worker.py`（从 `src/pdf-worker.py` 搬出，见下「pdf worker 搬家」） |

相对 import 一律写 `.js` 说明符（`./scope.js`、`./service.js`）：Node 的类型剥离只删类型、不改写说明符，
编译产物的路径才对得上。

### 清单与工程文件

- `backend/spaces/package.json`：`main` → `./dist/index.js`，`types` → `./dist/index.d.ts`；
  `exports` 的 `"."`、`"./policy"`、`"./bwrap"`、`"./fs"`、`"./sandbox"`、`"./bash"`、`"./directory"`
  各写成 `{ "types": …, "default": … }`（条件按声明顺序匹配，`types` 在前）；`"./locale/*.json"` 保持纯字符串目标；
  `files` → `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "locale/*.json"]`。
- `backend/attachments/package.json`：同样切 `dist`；`exports` 为 `"."`；`files` → dist 两个 glob +
  `assets/pdf-worker.py` + `README.md` + `pdf` + `locale/*.json`。
- `backend/spaces/tsconfig.json`、`backend/attachments/tsconfig.json`：照 T1/T2 的形状
  （`rootDir: src`、`outDir: dist`、`tsBuildInfoFile: dist/.tsbuildinfo`、`include: ["src/**/*.ts"]`）；
  `references`：spaces → `../http` + `../identity`，attachments → `../http` + `../sessions` + `../spaces`。
- `backend/spaces/tsconfig.test-support.json`：T2 的 noEmit 叶子工程（见下「test-support 决定」）。
- 根 `tsconfig.json`：solution 增加 `./backend/spaces`、`./backend/spaces/tsconfig.test-support.json`、
  `./backend/attachments` 三个 reference。
- 两个包的 README 没有点名 `.mjs` 路径，本票无需改。

### 测试 import 与断言（同一提交内）

- `tests/attachment-download-abort.test.mjs:9` → `../backend/attachments/dist/download.js`
- `tests/sandbox-network-profile.test.mjs:12` → `../backend/spaces/dist/bwrap.js`
- `tests/pdf-worker-cancel.test.mjs:28` → loader 钩子把 `@ourfairy/dsh-spaces/bwrap` 映射到
  `backend/spaces/dist/bwrap.js`
- `tests/pdf-worker-cancel.test.mjs:37`、`:144` → `backend/attachments/dist/pdf.js`
- `tests/spaces.test.mjs:52` → test-support 行改为 `backend/spaces/test-support/scope-contributors.ts`
- `tests/product-sources.test.mjs:166` 的断言（`pdf/` 轮子目录必须继续发布）**一字未改**：`files` 里保留了
  `pdf` 条目，doctor 的 `product packages` 清单里仍能看到
  `backend/attachments/pdf/pypdf-6.21.0-py3-none-any.whl`。
- `tests/identity-interfaces.test.mjs:111` 的「消费者不碰 identity 的 store」那条断言要**扫描消费方的源码**，
  扫描名单里的 `attachments/src/service.mjs` 改成 `attachments/src/service.ts`（断言本身一字未动；
  这是提交钩子跑全量时才发现的漏项，见下「Red 4」）。
- 没有改任何一条行为断言。

### 文档链接

`tests/docs.test.mjs` 断言仓库里每个 Markdown 相对链接都可达。源码改名后有 4 条链接指向不存在的文件：
`docs/decisions/upstream-compatibility-calibration.md`（1 条，指向 `backend/spaces/src/index.mjs`）与
`docs/decisions/native-capability-dependencies.md`（3 条，指向 attachments 的 `pdf.mjs` / `index.mjs` /
`service.mjs`）。这 4 条改成新的 `.ts` 路径，正文未改。指向 chat/delivery 的 `.mjs` 链接（T4/T5 的包）保持原样。

## pdf worker 搬家

`backend/attachments/src/pdf.mjs` 用 `dirname(fileURLToPath(import.meta.url))` 定位自己旁边的
`pdf-worker.py`。迁到 `.ts` 后 `import.meta.url` 指向 `dist/pdf.js`，`root` 变成 `dist/`，而 `tsc` 不复制
非 TS 资产——留在 `src/` 的 worker 在运行期就找不到了。

- **worker 落在 `backend/attachments/assets/pdf-worker.py`**（票面举例的 `assets/`）。包根的稳定目录，
  随包发布，不进 `dist/`（`dist/**/*.js` 是发布集，`.py` 不会被 `tsc` 复制进去）。
- **解析改成 `join(root, '../assets/pdf-worker.py')`**：`root` 是 `dist/`，往上一级就是包根。这与
  `pdf/` 轮子目录已有的 `join(root, '../pdf/pypdf-6.21.0-py3-none-any.whl')` 是同一个形状，两处只差一级。
- **发布**：`files` 加 `assets/pdf-worker.py`；doctor 的 `product packages` 清单里能看到它。
- 可复跑的断言脚本：[`check-pdf-worker.mjs`](check-pdf-worker.mjs)。

## 类型口径

档位照 `tsconfig.base.json`：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` +
`noImplicitOverride` + `noUnusedLocals` + `noUnusedParameters`（#201 的决议）。

- 没有 `@ts-nocheck`，没有 `@ts-ignore`，没有 `@ts-expect-error`，导出的签名里没有 `any`。
- 保留的 `as`（全部是「品牌 / 边界」上的断言，每处都写了理由，运行期不多一道检查）：
  - `backend/spaces/src/fs.ts`：`errorCode` 读 `error.code`（迁移前就是直接读同一个属性，抛出的 `null`
    仍然照样抛）；`metaError as Error` 读 `.message`（同上）。
  - `backend/spaces/test-support/scope-contributors.ts`：夹具站的是「只有 header 的 session」，把
    `id` / `header.owner` 认作 dsh 的品牌类型（运行期是同一个字符串）。
  - `backend/attachments/src/service.ts`：`sessionId as string`（owned-session 读刚拒过非本人的 id）、
    `uploadId as string`（锁的键，`_owned` 拒收非 32 位十六进制的 id）、`row.original as FileAttachmentRef | null`
    与 `row.image as ImageAttachmentRef | null`（store 的 JSON 列）、`mime as ImageMediaType`（propose 时
    已按 store 的 `imageLimits.mediaTypes` 收过）、`fileHostPath(...) as string` / `imageHostPath(...) as string`
    （store 写的引用）、`events as unknown as readonly AdmittedEvent[]`（会话日志是 JSON，见下）、
    `value as string[]`（逐个元素已验过是字符串）、`owner as SessionOwner`（身份库按活着的 short id 查人）。
  - `backend/attachments/src/pdf.ts`：`JSON.parse` 的结果读成 `WorkerResult`（worker 是产品自己的进程，
    答话是 JSON）、`result as unknown as PdfToolValue`（渲染那一步把原生图片引用挂到页面上，而它不是
    JSON 值类型）、`handle.collected.stdout as SubprocessOutputReader`（spawn spec 明确要了收集 stdout）、
    `agent.options.provider as string` / `model as string`（`resolveModelInfo` 的两个入参）、
    `exec.agent as Agent`（工具是按 agent 注册的，执行时一定绑着那个 agent）、
    `args as PdfToolArgs`（工具自己的 schema 是入参的权威）、`value.pages as unknown as WorkerPage[]`
    （工具的输出 schema 是开放的 JSON 值）。
- 动态形状一律用真守卫或真收窄收窄，不用断言加检查：
  - `Number.isSafeInteger` 写成类型守卫 `isSafeInteger`（检查本身没变，只是让通过检查的值能被当数字用），
    出现在 `service.ts` 的 propose/chunk/download 与 `pdf.ts` 的页码校验。
  - `fail` 改成**函数声明**并显式标注 `: never`：TS 只对「有显式返回类型标注的函数声明」做
    never-returning 的控制流收窄，`const fail = (...): never => …` 不会收窄。
- dsh 的上下文接缝用 `import type {} from '@deepseek-ai/dsh-…'` 加载其 `Context` 增强：
  `dsh-attachment`（`ctx.attachments`）、`dsh-llm`（`ctx.llm`）、`dsh-agent-default-model`
  （`ctx.agentDefaultModel`）、`dsh-fs`（`ctx.fs`）、`dsh-working-directory`（`ctx.workingDirectory`）、
  `dsh-agent`（`ctx.agents`）、`dsh-subprocess`（`ctx.subprocess`）、`dsh-client-connection`（`ctx.connection`）、
  `dsh-host-webserver`（`ctx.webServer`）、`dsh-session-projection`（`ctx.sessionProjections`）。
  这些 import 是纯类型的，编译产物里没有新的运行期依赖。
- 产品自己的服务在各自的包里声明上下文增强：spaces 声明 `ctx.ourfairySpaces`，attachments 声明
  `ctx.ourfairyAttachments`。

## 行为面：迁移中没有引入新的运行期检查

本票刻意**没有**加任何迁移前不存在的运行期形状检查。逐条核对过的地方：

- `SpaceScope.session(id)`：`ctx.sessions.get(id)` 在 `id` 为 `undefined` 时本来就是一次 Map 未命中，
  迁移后写成 `id === undefined ? undefined : this.ctx.sessions.get(id)`，结果相同。
- `SpaceScope.requireCurrent()`：迁移前是 `this.owner(session)` 再返回 `session`（`session` 为 `undefined`
  时 `owner` 抛 `FsError`）；迁移后先判 `undefined` 再调 `owner`，**抛的是同一个** `FsError`（同 message、
  同 code）。
- `ScopedFileSystem.assertRead(target, op)`：迁移前这个 `op` 形参在函数体里**没被用过**（JS 允许多传实参）。
  迁移后把实参去掉、函数签名保持 `assertRead(target)`，行为不变。
- `ScopedFileSystem.assertWrite(target, op, policy)`：`op` 迁移前也没被用过；迁移后形参改名 `_op`
  （TS 的 `noUnusedParameters` 放行下划线前缀），实参照旧传 `'write'` / `'edit'`。
- `ScopedFileSystem.mintTarget`：`targetKey: key` 改成 dsh 自己的品牌函数 `FsTargetKey(key)`
  （实现是 `key as FsTargetKey`，运行期同一个字符串）。
- `AttachmentService.fail`：仍是同一个 `AttachmentError`（同 status、同 code、同 message）；只把
  `const` 箭头函数改成函数声明，为的是拿到 TS 的 never-returning 收窄。
- `AttachmentService.propose` / `chunk` / `complete` / `download`：请求体里的值仍然是 `unknown`，
  检查顺序与迁移前逐条相同（先 mime 正则、再 `Number.isSafeInteger(size)`、再 sha256 正则）。
- `AttachmentService.inputs` 的图片类型检查：迁移前是
  `imageLimits.mediaTypes.includes(mime)`，迁移后是 `imageLimits.mediaTypes.some(allowed => allowed === mime)`
  ——同一张表、同一个字符串比较，`includes` 与 `===` 对字符串等价。
- `AttachmentService.qualifiedFile` / `refresh`：`fileHostPath()` / `imageHostPath()` 返回
  `string | undefined`，迁移前直接把它喂给 `realpathSync`（`undefined` 会抛）；迁移后用 `as string`
  在编译期收窄，**运行期不多一道判断**，抛错时机不变。
- PDF 工具：`defineTool` 的 `parameters` 形状、`output` schema（`{ type: 'object', additionalProperties: true }`）
  与 `render` 的产出**一字未改**；`execute` 返回的仍是 worker 的 JSON 加渲染时挂上的图片引用。
  worker 的请求体、bwrap argv、prlimit 参数、超时与终止判定逐条照抄。
- 会话日志是 JSON：`admittedMessages` 在**这一处边界**把事件流读成产品自己的形状
  （`events as unknown as readonly AdmittedEvent[]`），只取 `agent/inbox/spliced`、`user/message`、
  `delivery/message` 三种带消息的事件——与迁移前的三元表达式逐条对应。

## test-support 决定

`backend/spaces/test-support/scope-contributors.ts` 是**测试专用**的 dsh 插件行：它由测试用绝对路径交给
loader，不在包的 `files` 里，因此从不随包发布，也不进 profile。做法照 T2：

- **类型检查**：单独的 noEmit 工程 `backend/spaces/tsconfig.test-support.json`（`noEmit: true`、
  `allowImportingTsExtensions`、`erasableSyntaxOnly`），作为根 solution 的叶子 reference 参与 `tsc -b`；
  它的 buildinfo 落在 `backend/spaces/dist/.tsbuildinfo.test-support`（已被 `/backend/*/dist/` 忽略，
  `npm run clean` 也会清掉）。noEmit 工程只做类型检查、不产出 JS，所以夹具不会进包的 `dist`。
- **测试怎么到达**：`tests/spaces.test.mjs` 把夹具路径指向 `backend/spaces/test-support/scope-contributors.ts`，
  由 Node 的类型剥离直接执行。这条路线与 T6 计划里 `scripts/` 走 `.ts` 的做法一致。
- 夹具仍用「只有 header 的 session」：`scope-contributors.ts` 里 `id` / `header.owner` 各过一次品牌断言。

## Red / green

**Red 1（包内原子）**——源码已迁成 `.ts`、`.mjs` 已删，测试仍指旧源码路径（把基线提交里的测试文件原样
放到 `tests/` 下跑）：

```
$ node --test tests/zz-red-sandbox-network-profile.test.mjs tests/zz-red-attachment-download-abort.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../backend/spaces/src/bwrap.mjs' imported from .../tests/zz-red-sandbox-network-profile.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../backend/attachments/src/download.mjs' imported from .../tests/zz-red-attachment-download-abort.test.mjs
✖ tests/zz-red-attachment-download-abort.test.mjs
✖ tests/zz-red-sandbox-network-profile.test.mjs
```

**Green**——测试 import 改到 `dist/*.js`、夹具路径改到 `.ts` 之后：相关 9 个文件 49/49 通过（见下表）。

**Red 2（pdf worker 真的被搬到包根）**——把 worker 放回 `src/`（迁移前的布局），构建产物仍在 `dist/`：

```
$ node work/implementation/evidence/208-ts-spaces-attachments/check-pdf-worker.mjs
ok   the package is built: .../backend/attachments/dist/pdf.js exists
ok   the manifest points at the build output: main=./dist/index.js types=./dist/index.d.ts
FAIL the built module resolves the worker to an existing file:
      .../backend/attachments/assets/pdf-worker.py
1 check(s) failed   (exit 1)
```

**Green**——worker 落在 `assets/` 之后：4 项检查全过（exit 0）。

**Red 3（test-support 确实被检查）**——往夹具里塞一个类型错误，`tsc -b` 当场报出来：

```
$ node <dsh>/node_modules/typescript/bin/tsc -b tsconfig.json
backend/spaces/test-support/scope-contributors.ts(49,9): error TS2352:
  Conversion of type 'string' to type 'number' may be a mistake ...
```

（该行随后还原；noEmit 工程确实在检查这个文件，不是空转。）

**Red 4（漏掉的源码扫描路径）**——提交钩子跑全量时，票面给的「相关测试」清单没有覆盖到的一条断言红了：
`tests/identity-interfaces.test.mjs` 的「消费者不碰 identity 的 store」要读消费方的源码，扫描名单里写的
还是 `attachments/src/service.mjs`：

```
$ node --test tests/identity-interfaces.test.mjs
✖ the service and its consumers reach identity through the domain faces, never the store
  Error: ENOENT: no such file or directory, open
    '.../backend/attachments/src/service.mjs'
ℹ tests 293  ℹ pass 292  ℹ fail 1
```

**Green**——扫描名单改成 `attachments/src/service.ts` 之后：6/6 通过；钩子重跑全量时 293/293 通过。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run clean` | `removed 5 build output directories`（http/identity/sessions/spaces/attachments 的 `dist`） |
| `npm run build` | 干净树编译通过，无输出。产物：`backend/spaces/dist/{bash,bwrap,directory,fs,index,policy,sandbox,scope}.{js,d.ts}`，`backend/attachments/dist/{download,index,pdf,service}.{js,d.ts}` |
| `node scripts/precommit.mjs --print` | 门禁的相关测试选择：9 个文件（attachment-download-abort、bundle-packages、config-contracts、pdf-worker-cancel、product-sources、row-addressability、sandbox-network-profile、scoped-provider-rows、spaces） |
| `node --test`（上面那 9 个文件） | 49 tests / 49 pass / 0 fail |
| `node --test tests/spaces.test.mjs tests/attachments.test.mjs tests/pdf.test.mjs` | 19 tests / 19 pass / 0 fail（含 `.ts` 夹具行被 loader 加载、真实 bwrap 里的 PDF 渲染） |
| `node --test tests/docs.test.mjs` | 1 test / 1 pass / 0 fail |
| `node work/implementation/evidence/208-ts-spaces-attachments/check-pdf-worker.mjs` | 4 checks / 4 pass（worker 从构建产物可达，且随包发布） |
| `npm run backend:doctor` | `doctor: all checks passed`。`product packages` 里 attachments 是 `dist/*`（`.js` + `.d.ts`）+ `assets/pdf-worker.py` + `README.md` + `locale/en.json` + `package.json` + `pdf/README.md` + `pdf/pypdf-6.21.0-py3-none-any.whl`，**没有** `src/*`；spaces 同样只有 `dist/*`，**没有** `test-support/*` |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)` |
| `npm run combo:verify` | `combo: combination verified`（ourfairy / dsh / android source 三行 ok） |
| `git check-ignore -v backend/spaces/dist/.tsbuildinfo.test-support` | `.gitignore:11:/backend/*/dist/` |
| 提交钩子（`node scripts/precommit.mjs`，因包 manifest 属权威路径而判成 `full`） | 第一次 293 tests / 292 pass / **1 fail**（Red 4 那条源码扫描路径）；修好后重跑 **293 / 293 pass / 0 fail**，`combo:verify` 为 `combo: combination verified`。**那是钩子的行为，不构成本票的门禁**。 |

`backend:probe` 用了 `OURFAIRY_PORT=0`：本机 3080 端口被一个与本票无关的 `dsh web` 占着（与 T1/T2 记录的情况相同）。

## 没有跑的

- **没有主动跑全量 `npm test`**：票面「不跑全量」把全量留给 T6。本票主动跑的是上表列出的相关文件。
  提交时仓库自带的 pre-commit 钩子若因为包 manifest 属于权威路径而判成 `full` 模式替本票跑一次全量，
  那是**钩子**的行为，不构成本票的门禁。
- **没有触发 CI**：没有 push。
- **没有合入 `integration/spec-205`**：由 Lead 合。
- 没有改 `combo.json`、Android 客户端、dsh 检出；没有加根 `devDependencies`、lockfile 或第二份 TypeScript。
- 没有迁 `chat` / `delivery` / `gateway` / `groups` / `search` / `speech` / `probe`，也没有迁 `scripts/`。

## 未完成项与留给下一票的提醒

- **`as unknown as` 只出现在 JSON 边界**：`backend/attachments/src/service.ts` 的会话事件流、
  `backend/attachments/src/pdf.ts` 的 worker 答话与工具规范值。这三处都是「运行期是 JSON、类型系统里
  没有对应形状」的地方。T4+ 若也在自己的包里读会话事件或别的 JSON，**先找已有的边界工具**
  （`readSessionEvents` 是事件流那一处的入口），别在每个包里各写一份 `as unknown as`。
- **PDF 工具的规范值不是 JSON 值类型**：`ImageAttachmentRef` 是 interface（有可选字段、没有索引签名），
  在 TS 里不是 `JsonValue`。渲染那一步把它挂到页面上，所以工具的规范值必须过一次 `as unknown as`。
  T4+ 若新增带图片的工具，会撞同一堵墙。
- **`defineTool` 的参数 schema 不能用条件展开推断**：`parameters` 里 `...(mode !== 'info' ? { pages: … } : {})`
  会让 `InferArgs` 丢掉 `pages`（`keyof` 联合类型只留下公共键）。本票在 `execute` 边界用一次
  `args as PdfToolArgs` 收窄；**工具的 schema 仍是入参的权威**，运行期不多一道检查。
- **`fail` 这类「拒绝」辅助函数要写成函数声明**：TS 的 never-returning 收窄只认「有显式返回类型标注的
  函数声明」，写成 `const fail = (...): never => …` 不会收窄，后面每一处都会被 `unknown` 污染。
  T4+ 抄这个形状。
- **陈旧探针的落点要跟发布集走**：`tests/product-sources.test.mjs` 的「新增一个已发布文件必须进哈希」
  那条断言，探针落在**已迁包的 `dist/`**（identity 是 `backend/identity/dist/staleness-probe.js`）。
  spaces / attachments 本来就没有这条探针，迁完后它们的发布集变成 `dist/`，后续若给它们加探针，
  要落在 `dist/` 里。
- **`backend/spaces/test-support` 不进包、不进 profile**：doctor 的 `product packages` 清单里
  不应出现 `test-support/`；若将来有人把它写进 `files`，夹具就会随包发布。
- **`backend/attachments/pdf/` 轮子目录继续发布**：`files` 里的 `pdf` 条目不能删——
  `tests/product-sources.test.mjs:166` 断言它，且 PDF worker 在运行期要读那个 `.whl`。
