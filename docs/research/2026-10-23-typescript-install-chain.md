> 2026-10-23 状态：日期化记录。本文记录 2026-10-23 的判断，不描述当前实现。

# 安装链与构建产物：files、productSourceHash、模板与 doctor

日期：2026-10-23。产品检出 `main` @ `eb7c2a6c58`（`git rev-parse HEAD`），实验期间未改本仓。dsh 检出 `/home/eafen405/projects/deepseek-harness` @ `d1b6099ae716870a2afba705a2c90415408a69f5`，与 [`combo.json`](../../combo.json) 的 `repos.dsh.productCommit`（`combo.json:18`）一致，工作树干净。运行环境：Node `v24.18.0`；pnpm 经 `corepack pnpm@11.28.5`；构建实验用 dsh 自带的 `tsc`（`node_modules/.bin/tsc --version` → `Version 6.0.3`，dsh `package.json:283`）。

方法：读组合层、启动器与 combo 脚本（`scripts/ourfairy-composition.mjs`、`scripts/ourfairy-backend.mjs`、`scripts/combo.mjs`）及相关测试；在 `.worktrees/scratch-200/`（`.gitignore:3` 忽略）的最小 fixture 上直接调用组合函数；用 pinned pnpm 在一次性目录复现 `file:` 安装；用 dsh 的 tsc 做构建实验；在仓库的临时副本上跑真实 `doctor` 与 `probe`。本仓源码、测试、`package.json`、`combo.json` 与地图均未改动。

实验编号（下文按号引用）：

| 号 | 内容 |
| --- | --- |
| E1–E9 | fixture 上 `productSources` / `publishedEntries` / `productSourceHash` 的四种 `dist` 状态与漂移 |
| E10 | fixture 上 `installDecision` 的 stamp / 模板 / `clean` 时序 |
| E11 | pinned pnpm 的 `file:` 安装（`files`、空 `dist`、`main` always-include、陈旧内容） |
| E12 | dsh tsc 6.0.3 的构建产物、确定性、孤儿输出与并发 |
| E13–E15 | 真实 doctor / probe：缺产物时 doctor 绿、启动失败 |
| E16 | 真实 doctor / probe：构建出的 `dist` 包能安装并启动 |
| E17 | 现有 manifest 的 `main`/`exports` 是否被 `files` 覆盖 |

## 结论

1. **哈希构建产物，不哈希源码 + tsconfig。** 现有 hash 的语义是「profile 里那份拷贝的内容」：模板目录名只由 hash 决定，`installDecision` 的 `copy` 分支只信模板存在（`scripts/ourfairy-composition.mjs:351-353,370-381`），注释把它写成「installed tree is a pure function of the hash」（`:360-363`）。若改成哈希源码 + tsconfig，hash 描述的是输入、install 复制的是 `dist`：一个未重建的旧 `dist` 会以「当前输入」的 hash 装进 profile，并发布同 hash 的共享模板，之后同输入、不同产物的构建会命中这份旧模板。实测 pnpm 在 `node_modules` 未删除时不会刷新 `file:` 内容（E11.5），旧产物不是理论风险。
2. **build 必须在第一次 hash 之前完成。** `installProfile` 在决定 `cached/copy/install` 之前同步构建，失败即终止；`doctor` 的「product packages」检查（也读 `productSources`）之前同样要先构建。构建属于启动器进程层（`scripts/ourfairy-backend.mjs` 已持有 `child_process`），不能进零 spawn 的组合层；`installDecision` 仍是纯函数。`backend:start` 缺 `dist` 时，构建失败是构建器 stderr，构建被绕过时是组合层的前置断言（§3）。
3. **`files` 指向 `dist` 而 `dist` 缺失或为空时，「没有产物」与「内容没变」不可区分，必须硬失败。** `publishedEntries` 对缺失目录返回 `[]`，对空目录也返回 `[]`；`productSourceHash` 因此只哈希 `package.json` 等非产物文件，得到一个合法但「没有运行产物」的 hash（E1/E2/E9）。pnpm 对这种包照常安装成功、只少复制 `dist`（E11.1/E11.2）；launcher 写出该 hash 的 stamp 并发布同 hash 模板（`scripts/ourfairy-backend.mjs:196-202`）；doctor 全绿（E13），直到真实启动才以 `ERR_MODULE_NOT_FOUND` 失败（E15）。修法：`productSources` 在展开某个 `files` 条目得到 0 个文件时抛错，消息点名包、条目与补救命令；错误会在 pnpm 之前出现。
4. **模板缓存不需要新机制，失效由产物 hash 自动承担。** 模板键 = `productSourceHash` + `pnpmPin`（`composition.mjs:351-353`），只在安装成功后发布（`:410-421`，`ourfairy-backend.mjs:196-202`）；`dist` 内容一变 hash 就变，旧模板不可达（只占磁盘；`.ourfairy-template/` 已在 `.gitignore:25`）。前提是 hash 覆盖「安装真正复制的每个文件」：pnpm 对 `main` 指向的文件**总是**复制，即使不在 `files` 里（E11.6）；当前所有包的 `main`/`exports` 目标都落在自己的 `files` 条目内（E17），迁移后要保住并把它变成断言。
5. **半迁移可以启动，但只允许「包内原子」。** 每个包必须把 `.ts` 源码、构建配置、`main`/`exports`、`files` 指向 `dist` 放在同一步；「`files` 已指 `dist`、`main` 仍指 `src`」的半状态会让 pnpm 只复制 `main` 一个文件（E14：`chat/src/index.mjs` 在场、`service.mjs` 缺失），启动失败。包与包之间可以分批，因为 profile 是拷贝：只要每个包改动后自洽、构建产物存在，混合树就能启动与测试。`npm test` 的结构裁判（`tests/product-sources.test.mjs:83-92,151-171`、`tests/bundle-packages.test.mjs:269-297`）在半状态下**响亮失败**；真正静默的是 `npm run combo:verify`（不读 hash、不安装）与缺产物时的 doctor（E13）。

## 1. 哈希什么：产物，不是源码 + tsconfig

### 1.1 现状机制（逐个函数）

- `productSources(root)`（`composition.mjs:235-245`）从 bundle manifest 派生产品包，对每个包的 `files` 做展开，并加上总是发布的 `package.json`（`:238-239`）。
- `publishedEntries(dir, entry, root)`（`:260-270`）用 `node:fs.globSync` 匹配 `files` 条目；目录递归列出、只留文件。注释明确「匹配不到就发布不了东西，npm 同样静默跳过」（`:250-257`）——这是缺产物被静默吞掉的入口。
- `productSourceHash(root)`（`:297-306`）对 `PROFILE_IMPORT_METHOD` + 每个相对路径 + 文件内容做 sha256；路径集合来自 `productSources`，排序稳定。
- `profileTemplateDir(root, hash)`（`:351-353`）= `<root>/.ourfairy-template/<hash>-<pnpmPin>`。
- `installDecision`（`:370-382`）：stamp 与当前 hash 相同且 linked manifest 存在 → `cached`；否则同 hash 模板存在 → `copy`；否则 `install`。
- `installProfile`（`ourfairy-backend.mjs:159-203`）：`writeProfile` → `installDecision` → `copy` 或 pnpm install → `publishProfileTemplate` → `writeSourceStamp`。

### 1.2 实验：`files: ["dist"]` 的四种状态

fixture：`backend/alpha/package.json` 有 `files: ["dist","README.md","locale/*.json"]`、`main: ./dist/index.js`；`productSources` 还覆盖 bundle/probe/各 `package.json`。命令：

```sh
node .worktrees/scratch-200/probe.mjs .worktrees/scratch-200/compo-fixture backend/alpha dist
```

| 状态 | `publishedEntries('backend/alpha','dist')` | alpha 进入 hash 的文件 | hash（sha256，前 12 位） |
| --- | --- | --- | --- |
| E1 `dist` 不存在 | `[]` | `package.json`、`README.md`、`locale/en.json` | `82ea6e61852d` |
| E2 `dist` 是空目录 | `[]`（glob 命中目录，递归 0 个文件） | 同上 | `82ea6e61852d`（与 E1 相同） |
| E3 `dist/index.js` | `['backend/alpha/dist/index.js']` | 多出该文件 | `a01132b17ee4` |
| E4 改 `dist/index.js` 内容 | 同上 | 同上 | `6b497c65cb50` |

E9 单独复跑 E1/E2 的等式：`empty-dist hash = missing-dist hash = 82ea6e61…`。E7 在 `dist` 里多放一个陈旧产物 `legacy.js`，hash 变成 `06cd43a9c84e`，该文件也进入要安装的集合。

注意 `package.json` 本身总被哈希（`composition.mjs:238-239`），所以把 `main`/`exports` 从 `src` 改到 `dist`、即使 `dist` 没建，也会因 manifest 变化而改 hash——这只会把「坏安装」包装成一次正常的 `install`，不会自动发现缺产物。哈希覆盖不到的是「`files` 条目命中 0 个文件」这件事本身，必须靠断言。

直接观察 glob（`glob-detail.mjs`）：缺失时 `matches=[]`；空目录时 `matches=['dist']`、`recursive=[]`；有一个文件时 `recursive=['index.js']`。所以「命中目录」不等于「有内容」，空目录与缺失在 `productSources` 和 pnpm 复制上完全等价。

### 1.3 为什么不是「源码 + tsconfig」

- hash 的两个消费者都把它当内容身份：stamp 在安装后写入同一 hash（`ourfairy-backend.mjs:179,201`），模板目录名只用 hash（`composition.mjs:351-353`），`copy` 分支不再校验内容（`:378-379`）。
- 若哈希输入是源码 + tsconfig，则「`dist` 是否由这些输入构建出来」没有任何断言；`dist` 缺失或更旧都不改 hash，launcher 会认为 profile 最新，或安装一份旧产物并盖上「最新」stamp。模板以「输入 hash」为键跨 home 共享，污染面更大。
- 哈希产物后，tsconfig 变化是否重装由「是否改变输出」决定：改了输出 → hash 变 → 重装；没改输出 → 不重装。这正是想要的语义（模板是安装树内容的函数，不是构建配置的函数）。
- 例外要一起定（见 #199）：tsc 版本来自 pinned dsh，dsh 升级后同样源码可能产出不同 `dist`；产物 hash 自动覆盖，输入 hash 覆盖不到。

### 1.4 源码/tsconfig 改变而构建未跑

E5：只新增并改写 `backend/alpha/tsconfig.json`（不在 `files` 里），hash 不变。E6：新增并改写 `backend/alpha/src/index.ts`，hash 同样不变。这两条本身正确——它们没有进入安装树；危险的是它们会改变下一次构建的产物，而 launcher 只看得到已构建的 `dist`。因此「build 先于 hash」不是可选优化，而是产物 hash 的必要前提（§2）。E10 是这个缺口的模板侧演示：先在有 `dist` 时写入 stamp，再删掉 `dist`，`installDecision` 从 `cached` 变成 `install`；给无产物 hash 放一份模板后，决策变成 `copy`，即「安装一份没有 `dist` 的树」是可到达的状态。

### 1.5 模板缓存如何失效

- 键：hash + `pnpmPin`（`:351-353`）；hash 变 → 新目录。旧模板不删除、也不再被任何决策命中（`profileTemplateDir` 只按当前 hash 计算）。
- 发布时机：只在 pnpm 安装成功且 linked manifest 存在之后（`ourfairy-backend.mjs:196-201`）；半拷贝用 staging + rename（`composition.mjs:410-421`）。
- 唯一能污染模板的路径是「hash 没有完整描述安装树」：缺产物（E1/E2），或 `files` 之外被 pnpm 强制复制的 `main` 文件（E11.6）。前者由结论 3 的断言堵住，后者由 main/exports 覆盖断言堵住（§3.5）。
- `OURFAIRY_NO_TEMPLATE=1` 只关闭「使用模板」的决策（`ourfairy-backend.mjs:166`）；安装成功后仍会发布模板（`:200`）。所以缺产物时的硬失败必须发生在 pnpm 之前，否则仍会发布一份坏模板。

## 2. 时序：build 在 hash 前、install 前

### 2.1 单点漏斗与现有顺序

四个会触发安装的命令都落到 `installProfile`：`probe`（`ourfairy-backend.mjs:243-246`）、`boot-product`（`:291-294`）、`start`（`:455-458`）、doctor 的「profile project linked」检查（`:680-683`）。`resolveDsh` 在这些命令里先执行（`:132-150`），所以构建器（dsh 的 tsc）在安装前一定可用；dsh 的 `node_modules` 缺失时，`dsh CLI build` 检查或 `resolveDsh` 会先失败。

doctor 的检查顺序有坑：`product packages`（`:673-679`，读 `productSources`）在 `profile project linked`（`:680-683`，触发安装）之前。若构建只放在 `installProfile` 里，product packages 会在构建前哈希。因此构建要么在 doctor 中作为显式检查排在 product packages 之前，要么把 product packages 移到安装之后。

### 2.2 推荐时序

1. `resolveDsh`（已存在）→ 2. 构建产品包（各包 `rm -rf dist` 后 `tsc -b`，具体形态由 #199 定）→ 3. `writeProfile` → 4. `installDecision`（唯一一次 `productSourceHash`）→ 5. `copy` 模板或 pnpm install → 6. 发布模板 + 写 stamp → 7. 启动。

构建放在 `installProfile` 的第一行，并在 `commandDoctor` 里作为独立检查（如「product build」）排在 `product packages` 之前；`installProfile` 里的构建对 doctor 是幂等 no-op。构建失败即 `fail`，不进入 hash/install；doctor 通过 `check()` 的 try/catch 记录成失败检查、其余检查继续（与现有安装失败测试一致，`tests/lifecycle.test.mjs:152-175`）。

`npm test` 增加 `pretest` 构建：`node --test` 默认按 `os.availableParallelism() - 1` 并行执行测试文件（`/usr/share/doc/nodejs/api/cli.md:2516-2528`），本仓有 11 个测试文件、33 处 `runBackend(...)` 驱动真实 launcher（`tests/helpers/backend.mjs:122-137`；部分传副本，部分默认本仓）。先构建好，并行测试里的 launcher 构建才都是只读 no-op，不会在同一根上同时做真实构建。

### 2.3 为什么不在组合层构建

`composition.mjs` 的模块注释把「只 import `node:fs/path/crypto/os`、绝不 `child_process`」当作零 spawn 边界（`:11-16`），但注释也承认「no behavioural test asserts it」（`:16`）。把构建放进组合层会让 `installDecision`/`productSources` 从纯函数变成有副作用的函数，也破坏 `tests/product-sources.test.mjs` 直接 import 组合函数做断言的接缝。构建属于 `ourfairy-backend.mjs` 的进程层。

### 2.4 pnpm `file:` 安装的实测

用 `corepack pnpm@11.28.5 install --ignore-scripts --package-import-method copy --store-dir <scratch>`，consumer 依赖 `"@ourfairy/dsh-alpha": "file:../producer"`：

| 实验 | producer 状态 | 结果 |
| --- | --- | --- |
| E11.1 | `files:["dist"]`，无 `dist` | 安装成功；profile 里只有 `package.json`/`README.md`/`locale`，无 `dist` |
| E11.2 | 空 `dist` 目录 | 安装成功；不创建 `dist`（空目录不复制） |
| E11.3 | `dist/index.js` | 安装成功；`dist/index.js` 是真实副本 |
| E11.4 | `tsconfig.json` 不在 `files` | 不复制（构建配置不泄漏进 profile） |
| E11.5 | 改 `dist/index.js` 内容后不删 `node_modules` 重装 | pnpm 输出 `Already up to date`，安装副本仍是旧内容 |
| E11.6 | `main: ./src/index.js` 不在 `files`（`files:["dist"]`） | pnpm **仍然复制** `src/index.js`（npm pack 的 always-included `main`） |

E11.5 解释了 `installProfile` 为什么在 install 前 `rm -rf node_modules`（`ourfairy-backend.mjs:183-185`）；E11.6 是「hash 必须覆盖安装树」的反例来源。

## 3. doctor、installed-set、`.gitignore` 与空目录 glob

### 3.1 两个检查读的不是同一份东西

- 读 `files` 的是 `product packages`（`ourfairy-backend.mjs:673-679`）：只把 `productSources` 拼成 detail，**不会**校验 pnpm 装出来的副本里有没有这些文件。
- `bundle packages`（`combo.mjs:401-484`）读安装后的目录与 manifest：`installedProductPackages` 枚举 `<profileDir>/node_modules/<scope>/*`（`:303-312`），再用 dsh 自己的 patch loader 对账行与声明；它不 import 模块，也不看 `files`。所以地图里「doctor 的 installed-set 检查与 `files` 对账」需要修正措辞：installed-set 是**目录级**的，缺 `dist` 完全看不见。
- `plugin compatibility`/`native capabilities` 同样只读 manifest 与 loader 组合，不执行模块。

### 3.2 端到端证据：doctor 绿、启动失败

仓库临时副本上把 `backend/chat/package.json` 的 `files` 改成 `["dist","README.md","locale/*.json"]`，保留 `main: ./src/index.mjs`，不构建 `dist`，跑真实 doctor（新 home）：

```
ok   product packages :: backend/attachments/…, backend/chat/package.json, …
ok   profile project linked :: …/e2e-home2/dsh-home/profiles/ourfairy (installed)
ok   bundle packages :: 11 declared package(s) mounted by 16 row(s): …
ok   plugin compatibility :: 13 installed product package(s) compatible with dsh 0.2.1-rc.2
```

（唯一失败是拷贝不是 git 检出导致的 `combo combination`，与本实验无关。）安装后的 `@ourfairy/dsh-chat` 只有 `package.json`/`README.md`/`locale`/`src/index.mjs`：`main` 被 always-include，相对导入的 `service.mjs` 不在。随后 probe：

```
chat (@ourfairy/dsh-chat): failed to import: Error [ERR_MODULE_NOT_FOUND]:
Cannot find module '…/node_modules/@ourfairy/dsh-chat/src/service.mjs'
imported from '…/node_modules/@ourfairy/dsh-chat/src/index.mjs'
…
- bundle product row "chat" (@ourfairy/dsh-chat) is not active (fiber absent)
```

紧接着的第二次 doctor 对该 home 报 `profile project linked (cached)`，其余产品检查仍全绿——坏 profile 被 stamp 固化，直到启动才暴露。这与 #194 的结构性盲区同型（那里 doctor 全绿，而 `.ts` 包启动时报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。

### 3.3 正向对照：构建产物确实能装、能启动

另一份临时副本里加一个最小产品包 `backend/ts-artifact-probe`：`src/index.ts` 只导出 `name`/`inject`/`apply`，`package.json` 设 `"type":"module"`、`main`/`exports` 指向 `./dist/index.js`、`files:["dist"]`。用 dsh 的 tsc 构建：

```sh
/home/eafen405/projects/deepseek-harness/node_modules/.bin/tsc -p backend/ts-artifact-probe/tsconfig.json
# → backend/ts-artifact-probe/dist/index.js
```

把它加入 bundle 依赖与一行 row 后：doctor 的 `product packages`/`profile project linked (installed)`/`bundle packages`（12 包 17 行）全绿；安装副本只有 `dist/index.js` 与 `package.json`；probe 退出 0，`report.ok=true`，行状态：

```json
{"id":"artifact-probe","name":"@ourfairy/dsh-artifact-probe","disabled":false,"fiberState":"active"}
```

这一步（E16）补上了 #194/#195/#196 没有验证的缺口：**构建产物经 `file:` 安装进 profile 后可以正常启动**（单包最小样本，不是 53 文件的真实迁移）。

### 3.4 空目录/缺失目录的 glob 行为

`globSync('dist', {cwd})`：目录不存在 → `[]`；空目录 → `['dist']`（命中目录本身）；`readdirSync(..., {recursive:true})` 对空目录 → `[]`。因此 `publishedEntries` 两种情况都返回 `[]`，`productSourceHash` 得到同一个值（E1/E2/E9）。pnpm 侧同样：空目录不复制、缺失也不报错（E11.1/E11.2）。

### 3.5 `.gitignore` 与 hash 覆盖不变量

现状（`git check-ignore`）：`/node_modules`、`backend/*/dist`、`*.tsbuildinfo`、根 `tsconfig.json` 都**不在**忽略列表；`.ourfairy-template/` 已忽略（`.gitignore:25`），`.worktrees/` 已忽略（`:3`）。迁移前要补 `/node_modules/`、各包 `dist/`、`*.tsbuildinfo`（或 per-package），并像 `tests/android-source.test.mjs` 那样加一条结构断言，避免构建产物被误提交。

E17 的只读检查（遍历 `productPackageDirs()`，用 `publishedEntries` 对账每个 `main`/`exports` 目标）：当前 11 个产品包的所有目标都落在自己的 `files` 内（`exports["./package.json"]` 由 `productSources` 显式加入，`composition.mjs:238-239`）。这条不变量在迁移后必须保持，因为 pnpm 会复制 `main` 指向的文件而不管 `files`（E11.6）。

## 4. 半迁移期是否允许启动

允许，但只允许自洽的包。判据：

1. 对一个包，`main`/`exports` 指向的文件必须由 `files` 条目发布（或就是 `package.json`）；`files` 的每个条目必须至少发布一个文件（否则结论 3 的断言失败）。
2. 一个包的 `.ts` 源码、构建配置、manifest 指向、`dist` 产出必须同一步落地；不允许「`files` 先改 `dist`、源码/`main` 后改」的中间提交。E14 就是这个半状态：`main` 仍指 `src/index.mjs`，pnpm 只复制了它，相对导入缺失，probe 失败。
3. 包与包之间可以分批：profile 是拷贝，只要每个包在提交时自洽且有构建产物，混合树（部分包直发 `.mjs` 源码、部分包装 `dist`）可以启动，`npm test` 与 `doctor` 都能跑。`scripts/` 不进 profile，可以独立迁移。

迁移期哪些命令能兜底：`npm test` 里启动真实后端的用例（`tests/baseline-boot.test.mjs`、`tests/start-readiness.test.mjs`、`tests/bundle-only-profile.test.mjs` 等）会在缺产物时失败；`doctor` 在没有前置断言时**不会**（§3.2）；`combo:verify` 只比对版本组合，不读 hash、不安装，全程无感。因此 gate 的顺序应是 build → test/doctor，而不是反过来。

## 5. 会静默失效的测试/命令，与断言应加在哪里

| 面 | 现状 | 改 `files`→`dist` 后 | 应在哪里失败 |
| --- | --- | --- | --- |
| `doctor` 的 product packages / bundle packages / plugin compatibility | 全绿（E13） | 缺 `dist` 仍全绿，stamp 固化坏 profile | 在 `productSources` 的 0 文件断言处失败；doctor 记录为失败检查。新增单测：删副本某包 `dist` 后 doctor 必须失败并点名包+条目 |
| `npm run combo:verify` | 绿 | 与 hash/安装无关，永远绿 | 不指望它；迁移 gate 必须有 build/test/doctor |
| `tests/product-sources.test.mjs:83-92` | 期望 `src/` 下每个文件被哈希 | `files` 不再含 `src`，`copiedSources` 断言失败（响亮） | 把期望改成 `dist/`，不要删除。新增「`files` 条目 0 文件时 `productSources` 抛错」 |
| 同文件 `:151-171` | 新增 `src/*.mjs` 必须改变 hash | 会失败（响亮） | 改成新增 `dist/*.js` 改变 hash；保留「新增产物 → `install`」 |
| 同文件 `:174-208` 模板 fixture | 手写模板目录 + 当前 hash | 若副本无 `dist`，新断言先抛错（响亮） | fixture 需先构建或复制 `dist`，否则断言失去意义 |
| `tests/bundle-packages.test.mjs:269-297` | 每个 `files` 条目至少发布一个真实文件 | **正好**抓住缺/空 `dist`，但只在 `npm test` 里跑 | 保留；补一条：`main`/`exports` 目标必须被 `files`（或 `package.json`）覆盖 |
| `tests/bundle-packages.test.mjs:203-231` | 断言 bundle 安装副本的精确文件列表 | bundle 无 TS，不受影响；将来若 bundle 有 `dist` 会响亮失败 | 保留 |
| `tests/composition-module.test.mjs` | 只测准入规则，未测零 spawn 边界（模块注释自认 `composition.mjs:16`） | 若把构建塞进组合层，没有任何测试失败 | 加一条源码扫描断言（组合模块不得 import `child_process`、不得调用 `spawn`），失败在 `composition-module.test.mjs` |
| `tests/launcher-import.test.mjs:23-47` | import 必须无副作用、且不读 `combo.json` | 构建若放在模块加载期会在这里响亮失败 | 保留；构建只能发生在 `main()` 之后 |
| `tests/helpers/backend.mjs:104-110` `copyProductRepo` | 只复制 `backend/scripts/combo.json/package.json` | 根 `tsconfig`/构建脚本不在副本里：副本 launcher 无法构建（响亮），或被误以为没有构建输入 | 把根构建配置加进复制清单；或在 #199 决定 per-package 配置（随 `backend/` 自动复制） |
| `tests/lifecycle.test.mjs:152-175` | 断言 doctor 记录安装失败 | 构建失败会先失败在更早的检查；测试仍应绿，但消息断言可能失配 | 新检查名/消息要在测试里显式断言 |
| `npm test` 的 docs-only 门（`scripts/precommit.mjs:28-33`） | 文档提交只跑 docs+combo:verify | 与安装链无关；不要把它当迁移 gate | 无需改 |

## 6. 改动清单（文件 + 函数）

**组合层（`scripts/ourfairy-composition.mjs`）**

- `productSources`（`:235-245`）：对每个 `files` 条目，`publishedEntries` 返回空数组时 `throw`，消息包含包目录、条目和补救命令（如 `run 'npm run build'`）。`publishedEntries` 保持 npm glob 语义不变，便于单测。
- `productSourceHash`、`profileTemplateDir`、`installDecision`、`copyProfileTemplate`、`publishProfileTemplate`、`writeSourceStamp`：**不改**。hash 继续取 `productSources`。
- 可选：新增只读辅助 `uncoveredManifestTargets(root)` 供测试断言 `main`/`exports` 覆盖；若不想扩 API，断言直接写在测试里。

**进程层（`scripts/ourfairy-backend.mjs`）**

- 新增 `buildProducts(combination)`（或等价名）：解析 dsh 的 tsc 路径，`rm -rf` 各包 `dist` 后同步构建；失败 `fail` 并附 stderr 尾部与 `combo.json` 的 requiredBuild 提示。
- `installProfile`（`:159-203`）：第一行调用 `buildProducts`；其余不变（`writeProfile` → decision → install → publish → stamp）。
- `commandDoctor`（`:617+`）：新增「product build」检查，排在「dsh CLI build」之后、「product packages」之前；`check()` 会把它记成一行失败而不是整份报告消失。
- `commandProbe`/`commandBootProduct`/`commandStart`：无需改（都走 `installProfile`）。

**包与仓库配置**

- 根 `package.json`：新增 `build`（`tsc -b`，具体形态由 #199 定）与 `pretest`（先 build 再 `node --test`）；`backend:*` 脚本可保持不变（launcher 自己构建）。
- `.gitignore`：`/node_modules/`、`backend/*/dist/`（或 `**/dist/` 的等价最小集合）、`*.tsbuildinfo`。
- 各包 `package.json`：迁移时 `main`/`exports`/`files` 一起指向 `dist`；`files` 不含 `tsconfig`、`*.tsbuildinfo`、`src`。

**测试（独立裁判，只改路径与期望，不改行为断言）**

- `tests/product-sources.test.mjs`：`copiedSources` 从 `src/` 改为 `dist/`；新增产物文件的 hash 变化用例；新增「0 文件条目抛错」。
- `tests/bundle-packages.test.mjs`：保留 `:269-297`；新增 main/exports 覆盖断言；新增「删副本 `dist` → doctor 失败」。
- `tests/composition-module.test.mjs`：加零 spawn 源码断言。
- `tests/helpers/backend.mjs`：`copyProductRepo` 增加构建输入（根 tsconfig 或构建脚本清单）。

## 7. 失败形态一览

| 状态 | hash | 安装 | doctor | 启动 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `dist` 缺失 | 合法 H0（无产物） | 成功但无 `dist` | 绿 | `ERR_MODULE_NOT_FOUND`（E15） | 必须被断言阻断 |
| `dist` 空目录 | = H0 | 成功，无 `dist` | 绿 | 同上 | 与缺失不可区分 |
| `dist` 内容变 | 新 H1/H2 | 新模板/重装 | 绿 | 新产物 | 正确 |
| `clean` 删 `dist` 未构建 | 回 H0 | 触发重装（非 cached） | 绿 | 可能坏 | 构建先于 hash 时，确定性重建回 H1 → cached |
| 只改源码/tsconfig、未构建 | 不变 | `cached`，旧产物 | 绿 | 旧代码 | 只有「每次启动先构建」能防；`pretest` 只保护测试 |
| 删源码后重建（不 clean） | 变（含孤儿产物） | 重装并携带孤儿 | 绿 | 旧模块文件仍在 | 构建必须先 `rm -rf dist`（E12.3/E12.4：`tsc -b --clean` 也不删孤儿） |
| `files`→dist 且 `main`→src | 覆盖缩水 | 只复制 `main` | 绿 | 相对导入缺失（E14） | 包内原子迁移 + main 覆盖断言 |
| 构建产物是 `.js` 但包无 `"type":"module"` | 覆盖正常 | 正常 | 绿 | ESM 语法按 CJS 解析失败 | 由 #199 的模块格式决定；本文未实测 |

构建实验补充（dsh tsc 6.0.3）：`tsc -b` 在 `allowImportingTsExtensions`+`rewriteRelativeImportExtensions` 下把 `./b.ts` 重写成 `./b.js`（E12.1），输出可直接运行；删 `dist`+`tsbuildinfo` 重建的产物 hash 与首次一致（E12.2：`5e8487879bd2`），说明「确定性重建 → 同 hash → cached」成立；删一个源码后 `tsc -b` 不删除它的旧产物，`tsc -b --clean` 也没删掉孤儿（E12.3/E12.4），所以构建脚本必须自己清 `dist`。E12.5 的三轮两进程同根构建都退出 0，但这不是并发安全性证明。

## 8. 未验证与边界

- 「所有现有测试在迁移后仍绿」未验证：本文未改代码，也未真迁移 53 个文件；只验证了安装链的机制与一个最小构建包。
- 构建产物启动用的是**单包最小样本**；11 个真实包同时以 `dist` 安装后的行组合、配置 schema 等不在本文范围。
- 并发 `tsc -b`：3 轮两进程同根构建都退出 0（E12.5），不是安全性证明；`npm test` 的 `pretest` 构建是为了让并行测试里的构建成为 no-op，避免把未证明的并发写当作设计前提。
- Node 22.19 的行为引自 #194 的复跑记录；本文只在 Node 24.18 上实验。
- 构建命令、`dist` 布局、`tsconfig` 归属、`type`/模块格式、`.tsbuildinfo` 位置由 #199/#203 决定；本文只固定它们与 hash/安装/模板的时序关系。
- 地图 #198 的「doctor 的 installed-set 检查与 `files` 对账」应按 §3.1 修正措辞：读 `files` 的是 product packages 检查，installed-set 是目录级、看不见缺产物。

## 9. 后续票建议（不属本票范围）

1. 实施票：安装链守卫与构建前置（组合层 0 文件断言 + launcher `buildProducts` + doctor 检查 + `.gitignore` + 上述测试）。
2. #199 补充：构建脚本必须清 `dist`（孤儿产物）、`tsbuildinfo` 不进入 `files`、`type`/模块格式与 `dist` 扩展名。
3. #202 补充：`pretest` + CI build 步骤 + `copyProductRepo` 的构建输入清单 + 零 spawn 断言。
4. 可选：模板清理（旧 `.ourfairy-template/<hash>-<pnpm>` 无 GC；只是磁盘占用）。
