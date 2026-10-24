# #137 启动器拆分：分析与任务图

父票：[#137 启动器拆分：组合层独立成零 spawn 模块，并修正 doctor 的错误契约](https://github.com/eafen405/OurFairy/issues/137)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `f331c38`。开工前实测：`npm test` 234/234 通过（约 105s），`npm run combo:verify` 三行 ok，
dsh 检出 HEAD = `5b8ec0f1…` 与 [`combo.json`](../../../combo.json) 锁定一致，`corepack pnpm@11.28.5 install` 可用。
`node --test <file>` 的子进程 argv 是 `[node, <test file>]`（实测），所以 `argv.slice(2)` 为空，
直接 import 启动器会走 help 分支并 `process.exit(2)`——这正是「启动器可被 import」需要守卫的原因。

## 现状审计

[`scripts/ourfairy-backend.ts`](../../../scripts/ourfairy-backend.ts) 902 行，混着五件事：

| 职责 | 现在的位置 |
| --- | --- |
| 读版本组合与 pin | `readCombination`、模块顶部的 `COMBINATION` / `PROFILE_NAME` / … |
| 派生产品包清单与源文件集合 | `productPackages`、`productSources`、`publishedEntries`、`readPackageManifest`、`productSourceHash` |
| 生成/安装 profile | `profileManifest`、`writeProfile`、`installProfile`、`isolatedEnv` |
| 探针 overlay 与子进程协议 | `overlayPath`、`bootPatches`、`childEnv` |
| 进程控制 | argv、`resolveDsh`、`spawn`、`listeningPorts`、`leakScan`、命令实现与派发 |

三个具体缺陷：

1. **`fail()` 是 `process.exit`。** `doctor` 的 `check()` 用 `try/catch` 包住检查，但 `fail` 不抛错，进程直接死：
   安装失败或 dsh 检出缺失时 `doctor --json` 没有任何 JSON 输出。既有断言里，缺 dsh 只对 `probe` 的文本有断言，
   `doctor` 的同一情形没有断言。
2. **同一份 bundle manifest 有两份读法。** 启动器读 worktree 副本并做三条准入判定（非 `file:`、指向仓库外、
   与 bundle/probe 重名）；[`scripts/combo.ts`](../../../scripts/combo.ts) 的 `verifyBundlePackages` 读已安装副本、
   只取 `Object.keys`，不做判定。
3. **组合规则不可直接断言。** 想断言哈希、陈旧判定、准入规则，只能起子进程跑 doctor，从返回模式反推。

## 目标形状

两个模块，一条错误契约。

### 组合层：`scripts/ourfairy-composition.mjs`

与启动器同级、命名对称（`ourfairy-backend` ↔ `ourfairy-composition`）。零 spawn：只 import
`node:fs` / `node:path` / `node:crypto` / `node:os`，不 import `node:child_process`，不调 git、不调 pnpm。
每个函数接受根目录参数并默认到模块所在仓库根，形状照抄 `combo.mjs` / `bench-gate.mjs` 的「CLI + 可 import 库」。

导出（实现可微调命名，但职责与边界不变）：

| 函数 | 职责 | 抛错 |
| --- | --- | --- |
| `readCombo(root)` | 读并解析 `combo.json`（从 `combo.mjs` 迁入；`combo.mjs` re-export） | 文件缺失/非对象 |
| `readCombination(root)` | 读 `combo.json` 的 `backend` 并校验 7 个 pin 字段 | pin 缺失或为空 |
| `layoutOf(home, root)` | 由 home 推出隔离布局（profileDir 用 pin 的 profileName） | — |
| `assertIsolatedHome(layout, root)` | 拒绝宿主 home 及其祖先 | 命中时抛 |
| `isolatedEnv(layout, { root, extra })` | 隔离环境（HOME / DSH_HOME / XDG / COREPACK_HOME …） | — |
| `readPackageManifest(dir, path)` | 读 package.json，要求非空 `files` | 读不出/无 `files` |
| `publishedEntries(dir, entry, root)` | 展开一条 `files` 项（glob 或目录） | — |
| `productPackages(root)` | bundle + probe + manifest 依赖，含三条准入规则 | 违规时抛 |
| `productSources(root)` | profile 安装会复制的全部源文件 | 同上 |
| `productSourceHash(root)` | 源文件内容哈希 | 同上 |
| `profileManifest(root)` | 生成的 profile manifest | 同上 |
| `writeProfile(layout, root)` | 写 manifest / pnpm 设置 / 用户层 | — |
| `profileLinkedManifestPath(layout, root)` | 已安装 bundle 的 manifest 路径（安装判定的输入之一） | — |
| `installDecision(layout, { root, reinstall })` | 比较内容哈希与 stamp、检查已链接 → `cached` / `install` | 源文件派生失败 |
| `writeSourceStamp(layout, hash)` | 写内容哈希 stamp | — |
| `probeOverlayPath(root)` | 探针 overlay 路径 | 缺失时抛 |
| `bootPatches(options, root)` | 本次组合的 overlay 列表（探针 + `--patch`，按 argv 顺序） | overlay 缺失 |

零 spawn 的边界就是模块的 import 面：`node:child_process` 不在其中，组合函数也就拿不到 git/pnpm。
这一点没有行为测试（源码扫描被 [`CODING_STANDARDS.md`](../../../CODING_STANDARDS.md) 禁止），
交付时按模块导入面记录，不作为「已被检查」声称保留。

### 进程层：`scripts/ourfairy-backend.mjs`

保留：argv 解析、进程版 `fail`、`git`、`resolveDsh`（读 HEAD、校验锁定提交）、探针子进程环境 `childEnv`、
`--patch` 参数拼装 `patchArgs`、全部命令实现、派发。顶部 `import.meta.main` 守卫；`main(argv)` 返回退出码，
import 启动器不解析 argv、不读 `combo.json`、不打印、不退出。

`--patch` 准入仍留在派发处：哪些命令接受 overlay 是命令集的属性，文本不变。
探针子进程环境也留在进程层：它注入的是启动器与探针 overlay 之间的进程协议，组合层对探针一无所知。

### 错误契约

组合层抛 `Error`（不带前缀）。CLI 边界 catch 后以既有 `ourfairy-backend: ` 前缀写 stderr 并非零退出。
消息文本逐字保留：`--patch` 准入、已在运行、dsh 检出缺失、profile 安装失败、隔离 home 拒绝。
进程层的 argv/flag 用法错误同样抛到边界，前缀与退出码不变。

### 安装拆分

组合层给判定：`installDecision` 比较 `productSourceHash(root)` 与已写 stamp、并检查已安装 bundle 的 manifest 是否存在，
返回 `cached` 或 `install`。进程层执行：`spawnSync(pnpm install …)`、失败时抛出既有消息、成功后
`writeSourceStamp(layout, hash)`。`doctor` 的 `profile project linked` 仍报告 `(installed|cached)`。

### bundle manifest 准入规则单份

三条依赖准入规则在组合层实现一次：

1. 每个依赖的 specifier 必须是 `file:<path>`；
2. 解析出的目录必须在 containment 根内；
3. 名字不能与 bundle/probe 条目重名。

启动器读 worktree 副本（containment 根 = 仓库根，消息文本不变）；`combo.mjs` 读已安装副本
（containment 根 = profile 的 `node_modules`：已安装包的 `file:../identity` 解析到同作用域下的已安装副本）。
`combo.mjs` 把违规转成 `failures` 里的一条，不抛穿 doctor。

**依赖方向。** `combo.mjs` 要调用组合层的规则函数，而组合层又要读 `combo.json`；若 `readCombo` 留在
`combo.mjs` 会形成 `combo.mjs` ↔ 组合层的循环。因此 `readCombo` 迁入组合层，`combo.mjs` 从组合层 import
并 re-export（现有 `import { readCombo, repoPath } from '../scripts/combo.mjs'` 的测试与脚本不用改）。
`repoPath` 与 `verify*` 留在 `combo.mjs`；`combo.mjs` 的 git 调用不在本 spec 范围。

**已安装副本的 containment 根。** 已安装 bundle 的 `file:../identity` 解析到
`<profile>/node_modules/@ourfairy/identity`，不在仓库内但在 profile 的 `node_modules` 内；用后者作根，
三条规则对两份副本给出同一判定。这是规则参数的差异，不是规则差异。

## 任务图

线性链：三张票都改同一批函数，拆开并行只会制造冲突；按 issue 的建议顺序逐张合并。

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-error-contract.md` | [#155](https://github.com/eafen405/OurFairy/issues/155) | 错误契约：抛错 + CLI 边界 + doctor 不再猝死 | 无 |
| `02-composition-module.md` | [#156](https://github.com/eafen405/OurFairy/issues/156) | 组合层独立成零 spawn 模块，启动器只留进程层 | 01 |
| `03-manifest-rules.md` | [#157](https://github.com/eafen405/OurFairy/issues/157) | bundle manifest 准入规则收敛到组合层一处 | 02 |
| `04-closeout.md` | [#158](https://github.com/eafen405/OurFairy/issues/158) | 合并后全量门禁、证据索引与可执行声称复核 | 01、02、03 |

## 测试接缝与验收

- 接缝：组合层模块的命名导出，以及既有的真实启动器入口。不新增子进程型接缝。
- 直接 import（脱离子进程）：产品源哈希集合、陈旧判定、新增源文件使哈希变化；隔离环境构造；
  三条准入规则的抛错。
- 保持子进程：已安装 profile 相关的全部断言（挂载行、已安装集、locale、幽灵包）。
- 保持独立：[`tests/bundle-only-profile.test.mjs`](../../../tests/bundle-only-profile.test.mjs) 继续自己写 profile
  （它的意义正是「启动器提供的清单没有入口」），只把隔离环境构造换成组合层实现。
- 错误文本原样通过：`--patch` 准入、已在运行、dsh 检出缺失。
- 全量门槛：`npm test` 与 `npm run combo:verify`。

## 范围外

- 改变任何组合规则的语义；把 dsh 检出解析移进组合层；修改探针报告结构；重新设计启动器日志或命令集；
  处理 `combo.mjs` 的 git 调用。
- `nodeSatisfies` 与 doctor 的检查编排留在进程层（它只读组合层给出的 `nodeRange`）。
- 不新增测试框架，不改 `package.json` scripts，不改日志格式。

## 证据

`work/implementation/evidence/137-launcher-split/`：`01-error-contract.md`、`02-composition-module.md`、
`03-manifest-rules.md`、`README.md`（收口索引）。结论区分命令与结果，未执行项如实记录。
