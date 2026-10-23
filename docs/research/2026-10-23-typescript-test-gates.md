> 2026-10-23 状态：日期化记录。本文记录 2026-10-23 的测试与门禁判断，不描述当前实现。

# TypeScript 迁移期的测试、构建前置与门禁分流（2026-10-23）

日期：2026-10-23。基线：`main` @ `c39c83d8c1`；研究分支 `research/ts-test-gates`，worktree
`.worktrees/research-ts-test-gates`。工具链：Node 24.18.0、dsh 自带的 TypeScript 6.0.3
（`/home/eafen405/projects/deepseek-harness/node_modules/typescript/bin/tsc`）、`@types/node` 22.20.1；
dsh 检出 HEAD = `d1b6099ae716870a2afba705a2c90415408a69f5`，与 [`combo.json`](../../combo.json) 的
`repos.dsh.productCommit` 一致。本文只提交这一份文档，未改产品代码、`tests/`、`package.json`、
`combo.json` 或地图 #198。

输入决议：[构建与产物 #199](https://github.com/eafen405/OurFairy/issues/199)、
[安装链 #200](https://github.com/eafen405/OurFairy/issues/200)、
[严格度与完成定义 #201](https://github.com/eafen405/OurFairy/issues/201)。本文只补它们没有收口的部分：
测试从哪加载、构建放在哪、`scripts/` 怎么进 `tsc -b`、precommit/CI 何时跑什么。

## 方法

1. 读产品侧测试与门禁：60 个 `tests/*.test.mjs`、[`tests/helpers/dsh-peers.mjs`](../../tests/helpers/dsh-peers.mjs)、
   [`tests/helpers/backend.mjs`](../../tests/helpers/backend.mjs)、[`scripts/precommit.mjs`](../../scripts/precommit.mjs)、
   [`tests/precommit.test.mjs`](../../tests/precommit.test.mjs)、[`tests/docs.test.mjs`](../../tests/docs.test.mjs)、
   [`.github/workflows/check.yml`](../../.github/workflows/check.yml)、[`package.json`](../../package.json)。
2. 读安装链的接缝：[`scripts/ourfairy-backend.mjs`](../../scripts/ourfairy-backend.mjs) 的
   `installProfile`（`:159`）与 `commandDoctor`（`:617`）、[`scripts/ourfairy-composition.mjs`](../../scripts/ourfairy-composition.mjs)
   的 `productSources`（`:235`）/`publishedEntries`（`:260`）。
3. 实验在 worktree 的 `.lab/` 临时目录做（已删除），只动副本与合成 fixture；没有改本仓产品代码/tests/
   manifest，没有跑全量 `npm test`，没有触发 CI。
4. Node/TypeScript 行为只认一手来源：本机 Node 24.18.0 的实测输出、dsh 检出的 tsc 6.0.3、Node 官方
   `typescript.html` / `test.html` / `cli.html` 文档（链接见文末「一手来源」）。不完全依赖票面转述。

## 结论

### 1. 测试 import：加载 `dist/*.js`，不加载源码 `.ts`；不加 `--conditions`

**7 处是静态 import，另有 15 处动态 import**。`grep -rn "backend/.*/src/" tests --include=*.test.mjs`
共 24 行：7 处 `import ... from '../backend/.../src/*.mjs'`、15 处 `await import(...)`（其中 2 处是
`pathToFileURL(join(repoRoot, ...))`）、1 处 `pdf-worker-cancel.test.mjs:28` 的 `registerHooks` 路径、
1 处 `precommit.test.mjs:35` 的 gate fixture 字符串。票面说的「7 处」对应静态 import，不是全部。

**结论：迁移后 22 个 import 点全部指向 `dist/*.js`，不指向 `src/*.ts`。** 理由是可执行事实，不是偏好：

- #199 定源码相对 import 写 `./x.js`。Node 的类型剥离**只删类型，不改写说明符**：`node src/a.ts` 里
  `import './b.js'` 在只有 `b.ts` 时直接 `ERR_MODULE_NOT_FOUND`（实验 E1）。所以 `src/*.ts` 在
  「`.js` 说明符」这条路线下根本不能被 Node 直接加载；要加载就得改成 `.ts` 说明符 +
  `rewriteRelativeImportExtensions`，这正是 #199 明确不采用的备选。
- `dist` 是 `files` 装进 profile 的那份产物（#200），测试加载它才是在当「独立裁判」；加载源码会绕开
  构建产物，`dist` 缺失时测试仍可能绿。
- 只有 7 个静态 import 的模块链是纯 Node 内建/相对 import：`identity/src/store.mjs`（只 import
  `node:fs`/`node:path`/`node:sqlite` 与同包相对文件）、`codes.mjs`、`interfaces.mjs`、
  `attachments/src/download.mjs`、`chat/src/queues.mjs`、`spaces/src/bwrap.mjs`。所以它们是静态
  import 也可以继续静态，只需把路径从 `src/*.mjs` 换成 `dist/*.js`。
- 其余动态 import（`chat/units`、`chat/runtime`、`chat/jobs`、`gateway/service`、`attachments/pdf`）
  的模块链有 `@deepseek-ai/*`/`zod`/跨包 import，必须保持「先 `import './helpers/dsh-peers.mjs'`，
  再动态 `import()`」的形状；这不是新规则，是文件头注释（`dsh-peers.mjs:1-14`）已经写明的约束。
- **不需要 `--conditions`。** 产品包公开子路径的 `exports` 只用标准的 `types`/`default` 两个条件（locale
  之类是纯字符串）；Node 默认就带 `node`/`default`/`import`/`require`（Node CLI 文档 `--conditions`），
  测试路径不需要再选条件。跨包解析靠 `dsh-peers.mjs` 的 `registerHooks` 把 parentURL 锚到包自己的
  `package.json`，让 Node 走该包的 `exports`——这是 resolver 层面的锚，不是 condition（实验 E4）。

**`tests/helpers/dsh-peers.mjs` 的具体改法：**

1. 保留 `registerHooks` 与 `packageOf`；保留 11 条 dsh/vendor/zod 手写 anchor（`dsh-peers.mjs:27-43`，另有 3 条 `@ourfairy` 见下）。
2. 把 3 个手写的 `@ourfairy/dsh-{identity,http,sessions}` anchor 换成由 `productPackageDirs()`
   驱动的全产品包 anchor：对每个 `backend/<pkg>/package.json` 读 `name`，映射到该 `package.json`。
   现在只锚 3 个包；迁移后 `dist` 模块可能 import 任何兄弟包（例如 `chat/service` 的
   `@ourfairy/dsh-attachments`），漏锚会在运行期 `ERR_MODULE_NOT_FOUND`。
3. anchor 目标继续是包根 `package.json`，**不要**改成 `dist` 文件：`exports` 在迁移中会从
   `src/*.mjs` 指向 `dist/*.js`，测试不需要跟着改；半迁移期未迁包仍解析到 `src`，已迁包解析到 `dist`。
4. `resolveDshPeer` 不变。注释补一句：锚的是 package manifest，不是具体产物路径。
5. 如果根 `node_modules` 链接农场已经存在，这个 hook 是冗余的；保留它是为了让**单文件
   `node --test tests/x.test.mjs`** 不依赖 `link-types` 的产物，且始终锚 combo.json 的 dsh 检出。

**半迁移期：每个包原子提交时同时改它的测试 import 路径。** 这跟地图 #198 的「import 路径改动单独提交」
有冲突：如果先删 `src/*.mjs`、下一个提交再改测试，中间那个提交的测试全红，#202 要求的「半迁移期保持
285 条全绿」就不成立。要么把路径改动并进包迁移提交（本文推荐，路径改动仍是纯路径、断言零改动），要么
保留 `.mjs` shim 直到路径提交——后者会重新引入第二个模块身份，不建议。

### 2. build-before-test：`pretest` 放根 `package.json`，全仓一次 `tsc -b`，测试内的 launcher 跳过构建

**位置与命令：**

```jsonc
// package.json（根）
"build": "node scripts/tsc.ts --fresh",      // link-types + 清 dist/tsbuildinfo + tsc -b
"typecheck": "node scripts/tsc.ts",          // link-types + 增量 tsc -b（同一条 tsc -b，不清）
"pretest": "npm run build",
"test": "node --test \"tests/**/*.test.mjs\""
```

`pretest` 是 npm 的生命周期脚本：`npm test` 会先跑一次，然后才启动 `node --test`；`node --test` 的每个
测试文件在独立子进程运行、并发上限由 `--test-concurrency` 控制（Node 测试文档；本机 32 核上 6 个文件
实测 6 个并发，实验 E3），所以构建必须在父进程里只发生一次，不能放到测试文件或 helper 的 `before` 里。
`test` 脚本的 glob 不变。

**为什么是整仓一次、不是每包：** 根 `tsconfig.json` 是 solution，`tsc -b` 按 project reference 的依赖
序构建；每包各起一个 tsc 会把同一张图拆成多次进程启动，而且各包共享根 `node_modules` 链接农场与
`tsc -b` 的增量状态。整仓一次只有一个写者。

**并行竞争的具体形态：**

- 不加 `pretest` 时，如果构建挂在每个测试文件的 helper 上，`node --test` 默认并行文件 → N 个测试文件
  同时 `tsc -b` 同一个根。`tsc -b` 的 `.tsbuildinfo` 是普通文件，没有文档承诺跨进程写同一 buildinfo
  的互斥；#200 的「两进程 3 轮均退出 0」只说明没观察到失败，不是安全性证明。
- 即使加了 `pretest`，**测试启动的后端 launcher 仍会走 `installProfile`，而 #200 要求它在第一次
  hash/install 前构建**。一个 `npm test` 里几十次 `start`/`doctor` 各自构建一次，又会回到 N 个并发写者，
  还会把全量套件拖慢。因此测试夹具必须让 launcher 跳过构建：
  `tests/helpers/backend.mjs` 的 `launchEnv()`（`:79`）默认注入 `OURFAIRY_SKIP_BUILD=1`；生产/CI 的
  launcher 不设这个变量，仍然构建。跳过时 `installProfile` 里的 `installDecision` →
  `productSourceHash` 仍会走 `productSources`，缺/空 `dist` 会按 #200 的规则硬失败，不会静默。
- 构建路径必须至少有一个测试真跑，否则「launcher 会构建」只是声称。建议新增
  `tests/build-before-install.test.mjs`：用 `copyProductRepo` 建副本，显式去掉
  `OURFAIRY_SKIP_BUILD`，在副本里跑 `node scripts/tsc.ts --fresh` 和一次 `doctor`/`probe`。这个测试在
  副本里构建，不和并行测试共享本 worktree 的 `dist`。

**`copyProductRepo` 要补的构建输入**（[`tests/helpers/backend.mjs:104-107`](../../tests/helpers/backend.mjs)）：

1. 多复制两个根文件：`tsconfig.base.json`、`tsconfig.json`（solution）。副本里的
   `backend/*/tsconfig.json` 与 `scripts/tsconfig.json` 已随目录复制。
2. 根 `node_modules` 链接农场：**不要复制**，调用 `linkTypes(root)` 在副本里重建。链接农场是
   combo.json 驱动的生成物（#199），复制会复制一份可能过期的机器路径；重建很便宜。
3. 复制 `backend/`、`scripts/` 时过滤掉 `*.tsbuildinfo`。实验 E5 实测：把带 `dist/.tsbuildinfo` 的树
   复制一份、删掉 `dist/probe.js`，`tsc -b` 退出 0 且**不恢复**缺失产物；删掉 buildinfo 后同一命令
   立即重建出 `probe.js`。`copyProductRepo` 的副本若保留 buildinfo，副本里的构建会假绿。
4. `copyProductRepo` 仍复制 `combo.json`/`package.json`；`linkTypes(root)` 必须按传入的 `root` 链接副本
   自己的 `backend/*`（不能用原 worktree 的包），dsh 仍走 `OURFAIRY_DSH_DIR`/combo。

**构建失败形态：** `pretest` 失败 → npm 不启动 test runner；launcher 构建失败 → `installProfile` 第一步
终止，不进入 hash/install（#200 时序）；缺 `dist` → `productSources` 抛错，doctor/probe 均响亮失败。

### 3. `scripts/` 迁 `.ts`：Node 直接执行；solution 里做**叶子 noEmit project**

**结论：** `scripts/` 是独立 project，`noEmit: true`，作为根 solution 的一个 **叶子** reference 加入
`tsc -b`；脚本源码里的相对 import 写 `.ts`（与 backend 的 `.js` 相反），Node 直接执行源码。tsc 只做
类型检查，不产出任何 JS。

**为什么 noEmit 可行（与 #199 的 TS6310 不矛盾）：** TS6310 是「被引用的 project 不能 disable emit」，
但只在该 project 被另一个 **emitting** project 引用、或 CLI 把 `--noEmit` 注入被引用 project 时触发。
实验 E2：

- 根 solution `files: []` + `references: [scripts]`，`scripts` 为 `noEmit` → `tsc -b` 退出 0，只产出
  `scripts/tsconfig.tsbuildinfo`；改出类型错误后立刻 `TS2322`（实验 E2）。
- 同一个 noEmit project 被一个 emitting consumer 引用 → `TS6310: Referenced project ... may not disable emit`。
- `tsc -b --noEmit` 在含 emitting project 的图上 → `TS6310`（#199 已报，本文复现）。所以
  `typecheck` 不能写成 `tsc -b --noEmit`；`tsc -b` 本身就是 typecheck。

约束：`scripts` 不能成为任何 emitting project 的依赖（它是叶子）；backend 包 `references` 里不要出现
`scripts`。

**`scripts/tsconfig.json`：**

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true, // noEmit 下才允许 import './x.ts'
    "erasableSyntaxOnly": true,         // Node strip-only：enum/namespace/参数属性直接拒绝
    "verbatimModuleSyntax": true,
    "types": ["node"],
    "tsBuildInfoFile": "tsconfig.tsbuildinfo"
  },
  "include": ["**/*.ts"]
}
```

`erasableSyntaxOnly` 是必要的：Node 只删类型，`enum` 运行时会 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`
（实验 E1）；`noEmit` 下 tsc 默认不会因此报错（它只做类型检查），开着这个开关才会在提交前报 `TS1294`
（实验 E2）。`scripts/tsconfig.tsbuildinfo` 加入 `.gitignore`（`*.tsbuildinfo`），`--fresh` 构建时删掉它。

**源码改动：**

- 10 个 `scripts/*.mjs` → `.ts`；只有 4 条跨文件相对 import 要改成 `.ts`：
  `combo.ts`→`ourfairy-composition.ts`、`ourfairy-backend.ts`→`combo.ts`+`ourfairy-composition.ts`、
  `real-acceptance.ts`→`combo.ts`。
- Node 直接执行：`node scripts/ourfairy-backend.ts start`、`node scripts/precommit.ts`；`package.json`
  的 10 个 `node scripts/*.mjs` 全部改 `.ts`。
- `scripts/tsc.ts`（新）负责解析 combo/`OURFAIRY_DSH_DIR` 指向的 dsh、调用 `link-types.ts`、
  `spawnSync(process.execPath, [dshTsc, '-b'])`；`--fresh` 先删 `backend/*/dist` 与
  `scripts/tsconfig.tsbuildinfo`。`scripts/link-types.ts`（新）建根 `node_modules` 符号链接农场（#199）。
  `scripts/tsc.ts` 自己必须可被 import 而不执行 CLI（`import.meta.main` 守卫，沿用 #156 的 launcher 纪律）。
- 测试：15 个文件（14 个测试 + `tests/helpers/backend.mjs`）共 17 条 import：combo 9、composition 5、
  specs-status/precommit/bench-gate 各 1；路径改 `.ts`；`tests/launcher-import.test.mjs:23,39` 的 launcher
  路径改 `scripts/ourfairy-backend.ts`；`tests/helpers/backend.mjs:24,124` 同样改。断言不变。
- `.githooks/pre-commit` 的 `exec node scripts/precommit.mjs` 改 `.ts`；
  `tests/precommit.test.mjs:64` 的 hook 断言随之改（这是 gate 断言，按本票要求改，不是行为断言）。

**Node 版本：** 根 `package.json` 的 `engines` 是 `^22.19.0 || >=24`。Node 22.18.0 起类型剥离默认开启且
不再发 experimental warning（Node v22 `typescript.html` history），22.19 落在范围内，不需要提高下限。
但 CI 只跑 Node 24；Node 22.19 的 `.ts` 直跑仍建议在实施票用一次 `node scripts/precommit.ts --print`
验证。

### 4. precommit/CI 新分流

原则按 #201：**每条提交只跑与改动面相关的检查 + 类型检查；全量在收口/合并/交付跑；CI 只在
integration/main 推送或手动触发时跑。** precommit 不再对「任何非 Markdown 改动」跑全量。

**四种模式（`scripts/precommit.ts`）：**

| 模式 | 触发 | 命令 |
| --- | --- | --- |
| `docs` | 空路径（message-only amend）或全部 `*.md` | `node --test tests/docs.test.mjs` + `npm run combo:verify`（现状不变） |
| `related` | 改动面能选出一组相关测试 | `npm run build` → `node --test <选中的测试文件>`（+ Markdown 改动时 `tests/docs.test.mjs`）→ `npm run combo:verify` |
| `typecheck` | 源码改动但没有直接测试引用（如 `backend/delivery` 内部） | `npm run typecheck` + `npm run combo:verify`；不声称行为覆盖 |
| `full` | 根构建/门禁权威、包 manifest、共享 fixture、merge commit、`--full`、选中集过大 | `npm test` + `npm run combo:verify` |

**相关测试的选择规则（可执行、可测试）：**

1. 始终加入 staged 的 `tests/**/*.test.mjs`。
2. staged 的 `backend/<pkg>/**`：加入所有正文含 `backend/<pkg>/` 或 `@ourfairy/dsh-<pkg>` 的测试文件
   （迁移后测试 import `dist`，仍含 `backend/<pkg>/` 前缀，所以规则不变）。这是「直接面」选择，不是
   覆盖率声称；launcher 端到端测试不 import 产品源码，选不到就落到 `typecheck`，由实施者按改动面手工
   补跑，收口全量兜底。
3. staged 的叶子 `scripts/<name>.ts`：加入正文含 `scripts/<name>.` 的测试（`bench-gate`→
   `tests/bench-gate.test.mjs`，`specs-status`→`tests/specs-status.test.mjs`）。
4. `full` 的权威路径：根 `package.json`、`combo.json`、`tsconfig*.json`、`backend/<pkg>/package.json`、
   `backend/<pkg>/tsconfig.json`、`scripts/{precommit,tsc,link-types,combo,ourfairy-composition,ourfairy-backend}.ts`、
   `tests/helpers/**`、`tests/fixtures/**`、`.github/**`、`.githooks/**`、`android/**`；以及
   `git rev-parse -q --verify MERGE_HEAD` 成功（merge）或显式 `--full`。
5. 选中测试数超过 45（当前 60 个测试文件）时直接 `full`，避免一条「近似全量但命令不同」的第三态。

实测选择结果（实验 E6，当前树，未迁移）：

| staged 路径 | 模式 | 选中数 |
| --- | --- | --- |
| `backend/chat/src/queues.ts` | related | 13 |
| `backend/chat/src/service.ts` | related | 13 |
| `backend/delivery/src/index.ts` | typecheck | 0 |
| `backend/http/src/http.ts` | typecheck | 0 |
| `backend/identity/package.json` | full | — |
| `scripts/bench-gate.ts` | related | 1 |
| `scripts/combo.ts` | full | — |
| `tests/chat-runtime.test.mjs` | related | 1 |
| `docs/research/x.md` | docs | 0 |

注意 `backend/http`/`delivery` 选不到直接测试，这是规则的真实边界：它们只能拿到 typecheck，行为验证靠
实施者手工跑相关 e2e + 收口全量。不要为了「看起来覆盖」把这类包硬塞进一个会骗人的 mapping。

**`tests/precommit.test.mjs` 要改的断言：**

- `classify([])`/纯 Markdown → `docs`，`plan` 仍等于 `DOCS_COMMANDS`（保留）。
- `['backend/chat/src/index.mjs']` 从 `full` 改为 `related`，且 `plan().tests` 含
  `tests/chat-runtime.test.mjs`（或其它真实引用 chat 的文件）。
- `['backend/delivery/src/index.mjs']` → `typecheck`。
- `['combo.json']`、`['package.json']`、`['tests/helpers/backend.mjs']`、`['scripts/precommit.ts']`、
  `['backend/chat/package.json']` → `full`（当前 `combo.json`/`package.json` 用例保留，新增 helper/
  manifest 用例）。
- `['tests/chat-runtime.test.mjs']` → `related`，选中自身。
- `plan` 的四种模式都保留 `combo:verify`；`related` 的命令含 `run build` 与 `--test`，`typecheck` 含
  `run typecheck`，`full` 含 `npm test`。
- hook 断言从 `exec node scripts/precommit.mjs` 改 `scripts/precommit.ts`。
- 新增 CI 形状断言（可放本文件）：读 `.github/workflows/check.yml`，断言没有 `pull_request:` 触发、
  保留 `workflow_dispatch:`、`npm run build` 出现在 `npm test` 之前。这是 #201 节奏的可执行形式。

**CI（[`.github/workflows/check.yml`](../../.github/workflows/check.yml)）：**

```yaml
on:
  push:
    branches: [main, 'integration/**']
  workflow_dispatch:
```

- 删除 `pull_request:`（当前每次 PR 同步都跑全量）。feature 分支按仓库惯例不推送；integration/main 的
  push 就是收口/合并，跑一次全量。需要时用 `workflow_dispatch` 手动补跑。
- 在 dsh 四条构建之后、`npm test` 之前加一步 `npm run build`（满足 #200 的 build-before-hash 时序，也让
  构建失败与测试失败在 CI 日志里分开）。
- 保留 `npm test`（会经 `pretest` 再构建一次，增量/空跑可接受）与 `npm run combo:verify`。
- 可选 `paths-ignore: ['docs/**', 'work/**', '**.md']`：纯 Markdown 的 integration 推送不跑全量，链接
  检查由 precommit docs gate 承担。本文不把它列为必须，因为代价只是偶尔一次全量，收益是少一次
  `npm test`；实施时按 #201 的「低频」取舍。

**README 的旧描述要同步：** [`README.md:66-68`](../../README.md) 现在写「其余改动跑 `npm test`」，
[`README.md:72-74`](../../README.md) 写「每个 PR 上跑」；实施票必须一起改，否则文档与门禁再次不一致。

### 5. 半迁移期：哪些响亮失败、哪些静默通过、断言零改动

**响亮失败（迁移中必然出现，必须在该包的原子提交内处理）：**

| 位置 | 失败形态 |
| --- | --- |
| 17 个测试文件的 22 个 backend import 点（7 静态 + 15 动态）加 1 个 pdf hook 路径 | 包迁移删掉 `src/*.mjs` 后 `ERR_MODULE_NOT_FOUND`；测试路径不切就一直红 |
| `tests/pdf-worker-cancel.test.mjs:28` 的 `@ourfairy/dsh-spaces/bwrap` hook | 仍指向 `src/bwrap.mjs`，spaces 迁移后红 |
| `tests/helpers/backend.mjs:24,124`、`tests/launcher-import.test.mjs:23,39` | launcher 改名 `.ts` 后路径不存在 |
| 14 个 import `scripts/*.mjs` 的测试文件 + `tests/helpers/backend.mjs` + `.githooks/pre-commit` 断言 | 脚本改名 `.ts` 后模块/路径/断言失败 |
| `tests/product-sources.test.mjs:51,83-90` | 期望集仍从 `src/` 推导；第一个包 `files` 指 `dist` 后，hash 覆盖 `dist` 而期望列 `src` → 失败（该测试的 `copiedSources` 要改成按 manifest 选择 `src`/`dist`） |
| `tests/bundle-packages.test.mjs:269-296` | `files` 指向 `dist` 但没构建时，`globSync` 匹配不到文件 → 明确列出包与条目；这是 pretest 的守卫 |
| `tests/precommit.test.mjs` | precommit 模式/hook 路径/CI 触发一改就红；按本票要求改，属于预期的 gate 断言变更 |
| 任何半 manifest（`files`→dist、`main`→src） | 安装副本缺模块，probe/doctor 启动失败（#200 的 E13/E14），不会静默 |

**静默通过（危险的那一类）：**

- `npm run combo:verify`：不读 build 产物、不算 hash、不安装，迁移期间一直绿。
- `tests/docs.test.mjs`：只查 Markdown 链接，迁移无关；新文档链接坏掉才会红。
- 未迁移包的测试：继续 import `src/*.mjs`，绿是应该的。
- **旧 `src/*.mjs` 没删、测试还在 import 它**：测试继续绿，但 profile 装的是 `dist`；这是最危险的双源
  状态。防护是包内原子提交（`src` 删除与 `files`/`main`/测试路径同一步），再加一个 gate：
  包 manifest 的 `main`/`exports` 指向 `dist` 时，`src/` 不得再有 `*.mjs`。这条断言建议做成新测试
  （例如 `tests/build-layout.test.mjs`）或 `scripts/tsc.ts` 的构建前检查，不要塞进行为测试。
- **直接 `node --test tests/x.test.mjs` 不跑 pretest**：`dist` 存在但可能过期，测试绿的是旧代码。规则：
  单文件跑前先 `npm run build`；`npm test` 不受影响。是否加「dist 新鲜度」硬检查留作后续（成本/收益
  还不值得在本票定）。
- `doctor` 的旧行为（#200 前）在缺 `dist` 时全绿；#200 的 `productSources` 0 文件抛错落地后不再静默。
  本票要求实施票让该守卫与构建前置同批落地，否则半迁移期 doctor 会骗人。

**「285 条全绿」怎么保持：**

- 每个包一原子提交：`src/*.mjs`→`.ts`、`tsconfig.json`、`files`/`main`/`exports`→`dist`、该包测试
  import 路径；提交前跑该包的 related 测试 + `npm run typecheck`。
- 第一条包迁移时同步改 `tests/product-sources.test.mjs` 的期望集推导（按 manifest 选 `src`/`dist`），
  否则它从第一个包起红。
- 收口/合并前才跑一次全量 `npm test`、`combo:verify`、`backend:doctor`（#201）。迁移期间不每步跑全量。
- 包与包的顺序按 #199 的依赖图：`identity`→`sessions`→`spaces`/`attachments`→`chat`→
  `delivery`/`gateway`/`search`/`speech`/`groups`→`probe`；`http` 作为多数包的依赖先做试点。
- 只有「全量绿」这个整体声称要等所有包迁完；单个测试文件随其包迁移即可恢复绿，不需要等结束。

**断言零改动（import 路径除外）的边界：**

- **可以只改 import/路径**：上述 17 个 backend 测试、14 个 scripts 测试、helper、launcher-import、
  pdf hook。行为断言一条不改。
- **必须改的 gate/fixture 断言（不是行为断言）**：`tests/precommit.test.mjs`（模式/hook/CI）、
  `tests/product-sources.test.mjs` 的期望集推导（`src`→按 manifest）、`tests/bundle-packages.test.mjs`
  的 `files` 检查（不改断言，靠 pretest 保持绿）。这三处是结构事实，不是 HTTP/SSE/业务行为。
- **建议新增而非改写**：build-before-install 测试、双源守卫、CI 触发断言。新增测试也要在票上写明，
  不要混进「断言零改动」的声称里。
- `tests/docs.test.mjs`、`tests/ecosystem-boundary.test.mjs` 的 `CITED_CHECKS` 表（引用测试名，不引用
  文件内容）不需要改。

## 改动清单（实施票按此拆）

**T1 `scripts/` 与构建基础设施（先落，测试保持绿）：**

- `scripts/*.mjs` → `.ts`（10 个）+ 4 条相对 import 改 `.ts`；`scripts/tsconfig.json`（noEmit 叶子）。
- 新增 `tsconfig.base.json`（#199 的内容）、根 `tsconfig.json`（`files: []`，references 先只有
  `scripts`，随包迁移增长）、`scripts/link-types.ts`、`scripts/tsc.ts`。
- `package.json`：10 个脚本路径改 `.ts`；新增 `build`/`typecheck`/`pretest`。
- `.githooks/pre-commit` 改 `.ts`；`.gitignore` 加 `/node_modules/`、`backend/*/dist/`、`*.tsbuildinfo`。
- 14 个测试文件 + `tests/helpers/backend.mjs` + `tests/launcher-import.test.mjs` 的 scripts 路径改 `.ts`；
  `tests/precommit.test.mjs:64` hook 断言改 `.ts`。
- `README.md` 的命令与目录表改 `.ts`。

**T2 precommit/CI 分流（可与 T1 同批或紧随）：**

- `scripts/precommit.ts`：`docs`/`related`/`typecheck`/`full` 四模式 + 选择规则 + `--full`/`--print` +
  `MERGE_HEAD` 检测；`tests/precommit.test.mjs` 按 §4 改/增断言（含 CI 形状）。
- `.github/workflows/check.yml`：删 `pull_request`，保留 push main/integration + `workflow_dispatch`；
  dsh 构建后加 `npm run build`；保留 `npm test` + `combo:verify`。
- `README.md:66-74` 同步新分流与 CI 触发。

**T3 测试夹具与 resolver（与 T1 或首个包同批）：**

- `tests/helpers/dsh-peers.mjs`：全产品包 anchor（由 `productPackageDirs()` 派生）。
- `tests/helpers/backend.mjs`：`launchEnv` 注入 `OURFAIRY_SKIP_BUILD=1`；`copyProductRepo` 复制
  `tsconfig.base.json`/`tsconfig.json`、过滤 `*.tsbuildinfo`、调用 `linkTypes(root)`；launcher 路径 `.ts`。
- `scripts/ourfairy-backend.ts`：`installProfile` 首步 `buildProducts`（尊重 skip），doctor 增加
  `product build` 检查（#200 的清单）。
- 新增 `tests/build-before-install.test.mjs`（副本内真构建 + doctor/probe），以及双源守卫。

**T4 单包试点 `http`（原子提交）：**

- `backend/http/src/*.mjs`→`.ts`、`tsconfig.json`、`exports`/`files`/`main`→`dist`；根 solution 加
  reference。当前没有测试直接 import http 源码（`tests/identity-http.test.mjs` 等是启动/安装类），所以
  这一包的测试不需要改 import 路径；验证靠 build + 相关 e2e + 副本 doctor/probe。
- 验证：`npm run build`、`npm run typecheck`、相关测试、副本 doctor/probe、profile 启动。

**T5 其余包按依赖序迁移**（每包一原子提交；`attachments` 含 `pdf-worker.py` 搬出 `src` 到包根
`assets/`，`tests/pdf-worker-cancel.test.mjs` hook 改 `dist/bwrap.js`；`chat` 的测试 import 最多）。

**T6 收口：** 全量 `npm test`、`npm run combo:verify`、`npm run backend:doctor`；`docs/research/README.md`
索引；清 `.worktrees/research-*`；`bench:projection` 按 #201 跑一次。

## 实验与证据

所有实验在 `.worktrees/research-ts-test-gates/.lab/`（已删除）；命令与结果：

**E1 Node 类型剥离/解析（Node 24.18.0）：**

```console
$ node src/a-ts.ts                  # import './b.ts'
ts-specifier 42
$ node src/a-js.ts                  # import './b.js'，磁盘上只有 b.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/b.js' imported from '.../src/a-js.ts'
$ node --test tests/one.test.mjs    # .mjs 动态 import ../src/a-ts.ts
✔ mjs test can load ts
$ node src/enum.ts
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
```

**E2 TypeScript 6.0.3 build 模式：** 下面 `tsc` 均指 dsh 检出的
`node_modules/typescript/bin/tsc`（6.0.3）；`ts4`/`ts3` 是 `.lab/` 下的合成 fixture。

```console
# solution(files:[]) -> scripts(noEmit) : 成功
$ tsc -b --verbose
... Building project '.../ts3/scripts/tsconfig.json'...
EXIT=0   # 只有 scripts/tsconfig.tsbuildinfo，无 JS
# 改 b.ts 成 string：tsc -b -> TS2322，EXIT=1
# noEmit 项目被 emitting consumer 引用：TS6305 + TS6310
# 含 emitting project 的图上 tsc -b --noEmit：TS6310
# erasableSyntaxOnly + enum：TS1294
```

**E3 `node --test` 并行：** 6 个各自 sleep 300ms 的测试文件，记录 start/end 时间戳：
`max concurrent test-file processes: 6 of 6 files`。

**E4 跨包 anchor + dist：** fixture 包 B（`exports` 的 `types`/`default` 指 `dist`）+ 包 A 的
`dist/index.js` import `@ourfairy/pkg-b/sub`：

```console
$ node tests/check.mjs     # registerHooks 把 @ourfairy/pkg-b 锚到 pkg-b/package.json
anchor-resolved dist sibling: 42
$ node -e "import('./pkg-a/dist/index.js')"   # 不注册 hook、无 node_modules
ERR_MODULE_NOT_FOUND Cannot find package '@ourfairy/pkg-b' ...
```

**E5 `copyProductRepo` 构建输入（合成副本）：**

```console
$ (cd copy && tsc -b)                    # 缺根 tsconfig.json
error TS5083: Cannot read file '.../copy/tsconfig.json'
$ (cd copy && tsc -p backend/identity)   # 缺 tsconfig.base.json
error TS5083: Cannot read file '.../copy/tsconfig.base.json'
$ (cd copy && tsc -b)                    # 有 base，无根 node_modules
error TS2688: Cannot find type definition file for 'node'
error TS2307: Cannot find module 'zod'
$ (cd copy && tsc -b)                    # 建链接农场后
EXIT=0   # dist/probe.js + dist/probe.d.ts
# 复制带 dist/.tsbuildinfo 的树，删 dist/probe.js，再 tsc -b：EXIT=0 且不恢复 probe.js
# 删 .tsbuildinfo 后再 tsc -b：probe.js 重建
```

**E6 precommit 选择器原型（当前树）：** 输出见 §4 表；`backend/chat/**` 选 13 个正文含
`backend/chat/`/`@ourfairy/dsh-chat` 的测试；`backend/delivery|http` 选 0，落 `typecheck`；
`scripts/bench-gate.ts` 选 1；`scripts/combo.ts`/manifest 落 `full`。

**E7 未跑全量：** 按票面要求没有跑 `npm test`；只跑 `node --test tests/docs.test.mjs
tests/precommit.test.mjs`（6 条全过，其中 docs 的 1 条是本文链接检查），CI 未触发。

## 一手来源

- Node.js v24 `Modules: TypeScript`：<https://nodejs.org/docs/latest-v24.x/api/typescript.html>（默认
  strip-only、`.ts` 说明符必须带扩展名、node_modules 下拒绝 `.ts`、`erasableSyntaxOnly` 建议）。
- Node.js v22 `Modules: TypeScript`：<https://nodejs.org/docs/latest-v22.x/api/typescript.html>（22.18
  起默认开启且不再发 experimental warning）。
- Node.js v24 `Test runner`：<https://nodejs.org/docs/latest-v24.x/api/test.html>（每个匹配文件在独立
  子进程执行、并发由 `--test-concurrency` 控制、glob 参数）。
- Node.js v24 `Command-line API`：<https://nodejs.org/docs/latest-v24.x/api/cli.html#-c-condition---conditionscondition>
  （`--conditions` 只加自定义条件；默认 `node`/`default`/`import`/`require`），以及
  <https://nodejs.org/docs/latest-v24.x/api/cli.html#--test-concurrency>。
- dsh 检出的 TypeScript 6.0.3：`/home/eafen405/projects/deepseek-harness/node_modules/typescript/bin/tsc`；
  build 模式、TS6310/TS6305/TS1294 均为本文实验复现，不是二手转述。
- 本仓一手文件：上面逐条引用的 `tests/`、`scripts/`、`.github/`、`package.json` 与 `combo.json`。

## 边界与未决

- 本文没有实测 12 包全 emit 的构建耗时；`npm test` 的 pretest（`--fresh`）成本由首个包试点票测（#198
  的 Not yet specified）。
- `backend/http`/`delivery` 等无直接测试引用的包，precommit 只给 typecheck；这是 #201「按改动面」
  的取舍，收口全量兜底。是否给每个包补一张 e2e 映射表，等迁移中出现一次漏网再决定。
- 生产环境两个进程同时 `start`/`doctor` 时仍可能并发 `tsc -b`；本票不引入构建锁（没有观测到的故障，
  个人项目单次启动）。若出现，另开票。
- `scripts/tsc.ts` 的 `--fresh` 会清 `backend/*/dist`，代价与增量策略等试点实测；若 12 包全量构建
  不可接受，再决定 pretest 是否保留 `--fresh`。
- Node 22.19 的 `.ts` 直跑未在本机实测（本机 24.18）；官方 22.x 文档称 22.18 起默认且无 warning，
  CI 仍用 24。实施票可加一条 `node -v` 矩阵验证。
