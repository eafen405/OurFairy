# #230 安装恢复：fake corepack 与确定性重试用例

票面：[#230 T1 确定性安装恢复](https://github.com/eafen405/OurFairy/issues/230)（本地副本
[`work/tickets/229/01-install-recovery.md`](../../../tickets/229/01-install-recovery.md)）。
父规格 [#229](https://github.com/eafen405/OurFairy/issues/229) 是**只补测试**的规格：生产 launcher、
composition、构建、哈希、模板、缓存与错误处理均未改。

- 分支：`ticket/230-install-recovery`
- 基线：`integration/spec-229` @ `d489923a34`
- 测试提交：`de32d5d6e1`（替身与四个用例）、`c49f06d763`（版本查询计数断言）
- 环境：WSL2 Linux x64、Node `v24.18.0`、`combo.json` 锁定 `corepack pnpm@11.28.5`、
  profile `ourfairy`、bundle `@ourfairy/dsh-v1-bundle`

## 改了什么

| 文件 | 内容 |
| --- | --- |
| `tests/helpers/fake-corepack.mjs`（新增，167 行） | 可复用的 corepack 进程替身：在临时目录生成 PATH 上优先的 `corepack` 可执行文件与状态目录（`config.json` 剧本、`calls.jsonl` 调用记录），提供 `installFakeCorepack` / `fakeCorepackEnv` / `corepackCalls` / `removeFakeCorepack`。成功时按 profile manifest 的 `dsh.profile.bundles` 布置最小 linked bundle manifest 与 `pnpm-lock.yaml`；失败时输出可区分的 attempt 标记。不 import 任何生产模块。 |
| `tests/install-recovery.test.mjs`（新增，269 行） | 四个确定性用例，全部驱动真实 launcher 的 `doctor --json`，每个用例独立 `copyProductRepo()` 仓库副本 + `makeHome()` 隔离 home，`after` 清理。断言三处外部证据：假替身调用日志、doctor 的 `profile project linked` 检查、文件系统（模板目录、linked manifest、lockfile、stamp）。 |

沿用既有基础设施：`copyProductRepo`、`makeHome`/`removeHome`、`runBackend`、`launchEnv`
（默认 `OURFAIRY_SKIP_BUILD=1` 与临时端口）。未新增测试框架、第二套安装状态或生产入口；未导出
`installProfile`。

## 替身的外部契约

启动器把 pnpm 当子进程跑（`corepack pnpm@<pin> install …`，cwd = profile 目录），所以替身只替换
**进程 seam**：

- 版本查询输出 `<pin>` 并退出 0（doctor 的 `corepack pnpm pin available` 检查通过）；
- 每次 install 在**入口**记录 `{kind, argv, cwd, lockfile, attempt, outcome}`，其中 `lockfile` 是
  该次调用开始时 profile 中 `pnpm-lock.yaml` 是否存在；
- 剧本按第 N 次 install 取 `installs[N-1]`（超出列表时重复最后一项）：`fail` 退出 1 且 stdout/stderr
  带 attempt 编号；`succeed` 写 lockfile 与 linked bundle manifest 后退出 0；
  `succeed-without-linked` 只写 lockfile 后退出 0。

生产端在替身返回后照常执行：linked manifest 校验 → 模板发布 → stamp 写入。测试断言的就是这些
生产步骤的外部结果，而不是生产内部函数。

## 四个用例与实测结果

| 用例 | install 次数与 lockfile 状态 | doctor `profile project linked` | 模板 / stamp |
| --- | --- | --- | --- |
| 旧 lockfile 首装失败 → 重试成功 | 恰好 2 次：第 1 次 `lockfile=true`，第 2 次 `lockfile=false`；attempt `[1,2]`，outcome `[fail,succeed]` | `ok=true`，detail 以 ` (installed)` 结尾 | 已发布唯一模板 `<repoCopy>/.ourfairy-template/<hash>-11.28.5`；模板含 linked bundle manifest 与 install 产出的 lockfile；stamp 内容 = 模板目录名中的 hash |
| 两次都失败 | 恰好 2 次：`[true,false]`，outcome `[fail,fail]` | `ok=false`，detail 含 `the profile lockfile was stale and has been dropped; the retry failed too.`、`the first failure was:`，以及两次 attempt 的 stdout+stderr 四段 | 无模板、无 stamp |
| 首装失败且无旧 lockfile | 恰好 1 次：`lockfile=false`，outcome `[fail]` | `ok=false`，detail 以 `profile install failed in <profileDir> (exit 1):` 开头；不含 `the profile lockfile was stale` 与 `the first failure was:` | 无模板、无 stamp |
| 报成功但无 linked manifest | 恰好 1 次：outcome `succeed-without-linked`；profile 中确有 lockfile | `ok=false`，detail 含 `profile install reported success but <profile>/node_modules/@ourfairy/dsh-v1-bundle/package.json is missing;` 与 `the product bundle would be silently skipped instead of failing the boot` | 无模板、无 stamp |

版本查询在四个用例中都只发生一次，argv 为 `[pnpm@11.28.5, --version]`；恢复成功用例还固定了
install 的完整 argv（`install --ignore-scripts --package-import-method copy --store-dir <home>/pnpm-store`）
与两次调用的 cwd 都是 profile 目录。

## 命令与结果（本次实际执行）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/install-recovery.test.mjs`（Red，替身尚未实现） | 0 pass / 1 fail：`ERR_MODULE_NOT_FOUND` 指向 `tests/helpers/fake-corepack.mjs` |
| 同上（Green，替身实现后） | **4 pass / 0 fail**，约 1.0s（各用例约 210–260ms） |
| 同上（替身自检中的 Red） | 把 `process.exit` 改为 `process.exitCode` 时漏了 `return`，替身「失败后继续走成功路径」；用例 3 立刻以 `no lockfile means no lockfile-retry note` 变红并显示多出的第 2 次 install/success 输出。补 `return` 后恢复 4 pass——证明日志断言能发现非预期的 install 序列 |
| `node --test tests/lifecycle.test.mjs` | 6 pass / 0 fail（11.5s） |
| `node --test tests/bundle-packages.test.mjs` | 11 pass / 0 fail（139.6s） |
| `node --test tests/product-sources.test.mjs` | 9 pass / 0 fail（6.6s） |
| `git merge integration/spec-229` | `Already up to date.`（集成分支 tip 仍是 `d489923a34`，无冲突） |
| 合并后 `node --test tests/install-recovery.test.mjs` | **4 pass / 0 fail**（1.1s） |
| 提交时的仓库 pre-commit 钩子（自动） | 本次提交改动了 `tests/helpers/fake-corepack.mjs`，该路径在 `scripts/precommit.ts` 的 `FULL_AUTHORITY` 中，因此钩子的分类是 **full**（构建 + `npm test` + `npm run combo:verify`），不是 related。T1 提交本身的全量输出未单独留存；可复查的全量记录是 #231 提交 `d24d5e125d`（`npm test` 318 pass / 0 fail，87.4s，`combo:verify` 三行 ok）与 #232 收口的最终运行 |

## 替身证据 vs 真实 pnpm 证据

- **本票新增的 4 个用例全部是替身证据**：新测试文件不启动真实 pnpm。判据是替身调用日志——四个
  用例都记录到且只记录到预期的版本查询与 install 调用；真实 corepack/pnpm 不会写这份日志，也不会
  产生脚本化的 attempt 输出与「成功但不布置 linked」状态。
- **真实 pnpm 证据仍由既有套件保留**（本次一并跑过）：`tests/lifecycle.test.mjs` 的安装失败用例让
  真实 pnpm 失败并检查错误契约；`tests/product-sources.test.mjs` 的安装副本用例跑真实 install 比较
  inode；`tests/bundle-packages.test.mjs` 的多个用例跑真实 doctor/install。它们不是本票新增证据，
  也不能替代替身用例对「重试次数 / 锁文件时点 / 模板与 stamp 的有无」的确定性断言。
- 未执行项：本票不把全量门禁当作交付证据。全量 `npm test` 与 `npm run combo:verify` 的最终集成结果由
  #232 收口运行并记录；本目录的结论只依据上表列出的定向测试与 related 门禁。
