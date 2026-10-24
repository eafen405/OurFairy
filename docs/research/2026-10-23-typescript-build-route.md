> 2026-10-23 状态：日期化记录。本文记录 2026-10-23 的判断，不描述当前实现。

# backend/ 的 TypeScript 构建与类型检查路线（2026-10-23）

日期：2026-10-23。实验基线：`main` @ `eb7c2a6c5867dc4af228fa09adb3bbe04e7a40ab`；本文提交时分支已 rebase 到 `c39c83d8c1`（#201 只改 `AGENTS.md`）。实验分支 `research/ts-build-route`（worktree `.worktrees/research-ts-build-route`）。dsh 检出 `/home/eafen405/projects/deepseek-harness`，HEAD = `d1b6099ae716870a2afba705a2c90415408a69f5`，与 [`combo.json`](../../combo.json) 的 `repos.dsh.productCommit` 一致，工作树干净。工具链：Node 24.18.0、dsh 自带的 TypeScript 6.0.3（`node_modules/typescript/bin/tsc`）、`@types/node` 22.20.1、zod 4.4.3。

方法：读产品侧 11 个包 + probe 的 `package.json`、47 个 `src/*.mjs`、[`scripts/ourfairy-composition.ts`](../../scripts/ourfairy-composition.ts)、[`scripts/combo.ts`](../../scripts/combo.ts)、CI 工作流；读 dsh 的 `tsconfig.base.json`、每包 `tsconfig.json`、`lib/types/*.d.ts`、`scripts/verify-node-next-types.ts`，以及 TypeScript 6.0.3 的 `lib/typescript.js`。实验在 `work/tmp/ts-build-route/`（gitignored）里做：把 `backend/http` 的 `src/*.mjs` **复制**为 `.ts`（产品代码零改动），加一个消费方包、一个故意错误文件、一个真实 `.mjs` 探针；跑完删除。所有命令和结果见 §7。

## 结论

1. **形态用「根 solution + 每包 project reference」**：根 `tsconfig.json` 只写 `files: []` 和 `references`，每个可编译包一个 `tsconfig.json`，统一 `composite: true`，用 dsh 的 `tsc -b` 构建。不要单 program：每个包要有自己的 `rootDir`/`outDir`/`dist` 和 package 身份，单 program 会把包边界和输出位置一起抹掉。`composite` 已经隐含 `declaration` 与 `incremental`，不必再写；`rootDir` 不被隐含，必须显式写。
2. **产物布局是每包 `dist/`，输出 `.js` + `.d.ts`，不入库**：`rootDir: "src"`、`outDir: "dist"`、`tsBuildInfoFile: "dist/.tsbuildinfo"`；package `"type": "module"` 让 `.js` 就是 ESM。源码 import 的**相对路径用 `.js`**（`./http.js`），编译后 JS 与 `.d.ts` 都保持 `.js`；不需要 `allowImportingTsExtensions` / `rewriteRelativeImportExtensions`。跨包仍用包名子路径（`@ourfairy/dsh-http/http` 等），由每包 `exports` 的 `types`→`dist/*.d.ts`、`default`→`dist/*.js` 映射。
3. **dsh 类型用 combo.json 驱动的根 `node_modules` 符号链接农场**，不用 `tsconfig.paths`：链接 dsh 的全部 workspace 包（`packages/*/*`、`vendor/*`）、产品包（`productPackages()`，含 probe）、`zod`、`@types/node`、可选的 `typescript`；tsc 走正常 Node 解析，读 dsh 的 `exports.types`。`skipLibCheck: true`，`preserveSymlinks` 保持默认 `false`。TypeScript 本体直接用 dsh 检出的 6.0.3，不新增根 devDependency / lockfile。
4. **build 与 typecheck 是同一条命令 `tsc -b`**：TypeScript 6.0 的 build 模式不接受 `--noEmit`（会把 `noEmit` 注入所有被引用项目，报 TS6310）；`tsc -b` 失败即类型检查失败。CI 在 dsh 四条构建之后、`npm test` 之前跑一次 `npm run build`。
5. **构建产物必须进包 `files`，但只进 `.js`/`.d.ts`，`.tsbuildinfo` 留在 `dist` 内不发布**：`files: ["dist/**/*.js", "dist/**/*.d.ts", ...]`。`dist` 不入库、由 `rm -rf backend/*/dist` 清理（`tsc -b --clean` 不会删手工残留文件）。非 TS 运行资产（`backend/attachments/src/pdf-worker.py`）要迁到包内稳定位置并在 `files` 里保留，tsc 不会复制它。
6. **strict 从第一天就开**：trial 用 `strict: false` 只是为了隔离构建机制；生产基线写 `strict: true`。单包试点 `backend/http` 在 strict 下报 22 个错误（14×TS7006、5×TS7031、3×TS18046），全是参数/解构隐式 any 与 `unknown` catch，属于迁移注解工作量，不是路线问题。

## 1. 配置形状

### 1.1 根 `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "skipLibCheck": true,
    "composite": true,
    "noEmitOnError": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  }
}
```

- `module`/`moduleResolution` 选 `nodenext`，因为产物由 Node 直接执行、包是 `"type": "module"`。它要求相对 import 带扩展名（TS2834/TS2835），`.js` 源码说明符正好满足；`bundler` 不会强制这条 Node 规则。
- `composite: true` 同时打开 `declaration` 与 `incremental`：TypeScript 6.0.3 的选项表把两者的默认值写成 `false_unless_composite_is_set`（`<dsh>/node_modules/typescript/lib/typescript.js:41004-41019`）；实验里只留 `composite`、删掉 `declaration`/`incremental`，仍然产出 `.d.ts` 与 `.tsbuildinfo`。
- `verbatimModuleSyntax: true` 让 type-only import 必须写成 `import type`，与 Node 直接运行 `.ts` 的场景一致；试跑包含 `import z from '@deepseek-ai/schemastery'` 的默认导入，能通过。
- `skipLibCheck: true` 的理由见 §4.3；`noEmitOnError` 的理由见 §2.4。
- 不写 `sourceMap`/`declarationMap`：profile 只复制 `files`，`src` 不随产物进 profile，map 指向不存在的源码。以后要调试 profile 栈再加 `inlineSources`。
- 不写 `declaration`/`incremental`：由 `composite` 隐含，少一份可漂移的配置。

### 1.2 根 `tsconfig.json`（solution）

```json
{
  "files": [],
  "references": [
    { "path": "./backend/http" },
    { "path": "./backend/identity" },
    { "path": "./backend/sessions" },
    { "path": "./backend/spaces" },
    { "path": "./backend/attachments" },
    { "path": "./backend/chat" },
    { "path": "./backend/delivery" },
    { "path": "./backend/gateway" },
    { "path": "./backend/groups" },
    { "path": "./backend/search" },
    { "path": "./backend/speech" },
    { "path": "./backend/probe" }
  ]
}
```

`files: []` 让根只当 solution，不编译任何文件。注意：`files: []` 且 `references: []` 时 `tsc -b` 会报 TS18002（`The 'files' list in config file … is empty`，实测），所以根 solution 必须等到试点包有了第一个 reference 再落地；不要先合一个空 solution。`tsc -b --noEmit` 仍会因把 `noEmit` 注入子项目而失败（见 §5.1），根 `files: []` 只是让根自己不被编译。不要给根加 `include`/`compilerOptions`，也不要把它展平成单 program。`backend/v1-bundle` 没有源码，不建 tsconfig。

### 1.3 每包 `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "references": [{ "path": "../http" }]
}
```

`rootDir` 必须显式：删掉它后产物落成 `dist/src/http.js`，同时 `exports` 指向的 `dist/http.js` 不存在，消费方直接 TS2307（实测）。`references` 只列**产品包**依赖；dsh 包是外部 `.d.ts`，不进图。

产品包依赖图（由 `src/*.mjs` 的静态 import 抽出）：

| 包 | references |
| --- | --- |
| `http` | 无 |
| `identity` | `http` |
| `sessions` | `http`, `identity` |
| `spaces` | `identity` |
| `attachments` | `http`, `sessions`, `spaces` |
| `chat` | `http`, `sessions`, `attachments` |
| `delivery` | `sessions`, `attachments`, `identity` |
| `gateway` | `http` |
| `groups` | 无 |
| `search` | `identity` |
| `speech` | `http` |
| `probe` | `identity` |

`probe` 里的 `SERVICE_ROWS` 只是运行期字符串，不是 TS import，不要为 `chat`/`gateway`/`attachments` 建 reference。

`tsc -b` 会先构建被引用项目，再构建引用方；从干净目录一次 `tsc -b` 就能得到正确顺序（实测）。如果漏了 reference，干净构建会因找不到依赖的 `dist/*.d.ts` 报 TS2307，这正是想要的失败方式，而不是悄悄读到旧产物。

## 2. 产物布局

### 2.1 目录

```
backend/http/
  src/
    index.ts
    http.ts
  dist/
    index.js
    index.d.ts
    http.js
    http.d.ts
    .tsbuildinfo
  package.json
  tsconfig.json
```

`.js` 而不是 `.mjs`：每个包都有 `"type": "module"`，`.js` 就是 ESM；tsc 从 `.ts` 只发 `.js`。要发 `.mjs` 只能把源码改成 `.mts`（`.d.mts` 一并来），这与图的目标「源码全部 `.ts`」相冲突，也没有运行时收益。`main`、`types`、`exports` 全部指向 `dist`。

### 2.2 `files` 与 `exports`

以 `http` 为例（当前形状见 [`backend/http/package.json`](../../backend/http/package.json)）：

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./http": { "types": "./dist/http.d.ts", "default": "./dist/http.js" },
    "./locale/*.json": "./locale/*.json"
  },
  "files": ["dist/**/*.js", "dist/**/*.d.ts", "README.md", "locale/*.json"]
}
```

- `types` 必须排在 `default` 前：`exports` 条件按声明顺序匹配（TypeScript 6.0.3 `lib/typescript.js:45768`），第一个命中的生效。
- 每个公开子路径都要有 `types` + `default`。子路径清单：

| 包 | 除 `.` 外的子路径 |
| --- | --- |
| `http` | `./http` |
| `sessions` | `./events` |
| `identity` | `./routes`, `./owner` |
| `spaces` | `./policy`, `./bwrap`, `./fs`, `./sandbox`, `./bash`, `./directory` |
| `delivery`, `groups` | `./package.json`（字符串目标，保持现状） |
| `probe` | 无 |
| 其余产品包 | 无 |

所有带 locale 的包继续保留 `./locale/*.json`；`probe` 没有 locale；`v1-bundle` 没有源码，`exports`/`files` 不动。

- `files` 用 `dist/**/*.js` 与 `dist/**/*.d.ts`，不用目录 `"dist"`：目录会把 `dist/.tsbuildinfo` 一起复制进 profile，导致 `productSourceHash` 随构建状态抖动。实测 `globSync("dist/**/*.js")` 能匹配 `dist/index.js`；对试跑包跑 `npm pack --dry-run`，tarball 内容只有 `dist/http.js`、`dist/http.d.ts`、`dist/index.js`、`dist/index.d.ts`、`package.json` 五项，`.tsbuildinfo` 没有被收进去。
- `attachments` 还要保留 `pdf`（wheel）并在下面处理 `pdf-worker.py`；`probe` 保留 `overlay.patch.yml`。

### 2.3 `.tsbuildinfo` 放哪里

放在 `dist/.tsbuildinfo`，让构建状态和产物同生共死：`rm -rf dist` 同时清掉状态，下一次 `tsc -b` 会重新 emit。反过来，如果把 `.tsbuildinfo` 放到包根，只删 `dist` 再跑 `tsc -b`，TypeScript 会认为项目最新、**退出 0 但不产出任何文件**（实测），profile 就会装到空包。

`tsc -b --clean` 只删它自己记录的产物；手工塞进 `dist` 的文件不会被删（实测放一个 `stale.js` 后 `--clean` 仍留着它）。所以权威清理命令是：

```sh
rm -rf backend/*/dist
```

### 2.4 失败时不要留半套产物

TypeScript 默认「有错也 emit」。在**未打开** `noEmitOnError` 的试跑里，strict 的 `tsc -b` 退出 2，但仍写出了完整 `dist/*.js` 与 `.d.ts`；打开 `noEmitOnError: true` 后，同一失败构建只留下 `.tsbuildinfo`，没有 JS。CI 仍应先 `rm -rf backend/*/dist` 再构建，避免上一次成功的旧文件掩盖这一次的失败。

### 2.5 非 TS 运行资产

`backend/attachments/src/pdf.mjs:11-13` 用 `dirname(fileURLToPath(import.meta.url))` 定位 `pdf-worker.py`。源码进 `dist` 后，`root` 变成 `backend/attachments/dist`，`../pdf/*.whl` 仍然对，但 `dist/pdf-worker.py` 不存在。tsc 不复制非 TS 文件。迁移时把 `pdf-worker.py` 移到包根稳定目录（例如 `assets/pdf-worker.py`），代码用 `join(root, '../assets/pdf-worker.py')`，并把 `assets` 加进 `files`；不要继续依赖 `src` 被发布。`probe` 的 `new URL('../package.json', import.meta.url)` 不受影响，因为 `dist` 和 `src` 一样在包根下一层。

### 2.6 与安装链的交接

`productSourceHash` 从每包 `files` 派生要哈希的文件（[`scripts/ourfairy-composition.ts:297-305`](../../scripts/ourfairy-composition.ts)，其集合由 `productSources` 按 `files` 展开），doctor 的 installed-set 也读同一份 `files`（[`scripts/ourfairy-backend.ts:673-678`](../../scripts/ourfairy-backend.ts)）。一旦 `files` 包含 `dist`，**构建必须先于 hash/安装/doctor**；否则 hash 会把空目录或旧产物当产品源码。这个先后关系、模板缓存与 CI 缓存归 #200 的安装链票，本文只钉「dist 是安装输入」。

## 3. 模块说明符与跨包解析

### 3.1 相对路径用 `.js`

源码：

```ts
export { bearerToken, sendJson } from './http.js'
```

产物 `dist/index.js` 与 `dist/index.d.ts` 都保持 `./http.js`（实测）。Node 按 `.js` 找到产物；tsc 在源码里按 `.js`→`.ts` 解析。这条路不需要 `allowImportingTsExtensions`、不需要 `rewriteRelativeImportExtensions`，也不要求 `moduleResolution: bundler`。

### 3.2 备选：`.ts` + `rewriteRelativeImportExtensions`

dsh 自己用这条：`allowImportingTsExtensions: true`、`rewriteRelativeImportExtensions: true`，源码写 `./http.ts`。实测：

```js
// dist/index.js
export { bearerToken, sendJson } from "./http.js";
// dist/index.d.ts
export { bearerToken, sendJson } from './http.ts';
```

JS 会被改写，**声明文件不会被改写**（TypeScript 6.0.3 `lib/typescript.js:114948` 对 declaration file 提前返回）。dsh 的 `lib/types/**/*.d.ts` 里大量 `from './types.ts'` 就是这么来的；消费方在声明文件里允许 `.ts` 扩展名（同一份 `typescript.js:46731` 的 declaration 豁免），所以仍能解析。

不推荐这条路：多两个开关，只为了少写 `.js`；而且我们的包不是 tsdown 打包，声明文件会直接进 profile。`.js` 说明符对任何 NodeNext 消费方都更普通。

### 3.3 跨包 import

沿用现有包名子路径：`@ourfairy/dsh-http/http`、`@ourfairy/dsh-sessions/events`、`@ourfairy/dsh-identity/owner`、`@ourfairy/dsh-spaces/bwrap`。不要改成相对路径跨包，也不要给 `@ourfairy/*` 加 `paths`。

解析链是：源码 import 包名 → 根 `node_modules/@ourfairy/dsh-http` 符号链接 → 包 `package.json` 的 `exports["./http"].types` → `backend/http/dist/http.d.ts`。实测 `tsc --traceResolution` 正是这条，且 `@ourfairy/dsh-http/http` 成功解析到 `dist/http.d.ts`。

构建前/后的差异：

- 干净构建：`tsc -b` 由 references 先构建 `http`，再构建消费方；消费方读到刚生成的 `dist/http.d.ts`。
- 只跑 `tsc -p backend/chat/tsconfig.json` 而 `http/dist` 不存在：TS2307 `Cannot find module '@ourfairy/dsh-http/http'`（实测）。这是期望的硬失败，不允许回退到源码或旧声明。
- 备选的「`types` 指向 `src/*.ts`」确实能让未构建的 tsserver 工作（实测：`exports` 的 `types` 改成 `./src/http.ts` 后，`tsc -b` 仍通过，trace 解析到 `src/http.ts`）。但这样一来消费方程序会把依赖的源码一起编译，类型身份不再等于安装产物；我们选 `types`→`dist`，让「检查的就是要发布的」。

### 3.4 声明文件内容

跨包 import 在 `.d.ts` 里原样保留包名，不内联。因此每包 `exports` 的每个公开子路径都必须有 `types`；所有公开子路径都写进 `exports` 后不需要 `typesVersions`，也不要用它绕过 `exports`。`dist` 里所有 `.d.ts` 都要随 `files` 发布，因为入口 `.d.ts` 会相对 re-export 同目录的其它声明。

## 4. dsh 类型、Node 类型与 TypeScript 本体

### 4.1 根 `node_modules` 链接农场

链接器（建议放 `scripts/link-types.mjs`，由 tsc wrapper 调用）从 [`combo.json`](../../combo.json) 取 dsh 路径，并尊重 `OURFAIRY_DSH_DIR`（[`scripts/combo.ts:55-63`](../../scripts/combo.ts)；CI 就设置它，见 [`.github/workflows/check.yml:46-57`](../../.github/workflows/check.yml)）。在仓库根创建：

- `@deepseek-ai/*` → dsh 的 `packages/*/*` + `vendor/*` 中每个 `package.json` 的 `name`；建议再补扫 dsh 根 `node_modules/@deepseek-ai/*` 并去重（覆盖非 workspace 安装项）。
- `@ourfairy/*` → `productPackages(root)` 给出的每个包目录（bundle + probe + 11 个产品包）。
- `zod` → dsh 的 `node_modules/zod`（4.4.3，满足产品 `^4.4.3`）。
- `@types/node` → dsh 的 `node_modules/@types/node`（22.20.1）。
- 可选 `typescript` → dsh 的 `node_modules/typescript`，只给编辑器找 workspace 版本；tsc 不通过它启动。

链接器只替换自己创建的符号链接；遇到真实目录（例如开发者自己 `npm install` 过）不要删，报错或跳过。根 `node_modules` 目前**没有**被 `.gitignore` 忽略，基础设施票要加 `/node_modules/`。

### 4.2 为什么不用 `paths`

dsh 自己的 `tsconfig.base.json:30` 起是一张巨大的 `@deepseek-ai/*` → `packages/*/src` 映射，但那是 dsh 仓库内部编译自己的源码用的。我们的消费方只需要 dsh 的 `lib/types/*.d.ts`，而 dsh 的 `.d.ts` 还会相互 import 大量包和子路径；手写 `paths` 既要覆盖每个子路径，又会在 dsh 包清单变化时漂移（#195 已实测过这条的脆性）。符号链接让 tsc 走正常 Node 解析，和运行时的包身份完全一致。

### 4.3 `skipLibCheck: true` 与已知的 cosmokit 缺口

dsh 的 `packages/llm/llm-pi-ai/lib/types/config.d.ts:195` 等位置使用 `import("@deepseek-ai/cosmokit").Dict`，而 `@deepseek-ai/cosmokit` 只在 dsh 自己的 `tsconfig.base.json` `paths` 里可解析；从 dsh 包的真实路径往外走找不到它。实测 `skipLibCheck: false` 会报 4 个 TS2307（全部是 `@deepseek-ai/cosmokit`），`skipLibCheck: true` 则构建通过。

这是 dsh 声明包的既有限制，不是本文路线引入的。产品目前没有静态 type-import 这一面：`backend/gateway/src/service.mjs:24-33` 只把 `@deepseek-ai/dsh-llm-pi-ai/src/catalog.ts` 当运行期字符串动态 import。若以后真的用到 cosmokit 相关类型，再在生成的 tsconfig 里补一条针对 `@deepseek-ai/cosmokit` 的 `paths`，或在上游 dsh 里把 cosmokit 声明成依赖；不在本次范围。

### 4.4 `preserveSymlinks` 保持默认 `false`

默认 false 时 tsc 把符号链接解析到真实路径：`node_modules/@ourfairy/dsh-http` → `/…/backend/http`，项目引用能按 realpath 对上产物，诊断也指向真实源码。dsh 仓库自己的构建用默认值；dsh 的 `verify-node-next-types.ts:124-136` 例外地用 `preserveSymlinks: true`，因为它在临时目录里造了一个扁平链接安装、要按「已安装包」解析。

我们实测 `preserveSymlinks: true` 也能 `tsc -b` 通过，但它让 tsc 停留在链接路径，`skipLibCheck: false` 时会转而暴露 `openai`/`typebox`/`undici-types` 等 dsh 外部 SDK 的缺失类型；我们的目标是检查产品源码，不是复核 dsh 的三方 SDK，所以用默认 false。

### 4.5 Node 类型

`types: ["node"]` 通过根 `node_modules/@types/node` 解析到 dsh 的 22.20.1。它包含 `node:sqlite`（`sqlite.d.ts` 存在，`DatabaseSync` 类型实测可编译），而产品 `backend/identity/src/store.mjs` 正需要它。22.20.1 对 Node 24.18 可能缺一些新 API；目前够用，暂不因 Node 24 单独加根 devDependency。真缺时再评估根 `@types/node@24` + lockfile，那是另一张票。

### 4.6 TypeScript 本体

用 dsh 检出的 `node_modules/typescript/bin/tsc`（6.0.3），不新增根 `typescript` devDependency、不做根 `pnpm install`、不新增 lockfile。理由：

- combo.json 已经锁了 dsh 提交，dsh 的 lockfile 锁了 TypeScript 版本；再引入根安装会出现第二份版本权威。
- CI 的 dsh 四条 `requiredBuild` 里第一条就是 `corepack pnpm@11.28.5 install`，TypeScript 随 dsh 一起装好；本地 dsh 检出也已具备。
- 编辑器的 workspace 版本可以靠链接 `node_modules/typescript` 解决；`tsc` 命令行始终走 dsh 的绝对路径，避免 PATH 漂移。

wrapper 不要 spawn `node_modules/.bin/tsc`（Windows 上的 shim 问题，dsh 的 `verify-node-next-types.ts:146-150` 有同样的注释），用 `process.execPath` + `bin/tsc`。

## 5. 命令、CI 与落地顺序

### 5.1 建议的入口

```json
{
  "scripts": {
    "build": "node scripts/tsc.mjs -b",
    "typecheck": "node scripts/tsc.mjs -b",
    "clean": "rm -rf backend/*/dist"
  }
}
```

`clean` 只删每包 `dist`，不碰 `src`、locale、pdf 等资产；要跨平台就在 `scripts/clean.mjs` 里用 `globSync('backend/*/dist')` + `rmSync`。

`scripts/tsc.mjs` 的骨架：

```js
const { combo } = readCombo(root)
const dsh = repoPath(combo, 'dsh', root)          // 尊重 OURFAIRY_DSH_DIR
ensureTypeLinks({ root, dsh })                    // 幂等符号链接农场
const tsc = join(dsh, 'node_modules/typescript/bin/tsc')
const result = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(result.status ?? 1)
```

没有 `tsc -b --noEmit` 这一档：那会把 `noEmit` 注入每个被引用项目并报 TS6310（实测 `Referenced project '…/pkgs/http' may not disable emit`）。`tsc -b` 本身就是类型检查；要「只检查不写入」就接受它写入增量产物，或者另建一个带 `paths` 的单程序 noEmit 检查（本文不推荐，维护两套解析）。

### 5.2 CI

在现有 full-gate 的 dsh 四条构建之后、`npm test` 之前加一步 `npm run build`；`npm run combo:verify` 保持在最后。CI 里 wrapper 通过 `OURFAIRY_DSH_DIR` 找到 dsh 的 tsc。若 CI 要缓存，缓存 `backend/*/dist`（连同其中的 `.tsbuildinfo`）或干脆每次 `rm -rf backend/*/dist` 后全量构建；不要只缓存 `.tsbuildinfo` 而不缓存 dist，那会触发 §2.3 的静默不产出。

### 5.3 落地顺序

1. **基础设施票**：`scripts/link-types.mjs` + `scripts/tsc.mjs`、`.gitignore` 加 `/node_modules/` 与 `backend/*/dist/`、`tsconfig.base.json`、npm scripts。根 solution 不在这张票里落：`files: []` 至少需要 `references` 里有一个项目（TS18002），所以它和第一个试点包一起出现。
2. **单包试点 `backend/http`**：`src/*.mjs` → `.ts`、相对说明符 `.js`、补 strict 注解（约 22 处）、`package.json` 的 `exports`/`files` 改 dist、根 solution 加 `./backend/http`。跑 `npm run build`、`npm test`、装 profile、`backend:doctor`，确认安装链（#200）能拿到 dist。
3. **按依赖序迁移**：`identity` → `sessions` → `spaces`/`attachments` → `chat` → `delivery`/`gateway`/`search`/`speech`/`groups` → `probe`。每包一张票，各自加 tsconfig/reference，严格模式一次到位。
4. **收口票**：`tests/` 的 import 路径切换（直接 import 后端 `src/*.ts` 还是 `dist/*.js` 是独立决定）、构建先于 `npm test`/doctor 的脚本接线、`scripts/` 的 `.ts` 直接执行与 noEmit typecheck、CI 缓存、`docs/research/README.md` 索引。

`scripts/` 的 typecheck 与 backend 不同：不进 profile、不 emit，源码说明符要用 `.ts`（Node 需要显式扩展名），tsconfig 用 `noEmit: true` + `allowImportingTsExtensions: true` + 建议的 `erasableSyntaxOnly: true`。它可以作为根 solution 的一个 `noEmit` 项目（`files: []` 的根引用 noEmit 项目是合法的，trial 里验证过），但会每次重建，等脚本迁移时再定。

## 6. 取舍

| 选择 | 推荐 | 理由 |
| --- | --- | --- |
| 根 solution + 每包 reference | 是 | 每包独立 `dist`/包身份；dsh 同形；`tsc -b` 一次构建全图 |
| 单 program | 否 | 一个 `outDir` 装不下 12 个包；跨包会丢包边界 |
| `composite` | 是 | reference 的前提；隐含 declaration + incremental |
| `declaration`/`incremental` 手写 | 否 | 已由 composite 隐含，少写少漂 |
| `rootDir` | 显式 `src` | 不写会把产物嵌成 `dist/src` 并让 exports 失配 |
| 输出 `.js` | 是 | `type: module` 下即 ESM；`.mts` 才能发 `.mjs`，与源码全 `.ts` 冲突 |
| 源相对说明符 `.js` | 是 | 无额外开关，声明文件也保持 `.js` |
| `.ts` + rewrite | 否 | 多两个开关；声明文件仍留 `.ts` |
| `types`→`dist` | 是 | 检查的就是安装产物；干净构建硬失败 |
| `types`→`src` | 否 | 消费方会编译依赖源码，类型身份偏离产物 |
| 根 `node_modules` 链接 | 是 | 与运行时同一套解析；覆盖 dsh 的深层 `.d.ts` |
| `paths` | 否 | 子路径多、dsh 包清单会漂；#195 已证脆 |
| `skipLibCheck` | `true` | 否则被 dsh 的 cosmokit 内部别名挡住；产品未用该面 |
| `preserveSymlinks` | 默认 `false` | 项目引用按 realpath；与 Node 默认一致 |
| TypeScript 来源 | dsh 检出 6.0.3 | 单一版本权威；CI 已安装 |
| 根 devDependency / lockfile | 暂不 | 会引入第二份版本权威；现在没有根安装 |
| `dist` 入库 | 否 | 构建产物；由安装链按需构建 |
| `tsc -b --clean` 作为唯一清理 | 否 | 不清手工残留；用 `rm -rf backend/*/dist` |
| `sourceMap`/`declarationMap` | 暂不开 | profile 不带 src，map 无意义；也避免 hash 抖动 |
| `strict` | `true` | 迁移本身就要补注解；false 会丢掉大部分检查 |

## 7. 实验记录

实验目录：`work/tmp/ts-build-route/`（gitignored，实验后删除）。`D=/home/eafen405/projects/deepseek-harness`，`W=/home/eafen405/projects/OurFairy/.worktrees/research-ts-build-route/work/tmp/ts-build-route`。试跑包的 `strict` 为 `false`，只为隔离构建机制；strict 的结论单独见 E4。

### E1 真实包构建通过

`final/pkgs/http` 是 `backend/http/src/http.mjs` 与 `index.mjs` 的 `.ts` 副本；`index.ts` 额外加一行 `export { bearerToken, sendJson } from './http.js'` 以覆盖相对说明符。消费方 import `@ourfairy/dsh-http/http`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-agent/session-history`、`zod`。

```sh
cd "$W/final"
node "$D/node_modules/typescript/bin/tsc" -b
```

输出：

```
EXIT=0
dist: .tsbuildinfo http.d.ts http.js index.d.ts index.js
```

`dist/index.js`：

```js
export { bearerToken, sendJson } from './http.js';
```

`dist/index.d.ts`：

```ts
export { bearerToken, sendJson } from './http.js';
```

Node 通过包 `exports` 运行产物：

```sh
node --input-type=module -e 'import { sendJson } from "@ourfairy/dsh-http/http"; import * as pkg from "@ourfairy/dsh-http"; console.log(typeof sendJson, Object.keys(pkg).sort())'
```

```
function [ 'apply', 'bearerToken', 'inject', 'name', 'sendJson' ]
```

### E2 dsh / zod / 跨包类型解析

对消费方跑 `tsc -p pkgs/consumer/tsconfig.json --noEmit --traceResolution`，逐条确认（节选，`<DSH>` 为 dsh 检出）：

```
Module name '@deepseek-ai/dsh-agent/session-history' was successfully resolved to '<DSH>/packages/core/agent/lib/types/session-history.d.ts'
Module name '@deepseek-ai/dsh-llm' was successfully resolved to '<DSH>/packages/llm/llm/lib/types/index.d.ts'
Module name '@deepseek-ai/dsh-session/surface' was successfully resolved to '<DSH>/packages/core/session/lib/types/surface.d.ts'
Module name '@deepseek-ai/dsh-tools' was successfully resolved to '<DSH>/packages/core/tools/lib/types/index.d.ts'
Module name '@deepseek-ai/schemastery' was successfully resolved to '<DSH>/vendor/schemastery/lib/types/index.d.ts'
Module name 'zod' was successfully resolved to '<DSH>/node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.d.cts'
Module name '@ourfairy/dsh-http/http' was successfully resolved to '/…/final/pkgs/http/dist/http.d.ts'
```

同时覆盖了产品 peerDependencies 里全部 17 个 `@deepseek-ai/*` 的 `typeof import()`，包括 `dsh-agent/session-history`、`dsh-llm/assistant-stream`、`dsh-session/surface`，无 TS2307。

### E3 故意错误

`pkgs/consumer/src/broken.ts`：

```ts
import type { AssistantMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
const schema = z.object({ text: z.string() })
export const wrongDsh: AssistantMessage = 1
export const wrongZod: number = schema.parse({ text: 'x' }).text
```

`tsc -b`：

```
pkgs/consumer/src/broken.ts(5,14): error TS2322: Type 'number' is not assignable to type 'AssistantMessage'.
pkgs/consumer/src/broken.ts(6,14): error TS2322: Type 'string' is not assignable to type 'number'.
EXIT=1
```

删掉 `broken.ts` 后再跑，`EXIT=0`。说明 dsh 声明与 zod 推断都真实进入了检查，不是 `any` 占位。

### E4 strict 档位

把 `final/pkgs/http/tsconfig.json` 的 `strict` 设为 `true`，`tsc -b`：

```
22 errors: 14×TS7006 (implicit any parameter), 5×TS7031 (implicit any binding element), 3×TS18046 ('error' is of type 'unknown')
```

全部在 `http.ts`（116 行），没有结构性错误。迁移注解即可，不需要改路线。

### E5 `noEmitOnError`

在 `http.ts` 末尾加 `const deliberateBuildError: number = "not a number"`，删 `dist` 后 `tsc -b`：

```
pkgs/http/src/http.ts(118,7): error TS2322: Type 'string' is not assignable to type 'number'.
pkgs/consumer/src/main.ts(1,26): error TS2307: Cannot find module '@ourfairy/dsh-http/http' or its corresponding type declarations.
EXIT=1
dist: 只剩 .tsbuildinfo（没有 js/d.ts）
```

同一实验也证明「依赖没构建好时消费方是 TS2307」，而不是悄悄通过。

### E6 `tsc -b --noEmit` 不可用

```
pkgs/consumer/tsconfig.json(8,18): error TS6310: Referenced project '/…/pkgs/http' may not disable emit.
EXIT=1
```

### E7 `--clean` 不清手工残留

```
# dist 中已有 stale.js
node "$D/node_modules/typescript/bin/tsc" -b --clean
EXIT=0
dist: stale.js 仍在
```

### E8 缺少 `rootDir`

删掉 `rootDir` 后：

```
dist/src/http.js
dist/src/index.js
dist/src/*.d.ts
consumer: TS2307 Cannot find module '@ourfairy/dsh-http/http'
```

### E9 `.ts` 说明符 + rewrite

`index.ts` 改成 `from './http.ts'`，加 `allowImportingTsExtensions`、`rewriteRelativeImportExtensions`：

```
dist/index.js:  export { bearerToken, sendJson } from "./http.js";
dist/index.d.ts: export { bearerToken, sendJson } from './http.ts';
EXIT=0
```

### E10 `types` 指向源码的备选

包 `exports` 的 `types` 改成 `./src/index.ts` / `./src/http.ts`，删 `dist` 后 `tsc -b` 仍 `EXIT=0`，trace 解析到 `src/http.ts`。这证明它可行，但也证明消费方编译的是依赖源码，故不采用。

### E11 真实 `backend/http` 源码的 noEmit 探针

不改产品代码，tsconfig 直接 include `backend/http/src/**/*.mjs`，加 `allowJs`/`checkJs`，`noEmit`：

```sh
node "$D/node_modules/typescript/bin/tsc" -p "$W/probe-real"
EXIT=0
```

在探针里加 `const broken: number = z.object({ text: z.string() }).parse({ text: 'x' }).text` 后：

```
error TS2322: Type 'string' is not assignable to type 'number'.
```

### E12 Node 24.18 的 node_modules 边界

```
# .ts 在 node_modules 外
loaded outside: 2

# 包的 exports 指向 node_modules 内的 .ts
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for files under node_modules, for "file:///…/node_modules/probe/index.ts"
EXIT=1
```

这就是「产品包必须有构建产物」的直接复现。

### E13 `preserveSymlinks` 对照

- 默认 `false` + `skipLibCheck: false`：4×TS2307，全部来自 dsh `llm-pi-ai` 的 `@deepseek-ai/cosmokit`。
- 默认 `false` + `skipLibCheck: true`：`tsc -b` 通过（推荐组合）。
- `preserveSymlinks: true` + `skipLibCheck: false`：cosmokit 不再报，但换成 `openai`、`@anthropic-ai/sdk`、`typebox`、`undici-types` 等 dsh 外部 SDK 的 TS2307；不是我们想检查的面。
- `preserveSymlinks: true` + `skipLibCheck: true`：`tsc -b` 通过，但项目引用/probe 与默认 false 相比没有收益。

### E14 构建耗时

2 个项目（http + consumer）的干净构建 1.35s，无改动增量构建 1.41s（同一台机器，含启动开销；增量没有更快是因为 `--noEmit` 消费方每次都重建，真实 12 包全 emit 的图要等试点票实测）。按这个量级，`tsc -b` 放进 precommit/CI 可接受。

### E15 `tsbuildinfo` 放包根的坑

把 `tsBuildInfoFile` 改成包根 `tsconfig.tsbuildinfo`，构建成功后只删 `dist`，再 `tsc -b`：

```
EXIT=0
dist: （空）
```

TypeScript 认为项目最新，不会补发缺失产物。故推荐 `dist/.tsbuildinfo`；若放包根，清理必须同时删 `.tsbuildinfo`。

### E16 `node:sqlite` 类型

消费方 `import { DatabaseSync } from 'node:sqlite'` 在 `@types/node` 22.20.1 下编译通过，确认 identity 迁移不需要额外 Node 类型包。

### E17 空 solution

```json
{ "files": [], "references": [] }
```

```
error TS18002: The 'files' list in config file '…/empty-solution.json' is empty.
EXIT=1
```

加一个 `references` 指向试跑 `pkgs/http` 后 `EXIT=0`。所以根 solution 必须与第一个试点包一起落地。

### E18 `files` glob 的实际打包结果

```sh
cd "$W/final/pkgs/http"
npm --cache ../../../npm-cache pack --dry-run
```

```
dist/http.d.ts
dist/http.js
dist/index.d.ts
dist/index.js
package.json
total files: 5
```

`dist/.tsbuildinfo` 不在 tarball 里，证明 `files: ["dist/**/*.js", "dist/**/*.d.ts", …]` 能满足「产物进包、构建状态不进包」。

## 8. 后续票

1. **基础设施：tsc wrapper + 链接器 + 根配置**。`scripts/tsc.mjs`、`scripts/link-types.mjs`、`.gitignore`（`/node_modules/`、`backend/*/dist/`）、`tsconfig.base.json`、空 references 的根 solution、`build`/`typecheck`/`clean` 脚本；不迁移任何源码。
2. **单包试点：`backend/http` 迁移到 `.ts`**。改 `exports`/`files`/`main`/`types`、补 strict 注解、验证安装 profile 后启动与 `backend:doctor`。这是与 #200 的交接点。
3. **其余包按依赖序迁移**：`identity` → `sessions` → `spaces`/`attachments` → `chat` → `delivery`/`gateway`/`search`/`speech`/`groups` → `probe`。每包一张票，包含 `pdf-worker.py` 的资产搬家。
4. **测试与收口**：`tests/` 的后端 import 路径切换（`src/*.ts` 还是 `dist/*.js` 单独决定）、`npm test` 前的构建接线、`scripts/` 的 `.ts` 直接执行与 noEmit typecheck、CI 缓存、`docs/research/README.md` 索引。
5. **dsh cosmokit 类型缺口（可选）**：若产品开始使用 `dsh-llm-pi-ai` 的 config 类型，在 dsh fork 里把 `@deepseek-ai/cosmokit` 声明成依赖，或在本仓生成一条只针对它的 `paths`。现在不需要。

## 9. 未决与边界

- 47 个 `src/*.mjs` 的逐包 strict 注解工作量，要等每包迁移票实测；本文只测了 `http`。
- 6 个 `backend/*/test-support/*.mjs` 不在包 `src`、不进 profile；是否转 `.ts`、由谁 typecheck，留给测试收口票。
- `tests/` 保持 `.mjs`，本文不改；它 import 后端源码的路径变化单独提交。
- `scripts/` 的 shebang、npm script 后缀、`.githooks`/`precommit` 调用方式随 scripts 迁移票定。
- CI 缓存策略、`dist`/`.tsbuildinfo` 的失效表现随基础设施/收口票定。
- 本文只提交文档；未改任何业务代码、tests、`package.json` 的 `exports`/`files`、`combo.json` 或地图 #198 的 body。
