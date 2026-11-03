# #232 收口：两轴评审修复、证据与全量门禁

票面：[#232 T3 收口](https://github.com/eafen405/OurFairy/issues/232)（本地副本
[`work/tickets/229/03-closeout.md`](../../../tickets/229/03-closeout.md)）。
父规格 [#229](https://github.com/eafen405/OurFairy/issues/229) 是**只补测试**的规格：本次增量只改
测试、证据与票面，生产 launcher、composition、构建、哈希、模板、缓存与错误处理均未改。

- 分支：`ticket/232-closeout`
- 基线：`integration/spec-229` @ `d1cda08be2`（含 T1 #230、T2 #231）
- 本票提交：见下方「提交」一节
- 环境：WSL2 Linux x64、Node `v24.18.0`、`corepack pnpm@11.28.5`、profile `ourfairy`

## 两轴评审与处置

评审范围：`git diff 6662bef17e...HEAD`（`integration/spec-229` 的规格增量）。两轴各由一个只读
子代理独立完成，互不参考。

### Standards 轴

| 发现 | 处置 | 失效时会失败的检查 |
| --- | --- | --- |
| #230 证据声称提交进入 `related` 门禁，但 `tests/helpers/fake-corepack.mjs` 属于 `scripts/precommit.ts` 的 `FULL_AUTHORITY`，应为 `full` | 改写该行：如实写 `full` 分类，引用已留存的全量记录（#231 提交 `d24d5e125d` 318 pass/87.4s）与本票最终运行 | 证据文本与 `scripts/precommit.ts` 的 `FULL_AUTHORITY` 对照；本 README 的最终门禁记录 |
| `install-recovery.test.mjs` 手写失败消息，未复用 `describeRun` | 改用 `tests/helpers/backend.mjs` 的 `describeRun('doctor', run)` | 静态对照即可；与 `template-reuse.test.mjs`、`bundle-packages.test.mjs` 同形 |
| `checkNamed` 与模板发布契约在两个测试文件中重复 | 抽到 `tests/helpers/profile-install.mjs`：`checkNamed`、`linkedBundleManifestPath`、`assertPublishedTemplate`；两个测试共用 | 任一模板形状断言只在 helper 中定义；两个测试都导入它 |
| `const c` 名称含糊且反复走 `c.combination.backend.*` | 改为 `world`，并在用例内解构 `bundlePackage` / `pnpmPin` | 测试源码；行为断言不变 |
| `installFakeCorepack` 的 `installs` 默认值没有调用者使用 | 改为必填；缺省时给出明确错误 | 新 helper 的入参校验 |
| `published.json` 多出 `baseBranch` / `baselineCommit`，无读取方 | 删除这两个字段；保留与 #225 同形的 `parent` / `title` / `children[].blockedBy` | 与 `work/tickets/225/published.json` 的字段对照 |

### Spec 轴

| 发现 | 处置 | 失效时会失败的检查 |
| --- | --- | --- |
| 失败用例只断言模板根目录为空，未证明「没有模板目录」 | `assertNoInstallArtifacts` 改为 `assert.equal(existsSync(templateRoot), false)` | T1 双失败 / 无 lockfile 失败 / linked 缺失三个用例 |
| 失败用例未断言进程结果，只读 doctor 的单项检查 | T1 增加 `assertFailedRun`（`report.ok === false` 且 `run.code !== 0`）；T2 损坏模板用例同样断言 | 各失败用例；把 launcher 退出码改回 0 即变红 |
| T1 过度约束无关行为：`corepack pnpm pin available` 检查、精确 install argv、版本次数 | 删除无关检查与精确 argv；版本次数只保留在 T2 的 `assertOnlyVersionQueries`（它本身就是「复制路径没有 install」的证据） | T1 不再断言无关 doctor 检查；T2 的调用日志断言保持不变 |
| `INSTALL_FORBIDDEN` 是 T1 票面未列出的第四种结果 | 删除；T2 改用既有的 `INSTALL_FAILED`：任何 install 都会先记录再失败，日志仍是「没有执行安装」的证据 | T2 三个用例的 `assertOnlyVersionQueries` |
| T2 三个用例共享模块级仓库副本，第 3 个用例删掉模板 manifest 且不恢复，单独运行复制用例会失败 | 真实安装移入 `before()`；损坏模板用例在 `finally` 恢复 manifest | 单独运行任一 T2 用例都能通过（`before` 提供发布者状态，`finally` 恢复模板） |

## 最终门禁（本工作树、未提交改动的最终状态）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/install-recovery.test.mjs tests/template-reuse.test.mjs tests/docs.test.mjs` | **8 pass / 0 fail**（7.3s；真实安装由 `before` 完成） |
| `npm test` | **318 pass / 0 fail**（98.8s），`tests 318`、`suites 7` |
| `npm run combo:verify` | ourfairy / dsh / android source 三行 ok |
| `git diff --name-only 6662bef17e -- scripts backend android combo.json package.json` | 空：生产代码、构建、组合与客户端零改动 |
| `git status --porcelain`（提交前） | 仅测试、证据与票面文件 |

全量通过只证明测试与门禁通过，不等于推送、落地或 GitHub 票面已关闭；这些由 Lead 在合并后处理。

## 证据分工

- 真实 pnpm 证据：`tests/install-recovery.test.mjs` 的恢复成功用例（真实 corepack 安装后由生产发布模板与 stamp）、
  `tests/template-reuse.test.mjs` 的 `before` 真实安装；既有 `lifecycle` / `bundle-packages` /
  `product-sources` / `bundle-only-profile` 套件继续提供真实安装、inode 与包集合证据。
- 替身证据：`fake-corepack.mjs` 控制的失败、重试、成功但无 linked manifest，以及复制/缓存/损坏模板
  用例；替身只替换 pnpm 进程并记录调用，模板发布、复制、linked 校验与 stamp 写入仍是生产代码。
- 两类证据分别在 [230-install-recovery](../230-install-recovery/README.md) 与
  [231-template-reuse](../231-template-reuse/README.md) 中说明。

## 未完成项

- 本票范围内无未完成项。
- 集成分支尚未推送、未落地；三张实施票与规格票的关闭、worktree 清理由 Lead 在合并后执行。

## 提交

本 README 与证据索引描述文件随收口提交入库；测试/helper 修复与票面修正为另一提交。
