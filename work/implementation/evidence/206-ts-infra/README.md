# 206-ts-infra — 票 #206（T1 基础设施与守卫）证据

分支 `ticket/206-ts-infra`，基线 `integration/spec-205` @ `aac76bbb7c`。dsh 检出
`/home/eafen405/projects/deepseek-harness` @ `d1b6099ae716`（与 `combo.json` 锁定一致，已构建，
本票未重建）。Node v24.18.0。

## 改了什么

### 构建链

| 文件 | 内容 |
| --- | --- |
| `tsconfig.base.json`（新） | 共享编译档位：`strict` + dsh base 的 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noImplicitOverride` / `noUnusedLocals` / `noUnusedParameters`；`skipLibCheck`、`composite`、`noEmitOnError`、`verbatimModuleSyntax`；`target: es2024`、`module`/`moduleResolution: nodenext`、`types: ["node"]`。`composite` 已含 `declaration` + `incremental`，故未重复写。 |
| `tsconfig.json`（新） | 根 solution：`files: []` + `references: [{ path: "./backend/http" }]`。空 solution 无引用是 TS18002，所以它与第一个迁完的包一起落地。 |
| `backend/http/tsconfig.json`（新） | `extends ../../tsconfig.base.json`；`rootDir: src`、`outDir: dist`、`tsBuildInfoFile: dist/.tsbuildinfo`、`include: ["src/**/*.ts"]`。 |
| `scripts/link-types.mjs`（新） | 由 `combo.json` 驱动的根 `node_modules` 符号链接农场：dsh 的 `packages/*/*` 与 `vendor/*`、产品包、`zod` / `@types/node` / `typescript`。只替换本脚本自己建的符号链接；同名真实目录保留并告警。导出 `linkTypes(root)`，供测试副本重建农场。 |
| `scripts/tsc.mjs`（新） | 用**锁定的 dsh 检出自带的 TypeScript 6.0.3** 跑 `tsc -b`。仓库根没有 `devDependencies`、没有 lockfile、没有第二份 TypeScript：编译器的版本权威仍是 dsh 检出。导出 `tscToolchain` / `cleanProducts` / `buildProducts`。 |
| `package.json` | 新增 `build`（link-types + 清 `dist` + `tsc -b`）、`typecheck`（link-types + 增量 `tsc -b`）、`clean`、`pretest: npm run build`。 |
| `.gitignore` | 新增 `/node_modules/`、`/backend/*/dist/`。构建信息落在 `dist/.tsbuildinfo` 里，随 `dist` 一起忽略，没有散在 `dist` 外的 `*.tsbuildinfo`，故未另加该规则。 |

构建**先清 `dist` 再编译**：`tsc -b --clean` 只删它还认得的产物，源文件被删后遗留的产物会活下来并被装进
profile，所以清的是整个 `backend/*/dist` 目录。

### 安装链守卫（#200）

- `scripts/ourfairy-composition.mjs` 的 `productSources()`：某个 `files` 条目展开出**零个文件**时抛错，
  错误信息点名包（`backend/http (@ourfairy/dsh-http)`）、条目（`"dist/**/*.js"`）与补救命令
  （`npm run build`）。此前缺 `dist` 与空 `dist` 不可区分：两者哈希相同、pnpm「装成功」、doctor 一直绿，
  启动时才以 `ERR_MODULE_NOT_FOUND` 崩掉。`publishedEntries()` 的 npm glob 语义未动，仍可单测。
  该模块仍然**零 spawn**：只 import `node:fs` / `node:path` / `node:crypto` / `node:os`。
- `scripts/ourfairy-backend.mjs`：新增 `buildProducts()`，作为 `installProfile()` 的**第一步**，在哈希/安装判定之前。
  构建失败以可读信息终止。它住在进程层（launcher 本来就握 `child_process`），构建实现复用
  `scripts/tsc.mjs` 的 `buildProducts`，同一份「怎么构建」只有一处。
- `commandDoctor`：新增 `product build` 检查，排在 `dsh CLI build` 之后、`product packages` 之前。
  同一进程内只构建一次（`doctor` 的构建检查与 `installProfile` 共用一次构建）。
- `OURFAIRY_SKIP_BUILD=1`：launcher 跳过重复构建。测试夹具默认注入它——全量套件里有几十次并发的
  launcher 调用，否则它们会同时写同一份构建输出。生产与 CI 不设这个变量。**跳过构建不等于跳过守卫**：
  源哈希仍然走 `productSources`，缺/空 `dist` 照样硬失败（实测见下）。

### 测试基础设施（#202）

- `tests/helpers/dsh-peers.mjs`：三条手写的 `@ourfairy/*` anchor 换成由 `productPackageDirs()` 驱动的
  **全部产品包** anchor，每个包锚在自己的 `package.json` 上（不是某个 `dist` 文件）——这样 `exports`
  自己决定解析结果：已迁的包解析到 `dist`，未迁的包仍解析到 `src`，anchor 不必跟着改。
- `tests/helpers/backend.mjs`：`copyProductRepo()` 多复制根 `tsconfig.base.json` 与 `tsconfig.json`；
  复制时滤掉 `*.tsbuildinfo`（带着 buildinfo 的副本会让副本里的构建假绿：缺了产物也不重建）；
  用 `linkTypes(root)` **重建**链接农场而不是复制（复制的农场带着上一台机器的路径）。
  `launchEnv()` 默认注入 `OURFAIRY_SKIP_BUILD=1`（显式传 `OURFAIRY_SKIP_BUILD: undefined` 可让 launcher 构建）。

### 门禁（#202）

`scripts/precommit.mjs` 从两模式改成四模式：

| 模式 | 触发 | 命令 |
| --- | --- | --- |
| `docs` | 无路径（message-only amend）或全部 `*.md` | `node --test tests/docs.test.mjs` + `npm run combo:verify` |
| `related` | 改动面能选出相关测试 | `npm run build` → `node --test <选中的测试文件>` → `npm run combo:verify` |
| `typecheck` | 源码改动但选不出相关测试 | `npm run typecheck` + `npm run combo:verify`（不声称行为覆盖） |
| `full` | 根构建/门禁权威、包 manifest、共享 fixture、合并提交、`--full`、选中集 > 45 | `npm test` + `npm run combo:verify` |

相关测试的选择规则：staged 的 `tests/**/*.test.mjs` 必选；staged 的 `backend/<pkg>/**` 选中正文含
`backend/<pkg>/` 或 `@ourfairy/dsh-<pkg>` 的测试；staged 的叶子 `scripts/<name>.(mjs|ts)` 选中正文含
`scripts/<name>.` 的测试；Markdown 改动加 `tests/docs.test.mjs`。`--print` 仍打印决策 JSON 且不执行，
合并检测（`MERGE_HEAD`）保留。

`.github/workflows/check.yml`：删掉 `pull_request:` 触发，保留 `push` 到 `main` 与 `integration/**` 以及
`workflow_dispatch`；dsh 四条构建之后、`npm test` 之前加一步 `npm run build`；保留 `npm test` 与
`npm run combo:verify`。根 `README.md` 的「提交前钩子」「CI」两节同步改成新的分流。

### `backend/http` 试点

- `src/http.mjs`、`src/index.mjs` → `src/http.ts`、`src/index.ts`（`.mjs` 源文件已删，不留 shim）。
- 严格标注补齐：隐式 any 的参数与绑定元素、`catch` 里的 `unknown`。整个文件没有 `any`、没有 `as`、
  没有 `@ts-expect-error`、没有 `@ts-nocheck`：JSON body 的对象形状用类型守卫 `isJsonObject()` 收窄，
  不靠断言。
- 相对 import 写 `.js` 说明符（`./http.js`）：Node 的类型剥离只删类型、不改写说明符，所以 `.js`
  说明符才让编译产物的路径是对的。
- `package.json`：`main` → `./dist/index.js`，`types` → `./dist/index.d.ts`，`exports` 按子路径给
  `types` + `default`（条件按声明顺序匹配，`types` 在前），`files` → `["dist/**/*.js", "dist/**/*.d.ts",
  "README.md", "locale/*.json"]`。`./locale/*.json` 保留。

## Red / green

先写断言再看它红。

**Red 1（门禁四模式）**——`scripts/precommit.mjs` 还没改：

```
$ node --test tests/precommit.test.mjs
✖ tests/precommit.test.mjs (48.588021ms)
  SyntaxError: The requested module '../scripts/precommit.mjs' does not provide an export named 'TYPECHECK_COMMANDS'
ℹ tests 1 / pass 0 / fail 1
```

**Red 2（发布集与零文件守卫）**——`productSources()` 还没改、`backend/http` 还没迁：

```
$ node --test tests/product-sources.test.mjs
✖ the hashed set follows what the packages publish, not their test fixtures
✖ a package that publishes its build output is hashed by that output
  AssertionError: the http package publishes its build output, so the hash must cover it;
  the composition listed backend/.../src/http.mjs, backend/.../src/index.mjs, ...
✖ a files entry that publishes no file is refused instead of silently skipped
  AssertionError: Missing expected exception: a missing dist must be refused, not hashed as an empty set
ℹ tests 9 / pass 6 / fail 3
```

**Green**——实现后：

```
$ node --test tests/precommit.test.mjs
ℹ tests 11 / pass 11 / fail 0
$ node --test tests/product-sources.test.mjs
ℹ tests 9 / pass 9 / fail 0
```

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 干净树编译通过，无输出。产物：`backend/http/dist/{http,index}.{js,d.ts}` + `dist/.tsbuildinfo`。 |
| `npm run clean` | `removed 1 build output directory`；`backend/http/` 下只剩 `README.md locale package.json src tsconfig.json`。 |
| `npm run typecheck` | 通过（增量 `tsc -b`，无输出）。 |
| `node --test tests/precommit.test.mjs` | 11 tests / 11 pass / 0 fail |
| `node --test tests/product-sources.test.mjs` | 9 tests / 9 pass / 0 fail |
| `node --test tests/bundle-packages.test.mjs` | 11 tests / 11 pass / 0 fail |
| `node --test tests/identity-http.test.mjs` | 10 tests / 10 pass / 0 fail |
| `node --test tests/product-sources.test.mjs tests/bundle-packages.test.mjs tests/precommit.test.mjs tests/identity-http.test.mjs` | **41 tests / 41 pass / 0 fail**（票面要求的验收集合） |
| `node --test tests/composition-module.test.mjs tests/launcher-import.test.mjs tests/bundle-manifest.test.mjs tests/dsh-checkout.test.mjs` | 9 tests / 9 pass / 0 fail（改了共享 helper 与 launcher 之后的相邻面） |
| `npm run backend:doctor` | `doctor: all checks passed`。含新增的 `ok product build: built the product packages`；`product packages` 列出 `backend/http/dist/{http,index}.{js,d.ts}`，不再有 `backend/http/src/*`。 |
| `npm run backend:probe` | **失败**：`listen EADDRINUSE: address already in use 127.0.0.1:3080`。3080 被本机上与本票无关的 `dsh web` 进程占着（`ss -ltnp` 显示 pid 1521 `node /home/eafen405/.npm-global/bin/dsh web`）。这是环境占用，不是本票改动。 |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)`。换临时端口即可，端口占用之外没有别的失败。 |
| `OURFAIRY_SKIP_BUILD=1 npm run backend:doctor`（把 `backend/http/dist` 移走后） | `FAIL product packages: backend/http (@ourfairy/dsh-http) declares the files entry "dist/**/*.js", which publishes no file; the profile install would copy a package without its build output. Run 'npm run build' to produce it.` 同一条信息也让 `profile project linked` 失败；`doctor: 2 check(s) failed`。守卫在跳过构建时照样响亮。 |
| `npm run combo:verify` | `combo: combination verified`（ourfairy / dsh / android source 三行 ok）。 |
| `git check-ignore -v node_modules backend/http/dist` | `.gitignore:10:/node_modules/`、`.gitignore:11:/backend/*/dist/`。 |
| 仓库自带的 pre-commit 钩子（提交时自动跑） | 本票改到了根 `package.json`、`scripts/tsc.mjs`、`scripts/link-types.mjs`、`backend/http/package.json`、`backend/http/tsconfig.json`、两个根 `tsconfig*.json` 与 `tests/helpers/**`——都是 `full` 权威路径，所以钩子判成 `full` 并跑了 `npm test`：**293 tests / 293 pass / 0 fail**，随后 `npm run combo:verify` 也绿。 |

`backend:probe` 默认端口 3080 的失败与本票无关：`ss -ltnp` 显示 3080 由用户自己起的 `dsh web` 占着，
而 `README.md` 已写明产品 web carrier 默认就绑 3080、测试用临时端口避开。验收以 `OURFAIRY_PORT=0`
的一次为准，原始那次失败也照实记在这里。

关于「不跑全量」：票面把全量留给 T6，本票**没有**把全量当成本票的验证步骤——上面那 293 条是仓库自己的
pre-commit 钩子对权威级改动的既有行为（`full` 模式），不是本票主动跑的验证。钩子绿是额外信息，
不构成「全量门禁已在 T1 收口」的声称。

提交：`feat(#206)` on `ticket/206-ts-infra`，父提交为集成分支 tip `aac76bbb7c`。

## 没有跑的

- **没有主动跑全量 `npm test`**：票面「不跑全量」把全量留给 T6。本票主动跑的是上面列出的相关文件；
  提交时仓库自带的钩子替本票跑了一次全量（见上表），那不是本票选的验证步骤。
- **没有触发 CI**：没有 push、没有改远端。
- **没有合入 `integration/spec-205`**：由 Lead 合。
- 没有改 `combo.json`、Android 客户端、dsh 检出；没有加根 `devDependencies`、lockfile 或第二份 TypeScript。
- 没有迁 `backend/` 下其它包，也没有迁 `scripts/`（`scripts/link-types.mjs`、`scripts/tsc.mjs` 是 T1 新增的
  `.mjs`，T6 再迁 `.ts`）。

## 未完成项与留给下一票的提醒

- **`scripts/` 仍是 `.mjs`**（T6 迁 `.ts`）。`scripts/precommit.mjs` 的权威路径表按 basename 匹配
  `scripts/{precommit,tsc,link-types,combo,ourfairy-composition,ourfairy-backend}.(mjs|ts)`，改名后不用改表。
- **测试 import 还没切 `dist`**：本票只有 `backend/http` 一个包迁了 `.ts`，它的测试 import 面为零
  （`tests/dsh-peers.mjs` 之外没有测试直接 import `backend/http/src`）。T2 迁 `identity` 时，
  `tests/identity-interfaces.test.mjs`、`tests/owner-codec.test.mjs`、`tests/conversation-search.test.mjs`
  里的 `backend/identity/src/*.mjs` 要在同一提交里改成 `backend/identity/dist/*.js`。
- **`backend/http` 的 `dist` 必须先在**：`npm test` 的 `pretest` 会编译一次；单独 `node --test tests/x.test.mjs`
  **不**跑 `pretest`，单文件跑之前先 `npm run build`，否则测的是旧产物。
- **`productSources` 的零文件守卫会让 doctor 在缺 `dist` 时红**：这是有意的。T2 起每个新迁的包都要
  先有 `dist` 才谈得上 doctor 绿。
- **`tests/precommit.test.mjs` 里 `backend/delivery` 的路径是拼出来的**（`['backend','delivery','src','index.mjs'].join('/')`）：
  选择规则按正文匹配，一个正文里写着包名的测试文件会被那个包选中，这个文件会选中自己，断言就无法成立。
  下一票若要加同类用例，照这个写法走，并在注释里说明原因。
- **`product build` 检查在 `OURFAIRY_SKIP_BUILD=1` 时报 skipped**：它不代替守卫，守卫在下一条
  `product packages` 里。
- **`npm run backend:probe` 的默认端口 3080 与本机 `dsh web` 冲突**：本机跑 probe 请带
  `OURFAIRY_PORT=0`。
