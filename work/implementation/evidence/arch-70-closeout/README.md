# arch-70 — 收口：两仓组合固定与全量验证

票：<https://github.com/eafen405/OurFairy/issues/70>（地图 #69 / `/implement-spec` 的最后一票）
执行者：Lead（收口验证票，不产出产品行为改动）

## 1. 版本组合最终核对

| 仓库 | 集成分支 | 实际 tip | combo.json 锁定 | 结果 |
| --- | --- | --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `2490de2b67e4bbcaadde737c9831f88d3cae11ef` | 自仓以集成分支 tip 锁定（based-on 规则） | ok |
| dsh fork | `product/ourfairy-v1` | `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee` | `repos.dsh.productCommit` = 同上 | ok（本图无 dsh 改动） |
| rikkahub fork | `product/ourfairy-v1` | `c3eea8a09738def2749c00117584b00d97885800` | `repos.rikkahub.productCommit` = 同上 | ok（#68 合入后回写） |

`npm run combo:verify` 原文（`02-combo-verify.log`）：

```
repo      branch                   expected          actual            result
ourfairy  integration/ourfairy-v1  based on integra  2490de2b67e4bbca  ok (worktree is the integration tip)
dsh       product/ourfairy-v1      fe2bbc3b1c14efd7  fe2bbc3b1c14efd7  ok
rikkahub  product/ourfairy-v1      c3eea8a09738def2  c3eea8a09738def2  ok
combo: combination verified
```

两仓集成分支均已推送到远端（每个 merger 合入时推送；最后一次 `26cc002..2490de2` 由 #52 merger 推送并核对）。

## 2. 两仓全量验证（final 组合实测）

### OurFairy（主 checkout，HEAD = integration tip `2490de2`）

| 命令 | 结果 | 原始日志 |
| --- | --- | --- |
| `npm test` | **139 / 139 pass，0 fail**（6 suites；基线 109 + 本图 30 条新增覆盖） | `01-ourfairy-npm-test.log` |
| `npm run combo:verify` | **combination verified**（三仓 ok，见上） | `02-combo-verify.log` |
| `node scripts/ourfairy-backend.mjs doctor`（keyless，`OURFAIRY_HOME=/tmp/ourfairy-closeout-doctor-final`、未设 `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`） | **all checks passed**（9 项：node/pnpm pin/combo/dsh build/product packages/isolated home/profile linked/model double keyless/bundle agent model） | `03-doctor-keyless.log` |

### rikkahub（主 checkout，HEAD = product/ourfairy-v1 tip `c3eea8a0`）

| 命令 | 结果 | 原始日志 |
| --- | --- | --- |
| `./gradlew :app:testDebugUnitTest :app:assembleDebug`（`ANDROID_HOME=/home/eafen405/Android/Sdk`、`PATH=/home/eafen405/ourfairy-bin:$PATH`、`-Xmx6g --max-workers=4 --parallel`） | **BUILD SUCCESSFUL**；XML 统计 **72 suites / 531 tests / 0 failures / 0 errors / 0 skipped**；3 个 debug APK（arm64-v8a / x86_64 / universal） | `04-android-full.log` |

计数方式：由 `app/build/test-results/testDebugUnitTest/TEST-*.xml` 聚合统计（不只看 BUILD SUCCESSFUL）；`app-universal-debug.apk` SHA256 前缀 `25040f27781b774e0b01`（构建产物仅用于证明 debug 构建可用，未在真机安装）。

## 3. 任务图核对

地图 #69 的 22 张子票中，21 张实现票全部 **CLOSED**（逐个 `gh issue view <n> --json state` 核对）：

`#47 #48 #49 #50 #51 #52 #53 #54 #55 #56 #57 #58 #59 #60 #61 #62 #63 #64 #66 #67 #68` → 全部 CLOSED

本票 #70 关闭后地图 #69 的 22 张子票全部关闭；地图随即进入最终两轴 code-review（`/implement-spec` 第 7 步），评审与修复完成后再关闭地图。

地图 #69 Decisions so far 每票一行（gist + 链接），由各票 merger/Lead 在关闭时追加。

## 4. 组合之外的边界（如实记录）

- 真机/模拟器、真实 Firebase、真实云模型/ASR 与 vivo S50 性能验收**未执行**（#44/#45 范围）。
- Android 全量为 JVM 测试 + debug 构建；Koin/Compose 接线等属编译级/模块级保证的条目已在各票 resolution 注明。
- `backend/identity/README.md`（#52 范围外发现）与 `backend/identity`/`backend/sessions` 的 `files` 声明里不存在的 README.md（#48/#66 范围外发现）、`bundleDeclaresAgentModel` 子串匹配仍可漂移（#64 范围外发现）、测试并行时 `product-sources` 探针文件竞态（#57/#67 范围外发现）、`before/cut` 跨会话共享字段（#56 范围外发现）等，均为已记录但本图**不修**的后续项；按地图规则「新发现的工作立新票回填地图，不塞进已关闭票」处理。
- dsh 仓库无改动（`product/ourfairy-v1` 保持 `fe2bbc3b`）。
