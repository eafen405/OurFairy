# 211 — T6 收口：`scripts/` 迁 `.ts`、研究文档索引、全量门禁与清理

**票据**：[#211](https://github.com/eafen405/OurFairy/issues/211)（规格 [#205](https://github.com/eafen405/OurFairy/issues/205) 的 T6）
**分支**：`ticket/211-ts-scripts`（基于 `integration/spec-205` @ `303280fdcf`，收口前合入 `4fb3250984`）
**约定**：规格 #205 的「不改行为」。迁移只加类型，不加运行期检查。

本目录记录本票改了什么、跑了什么、全量门禁的真实数字、保留的断言式窄化，以及本票消费掉的工作树与分支。

---

## 1. 改了什么

### 1.1 `scripts/` 十二个脚本整体迁移（目录原子）

| 迁走的源 | 新增 | 删除 |
| --- | --- | --- |
| `scripts/bench-gate.mjs`（155 行） | `scripts/bench-gate.ts` | `scripts/bench-gate.mjs` |
| `scripts/bench-projection.mjs`（775 行） | `scripts/bench-projection.ts` | `scripts/bench-projection.mjs` |
| `scripts/combo.mjs`（702 行） | `scripts/combo.ts` | `scripts/combo.mjs` |
| `scripts/evidence-index.mjs`（203 行） | `scripts/evidence-index.ts` | `scripts/evidence-index.mjs` |
| `scripts/link-types.mjs`（125 行） | `scripts/link-types.ts` | `scripts/link-types.mjs` |
| `scripts/ourfairy-backend.mjs`（829 行） | `scripts/ourfairy-backend.ts` | `scripts/ourfairy-backend.mjs` |
| `scripts/ourfairy-composition.mjs`（460 行） | `scripts/ourfairy-composition.ts` | `scripts/ourfairy-composition.mjs` |
| `scripts/pdf-flash-smoke.mjs`（44 行） | `scripts/pdf-flash-smoke.ts` | `scripts/pdf-flash-smoke.mjs` |
| `scripts/precommit.mjs`（261 行） | `scripts/precommit.ts` | `scripts/precommit.mjs` |
| `scripts/real-acceptance.mjs`（286 行） | `scripts/real-acceptance.ts` | `scripts/real-acceptance.mjs` |
| `scripts/specs-status.mjs`（289 行） | `scripts/specs-status.ts` | `scripts/specs-status.mjs` |
| `scripts/tsc.mjs`（94 行） | `scripts/tsc.ts` | `scripts/tsc.mjs` |

`scripts/measure-presentation.py` 是 Python，**未动**。不留 `.mjs` 替身。

**脚本是源码直接跑的，不是编译产物。** Node 24 在加载时剥掉类型，所以：

- `scripts/tsconfig.json` 是**不发码的叶子工程**：`noEmit` + `allowImportingTsExtensions`
  （相对 import 必须带 `.ts` 说明符，Node 的剥离器**不重写说明符**）+ `erasableSyntaxOnly`
  （禁 enum / namespace / 参数属性，Node 的剥离器擦不掉）+ `verbatimModuleSyntax` +
  `types: ["node"]` + `tsBuildInfoFile: "./tsconfig.tsbuildinfo"` + `include: ["**/*.ts"]`。
- 根 `tsconfig.json` 增一条 reference `{ "path": "./scripts" }`。
- **`scripts/` 内部的相对 import 带 `.ts`**（`./combo.ts`、`./ourfairy-composition.ts`、
  `./tsc.ts`、`./link-types.ts`），与后端包的 `.js` 相反——后端包是产物，脚本是源码。
- `scripts/tsc.ts` 用 `import.meta.main` 守卫，`ourfairy-backend.ts` 因此可以 import 它的
  `buildProducts` 而不触发 CLI。

### 1.2 路径与清单

- `package.json` 的 12 条 `node scripts/*.mjs` 全部改 `.ts`（`build` / `typecheck` / `clean` /
  `specs:status` / `evidence:index` / `bench:projection` / `bench:gate` / `combo:verify` /
  `backend:{probe,start,stop,status,doctor}`）。
- `.githooks/pre-commit` 的 `exec node scripts/precommit.mjs` → `.ts`。
- `.gitignore` 增 `*.tsbuildinfo`（脚本工程的发码信息落在 `scripts/tsconfig.tsbuildinfo`；
  后端包的 `.tsbuildinfo` 仍在各自的 `dist/` 里，由既有的 `/backend/*/dist/` 覆盖）。
- `scripts/tsc.ts` 的 `--fresh` 路径在删 `backend/*/dist` 之外**还删 `scripts/tsconfig.tsbuildinfo`**
  （`cleanProducts` 里多一句 `rmSync`）：陈旧的增量状态会让 `tsc -b` 不重新检查脚本就报成功。

### 1.3 测试的路径（只改路径与夹具字符串，行为断言一字未动）

19 个测试文件改了脚本路径：

- import 路径：`../scripts/combo.ts`、`../scripts/ourfairy-composition.ts`、
  `../scripts/specs-status.ts`、`../scripts/bench-gate.ts`、`../scripts/precommit.ts`、
  `../../scripts/combo.ts`、`../../scripts/link-types.ts`。
- 夹具路径字符串：`tests/precommit.test.mjs` 里判成 `full` 的那组路径
  （`scripts/precommit.ts`、`scripts/tsc.ts`、`scripts/link-types.ts`、
  `scripts/ourfairy-composition.ts`、`scripts/ourfairy-backend.ts`）。
- 钩子形状断言：`tests/precommit.test.mjs` 的
  `assert.match(hook, /exec node scripts\/precommit\.ts/u, …)`。
- 启动器路径：`tests/helpers/backend.mjs` 的 `backendScript` 与 `runBackend`、
  `tests/launcher-import.test.mjs` 的副本 import 路径。

`tests/precommit.ts` 的 `FULL_AUTHORITY` 正则本来就写 `/\.(?:mjs|ts)$/u`，所以改后的
`scripts/*.ts` 仍判成 `full`；`relatedTests` 的针脚是 `scripts/<name>.`，`.mjs` 与 `.ts` 都命中。

### 1.4 研究文档索引

`docs/research/README.md` 增三行（表格形状沿用既有三列：文件 / 日期 / 主题）：

| 文件 | 日期 | 主题 |
| --- | --- | --- |
| `2026-10-23-typescript-build-route.md` | 2026-10-23 | backend/ 的 TypeScript 构建与类型检查路线（#199） |
| `2026-10-23-typescript-install-chain.md` | 2026-10-23 | 安装链与构建产物（#200） |
| `2026-10-23-typescript-test-gates.md` | 2026-10-23 | 测试、构建前置与门禁分流（#202） |

三份文档本身**已在 `integration/spec-205`**，本票只补索引。

**另有一处必要的连带修改**：`tests/docs.test.mjs` 断言仓库里每条相对 Markdown 链接都能解析。
十二个脚本改名后，三份研究文档与两份历史文档（`work/implementation/evidence/137-launcher-split/README.md`、
`work/tickets/137/README.md`）里指向这些脚本的链接指向了不存在的文件。按该测试自己的注释
（「清理波次删了文件并改写了指向它们的说明」），链接文字与目标一起改到新文件名；
文档的**正文一字未动**。

---

## 2. 跑了什么

以下命令都在本票工作树 `/home/eafen405/projects/OurFairy/.worktrees/211-ts-scripts` 执行，
Node v24.18.0，pnpm 由 `corepack pnpm@11.28.5` 提供，dsh 检出 `d1b6099ae716870a2afba705a2c90415408a69f5`。

| 命令 | 结果 |
| --- | --- |
| `npm run build`（`node scripts/tsc.ts --fresh`） | 退出码 0，无输出（干净树重编 14 个工程 + 脚本叶子） |
| `node node_modules/typescript/bin/tsc -p scripts/tsconfig.json --noEmit` | 退出码 0，无诊断 |
| `npm test` | **293 tests / 293 pass / 0 fail**，90.8 s |
| `npm run combo:verify` | `combo: combination verified`（退出码 0） |
| `npm run backend:doctor` | `doctor: all checks passed`（退出码 0；11 项全 ok） |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)`（退出码 0） |
| `node --no-warnings work/implementation/evidence/211-ts-scripts/parity-scan.mjs` | 退出码 0，**0 residue**（12 个文件，源码比较与运行期比较各一遍） |
| `node scripts/combo.ts verify` / `show` / `node scripts/specs-status.ts --offline` / `node scripts/evidence-index.ts --check` | 全部退出码 0 |

### 2.1 全量门禁的数字（收口前，base `303280fdcf`）

- `npm test`：**293 / 293 / 0 fail**，`duration_ms 90752`。
- 合并 `integration/spec-205` @ `4fb3250984`（#214 的两个提交）之后重跑一次，
  数字见 §6。

### 2.2 钩子跑的门禁

本仓的 `.githooks/pre-commit` 装在本工作树（`core.hooksPath = .githooks`）。本票的提交
触发了它：改动落在 `scripts/`，`classify` 判成 `full`，所以钩子自己跑了一遍全量门禁。
**钩子的结果单独记在这里，不与上面的自跑结果混算。**

---

## 3. 保留的断言式窄化（`as` / `!`）

#201 允许在解析/校验边界用 `as` 并写明理由，禁 `any` / `@ts-ignore` / `@ts-nocheck` /
`@ts-expect-error`。本仓**零** `any`、零抑制指令。窄化清单：

| 位置 | 窄化 | 理由 |
| --- | --- | --- |
| `ourfairy-composition.ts:135,142` | `parsed as { repos?: unknown }`、`parsed as Combo` | combo.json 是组合形状的权威；`readCombo` 只证明它带 `repos` 映射，其余字段各自在使用处读 |
| `ourfairy-composition.ts:163` | `backend as ComboBackend` | 上面的循环证明了七个 pin 是非空字符串；启动器只打印的两个字段按记录文件原样带过 |
| `ourfairy-composition.ts:380` | `readdirSync(...) as string[]` | Node 的类型把递归列举放宽成 `string[] \| Buffer[]`；默认编码是 utf8，得到的名字是字符串 |
| `ourfairy-composition.ts:401,407` | `manifest as PackageManifest` | 清单是包自己的文件：npm 把 `files` 声明成字符串数组，上面的检查证明它在且非空 |
| `ourfairy-composition.ts:399` | `(error as Error).message` | catch 到什么就报什么；报告只读它的 `message`，与迁移前逐字相同 |
| `combo.ts:270,528,589,655,683` | `(error as Error).message` | 同上（启动器/校验器读 `message`） |
| `combo.ts:386` | `createRequire(...)('@deepseek-ai/dsh-app-boot') as DshAppBoot` | 模块从**已安装的 profile** 加载（`createRequire`），运行期副本是启动器会读的那份；类型取自钉住的 dsh 检出（同一个包） |
| `combo.ts` 的 `combo.repos[key]!`、`row[index]!`、`widths[index]!` | `!` | 键与列号都由调用方给定，且列数一致；断言只记录「这里一定有值」 |
| `link-types.ts:134`、`precommit.ts:134` | `JSON.parse(...) as { name?: unknown }` | 清单是包自己的文件，npm 把 `name` 声明成字符串 |
| `specs-status.ts` 的 `(issue: {…}) =>` | 箭头参数标注 | tracker 按查询回答三个字段；标注让类型来自查询而不是 `any` |
| `ourfairy-backend.ts:318,540` | `as Record<string, unknown>`、`as BackendState \| undefined` | 状态文件是启动器自己的记录，形状由 `writeState` 写定 |
| `ourfairy-backend.ts:463` | `(error as NodeJS.ErrnoException).code` | 信号探针抛什么就读它的 `code`，与迁移前逐字相同 |
| `ourfairy-backend.ts` 的 `child.pid!`、`dsh.head!`、`checks[0]!`、`combo.repos.dsh!` | `!` | 读取点紧跟产生点：子进程刚 spawn 一定有 pid；`combo.backend`/`combo.repos` 由 combo.json 声明 |
| `ourfairy-backend.ts` 的 `version.split('.').map(Number) as [number, number]` | `as` | node 版本至少带 `major.minor`；断言记录被比较的就是这一个拆分 |
| `bench-gate.ts:105` | `as BenchmarkDocument` | 基准文档是投影基准写出的文件，形状由基准定义 |
| `bench-gate.ts` 的 `runs[0]!`、`run[metric]!`、`changed[cell]!` | `!` | 单元存在时它的度量必有；`median` 的空样本分支在单元缺失时才可能命中，而那已被 `missing` 挡掉 |
| `bench-projection.ts:371,427,541,597,610` | `as ProductAnswer` / `as Projection` / `as Combo` / `as BackendSummary` / `as ModelDouble` | 各自的产品路由、投影、combo.json、启动器摘要与模型替身回答形状由各自所有者定义 |
| `bench-projection.ts:811,862,908` | `as number[]` | 差值、往返时间与展开都是两个有限数之差，round 之后是数字；断言记录这一点 |
| `bench-projection.ts:462,657,658` | `(failure as Error).message`、`(error as Error).message` | catch 到什么就报什么，与迁移前逐字相同 |
| `evidence-index.ts:72` | `as Descriptor` | 描述文件是它声明的那一节的权威 |
| `pdf-flash-smoke.ts:29` | `as BodyInit` | fetch 的 body 类型是 DOM 的 `BodyInit`，它没有列 Buffer；分块上传发的就是 Buffer |

**未解决的差异：零。** 所有运行期差异都在 §5 的声明类别里，且逐条可复核。

---

## 4. 行为差异（逐条）

规格 #205 的约定是「不改行为」，本票没有留下未解决的行为差异。四类**已声明**的差异：

| 差异 | 旧 → 新 | 判定 |
| --- | --- | --- |
| CLI 守卫 | `import.meta.url === \`file://${process.argv[1]}\``（或 `process.argv[1] === fileURLToPath(import.meta.url)`）→ `import.meta.main` | 直接运行时两者同真。差别只在**经符号链接**启动：旧守卫此时为假（`import.meta.url` 是真实路径而 argv[1] 是链接路径），新守卫为真。`combo.mjs` 与 `ourfairy-backend.mjs` 迁移前就已经用 `import.meta.main`，本票把其余七个统一到同一条。Node ≥ 22.16 提供该字段，本仓 `engines` 是 `^22.19.0 \|\| >=24` ✓ |
| `--fresh` 的清理面 | 只删 `backend/*/dist` → 还删 `scripts/tsconfig.tsbuildinfo` | 票据明文要求：陈旧的增量状态会让 `tsc -b` 不重新检查脚本就报成功。`--clean` 走同一条 `cleanProducts`，也一并清掉；`--clean` 打印的目录计数不变（脚本的 build info 不计入 `removed`） |
| 两个死 import | `scripts/real-acceptance.mjs` import 了从未使用的 `createHash` 与 `rmSync` → 迁 `.ts` 后删除 | 严格编译拒绝未使用的 import；两者从未被读取，删除后运行期只少了两个内建模块的加载，无可观测差别 |
| 文档链接目标 | 指向 `scripts/*.mjs` 的相对链接 → 指向 `scripts/*.ts` | 脚本改名后旧链接指向不存在的文件，`tests/docs.test.mjs` 会失败。按该测试自己的约定「改写指向它们的说明」，链接文字与目标一起改；正文未动 |

**没有**改动：任何测试的行为断言、任何运算符的增删（parity 扫描在声明类别之后报
`operators after the declared categories: identical`）、任何字面量的增删（除声明类别外）、
`combo.json`、后端十二个包、Android 客户端、dsh 检出。

---

## 5. parity 扫描

`work/implementation/evidence/211-ts-scripts/parity-scan.mjs`（可复跑，随目录保留）。
它改编自 T5 的 `210-ts-remaining/parity-scan.mjs`，有两处针对本票的改动：

1. **比较对象是 Node 真正加载的文本。** 脚本不发码，所以没有 `dist/*.js` 可比；扫描用
   `node:module` 的 `stripTypeScriptTypes`（Node 自己用的剥离器）剥掉新脚本的类型注解，
   与迁移前的 `.mjs` 逐 token 比。源码比较（两侧都过钉住的编译器的 printer）也做一遍，
   两遍都跑。
2. **每个文件两遍比较**：源码比较与运行期比较。两遍的 residue 都必须是零。

四项检查：operator 计数（含括号与语句分隔符）、AST 字面量多重集、AST 结构签名、
扫描器 token 流（模板字面量逐段走，嵌套模板同样下钻）。四者都顺序敏感或计数敏感，
所以**改名局部变量、重排语句、交换实参、改属性名都会露出来**。

### 5.1 声明的类别

每条变换都**同时**施加到两侧；活下来的差异就是本票没声明的差异，扫描打印 residue 并以非零退出。

| 类别 | 内容 |
| --- | --- |
| `script-specifier` | 指向十二个被迁移脚本的字符串字面量：`.mjs` → `.ts`（相对 import 说明符与脚本自己打印/拉起的路径） |
| `import-meta-main-guard` | 旧守卫 `import.meta.url === \`file://${process.argv[1]}\`` → `import.meta.main` |
| `import-meta-main-guard-argv` | 旧守卫 `process.argv[1] === fileURLToPath(import.meta.url)` → `import.meta.main` |
| `fresh-build-info` | `cleanProducts` 里多出的那句 `rmSync(join(root, 'scripts', 'tsconfig.tsbuildinfo'), { force: true })`（源码版与运行期版各一条） |
| `unused-imports-removed` | `real-acceptance` 里删掉的 `createHash` import 与 `rmSync` 具名导入 |
| `fetch-body-cast` | `pdf-flash-smoke` 的 fetch body 外面那对括号（`as BodyInit` 需要它，否则 `?:` 抢优先级） |
| `recursive-listing-cast` | `ourfairy-composition` 里 `readdirSync(...) as string[]` 的那对括号 |
| `cast-parentheses` | 类型擦除后留下的括号：`(error)` ≡ `error`，`(x.y)` ≡ `x.y` |
| `arrow-param-parens` | 类型标注逼出来的箭头参数括号：`(x) =>` → `x =>` |

### 5.2 输出（结论行）

```
0 operator delta(s) after the declared categories, 10 literal delta(s) before them,
11 token delta(s) before them, 0 residue(s) after them, across 12 files
```

逐文件的 `residue after the declared categories: none` 与
`runtime residue after the declared categories: none` 各 12 行；
`operators after the declared categories: identical` 各 12 行。

---

## 6. 合并 `integration/spec-205` 之后

本票收口时 `integration/spec-205` 已前进到 `4fb3250984`（#214 的两个提交：发送背压修复与
它的独立验证）。本票分支先提交（`ebca5da7d3`），再把该 tip 合进来（合并提交 `16f569d17f`，
无冲突：`work/implementation/evidence/README.md` 两边各加一行，git 自己分开了）。

`#214` 新增了 `tests/chat-stream-backpressure.test.mjs`，所以合并后的全量数字是
**294 / 294**（不是收口前的 293）——增的是 #214 的那条测试，不是本票的改动。

---

## 7. 没跑的 / 未完成的

| 项 | 状态 | 原因 |
| --- | --- | --- |
| `npm run bench:projection` | **未跑** | 票据 Steps 提到「`bench:projection` 一次」。本票没有改基准脚本的行为（parity 扫描证明除声明类别外逐 token 相同），但本票**没有**实跑投影基准：它要拉起模型替身并跑 160 轮历史，耗时远超本票的门禁预算。**留给收口人补跑。** |
| `npm run specs:status`（带 tracker） | 跑了 `--offline` 版本 | tracker 需要 `gh` 访问；离线版已验证脚本本身 |
| CI | **未触发、未推送** | 票据明令「不要 push、不要触发 CI」 |
| `combo.json` | **未改** | 票据明令「不要修改 combo.json」。因此 `combo.json` 的 `backend.launcher` 仍写 `scripts/ourfairy-backend.mjs`，`combo show` 打印这一行时是旧名。该字段只被 `combo.ts` 的 `printShow` 打印，**没有任何代码按它定位文件**，因此不影响行为；**但它是本票留下的唯一一处指向旧文件名的活引用，需要收口人决定是否改。** |
| `README.md`、`AGENTS.md`、`CONVENTIONS.md`、`CODING_STANDARDS.md` | **未改** | 票据交办给本票的范围清单里没有这四个文件。它们各有一处指向 `scripts/*.mjs` 的说明（`README.md:70` 的 `scripts/precommit.mjs`、`backend/chat/README.md:279` 的 `node scripts/bench-projection.mjs`、`backend/v1-bundle/README.md:50` 的 `scripts/ourfairy-backend.mjs`）——**收口人需要改这三处**，否则文档指向不存在的文件。 |
| 迁移前后的**性能**对比 | 未做 | 本票不改变运行期代码（parity 扫描），性能无从变化；且基准要跑模型替身 |

---

## 8. 收口后的最终门禁（合并 `4fb3250984` 之后）

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 退出码 0（`node scripts/tsc.ts --fresh`，干净树重编） |
| `npm test` | **294 tests / 294 pass / 0 fail**，`duration_ms 91345` |
| `npm run combo:verify` | `combo: combination verified`（ourfairy@`16f569d17f36`、dsh@`d1b6099ae716`、android source@`460109d1b89b`） |
| `npm run backend:doctor` | `doctor: all checks passed`（11 项全 ok） |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)` |
| `node --no-warnings work/implementation/evidence/211-ts-scripts/parity-scan.mjs` | 退出码 0，**0 residue** |

### 8.1 一次负载下的抖动（已复跑排除）

合并后的第一次全量跑出现了 3 条失败，全在 `tests/file-delivery.test.mjs`
（`file delivery recovers durable log success before business completion without recopying changed sources`、
`a file delivery flush failure leaves a ready retry and never confirms incomplete durability`、
`authorized shared files appear together in live and persisted recipient attachment projection`）。
那一跑机器上还叠着本票的并行工作（parity 扫描、doctor、probe），负载明显更高。

- 单跑 `node --test tests/file-delivery.test.mjs`：**8 / 8 pass**（7.995 s）。
- 负载下来后重跑整个 `npm test`：**294 / 294 / 0 fail**（91.3 s）。

结论：这三条是**负载下的抖动**，不是本票引入的回归——本票没有碰投递、chat 或 Android 的任何代码，
parity 扫描也证明 `scripts/` 除声明类别外逐 token 相同。**但收口人应知道：全量门禁在重负载下
可能抖。**

---

## 9. 清理清单

本票消费掉的工作树与分支（每个都先证明已被合并）：

| 工作树 | 分支 | 合并证据 |
| --- | --- | --- |
| `.worktrees/203-ts-http-trial` | `ticket/203-ts-http-trial` | **未合并**（`git merge-base --is-ancestor` 为否）。票据明写「http 试点；其内容已在 T1 重做」，故按票据删除 |
| `.worktrees/research-ts-build-route` | `research/ts-build-route` | `2a75ac98b4` 是 `integration/spec-205` 的祖先 |
| `.worktrees/research-ts-install-chain` | `research/ts-install-chain` | `e5d81be48a` 是祖先 |
| `.worktrees/research-ts-test-gates` | `research/ts-test-gates` | `afd2dcff6b` 是祖先 |
| `.worktrees/206-ts-infra` | `ticket/206-ts-infra` | `dd5a4da7c7` 是祖先 |
| `.worktrees/207-ts-identity-sessions` | `ticket/207-ts-identity-sessions` | `4b3f516525` 是祖先 |
| `.worktrees/208-ts-spaces-attachments` | `ticket/208-ts-spaces-attachments` | `9627d265d8` 是祖先 |
| `.worktrees/209-ts-chat` | `ticket/209-ts-chat` | `478fc708a4` 是祖先 |
| `.worktrees/210-ts-remaining` | `ticket/210-ts-remaining` | `3ef3144566` 是祖先 |

删除前逐条验过合并状态（`git merge-base --is-ancestor <branch> integration/spec-205`），
九个分支与九个工作树都已删除。删除后 `git worktree list` 只剩三行：

```
/home/eafen405/projects/OurFairy                4fb3250984 [integration/spec-205]
/home/eafen405/projects/OurFairy/.worktrees/211-ts-scripts  16f569d17f [ticket/211-ts-scripts]
/home/eafen405/projects/OurFairy/.worktrees/213-tool-calls  4fb3250984 [ticket/213-tool-calls]
```

**未删**：`.worktrees/` 本身、`.worktrees/211-ts-scripts` 与 `ticket/211-ts-scripts`（本票自己的）、
`.worktrees/213-tool-calls` 与 `ticket/213-tool-calls`（**另一个会话正在用**）、
根检出 `/home/eafen405/projects/OurFairy` 的工作树。
