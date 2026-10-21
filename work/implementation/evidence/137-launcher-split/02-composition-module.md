# 02-composition-module — 票 #156 证据

> 父票 [#137](https://github.com/eafen405/OurFairy/issues/137)；票面
> `work/tickets/137/02-composition-module.md`；分支 `ticket/156-composition-module`；
> 基线 `integration/spec-137` 的 `1a12d7a`；实现提交 `ef49e0f`；证据提交即本文件所在提交。

## 改了什么

### `scripts/ourfairy-composition.mjs`（新增）

组合层，零 spawn。导入面只有 `node:fs` / `node:path` / `node:crypto` / `node:os`；
仓库根由 `import.meta.dirname` 推出（不 import `node:url`，因为允许的导入面不含它）。
每个读仓库的函数接受根目录参数并默认到该模块所在仓库根。

从启动器迁入：`readCombination`、`layoutOf`、`assertIsolatedHome`、`isolatedEnv`、
`productPackages`、`productSources`、`publishedEntries`、`readPackageManifest`、
`productSourceHash`、`profileManifest`、`writeProfile`、`profileLinkedManifestPath`、
`installDecision`、`writeSourceStamp`、`probeOverlayPath`、`bootPatches`。
从 `combo.mjs` 迁入：`readCombo`。

按票面表格保留职责与边界。所有读仓库的函数接受根目录参数并默认到模块仓库根；
`readPackageManifest(dir, path)` 的实现微调为 `readPackageManifest(dir, root)`，自行拼
`<root>/<dir>/package.json`，以满足「所有函数接受根目录参数」且不重复传同一路径；
错误消息不变。`writeSourceStamp(layout, hash)` 只写 `layout` 已给出的路径，不读仓库，
因此没有可默认的根目录参数（票面表格也是这个签名）。

安装拆成两半：`installDecision(layout, { root, reinstall })` 比较 `productSourceHash`
与已写 stamp、并检查已链接 bundle manifest 是否存在，返回 `cached` / `install`；
`writeSourceStamp(layout, hash)` 只写 stamp，由进程层在 pnpm 成功后调用。

三条 bundle manifest 依赖准入规则的实现与消息文本原样迁入 `productPackages`：
非 `file:` specifier、解析目标在仓库外、与 bundle/probe 条目重名。

### `scripts/ourfairy-backend.mjs`（只留进程层）

- 保留：argv 解析、`fail`（抛错）、`git`、`resolveDsh`（HEAD + 锁定提交）、
  探针子进程环境 `childEnv`、`--patch` 参数拼装 `patchArgs`、全部命令实现、派发。
- 新增 `export async function main(argv)`：返回退出码，不调用 `process.exit`；
  唯一 CLI 边界在 main 的 `try/catch`（`cliFailure` 写既有前缀并返回 1）。
- 底部 `if (import.meta.main) process.exit(await main(process.argv))`。import 启动器
  不解析 argv、不读 `combo.json`、不打印、不退出。
- 删除模块加载期的 `COMBINATION` 读取：pin 在 `main` 开头读一次（先于 argv，保持
  「坏组合先于用法错误」的既有失败顺序），再传给命令。`layoutOf` 委托组合层。
- `installProfile`：`writeProfile` → `installDecision` → 进程层 `spawnSync` pnpm →
  成功后 `writeSourceStamp`。doctor 的 `profile project linked` 仍报 `(installed|cached)`。
- doctor 的四个组合事实改为调用组合层：`product packages` → `productSources`、
  `isolated home` → `assertIsolatedHome`、`node version` → `readCombination().nodeRange`、
  `profile project linked` → `installProfile`（组合判定 + 进程执行）。需要子进程的检查
  （corepack pin、dsh 构建、combo 校验、bundle/插件/原生能力）仍留在启动器。
- `--patch` 准入仍在派发处，文本未改。

### `scripts/combo.mjs`

`readCombo` 的实现删除，改为 `import { readCombo } from './ourfairy-composition.mjs'`
并 `export { readCombo }`，依赖方向单向（`combo.mjs` → 组合层），既有
`import { readCombo, repoPath } from '../scripts/combo.mjs'` 调用点不变。
`repoPath` 与 `verify*` 未动；未把 `verifyBundlePackages` 收敛到同一规则函数（#157）。

### 测试

- `tests/product-sources.test.mjs`：三个用例改为直接 import 组合层，不再起子进程跑
  `doctor --json`。用 `copyProductRepo` 的可变副本：(1) 哈希集合覆盖磁盘上每个包发布
  的 `src/` 与 manifest，且不含 `test-support/`、含 PDF wheel，哈希项都真实存在；
  (2) 写入 profile + stamp + 已链接 manifest 后，未改动源判定 `cached`；
  (3) 新增 `backend/identity/src/staleness-probe.mjs` 后哈希改变、源集合包含它、
  判定 `install`。
- `tests/bundle-only-profile.test.mjs`：仍自己写 bundle-only profile，`isolatedEnv`
  改为组合层实现（本地薄包装：`compositionEnv(layoutOf(home, repoRoot), { root: repoRoot, extra })`，
  worktree 根用于共享 `.corepack`）。
- `tests/composition-module.test.mjs`（新增）：在复制仓库上逐条断言三条依赖准入规则
  抛错且消息点名规则（非 `file:`、仓库外、与 bundle/probe 重名；重名同时覆盖 bundle
  与 probe 两个条目）。
- `tests/launcher-import.test.mjs`（新增）：进程内 `await import('../scripts/ourfairy-backend.mjs')`，
  断言 `typeof launcher.main === 'function'` 且 `repoRoot` 为字符串。若不惰性，测试进程
  会因 `node --test <file>` 的 argv（`argv.slice(2)` 为空）走 help 分支退出 2。

## 红 → 绿

实现前（组合模块不存在）：

```
node --test tests/product-sources.test.mjs tests/composition-module.test.mjs tests/launcher-import.test.mjs
```

结果 3 个测试文件全失败：两个组合层测试 `ERR_MODULE_NOT_FOUND`，`launcher-import`
因导入启动器触发 `process.exit` 而失败。实现后同一命令：7/7 pass（约 128ms）。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test tests/product-sources.test.mjs` | 3/3 pass，约 0.13s |
| `node --test tests/composition-module.test.mjs tests/launcher-import.test.mjs` | 4/4 pass |
| `node --test tests/bundle-only-profile.test.mjs` | 2/2 pass，10.9s |
| `node --test tests/lifecycle.test.mjs` | 4/4 pass，10.0s |
| `node --test tests/bundle-packages.test.mjs tests/plugin-compatibility.test.mjs tests/native-capabilities.test.mjs tests/ecosystem-boundary.test.mjs tests/bundle-manifest.test.mjs tests/android-source.test.mjs tests/baseline-boot.test.mjs` | 41/41 pass，91.5s |
| `npm test` | 239/239 pass，153.1s，exit 0 |
| `npm run combo:verify` | ourfairy / dsh / android source 三行 ok，exit 0 |

### 错误文本逐字对比（基线 `1a12d7a` vs 本分支）

把 `scripts/`、`combo.json`、`package.json`、`backend/` 复制到两个临时仓库：一个放
`1a12d7a` 的 `ourfairy-backend.mjs` + `combo.mjs`，另一个放本分支三个脚本。对同一命令
分别运行并比较 stdout / stderr / 退出码（临时脚本 `/tmp/compare-156.mjs`，未入库）。
以下全部 identical：

- 无命令（exit 2）、`help`（0）、`--help`（1）、未知命令、未知 flag、缺参数、多余参数
- `--patch` 在 `status` / `doctor` 上的准入拒绝
- 空闲 `status`；host home 的 `status` 与 `doctor --json`
- 缺 dsh 的 `probe` / `doctor --json` / `start` / `boot-product`
- 空 `backend.profileName`、缺 `combo.json`（模块加载期失败路径）
- profile 安装失败（`<home>/pnpm-store` 是普通文件）

结论 `ALL IDENTICAL`。

### 零 spawn / import 惰性

- `scripts/ourfairy-composition.mjs` 的 import 行只有
  `node:crypto`、`node:fs`、`node:os`、`node:path`；无 `node:child_process`。
- 把三个脚本复制到没有 `combo.json` 的临时目录后
  `node -e "import('…/ourfairy-backend.mjs').then(m => console.log(typeof m.main))"`
  输出 `function`，证明 import 不读组合。

## 未执行 / 范围外

- `combo.mjs` 的 `verifyBundlePackages` 尚未收敛到组合层同一规则函数：那是 #157。
- 未做源码扫描式的「零 spawn」测试：`CODING_STANDARDS.md` 禁止用正则扫源码充当检查，
  因此只记录导入面，不声称「已被检查」。
- 未做 Windows 验证；本仓库现有测试均在本机 Linux 上运行。
- 全量门禁受同机其它 worktree 的并行测试影响时出现过与本票无关的偶发失败
  （speech 超时、PDF 资源上限、freePort 撞端口、消息预算 8001/8000、remote-chat
  队列时序）；每个失败用例单独重跑均通过，本票改动的文件与这些断言无关。

## 合并

合并前 `git merge integration/spec-137`：集成分支 tip 仍是 `1a12d7a`（本票实现提交的父提交），
结果为 `Already up to date.`，无冲突。合并后重跑
`node --test tests/product-sources.test.mjs tests/composition-module.test.mjs tests/launcher-import.test.mjs`：
7/7 pass；`node --test tests/bundle-only-profile.test.mjs tests/lifecycle.test.mjs`：6/6 pass。
提交 `ef49e0f` 的 pre-commit hook 跑 `npm test` 239/239 与 `combo:verify` 三行 ok，均通过。

### 全量门禁的偶发失败（与本票无关）

提交过程中同机有多个 worktree 并行跑同一套全量测试，负载 20–60，pre-commit 的
`npm test` 出现过与本票无关的偶发失败：`speech` 超时、`PDF` 资源上限、
`bundle-only` 的 `freePort` 撞端口（EADDRINUSE）、消息预算 8001/8000、`remote-chat`
队列时序。每个失败用例单独重跑均通过；最终提交的 hook 全量 239/239 通过。
