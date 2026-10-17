# arch-48-product-sources — 票 #48 证据

## 改了什么

`scripts/ourfairy-backend.mjs`：删掉手写的 `PRODUCT_SOURCES`（33 条路径清单，实际展开 42 条），改为从
每个被 link 的产品包自己的 `package.json` 的 `files` 声明派生 profile 内容哈希的输入集合。

- 新增 `LINKED_PACKAGES`：profile 的 9 个 `file:` 依赖（bundle、probe + 7 个产品模块）的
  唯一清单，`profileManifest()` 与派生函数共用它 —— 不存在「装了但没哈希」的包。
- `productSources()`：对每个包，取 `package.json`（npm 无论如何都会打包）+ `files` 里每个条目；
  目录条目递归展开且只取文件，文件条目直接加入。返回排序后的 repo 相对路径。
- `readPackageManifest()`：manifest 读不出来、或没有非空 `files` 数组时 `fail()`。后者是这次改动的
  关键：新增产品包若忘了声明 `files`，派生集合会为空，哈希对该包恒定 —— 与「漏登记」同类故障，所以直接硬失败。
- `productSourceHash()` 直接读这些路径，去掉了 `existsSync ?... : '<missing>'` 的静默兜底：
  集合里的每个路径都来自磁盘列举，缺失即不可能；真正缺失的 `files` 条目在派生时被跳过（与 npm 的
  打包行为一致）。
- `commandDoctor` 的 `product packages` 检查不再遍历手写清单，改为返回派生集合（它同时是派生失败的
  显式出口）。

`tests/product-sources.test.mjs`（新增，3 条）：全部通过 `doctor --json` 这个既有公开入口观察，
不 import launcher 内部。

## 边界（为什么集合是 49 条而不是 backend/ 下全部文件）

派生集合 = **profile 安装真正复制的那批文件**，实测与安装后 `node_modules/@ourfairy/*` 的文件集
完全一致（双向差集均为空）。

不纳入的是 `backend/*/test-support/`（`backend/chat/test-support/fail-outlets.mjs`、
`backend/sessions/test-support/{persist-fixtures,resume-empty}.mjs`）：测试用
`new URL('../backend/.../test-support/x.mjs', import.meta.url)` 直接从 worktree 加载，
从不进 profile 副本；且三个包都未把 `test-support` 写进 `files`。把它们纳入哈希只会让纯测试改动
触发一次无意义的 pnpm 重装。

README 同理：`files` 里声明了 `README.md` 但 `backend/identity`、`backend/sessions` 两个包没有该文件
（既有遗漏，见 NOTES），npm 会静默跳过，派生逻辑也跳过。

## Red / green

Red（先写测试，对未改动的 launcher 跑）：

```
$ node --test tests/product-sources.test.mjs
✔ an unchanged worktree reuses the installed profile instead of reinstalling it
✔ the hashed set follows what the packages publish, not their test fixtures
✖ a new product source file invalidates the installed profile
  AssertionError: backend/identity/src/staleness-probe.mjs changed the product sources, so its content
  must reach the staleness hash and rebuild the install; doctor reported 'cached' and would have kept
  booting the previous copy
  actual: 'cached'  expected: 'installed'
ℹ tests 3 / pass 2 / fail 1
```

失败模式正是票面描述的静默故障：新增产品源文件后哈希不变，profile 判定
`cached`，测试继续对着旧副本跑。

Green（派生实现后）：

```
$ node --test tests/product-sources.test.mjs
✔ an unchanged worktree reuses the installed profile instead of reinstalling it
✔ the hashed set follows what the packages publish, not their test fixtures
✔ a new product source file invalidates the installed profile
ℹ tests 3 / pass 3 / fail 0
```

三条测试覆盖的断言：

1. 空 home 首次 `doctor` 报 `(installed)`，源未变时第二次报 `(cached)` —— 票面点名的缓存路径可观察断言。
2. 新增 `backend/identity/src/staleness-probe.mjs` 后 `(installed)`，且该文件出现在 `product packages`
   报告的文件集里；删回后再跑为 `(cached)`。这正是 #49 手工补登记 `owner.mjs` 的那类动作，本票后不再需要。
3. `product packages` 集合不含任何 `test-support/` 文件；含 `backend/attachments/pdf/pypdf-*.whl`
   （`files` 里的非 `src` 资产，只按 `src` 派生会漏掉）；且覆盖磁盘上 `backend/*/{package.json,src/**}`
   的全部文件（期望值从磁盘列举，不从 launcher 的报告反推）。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test tests/product-sources.test.mjs`（改前） | 3 tests / 2 pass / 1 fail（red） |
| `node --test tests/product-sources.test.mjs`（改后） | 3 tests / 3 pass（green） |
| `npm test`（合并 fbb266b 后、提交前） | 115 tests / 115 pass / 0 fail |
| `npm run combo:verify`（同上） | combination verified |
| `npm test`（提交 bbd0774 后复跑） | 115 tests / 115 pass / 0 fail |
| `npm run combo:verify`（同上） | combination verified |
| 派生集合 vs 安装副本逐文件比对 | 49 / 49，双向差集为空 |
| `doctor --json`（空 home，改后） | `product packages` 49 条；`profile project linked... (installed)`（`probe-doctor-fresh.json`） |

提交：`bbd0774` on `arch/48-product-sources`，父提交为集成分支 tip `fbb266b`（已对齐，无需再 merge）。

基线：合并集成分支后、未加本票测试时 `npm test` 为 112 条（111 pass / 1 fail，失败项是外部
rikkahub pin 中间态，见 NOTES）；加本票 3 条后为 115 条。

## 中途外部漂移记录

开发期间集成分支推进了两次（`5cc77b8` #54、`b5b789a` #55、`fbb266b` #59），每次都已 merge 后复跑。
其中一次 `npm test` 的 `doctor` 失败与 `combo:verify` 失败是 rikkahub 检出 tip（`fcba0647`）领先
`combo.json` 锁（`07adb343`）造成的中间态，与本票改动无关：把 rikkahub pin 更新后的集成分支 tip
`fbb266b` 合入后即全绿。

## 未完成项与说明

- 未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。
- 未做运行时验收：本票只覆盖 profile 安装判定与哈希覆盖，不启动真实模型或真机。
