# #182 同步 dsh fork 到上游 rc.2：分析与任务图

父票：[#182 同步 dsh fork 到上游 rc.2：17 处冲突与三条 fork 独有接缝](https://github.com/eafen405/OurFairy/issues/182)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `0d100942`，dsh 检出 `product/ourfairy-v1` @ `42133b30ad`（与 [`combo.json`](../../../combo.json) 锁定一致）。
开工前实测：`npm test` 285/285 通过（约 84s，issue 正文的 284 是撰写时刻的数），`npm run combo:verify` 三行 ok。

## 已核实的事实

下面的数字都来自本次实测，不是 issue 正文的转述。

| 项 | 实测 |
| --- | --- |
| 分叉 | fork 27 提交 / 上游 990 提交，共同基线 `d743267388`（alpha.2） |
| 目标 | 上游 `687f282e86`（`dsh-v0.2.1-rc.2`，2026-10-17） |
| 冲突 | 真合并得到 **17 处**，与 issue 一致 |
| 冲突体量 | hunk 数极不均衡：`docs/persistence-schema.json` 293、两份 persistence catalog 各 87、其 i18n 42，其余 8 个文件各 1–8 |
| 生成物 | 冲突文档里至少 9 份有生成器（`scripts/persistence-schema.ts`、`persistence-catalog-source.ts`、`gen-cordis-catalog.ts`），手解 429 个 doc hunk 是错的做法 |
| 接缝① `dsh-agent/session-history` | 上游 rc.2 没有任何同名或等价导出；fork 在 `packages/core/agent` 的 exports 里新增了 `./session-history` 子路径 |
| 接缝② `SessionHeader.owner` | 上游 rc.2 的 `SessionHeader` 无 `owner`，全仓无 `SessionOwnerId`；产品 `backend/sessions` 直接用 `header.owner` 与 `meta: { owner }` |
| 接缝③ `connection.authenticators` | 上游把 `peer.ts` 重构成 `browserPeer` + `peers` 映射 + `ConnectionAdmission`/`Principal`；fork 是 `operator-peer` + `principal-peer` + `authenticators` 注册表。语义重叠，这条最可能该改用上游 |
| job 事件 | fork `jobs/lifecycle`、`jobs/report` 对上游 `job/registered`、`job/settled` |
| 产品引用面 | 只有 `backend/chat/src/runtime.mjs`、`scripts/combo.mjs`、`tests/native-capabilities.test.mjs` 引用 `@deepseek-ai/dsh-agent/session-history`；产品侧无 `authenticators` 直接引用 |

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-seam-decisions.md` | [#185](https://github.com/eafen405/OurFairy/issues/185) | 三条接缝的上游等价物裁决，不改代码 | 无 |
| `02-merge.md` | [#186](https://github.com/eafen405/OurFairy/issues/186) | 真合并 `687f282e86`，17 处冲突逐条取舍 | 185 |
| `03-builds.md` | [#187](https://github.com/eafen405/OurFairy/issues/187) | 四条必需构建在同一提交上全绿 | 186 |
| `04-dsh-tests.md` | [#188](https://github.com/eafen405/OurFairy/issues/188) | 冲突面 dsh 包测试恢复 | 187 |
| `05-product-side.md` | [#189](https://github.com/eafen405/OurFairy/issues/189) | 产品侧改接、推送、组合锁更新 | 185、187 |
| `06-upstream-patches.md` | [#190](https://github.com/eafen405/OurFairy/issues/190) | 保留的接缝整理成可上游补丁 | 186 |
| `07-closeout.md` | [#191](https://github.com/eafen405/OurFairy/issues/191) | 证据索引、可执行声称、两轴评审 | 188、189、190 |

前沿：`185` → `186` → {`187`, `190`} → {`188`, `189`} → `191`。

01 阻塞 02 是刻意的：连接层与 job 事件冲突的取舍必须有裁决结论，否则合并时只能猜，事后要回改已合入的冲突。

## 为什么不是更细的并行切法

合并本身是单点操作：两处 worktree 同时解同一批冲突只会制造返工，而 17 处冲突的文件集虽然分成「文档」与「代码」两簇，文档簇（persistence schema/catalog）的内容是由合并后的源码派生出来的，必须等代码簇收口之后才能重生成。所以本 spec 的并行度来自 **03/06 与 04/05 两条支线**，不来自把合并拆开。

## 范围外

- 不升级 Android 客户端，不改 HTTP/SSE 契约
- 不顺带重构与本次同步无关的产品代码
- 不承诺把接缝合入上游，只要求整理成可提交的补丁形态

## 证据

`work/implementation/evidence/182-dsh-rc2-merge/`，每票一份记录加一份收口 README（目录索引见
[证据索引](../../implementation/evidence/README.md)）。
