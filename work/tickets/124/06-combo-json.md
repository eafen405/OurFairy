## Parent

[#124 文档收口：以「两个仓库」为准的事实纠偏与减法整理](https://github.com/eafen405/OurFairy/issues/124)

## What to build

`combo.json` 现在是"组合锁 + 构建笔记 + 归档说明"三层混在一个文件里。锁的部分有程序在消费，其余三分之二是没人读的历史残留，并且构成构建事实的第三份副本。

### 1. 保留：仍被程序消费的

| 块 | 消费方 |
| --- | --- |
| `repos.ourfairy.integrationBranch`、`localPath` | `scripts/combo.mjs` 校验 |
| `repos.dsh.productCommit`、`integrationBranch`、`localPath` | `scripts/combo.mjs`、`scripts/ourfairy-backend.mjs`（解析 dsh 安装锚点）、`scripts/bench-projection.mjs`、测试 helpers |
| `androidSource.commit`、`declaration` | `scripts/combo.mjs`、`tests/android-source.test.mjs` |
| `backend.profileName`、`bundlePackage`、`bundlePathInRepo`、`pnpmInvocation`、`launcher` | `scripts/combo.mjs show`、`scripts/ourfairy-backend.mjs`、测试 |
| `schemaVersion`、`product` | `scripts/combo.mjs` |

### 2. 移除：无人消费且与别处重复

- **`androidToolchain` 整块**（SDK 路径、platforms、buildTools、ndk、cmake、java、gradle、localProperties、`firstApkBuildTicket`、`measuredNotes`）。全仓没有任何脚本读取它；它是 2026-10-14 的构建实测记录。构建前置条件已经在 `README.md` 的「客户端构建前置条件」与 `android/README.md` 里各写一份——这一块是第三份。
  - 处理：把仍然有效、且 `README.md` 里缺的实测结论（`compileSdk 37` 实际解析到 `android-37.2`、NDK/`build-tools` 版本）并入 `README.md` 的构建前置条件；其余删除。**不要在新位置再抄一份 SDK 绝对路径**——那是单机事实。
- **`repos.*.researchUpstreamSha` / `researchUpstreamRef`**：`verify` 只用它们生成 `show` 表格的附注与 `productHasOwnCommits` 判断。研究基线按 #128 收敛到 `docs/research/README.md`，此处改为删除并让 `combo show` 指向研究目录。
  - 若删除会让 `tests/android-source.test.mjs` 或 `verify` 的某条断言失效，先改断言再删字段，不要为了让旧断言通过而保留字段。
- **`repos.ourfairy.remoteUrl`、`repos.dsh.remoteUrl`、`remoteName`**：只出现在 `combo show` 的输出里。保留的话必须说明用途；否则删除并要求 `show` 从 git 读取（`git remote -v`）而不是从 JSON 抄。
- **`repos.*.note`（三段长说明）与顶层 `description`**：分别复述了 dsh 的 requiredBuild 理由、客户端快照策略、产品拓扑。这类内容属于 `README.md` 与 `docs/architecture/`，不属于锁文件。
  - 处理：`dsh.note` 里"四步构建必须都跑"这个**操作性**信息保留（它是 `requiredBuild` 的说明，删除后读者不知道为什么要跑四步），压缩到 1–2 句；客户端策略的说明删除并指向 `README.md` 的「来源与许可证」；顶层 `description` 压缩到一句。

### 3. 保留并压缩

- `repos.dsh.requiredBuild`（四个命令）：保留。这是唯一记录"为什么 dsh 要跑四步构建"的地方，`build:lib:client` 与 `build:native-system` 不跑会导致运行期失败，删除风险大于收益。
- `repos.*.role`、`lock`：保留，`combo.mjs` 的分支逻辑按 `lock` 走。

### 4. 一致性

改完后 `npm run combo:verify` 必须仍打印三行并全绿；`npm run backend:doctor` 全绿；`npm run combo:show`（若存在）不得报错或缺字段。

## Acceptance criteria

- [ ] `androidToolchain` 整块删除；其中仍有效的实测结论已并入 `README.md` 的构建前置条件，且没有抄入任何单机绝对路径
- [ ] 全仓 `grep androidToolchain` 只命中历史证据（`work/implementation/evidence/**`），不命中 `combo.json` 或现行脚本
- [ ] 研究 SHA 不在 `combo.json` 出现；研究基线的唯一位置是 `docs/research/README.md`
- [ ] `combo.json` 的每个顶层键都有明确的消费方，或被删除；文件长度明显短于现状（78 行）
- [ ] `repos.dsh.requiredBuild` 保留且 `dsh.note` 说明了"四个都要跑"的理由
- [ ] `npm run combo:verify` 三行全绿；`npm run backend:doctor` 全绿；`npm test` 全绿
- [ ] 交付"删除清单 + 保留理由"，逐块说明"谁在读它，或为什么它可以走"

## Blocked by

无。#128 会把研究基线收敛到 `docs/research/README.md`；本票删除 `researchUpstreamSha` 后，两票的合并点就是那个指针。并行时本票先删字段、后确认 #128 的指针可解析。
