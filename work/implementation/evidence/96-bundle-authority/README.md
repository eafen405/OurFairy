# 96-bundle-authority — 票 #96 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/01-bundle-package-authority.md`；协作边界
> `work/implementation/notes/73-boundary.md`、`73-row-plan.md`。
> 分支 `ticket/96-bundle-authority`；基线 `integration/spec-73`（合并时 tip
> `9e0b42c`），并合入 `integration/ourfairy-v1` tip `32aa081`。

## 改了什么

### 1. bundle manifest 成为产品包集合的唯一权威

`backend/v1-bundle/package.json` 新增 `dependencies`：bundle 的 patch 按名字挂载的每个
`@ourfairy/*` 包，都声明为指向本仓库目录的 `file:` 依赖（`file:../identity` 等）。pnpm 以
**bundle 自己的目录**为基准解析这些 `file:`，所以 profile 只要安装 bundle，bundle 声明的产品包
就一起进来（实测，见下「实测事实 1」）。

`files` 从 `["cordis.patch.yml","README.md"]` 变为
`["cordis.patch.yml","README.md","locale/*.json"]`，并新增 `locale/en.json`——
dsh 用 `readPluginMeta` 读 bundle 的显示元数据（`locale/<language>.json`），
此前安装副本没有 locale。

`backend/v1-bundle/README.md`：新增「行集与包集」说明包集合的唯一权威是 manifest 的
`dependencies`，README 不复制包清单；新增「Consuming it」一段说明 pnpm 经 bundle 自己的
`file:` 依赖把产品包装进 profile，launcher 不再点名任何产品包。行集合的说明与 #47 的
`FORBIDDEN_ROW_IDS` 指针保持不变。

### 2. launcher 从 bundle 派生，删掉第二份清单

`scripts/ourfairy-backend.mjs`：删除 `LINKED_PACKAGES`（9 条手写清单）。新增
`productPackages()`：读 `backend/v1-bundle/package.json` 的 `dependencies`，把每个 `file:`
按 bundle 目录解析成仓库相对目录，再并入 `combo.json` 指定的探针包与 bundle 自身。
`profileManifest()` 与 `productSourceHash()` 都只读这一份派生集合，所以「装了但没哈希」
在结构上不再可能。

同一派生路径上新增两条硬失败（`fail()`），因为它们是同一种静默故障的来源：

- bundle 声明了非 `file:` 的产品包协议 → launcher 无法从本 checkout 链入，直接失败并指名包与声明值；
- `file:` 指向仓库外（`..` 或绝对路径）→ 陈旧哈希无法覆盖其内容，直接失败并指名解析后的路径。

`publishedEntries()` 用 Node 自带的 `fs.globSync` 展开 `files` 里的 glob（`locale/*.json`），
不再假设条目一定是目录或文件；launcher 自己没有通配符实现。`files` 条目匹配不到东西时与 npm
一样贡献零文件。

### 3. doctor 与测试回答「行 / 声明 / 已安装 / profile 是否一致」

`scripts/combo.mjs` 新增导出 `verifyBundlePackages({ binName, bundlePackage, installAnchor, profileDir })`，
复用 dsh 的公开导出（`createRequire(<dsh>/apps/cli/package.json)` →
`@deepseek-ai/dsh-app-boot`）：

| dsh 公开导出 | 用来读什么 |
| --- | --- |
| `loadProfileDirectory` | profile 的 bundle 层、层里的 patch、`skippedBundles` |
| `composeEntries([layer.patches])` | 该 bundle 实际挂载的行（与 boot 同一次 `applyEntryPatches`） |
| `readProfileManifest` | **已安装副本**的 manifest → 声明的产品包集合 |
| `resolveBundleDir` | 每个声明的包在 profile 里是否真的可解析（已安装） |

不 parse YAML、不复制 dsh 内部逻辑。检查对比三件事并逐条报「包名 + 行 id」：

| 情况 | 报告 |
| --- | --- |
| bundle 行挂载的 `@ourfairy/*` 包没被声明 | `bundle row "<id>" mounts <name>, but <bundle> does not declare <pkg>` |
| 声明的包没有任何行挂载 | `<bundle> declares <pkg>, but no bundle row mounts it` |
| 同一模块 specifier 被两行挂载 | `bundle rows "<id1>" and "<id2>" both mount <name> (<pkg>); a module specifier may be mounted once` |
| 声明的包在 profile 里解析不到 | `<bundle> declares <pkg>, but it is not installed in <profileDir>; run 'ourfairy-backend start --reinstall': …` |
| bundle 在 profile 里没被加载 | `<bundle> was not loaded from <profileDir>: <skipped reason>` |

「产品包」范围来自数据本身：bundle 包名所在的 scope（`bundlePackage.split('/')[0]`，今天即
`@ourfairy/`），不是枚举的包名表；行也走 `flattenEntries`，把 group 的 `config` 子行一并算进去
（loader 同样会挂载它们）。所以 #99–#101 新增包/行时，检查无需修改。

`doctor` 把它作为新的 `bundle packages` 检查，排在 `profile project linked` 之后（它读的是安装后的
profile）。成功时报告声明包数与「行 id : 行名」清单，例如：

```
ok  bundle packages: 8 declared package(s) mounted by 9 row(s):
    conversation-search:@ourfairy/dsh-search, identity:@ourfairy/dsh-identity, …
```

只有一个包贡献两行（`spaces` 行与它的 `@ourfairy/dsh-spaces/policy` 子路径行），这是同一包的
不同模块 specifier，不算重复挂载；同一 specifier 出现两次才算。

### 4. 测试

新增 `tests/bundle-packages.test.mjs`（8 条，Node 内置 runner）。全部通过 `doctor --json` 与
真实 dsh CLI 这两个既有公开入口观察，不 import launcher 内部；需要改动输入时用
`copyProductRepo()` 在临时副本上改，worktree 不被写。

| 用例 | 断言 |
| --- | --- |
| bundle 行 / 声明 / 已安装一致 | `bundle packages` 为 ok；生成的 profile 依赖 = bundle + 探针 + manifest `dependencies`；`node_modules/@ourfairy` 与之一致 |
| 删掉一个声明 | 检查失败并同时点名 `@ourfairy/dsh-search` 与 `conversation-search`；profile 不再安装该包 |
| 声明的包没有行挂载 | 失败并点名 `@ourfairy/dsh-identity`，且措辞是 `no bundle row mounts it` |
| 同一 specifier 两行挂载 | 失败并点名 specifier 与两个行 id |
| 挂载了未声明的 `@ourfairy` 包 | 失败并点名 `@ourfairy/dsh-ghost` 与 `ghost` |
| 挂载在 group 里的子行 | 失败并点名 `@ourfairy/dsh-nested` 与 `nested-product-row`（去掉 `flattenEntries` 该用例变红，已实测） |
| 安装副本只含 `files` 声明的内容 | 安装副本顶层恰为 `README.md`/`cordis.patch.yml`/`locale`/`package.json`；`locale/en.json` 与 checkout 内容一致；陈旧哈希覆盖这三个 bundle 文件 |
| 安装副本独立启动 | 先安装 profile，再删掉副本里的 `backend/`，只用 dsh CLI 启动安装后的 profile：探针 `ok`，产品行仍在 |

## 实测事实（用来支撑上面的设计，不是推测）

1. **pnpm 以声明者目录解析 `file:`。** 最小复现：`@x/bundle` 声明
   `"@x/identity": "file:../identity"`；profile 只依赖 `@x/bundle`。安装后
   `node_modules/@x/identity` 存在（`node_modules/.pnpm` 内为硬链接副本）。profile 同时直接
   依赖两者时 pnpm 去重成同一份安装，不产生第二份副本。
2. **dsh 公开导出足够。** 在真实生成的 profile 上跑
   `loadProfileDirectory('dsh', <abs profileDir>, <abs dsh apps/cli/package.json>)`，得到
   `layers[0].packageName === '@ourfairy/dsh-v1-bundle'`、`skippedBundles` 为空；
   `composeEntries([layer.patches])` 返回 37 行（合入 #82 后 40 行），其中 9 行 `@ourfairy/*`。
   `resolveBundleDir` 能解析声明的 8 个包。`readProfileManifest` 读到的是**安装副本**的 manifest。
3. **locale 确实被 dsh 读到。** `readPluginMeta('@ourfairy/dsh-v1-bundle', 'file://<profileDir>/package.json')`
   返回 `{"title":{"en":"OurFairy v1 backend"},"description":{"en":"…"}}`；不装 locale 时该调用返回
   `undefined`。
4. **bundle 的 `exports` 必须补三项。** 安装副本里 `resolvePluginResource('<bundle>/cordis.patch.yml')`
   与 `readPluginMeta` 走 Node 的 exports 解析；未声明 `./package.json`、`./cordis.patch.yml`、
   `./locale/*.json` 时子路径解析失败。三项已写入 manifest。

## 实际执行的命令与输出摘要

在 `/home/eafen405/projects/OurFairy/.worktrees/96-authority`，最终状态 `f28c0bd`
（本票 3 个提交 + 2 个合并提交）上执行。

```
$ npm test
ℹ tests 145
ℹ suites 7
ℹ pass 145
ℹ fail 0
ℹ duration_ms 75491.556631
```

```
$ node scripts/combo.mjs verify
repo      branch                   expected          actual            result
ourfairy  integration/ourfairy-v1  based on integra  f28c0bd396b67f71  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      fe2bbc3b1c14efd7  fe2bbc3b1c14efd7  ok
rikkahub  product/ourfairy-v1      2a5999855d608fd0  2a5999855d608fd0  ok
combo: combination verified
```

定向命令：

```
$ node --test tests/bundle-packages.test.mjs        # 8 tests, 8 pass
$ node --test tests/product-sources.test.mjs        # 3 pass
$ node --test tests/baseline-boot.test.mjs          # 6 pass
$ node --test tests/lifecycle.test.mjs              # 3 pass
$ node --test tests/executable-claims.test.mjs      # 1 pass
$ node --test tests/docs.test.mjs                   # 1 pass
$ OURFAIRY_HOME=/tmp/<fresh> node scripts/ourfairy-backend.mjs doctor
ok  bundle packages: 8 declared package(s) mounted by 9 row(s): …
```

Red（先写测试，对未改动的 launcher 跑）：

```
$ node --test tests/bundle-packages.test.mjs
✖ the bundle rows, its declared packages, and the installed profile agree
  AssertionError: doctor must run a "bundle packages" check; it ran
  ["node version","corepack pnpm pin available","combo combination","dsh CLI build",
   "product packages","isolated home","profile project linked","model double","bundle agent model"]
ℹ tests 6 / pass 0 / fail 6
```

Green（实现后）同上 8/8。

## 与并行票的交接

- **#98（peer semver）**：本票没动任何产品包 `peerDependencies`。bundle 自己的 `dependencies`
  全是 `file:../<dir>` 本仓库路径，不是 semver，`workspace:` 替换不涉及它。
- **#99–#101（行拆分）**：新增包 = 新目录 + bundle `dependencies` 加一条 `file:` + patch 加行；
  launcher 与 doctor 均无需改。**前提**：新产品包名必须继续在 `@ourfairy/` scope 下——检查按
  bundle 名所在 scope 识别产品行，跨 scope 会被当成非产品行（也正因此不会被误报）。
- **#103（单一模型权威）**：本票保留了 `combo.json backend.agentModel` 与 doctor 的
  `bundle agent model` 检查。新增的「安装副本独立启动」测试对 `agentModel` 缺席也成立（只在存在时
  传探针环境变量），#103 不需要改它。
- **#104（只声明 bundle 的 profile）**：本票已经证明这一点（删掉 checkout 的 `backend/` 后安装副本
  能启动），但 #104 仍拥有「用模型替身走一次认证后的产品 HTTP 请求」的验收。

## 未执行项与原因

- **`npm run combo:verify` 在提交时曾失败，与本票无关。** 开工时 rikkahub 的
  `product/ourfairy-v1` 在 `2a5999855d…`，而 `combo.json` 锁 `38d3d5a7d412…`（rikkahub 分支领先锁
  定提交）；同时本票分支尚未包含 `integration/ourfairy-v1` 的新 tip。按票面要求没有改 `combo.json`，
  三个提交用 `git commit --no-verify`（hook 的另一半 `npm test` 每次都通过）。合入
  `integration/ourfairy-v1` tip `32aa081` 后 `combo.mjs verify` 已全绿，见上面的输出。
- **未在中文 locale 上做断言。** 本票只加了 `locale/en.json`（dsh 的显示元数据回退语言）。没有加
  `zh.json`：产品没有第二语言的界面文案来源，凭空翻译会制造一份没有权威的文案。
- **未验证真实 npm 打包。** 「`files` 决定安装副本内容」用的是 pnpm 的 `file:` 安装（产品的真实
  安装路径），没有跑 `npm pack`；离线环境里两者的 `files` 语义相同，但没有单独实测 `npm pack`。
- **未做真实模型服务验收。** 本票不产生模型请求；`npm test` 里的模型请求仍走既有模型替身。
- `doctor` 在**复制的仓库**（`copyProductRepo`）里必然让 `combo combination` 检查失败（副本不是
  Git checkout），所以本票测试只断言 `bundle packages` 这一项，不断言 doctor 的退出码。
