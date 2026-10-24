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
| CLI 守卫 | `import.meta.url === \`file://${process.argv[1]}\``（或 `process.argv[1] === fileURLToPath(import.meta.url)`）→ `import.meta.main` | 直接运行时两者同真。差别只在**经符号链接**启动：旧守卫此时为假（`import.meta.url` 是真实路径而 argv[1] 是链接路径），新守卫为真。`combo.mjs` 与 `ourfairy-backend.mjs` 迁移前就已经用 `import.meta.main`，本票把其余七个统一到同一条。该字段由 **Node 22.18.0** 引入（24.x 线是 **24.2.0**），因此本仓 `engines` 必须是 `^22.19.0 \|\| >=24.2.0`：22.19 ≥ 22.18 ✓，而 `>=24` 会放进**没有该字段**的 24.0/24.1 ✗。收口评审已把下限提到 `>=24.2.0`，并给守卫加上响亮的失败，见 §10.1 |
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

## 6.1 类型漂移实例（票据验收项）

票据验收写的是：「给 pinned dsh 的 `JobStatus` 加成员或改 `kill()` 返回形状，`tsc` 失败并点名符号。」
本票把它跑成了可复跑的脚本 `work/implementation/evidence/211-ts-scripts/type-drift.mjs`：
把钉住的 dsh 的 jobs 包类型树**复制**到 `work/tmp/drift-211/`（钉住的检出是只读的，脚本不动它），
在副本上改形状，用一个 scratch 工程的 `paths` 指过去，然后跑 `tsc`。

```
node work/implementation/evidence/211-ts-scripts/type-drift.mjs
```

结果（逐条漂移后重跑 `tsc`）：

| 漂移 | `tsc` | 说明 |
| --- | --- | --- |
| 0. 未改动的钉住 dsh | 无错误 | 基线 |
| 1. `JobStatus` 加一个成员 | **无错误** | 产品用 `taskStatusOf(status: string)` 读状态，编译期看不到那个更窄的并集 |
| 2. `kill()` 返回形状加一个成员 | **无错误** | 产品用 `stopOutcomeOf(result: string)` 读结果，未知取值在**运行期**被拒绝 |
| 3. `JobOutputRead.next` 改类型 | **无错误** | 该值被原样放进推断出来的 wire 对象，编译期仍然接受 |
| 4. `JobId` 的参数改类型 | **失败**：`backend/chat/src/jobs.ts(49,22)`、`(61,40)` 两处 TS2345 | 用了点的位置报错 |
| 5. `JobId` 从包根消失 | **失败并点名符号**：`backend/chat/src/jobs.ts(2,10): error TS2724: '"@deepseek-ai/dsh-jobs"' has no exported member named 'JobId'. Did you mean 'JobKind'?` | 直接 import 的符号，编译器点名 |

**要如实记的一件事**：验收句里点名的两个符号（`JobStatus`、`kill()`）**不会**让 `tsc` 失败——
而且不是「差一点」：**产品根本没有引用 dsh 的那个 `JobStatus` 类型**。

- dsh 的 `JobStatus` 是字符串并集（`packages/jobs/jobs/src/view.ts:19`：
  `'running' | 'stopping' | 'completed' | 'killed' | 'failed'`）。
- 产品从 `@deepseek-ai/dsh-jobs` import 的只有 `JobView`（`backend/chat/src/units.ts:47`）
  与 `JobId`（`backend/chat/src/jobs.ts:2`）。**`JobStatus` 一次也没有被 import。**
- 状态跨过产品边界时是 `string`：`taskStatusOf(status: string)`
  （`backend/chat/src/units.ts:103`）读 `JobView.status`，再按产品自己的数字表 `TASK_STATUS`
  （`backend/chat/src/units.ts:95`）映射；表里没有的取值在**运行期**是 `0`（未知）。
- `kill()` 的结果同样以 `string` 落地：`stopOutcomeOf(result: string)`
  （`backend/chat/src/jobs.ts:25`）按 `STOP_OUTCOME` 表映射，未知取值抛 500。

**并集变宽对 `string` 仍然可赋值**，所以编译期看不见「多了一个成员」这件事——这是漂移 1、2 不让
`tsc` 失败的**机制**，不是巧合。T2–T5 刻意把产品对这两个符号的用法放宽成 `string` 加运行期的表，
所以未知取值被**运行期**拒绝，而不是让编译失败。`JobStatus` 的增删另有专门的测试期守卫：
`tests/native-job-status.test.mjs` 用 TypeScript 编译器 API 读钉住 dsh 的
`packages/jobs/jobs/lib/types/view.d.ts`，把 `JobStatus` 的成员与 `TASK_STATUS` 逐项对账。

因此**验收句里的字面例子不适用**：它要求「`tsc` 失败并点名符号」，而产品不引用那个符号，
没有可失败的编译期耦合。规格的**意图**（「一个类型错误先于测试发现漂移的实例」）由替代实例
证明——漂移 5 就是它，`tsc` 的错误**点名了符号**：

```
backend/chat/src/jobs.ts(2,10): error TS2724: '"@deepseek-ai/dsh-jobs"' has no exported member named 'JobId'. Did you mean 'JobKind'?
```

漂移 4（`JobId` 的参数改型）另有两处 `TS2345`，见上表。两条都由 `tsc` 在任何测试之前报出，
所以这一条性质成立：**dsh 的类型一变，产品的 `tsc` 就失败，并在直接 import 的符号上点名。**

**不改回去**（收口评审问过要不要把 `JobStatus`/`kill()` 收窄回 dsh 的并集）：**不改**。
T2–T5 刻意把产品的用法放宽成 `string` 加运行期的表，运行期语义（未知取值被拒绝，而不是
悄悄映射成别的数字）已经由 `tests/native-job-status.test.mjs` 与适配器测试固定；收窄会改变
行为，与规格 #205 的「不改行为」相冲突。

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

---

## 10. 收口评审的九项发现（2026-10-24）

规格 #205 的两轴 code review（Standards + Spec）在收口时给出九项发现。本节逐项记**发现是什么**、
**改了什么**、**怎么验的**。改动落在分支 `ticket/212-review-fixes`（基于 `integration/spec-205` @
`29f6d71ad2`），**不是** T6 的迁移内容，所以 §1–§9 的记载仍然成立；本节是它之后的增量。

| # | 发现 | 改了什么 | 落点 |
| --- | --- | --- | --- |
| 1 | `import.meta.main` 在 Node 24.0/24.1 上是 `undefined`，CLI 会静默退出 0 | 下限提到 `>=24.2.0`；守卫换成共享的 `isCliEntry`，缺字段时抛出点名 Node 要求的错误 | `package.json`、`combo.json`、`README.md`、`scripts/cli-guard.ts`、九个 CLI 入口、`scripts/ourfairy-backend.ts` 的 `nodeSatisfies` |
| 2 | §4 的 CLI 守卫一行把 Node 版本写错了 | 该行改成 22.18.0 / 24.2.0 与新的下限 | 本文件 §4、§10.2 |
| 3 | 票面指向不存在的证据目录 | 指向 `206-ts-infra/` … `211-ts-scripts/` 六个真实目录 | `work/tickets/205/README.md` |
| 4 | `backend/attachments/pdf/README.md` 仍写 `src/pdf.mjs` | 改成 `src/pdf.ts` | `backend/attachments/pdf/README.md` |
| 5 | 提交 `303280fdcf` 的信息说「断言本身没有变弱」，不准确 | 在本文件记下准确的说法 | 本文件 §10.5 |
| 6 | `scripts/precommit.ts` 的包名兜底会凭空造名 | 三处「从清单读名字」收成一处，兜底删除 | `scripts/package-manifest.ts`、`scripts/precommit.ts`、`scripts/link-types.ts`、`tests/helpers/dsh-peers.mjs` |
| 7 | `scripts/link-types.ts` 的注释说只替换「本脚本建的链接」，代码替换任何链接 | **改注释**（代码不动），两者对齐 | `scripts/link-types.ts` |
| 8 | 规格验收要求 `npm run bench:projection` 跑一次，票里没跑 | 实跑并记录真实数字 | 本文件 §10.8 |
| 9 | 验收点名的 `JobStatus`/`kill()` 漂移不会让 `tsc` 失败 | 查清机制并如实记录；**不收窄** | 本文件 §6.1、§10.9 |

### 10.1 `import.meta.main` 与声明的 Node 范围（发现 1）

**发现。** `import.meta.main` 由 **Node 22.18.0** 引入，24.x 线是 **24.2.0**。本仓 `engines` 与
`combo.json` 的 `backend.nodeRange` 原先写 `^22.19.0 || >=24`，**24.0 与 24.1 落在范围内**，
而这两个版本上该字段是 `undefined`（**不是** `false`）。九个 CLI 入口都用 `if (import.meta.main)`
守卫，于是「我无法判断自己是不是入口」被读成「我不是入口」：CLI 退出 0 而什么也没做，
`npm run build` 与 `npm run combo:verify` 变成**静默的空转**——门禁可以在什么都没构建的情况下通过。
这违反 `CODING_STANDARDS.md` 的「声称须可执行」。

**a. 抬高下限。**

| 落点 | 改前 | 改后 |
| --- | --- | --- |
| `package.json` 的 `engines.node` | `^22.19.0 \|\| >=24` | `^22.19.0 \|\| >=24.2.0` |
| `combo.json` 的 `backend.nodeRange` | `^22.19.0 \|\| >=24` | `^22.19.0 \|\| >=24.2.0` |
| `README.md`「先决条件」的 Node 行 | `^22.19.0 \|\| >=24` | `^22.19.0 \|\| >=24.2.0`（并注明该字段的起始版本） |

`^22.19.0` 那一段**不动**：22.19 ≥ 22.18，22.x 线本来就有该字段。`combo.json` 的 dsh 锁与
Android 来源声明**不动**。

**a′. 下限变了，doctor 的范围检查也得认得它。** `scripts/ourfairy-backend.ts` 的 `nodeSatisfies`
原先只认 `^N.M.P` 与 `>=N` 两种写法，`>=24.2.0` 会落进「不认识的写法」而**抛错**。它现在认
`>=N.M.P`，比较交给新加的 `compareVersion`（三元组逐段比）。这个函数**导出**了，
`tests/cli-guard.test.mjs` 用它断言下限的语义。

这一处新增的窄化只有一条，和 §3 的清单同一类：`compareVersion` 里的 `left[index] ?? 0`
——三元组的长度由调用方给定（永远是 3 段），`?? 0` 只是 `noUncheckedIndexedAccess` 下索引读的兜底。
没有 `any`，没有抑制指令。

**b. 失败要响亮，不能静默。** 新增 `scripts/cli-guard.ts`：

```ts
export const REQUIRED_NODE_RANGE = '^22.19.0 || >=24.2.0'

export function isCliEntry(isMain: boolean | undefined): boolean {
  if (isMain === undefined) {
    throw new Error(`import.meta.main is undefined: this Node does not provide it, so the CLI cannot tell whether it is the entry point.`
      + ` Node ${REQUIRED_NODE_RANGE} is required (import.meta.main landed in Node 22.18.0, and in 24.2.0 on the 24.x line).`)
  }
  return isMain
}
```

`import.meta` 是**按模块**的，helper 读不到调用者的 `import.meta.main`，所以标志由调用方传入。
九个有 CLI 守卫的入口都改成 `if (isCliEntry(import.meta.main)) …`：`scripts/tsc.ts`、`combo.ts`、
`precommit.ts`、`ourfairy-backend.ts`、`specs-status.ts`、`evidence-index.ts`、`bench-gate.ts`、
`real-acceptance.ts`、`link-types.ts`。`scripts/bench-projection.ts` 与 `scripts/pdf-flash-smoke.ts`
**没有** CLI 守卫（它们加载即执行，不靠入口判断），因此不需要改。

**c. 证明它真的会响。** 两条可复跑的路：

1. 直接调 helper：

```sh
node --input-type=module -e "import { isCliEntry } from './scripts/cli-guard.ts'; isCliEntry(undefined)"
```

输出（退出码 1）：

```
Error: import.meta.main is undefined: this Node does not provide it, so the CLI cannot tell whether it is the entry point. Node ^22.19.0 || >=24.2.0 is required (import.meta.main landed in Node 22.18.0, and in 24.2.0 on the 24.x line).
```

2. **真的把一个 CLI 按「没有该字段的 Node」加载**：新增 `tests/cli-guard.test.mjs` 用
   `module.registerHooks` 的 `load` 钩子把 `isCliEntry(import.meta.main)` 改写成
   `isCliEntry(undefined)`，再 `import('../scripts/bench-gate.ts')`——这正是 Node 24.0/24.1
   加载它的样子。守卫必须抛出并点名 Node 要求。

`node --test tests/cli-guard.test.mjs`：**5 tests / 5 pass / 0 fail**。

| 断言 | 内容 |
| --- | --- |
| `the helper answers for a Node that has the field` | `isCliEntry(true)` 为真、`isCliEntry(false)` 为假 |
| `the helper refuses a Node without the field, naming the Node it needs` | `undefined` 抛出，且消息里有 `^22.19.0 \|\| >=24.2.0` |
| `a CLI loaded as a Node without import.meta.main fails loudly` | 真的脚本在「没有该字段」下加载会失败，而不是退出 0 |
| `the declared floor excludes the Node versions without import.meta.main` | 24.0/24.1 不满足、24.2 与 22.19 满足、22.18 不满足（用产品自己的 `nodeSatisfies` 判） |
| `package.json, combo.json and the guard name the same Node range` | 三处写的是同一个范围字符串 |

最后一条是「下限不会各写各的」的可执行检查：`package.json` 的 `engines.node`、
`combo.json` 的 `backend.nodeRange` 与 `scripts/cli-guard.ts` 的 `REQUIRED_NODE_RANGE`
必须逐字相同。

### 10.2 §4 的 Node 版本写错了（发现 2）

§4 的「CLI 守卫」一行原来写「Node ≥ 22.16 提供该字段，本仓 `engines` 是 `^22.19.0 || >=24` ✓」——
**两处都不对**：该字段是 **22.18.0** 起的（不是 22.16），而 `>=24` **并不**被 24.0/24.1 满足，
所以那个 ✓ 不成立。该行已改成：字段由 Node 22.18.0 引入（24.x 线 24.2.0），因此下限必须是
`^22.19.0 || >=24.2.0`（22.19 ≥ 22.18 ✓，`>=24` 会放进没有该字段的 24.0/24.1 ✗），并指向 §10.1。

### 10.3 票面指向不存在的证据目录（发现 3）

`work/tickets/205/README.md` 的「证据」一节写的是 `work/implementation/evidence/205-ts-migration/`，
**该目录不存在**。真实的六个目录是 `206-ts-infra/`、`207-ts-identity-sessions/`、
`208-ts-spaces-attachments/`、`209-ts-chat/`、`210-ts-remaining/`、`211-ts-scripts/`，票面已逐个指向。

### 10.4 `backend/attachments/pdf/README.md` 的旧文件名（发现 4）

该 README 仍写 `src/pdf.mjs`。那个文件在 #208（提交 `420f344299`）里被改名为 `src/pdf.ts`
（`backend/attachments/src/pdf.ts`），README 已改。同类问题在 `29f6d71ad2` 里已修过一处，
这一处被漏掉了。

### 10.5 语音测试那一条的准确说法（发现 5）

提交 `303280fdcf`（`test(#211): 语音测试等预算释放，而不是猜一个固定延时`）的信息里写
「断言本身没有变弱 —— 仍然是「预算最终释放后拿到 200」，只是把「什么时候释放」从猜测变成观测」。
**这句不准确**：那一条确实**丢掉了一个 30 ms 的时间上界**，换成**最多 5 s 的有界轮询**
（每 25 ms 试一次，拿到 200 为止）。

**准确的说法**：*语义*断言（「取消之后预算最终会被释放，最终拿到 200」）没有变弱；
*时间上界*没有了——原先断言的是「30 ms 之后预算已经释放」，现在断言的是「5 s 之内预算会被释放」。
这是**放宽**，不是等价改写。

**而且这是既有抖动，不是迁移引入的**：在**迁移前**的 `main`（`c39c83d8c1`）上跑全量同样是
**285 个测试 / 284 通过 / 1 失败**，失败的正是这一条（单独跑这个文件时它稳定通过）；
迁移后的 `main` 侧是 293 个测试里挂这一条。语音服务在迁移前后逐字相同
（`backend/speech/src/service.ts` 与迁移前的 `.mjs` 预算/abort 逻辑一致）。
提交信息不可改（已落历史），所以更正记在这里——读者在这份证据里能找到它。

### 10.6 包名只能从清单读（发现 6）

**发现。** `scripts/precommit.ts` 的 `productPackageName` 读不到清单时**兜底造名**
`@ourfairy/dsh-${name}`。对 `backend/probe` 这个兜底是错的：它的清单名是
`@ourfairy/dsh-baseline-probe`，兜底会造出一个**不存在的包名**。同一段「从清单读名字」的逻辑在
三处各写一遍：`scripts/link-types.ts`、`scripts/precommit.ts`、`tests/helpers/dsh-peers.mjs`。

**改法。** 新增 `scripts/package-manifest.ts`，导出 `manifestName(manifestPath)` 与
`packageNameOf(dir)`；三处都调它，**清单是唯一权威，没有任何地方再兜底造名**：

| 调用方 | 改前 | 改后 |
| --- | --- | --- |
| `scripts/link-types.ts` | 自带一份 `packageNameOf` | `import { packageNameOf } from './package-manifest.ts'` |
| `scripts/precommit.ts` | 自带一份 + 兜底 `@ourfairy/dsh-${name}` | `import { packageNameOf } from './package-manifest.ts'`，**兜底删除**；读不到名字时只按目录选测试 |
| `tests/helpers/dsh-peers.mjs` | 自己 `JSON.parse` 清单 | `import { manifestName } from '../../scripts/package-manifest.ts'` |

**`.mjs` 引用 `.ts` 不是倒挂。** 本仓已有这个形状：`tests/helpers/backend.mjs` 本来就
`import … from '../../scripts/combo.ts'` 与 `'../../scripts/link-types.ts'`（Node 自带类型剥离，
`.mjs` 里 import `.ts` 源文件是本仓既有的做法）。所以三处收成一处是干净的，没有引入新的依赖方向。
兜底删除后的行为差别只有一个：`backend/probe` 的测试选择不再多带一个**不存在**的包名针脚，
它仍然按目录 `backend/probe/` 被选中。

### 10.7 `link-types.ts` 的注释与代码（发现 7）

**发现。** 文件头与 `linkInto` 的注释都写「只替换**本脚本建的**链接」，代码却是
「**任何**符号链接都替换，只有真实目录才保留并告警」。

**判定：改注释，不改代码。** 链接农场是**生成物**（注释自己就写着 "The farm is a generated
artifact"），留着上一次构建的链接就是留着陈旧目标；「只替换本脚本建的链接」要成立就得给脚本
记状态（哪些链接是它建的），那是为一个不存在的需求加机制，与「规模校准」相悖。
要保留的只有真实目录那一条——它保护开发者自己的安装，代码已经这么做了。所以注释改成与代码一致：

- 文件头：「A symlink at the farm's path is replaced — the farm is a generated artefact, and a
  link left there would be stale. A real directory at the same path was put there by something
  else and is left alone.」
- `linkInto`：「Any symlink at that path is replaced: the farm is a generated artefact, and a link
  left there would point at whatever the previous build linked. A real directory at that path was
  put there by something else and is kept, so the build never deletes a developer's own install.」

### 10.8 `npm run bench:projection` 补跑（发现 8）

规格 #205 的验收写「`npm run bench:projection` 跑一次」，#211 的证据写的是**未跑**（「留给收口人补跑」）。
本票补跑。

```sh
npm run bench:projection -- --out work/tmp/bench-projection-212.json --label "review-fixes closeout"
```

**退出码 0**，跑了 8 轮（2 种历史长度 × 2 种观察者数 × 2 次重复），真实数字：

| 轮 | 历史 | 观察者 | 事件数 | 流中 `/chat/read` p50/p95 (ms) | 帧数 | 帧字节 | 后端 CPU (ms) | 采样峰值 RSS (kB) | 静默 p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 40 | 1 | 326 | 6.76 / 8.96 | 47 | 9 228 820 | 287.51 | 282 208 | 7.31 |
| 2 | 40 | 2 | 326 | 6.25 / 9.75 | 94 | 18 471 038 | 297.31 | 280 356 | 7.03 |
| 3 | 40 | 2 | 326 | 6.47 / 9.12 | 94 | 18 471 038 | 292.64 | 282 904 | 7.70 |
| 4 | 40 | 1 | 326 | 7.15 / 9.41 | 47 | 9 235 519 | 273.65 | 283 408 | 9.16 |
| 5 | 160 | 1 | 1286 | 5.93 / 7.53 | 47 | 9 244 600 | 210.96 | 381 952 | 8.15 |
| 6 | 160 | 2 | 1286 | 5.95 / 8.80 | 94 | 18 485 668 | 247.73 | 405 412 | 6.77 |
| 7 | 160 | 2 | 1286 | 6.10 / 7.74 | 94 | 18 489 200 | 279.67 | 364 192 | 6.95 |
| 8 | 160 | 1 | 1286 | 8.56 / 12.28 | 47 | 9 242 873 | 368.00 | 380 276 | 14.92 |

**它证明什么、不证明什么。** 这是**替身**负载（模型替身 + 本机回路），不是真实云服务。
它量的是「同一份代码在两种历史长度下的每片段成本与内存」，**不是**规格 #205 的验收门禁
（#205 的验收是 build / test / combo:verify / doctor / probe 全绿 **加上** 这个基准跑一次）。
跑它的前提是钉住的 dsh 检出已按 `combo.json` 的 `requiredBuild` 构建过（本机已构建）。

**这一轮不是回归判据。** 本票不改任何产品包的行为（§10.1–§10.7 改的全是脚本、测试与文档），
所以没有「改前 / 改后」的对照可做；上面是**一次**基线，不是一次比较。

### 10.9 验收点名的 `JobStatus`/`kill()` 漂移（发现 9）

§6.1 已经记了「这两个符号不会让 `tsc` 失败」。评审要求**查清为什么**，并明确收窄的取舍。

**为什么（已核实）**：产品**根本没有引用** dsh 的 `JobStatus` 类型——

- dsh 的 `JobStatus` 是字符串并集：`packages/jobs/jobs/src/view.ts:19`
  （`'running' | 'stopping' | 'completed' | 'killed' | 'failed'`）。
- 产品从 `@deepseek-ai/dsh-jobs` import 的只有 `JobView`（`backend/chat/src/units.ts:47`）与
  `JobId`（`backend/chat/src/jobs.ts:2`）。**`JobStatus` 一次也没有被 import。**
- 状态跨过产品边界时是 `string`：`taskStatusOf(status: string)`（`backend/chat/src/units.ts:103`）
  按产品自己的数字表 `TASK_STATUS`（`backend/chat/src/units.ts:95`）映射；表里没有的取值是 `0`。
- `kill()` 的结果同样以 `string` 落地：`stopOutcomeOf(result: string)`
  （`backend/chat/src/jobs.ts:25`），表里没有的取值抛 500。

**并集变宽对 `string` 仍然可赋值**，所以编译期看不见「多了一个成员」——这是**机制**，不是巧合。
因此规格验收句里的字面例子**不适用**：它要求「`tsc` 失败并点名符号」，而产品不引用那个符号，
没有可失败的编译期耦合。替代实例（`JobId`）证明的是**同一条性质**（一个类型错误先于测试发现漂移），
而且错误**点名了符号**：

```
backend/chat/src/jobs.ts(2,10): error TS2724: '"@deepseek-ai/dsh-jobs"' has no exported member named 'JobId'. Did you mean 'JobKind'?
```

**不改回去。** 评审问过要不要把 `JobStatus`/`kill()` 收窄回 dsh 的并集。**不收窄**：T2–T5 刻意
把产品的用法放宽成 `string` 加运行期的表，未知取值在**运行期**被拒绝（而不是悄悄映射成别的
数字），这层语义已由 `tests/native-job-status.test.mjs` 与适配器测试固定；收窄会**改变行为**，
与规格 #205 的「不改行为」冲突。漂移 1–5 的实测输出见 §6.1 的表（本票重跑过一次，输出逐字相同）。

### 10.10 CI 的显式 `npm run build` 步骤：判定为**保留**

评审问：`npm test` 已经通过 `pretest` 构建过一次，CI 里那个显式的 `npm run build` 步骤是不是重复。

**判定：保留，并补一句说明为什么。** 三条理由：

1. `tests/precommit.test.mjs` 里有一条**可执行断言**：`npm run build` 必须出现在 `npm test`
   之前。删掉那个步骤就要改这条断言，而这条断言守的正是「构建失败与测试失败分开」这件事。
2. 显式步骤让构建在 CI 日志里是**一个有名有姓的步骤**（`Build the product packages`），
   而不是 `pretest` 里一段没有名字的输出。
3. 构建失败会在**套件开始之前**停掉作业；套件比构建贵得多。

代价是 CI 里构建跑两遍（`pretest` 那遍也是 `--fresh`）。这是一次 CI 运行里几十秒的重复，
换来的是失败点的可归因性，所以留着。注释已补成：

> The product packages are built before the suite runs: the profile the tests install publishes the
> build output, so a build failure and a test failure stay separate lines in this log.
>
> The explicit step stays even though the suite's own `pretest` hook also builds: it makes the build
> a distinct, named step, and a failing build stops the job before the suite starts.

**一句实话**：这条注释的第一版里写了字面的 `npm test`，`tests/precommit.test.mjs` 的
「构建先于套件」断言用的是 `indexOf` 的原文比较，于是注释里的 `npm test` 排在 `npm run build`
**前面**，断言红了。改成「the suite's own `pretest` hook」之后断言恢复——断言没动，语义没变
（工作流里两个步骤的先后本来也没变）。

### 10.11 评审说「不是发现」的两处：原样留着

- `scripts/ourfairy-composition.ts` 对 `files` 里**零文件**的条目抛错：这**正是** #206 票要的
  （#200 的安装链守卫），是**有意的新产品行为**。**不动。**
- `work/tickets/214-stream-rate.md` 是平铺文件而不是目录：那是并行会话（issue #214）的工作，
  不属于本规格。**不动。**

并行会话的提交（#214 的 `969e2934a3` / `4fb3250984`，#213 的 `60258bf611` / `7eb7b0dfb0` /
`7650e51444`）也不在本票范围内：**一个文件都没有改**。

### 10.12 parity 扫描的口径变了（必须说明）

§5 的 parity 扫描原来把**右侧**读成**工作树**里的 `.ts`。评审修复**故意**改了两个脚本
（`ourfairy-backend.ts` 的 `nodeSatisfies`、`link-types.ts` 的清单读取），于是扫描会在这两处
报 residue——而那两处不是「迁移的差异」，是**评审修复的差异**。

扫描的口径因此改成：**右侧读自迁移落地的那个提交**（默认 `29f6d71ad2`，第三个参数可覆盖），
它因此仍然证明它本来要证明的那件事——**迁移本身没有留下未声明的差异**：

```sh
node --no-warnings work/implementation/evidence/211-ts-scripts/parity-scan.mjs
```

输出（退出码 0）：

```
0 operator delta(s) after the declared categories, 10 literal delta(s) before them, 11 token delta(s) before them, 0 residue(s) after them, across 12 files
```

评审修复本身另有证据：§10.1（守卫的可执行检查）与 §10.9（漂移脚本的实测输出）。

### 10.13 本票的最终门禁（真实输出）

全部在 `.worktrees/212-review-fixes`（分支 `ticket/212-review-fixes`）上跑，Node `v24.18.0`，
corepack pnpm `11.28.5`，dsh 检出 `/home/eafen405/projects/deepseek-harness` @ `d1b6099ae716`。

| 命令 | 结果 | 输出 |
| --- | --- | --- |
| `npm run clean` | 通过 | `removed 12 build output directories` |
| `npm run build` | 通过 | 无输出（`node scripts/tsc.ts --fresh`），退出码 0 |
| `npm test` | **299 tests / 299 pass / 0 fail** | 106 772 ms |
| `npm run combo:verify` | 通过 | `combo: combination verified`（ourfairy@`29f6d71ad2cf`、dsh@`d1b6099ae716`、android source@`460109d1b89b`） |
| `npm run backend:doctor` | 通过 | `doctor: all checks passed`，其中 `node version: 24.18.0 satisfies ^22.19.0 \|\| >=24.2.0` |
| `OURFAIRY_PORT=0 npm run backend:probe` | 通过 | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)` |
| `npm run bench:projection` | 通过（退出码 0） | 见 §10.8 的 8 轮数字 |
| `node --test tests/cli-guard.test.mjs` | **5 tests / 5 pass / 0 fail** | §10.1 的五条断言 |
| `node work/implementation/evidence/211-ts-scripts/type-drift.mjs` | 通过 | 漂移 1/2/3 无错误、漂移 4 两处 `TS2345`、漂移 5 一处 `TS2724`（§6.1 与 §10.9） |
| `node --no-warnings work/implementation/evidence/211-ts-scripts/parity-scan.mjs` | 通过（退出码 0） | `0 residue(s) after them, across 12 files`（口径见 §10.12） |

**套件计数的来龙去脉。** 改动前是 **294/294**；本票新增 `tests/cli-guard.test.mjs`（5 个测试），
所以现在是 **299/299**。其中**一个**测试文件是并行会话 #214 带进来的
（`tests/chat-stream-backpressure.test.mjs`，1 个测试；#214 只**新增**这一个测试文件，
`tests/chat-multi-observer.test.mjs` 是改已有用例的断言、没加新用例）。
**去掉那一个测试文件，本规格自己的内容是 298 个测试**，全部通过。

**合并集成尖端之后（提交 `10e35572d5`，本分支的最终状态）。** 按收口要求把
`integration/spec-205`（`6f1864ff82`）并进本分支，合并无冲突，并行会话 #213 的文件**一个都没有改**。
合并后重跑同一组门禁，数字变了（#213 带进来 6 个测试）：

| 命令 | 结果 |
| --- | --- |
| `npm run clean && npm run build` | 通过（`removed 12 build output directories`，构建退出码 0） |
| `npm test` | **305 tests / 305 pass / 0 fail**（142 911 ms） |
| `npm run combo:verify` | 通过（ourfairy@`10e35572d575`、dsh@`d1b6099ae716`、android source@`460109d1b89b`） |
| `npm run backend:doctor` | 通过（`node version: 24.18.0 satisfies ^22.19.0 \|\| >=24.2.0`，`doctor: all checks passed`） |
| `OURFAIRY_PORT=0 npm run backend:probe` | 通过（`ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)`） |
| `node --no-warnings work/implementation/evidence/211-ts-scripts/parity-scan.mjs` | 通过（`0 residue(s) after them, across 12 files`） |
| `node work/implementation/evidence/211-ts-scripts/type-drift.mjs` | 通过（漂移 1/2/3 无错误、漂移 4 两处 `TS2345`、漂移 5 一处 `TS2724`，与合并前逐字相同） |

**305 = 299（合并前）+ 6（#213 的合并带进来的测试）**。其中属于本规格的内容仍是
**299 − 1（#214 的那个测试文件）= 298**，加上合并进来的 #213 的 6 个。
