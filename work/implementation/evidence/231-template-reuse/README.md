# #231 模板复用：真实安装发布、跨 home 复制与缓存命中

票面：[#231 T2 模板复用闭环](https://github.com/eafen405/OurFairy/issues/231)（本地副本
[`work/tickets/229/02-template-reuse.md`](../../../tickets/229/02-template-reuse.md)）。
父规格 [#229](https://github.com/eafen405/OurFairy/issues/229) 是**只补测试**的规格：生产 launcher、
composition、构建、哈希、模板、缓存与错误处理均未改。

- 分支：`ticket/231-template-reuse`
- 基线：`integration/spec-229` @ `bac1127d88`（含 T1 #230）
- 测试提交：`d24d5e125d`（本目录随其后的证据提交入库）
- 环境：WSL2 Linux x64、Node `v24.18.0`、`combo.json` 锁定 `corepack pnpm@11.28.5`、
  profile `ourfairy`、bundle `@ourfairy/dsh-v1-bundle`

## 改了什么

| 文件 | 内容 |
| --- | --- |
| `tests/helpers/fake-corepack.mjs`（扩展，167 → 176 行） | 新增 `INSTALL_FORBIDDEN` 结果：版本查询照常回答，任何 install 都被记录后以退出码 1 失败。复制/缓存用例用它证明复用路径没有执行 pnpm install，同时让「偷偷安装」在 launcher 错误里也响亮。既有三种结果与 T1 用例不变。 |
| `tests/template-reuse.test.mjs`（新增，262 行） | 三个用例共用一个临时仓库副本与三个隔离 home：真实 pnpm 发布模板 → 第二个 home 复制并缓存命中 → 模板损坏时复制响亮失败。断言集中在替身调用日志、doctor 的 `profile project linked` 检查与文件系统（模板、linked manifest、lockfile、stamp）。 |

沿用既有基础设施：`copyProductRepo`、`makeHome`/`removeHome`、`runBackend`、`launchEnv`
（默认 `OURFAIRY_SKIP_BUILD=1` 与临时端口）。未新增测试框架、生产入口或第二份模板权威；未导出
`installProfile`。

## 闭环与实测结果

| 步骤 | 外部证据 | 结果 |
| --- | --- | --- |
| home A 真实安装 | doctor `profile project linked` 以 ` (installed)` 结尾；`<repoCopy>/.ourfairy-template/<hash>-11.28.5` 恰好一个；模板含 linked bundle manifest 与 `pnpm-lock.yaml`；profile 写入 `.ourfairy-source-hash`，内容与模板目录名中的 hash 一致 | 通过（真实 corepack/pnpm，无替身） |
| home B 复制 | 同一仓库副本、全新无 stamp 的 home，PATH 上替身仅被查询版本一次；doctor 报告 ` (copied)`；B 的 stamp 与 A 逐字节相同；B 的 linked bundle manifest 与 A 的已装副本逐字节相同；模板树摘要不变（复制只读） | 通过（替身只记录/拒绝 install；复制与校验是生产代码） |
| home B 再次判定 | doctor 报告 ` (cached)`；两次运行累计只有 2 次版本查询、0 次 install；模板树摘要仍不变 | 通过 |
| home C 模板缺 linked | 删除共享模板的 linked bundle manifest 后，全新未 stamp 的 home C：doctor 的 profile 检查失败，detail 含 `profile template `、` is missing `、`delete it and rerun to install a fresh copy` 并点名缺失路径；C 无 stamp、无 linked manifest；替身日志只有 1 次版本查询、0 次 install | 通过 |

`doctor` 在仓库副本里因 `combo combination`（副本不是 Git checkout）整体退出非零，与本票无关；
三个用例都只读取 `profile project linked` 这一项检查。

## 命令与结果（本次实际执行）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/template-reuse.test.mjs` | **3 pass / 0 fail**，7.4s（真实安装 6.4s；复制 0.44s；损坏模板 0.20s） |
| `node --test tests/install-recovery.test.mjs tests/docs.test.mjs` | **5 pass / 0 fail**（T1 4 项 + Markdown 相对链接 1 项，1.1s），证明 helper 扩展未改变 T1 行为 |
| 提交 `d24d5e125d` 的仓库 pre-commit 钩子 | `tests/helpers/` 属于 `FULL_AUTHORITY`，钩子自动跑全量：构建通过、`npm test` **318 pass / 0 fail**（87.4s）、`npm run combo:verify` 三行 ok（ourfairy / dsh / android source） |

## 真实 pnpm 证据 vs 替身证据

- **真实 pnpm 证据**：home A 的安装未放置任何替身，模板与来源 stamp 由真实 `corepack pnpm@11.28.5`
  安装结果产生；这是本闭环的起点，不是测试手工布置。
- **替身证据**：home B/C 的复用判定与损坏模板失败。替身只替换 pnpm 进程并记录调用（版本查询与
  install 尝试）；模板复制、linked 校验、stamp 写入仍是生产代码，断言读取的是它们的外部结果。
- 既有真实 pnpm 证据未改动：`tests/lifecycle.test.mjs`、`tests/bundle-packages.test.mjs`、
  `tests/product-sources.test.mjs`、`tests/bundle-only-profile.test.mjs` 仍在本次全量中运行并通过。
- 未执行项：无本票范围内的未执行项。最终集成状态的 `npm test` 与 `npm run combo:verify` 仍由
  #232 收口在集成分支上重跑并记录。
