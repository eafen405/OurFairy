# 106-closeout — 票 #106 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/11-closeout.md`；分支 `integration/spec-73`；代码合并 tip `5d0a74f`
> （本收口提交只改文档/证据，在其后）。任务图 `work/tickets/73/README.md`；执行状态
> `work/implementation/notes/73-execution.md`；评审发现与修复
> `work/implementation/notes/73-review-findings.md`。

## 收口内容

1. **版本组合**：本轮只改本仓库（产品代码、测试、文档），没有移动 dsh 锁定
   `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf` 或 rikkahub 锁定
   `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`，也没有改 `combo.json`。ourfairy 的锁是
   `integration/ourfairy-v1` 分支；`integration/spec-73` 基于该 tip（merge-base
   `88c27b0`）。因此 `combo.json` 已反映本轮合并后的组合，无需改动。
2. **证据索引**：`work/implementation/evidence/README.md` 的插件生态表已含 96–106 全部
   目录（97 与 104/105/106 由收口轮补齐），链接可解析。
3. **最终两轴评审**：在 `88c27b0...5d0a74f` 上执行 Standards、Spec 与可执行声称三项
   评审，分两轮：第一轮 `88c27b0...b1878e7`（#96–#103），第二轮覆盖 `b1878e7...5d0a74f`
   （评审修复、#104、#105）。首轮与最终轮发现均在所属模块修复；完整发现→修复映射见
   `work/implementation/notes/73-review-findings.md`，本轮主要修复如下。
4. **关闭子票**：#104、#105、#106 按 tracker 方式关闭并留下结论；#96–#103 已在此前
   关闭；父票 #73 的正文、标题与状态未修改。

## 最终评审发现与修复（摘要）

| 发现 | 处理 |
| --- | --- |
| #104 只检查已出现的行，未证明 bundle 声明的行都被组合、每个声明包都被挂载 | 测试用 pinned dsh 的 `loadOverlayPatches` + `composeEntries` 从安装副本组合期望行，断言每个 `@ourfairy/*` 行 active、每个声明包至少被一行挂载（`packageOf` 处理 subpath）；删 `groups` 行做过红测 |
| 产品包缺少 locale/description（chat/attachments/search/spaces/speech/identity/sessions/gateway） | 补 `locale/en.json`、缺失的 `description`、exports/files，并加测试按 backend 目录派生检查 |
| probe 把刻意 disabled 行的缺失服务当失败，launcher `start` 不能在 disable scoped provider 时成功 | probe 对 disabled 期望行不再报失败：缺服务是刻意缺席，live 是替换；#105 的 scoped-bash disable/replacement 改走 launcher `start`，fs 级联仍按裸 direct boot 验证 |
| fence 测试只证明先于凭据，未证明先于解析 body | 六个产品模块入口加 malformed raw body + 不受信 Host，断言 403；doc/引文改为「解析请求体或读取凭据之前」 |
| identity `sessionTtlDays` 丢失安全整数上界 | `.max(Number.MAX_SAFE_INTEGER)`，加 `2**60` 非法配置加载期用例 |
| probe 注释说“bundle 贡献的行”，实际也判 overlay 行 | 改为「组合树中的非 disabled `@ourfairy/*` 行」 |
| spaces README 声称任一 provider 可 disable/replace 而不影响其他 provider | 按依赖事实改写：fs/sandbox 的依赖行会等待，probe 点名缺失服务/行，无原生 fallback |
| 98 evidence 仍写 8 个包/按 dependencies 判定 | 加 2026-10-20 补记：按安装集合判定（本提交 12 个：10 声明 + bundle + probe），旧 8/8 输出标为历史快照 |
| #96 “一包一行”与 #101 subpath 多行冲突 | 在 #96 记录评论（已发布）：#101 后一包可贡献多行，可执行规则是同一 module specifier 只挂一次、声明/安装/挂载/已声明未安装一致；医生检查执行这四条 |
| #73 写范围外的 `runtime.mjs` 注释修正 | 记录为 comment-only 边界例外（#99 使其过期），无行为变化 |
| 最终验证暴露既有测试隔离缺陷：`tests/pdf-worker-cancel.test.mjs` 扫描 `/tmp` 的 `ourfairy-pdf-*`，与并发运行的 `tests/pdf.test.mjs` 目录冲突，造成全量偶发失败（单跑通过） | 给该测试专用 `TMPDIR`（`mkdtempSync`）并只扫描该目录，恢复/删除在 `finally`；只改测试，不改产品。复现命令：`node --test tests/pdf.test.mjs tests/pdf-worker-cancel.test.mjs`（修复前取消用例失败，修复后 6/6 通过） |

## 实际执行

在 `integration/spec-73` 的代码合并 tip `5d0a74f` 的干净 worktree
（`.worktrees/verify-73`）上：

```
$ npm test
ℹ tests 185
ℹ suites 7
ℹ pass 185
ℹ fail 0
ℹ duration_ms 87908.66

$ npm run combo:verify
repo      branch                   expected          actual            result
ourfairy  integration/ourfairy-v1  based on integra  5d0a74fc4e0ae695  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      460109d1b89b824a  2d97ed143e7a6487  MISMATCH
combo: 1 drift/missing entry

$ git diff --check 88c27b0...5d0a74f
（无输出）
```

最终验证发现 `tests/pdf-worker-cancel.test.mjs` 的全量偶发失败不是本轮代码引入，而是
既有测试隔离缺陷：它扫描 `/tmp` 下所有新的 `ourfairy-pdf-*` 目录，并发运行的
`tests/pdf.test.mjs` 会产生同名前缀目录。复现：
`node --test tests/pdf.test.mjs tests/pdf-worker-cancel.test.mjs`（修复前取消用例失败）。
已给该测试专用 `TMPDIR` 并只扫描该目录（只改测试）；修复后同一命令 6/6 通过，全量
`npm test` 在无并行评审负载下 185/185 通过。

`doctor --json`（临时 `OURFAIRY_HOME`）的 ourfairy 检查均 ok（bundle packages 报
10 declared / 15 mounted，plugin compatibility 报 12 installed / dsh 0.2.1-alpha.2），
唯一 FAIL 是已知 rikkahub 外部漂移。

## 子票关闭

- #104：`tests/bundle-only-profile.test.mjs`（profile 只声明 bundle + 测试探针、真实
  pnpm 安装、直接 dsh boot、探针 ok、认证 chat turn、缺包失败点名）；证据
  `work/implementation/evidence/104-bundle-only/README.md`。
- #105：`tests/row-addressability.test.mjs`（投递/群组/bash disable 经 launcher 启动，
  bash 能力缺席且调用明确失败；替换 shell provider 后 launcher 仍 ready、其他 provider
  不受影响；非法 identity path 与 spaces root 在加载期失败并命名行/字段；fs 级联单独
  记录）；证据 `work/implementation/evidence/105-overlay/README.md`。
- #106：本目录。

## 未执行项与原因

- `combo:verify` 未全绿：唯一失败是 rikkahub 分支 tip `2d97ed14` 与 `combo.json` 锁定
  `460109d1` 的外部漂移（另一 spec 的归档提交）。按 `73-execution.md` 的纪律未改
  `combo.json`、未 checkout rikkahub；ourfairy 与 dsh 两项 ok。
- 未调用真实模型/云服务（测试使用模型替身）；未跑 Android/rikkahub 构建与真机；
  未做 npm 发布、plugin manager、Android API 迁移——均为 spec 明确 out of scope。
- 未验证非锁定 dsh 版本：兼容判定只对照 `combo.json` 锁定的版本线。
- spaces subpath 行（`@ourfairy/dsh-spaces/fs` 等）的 `readPluginMeta` 不读包根 locale；
  插件页若要求每行独立元数据，再补 subpath locale exports（本 spec 的 locale 仅为
  最小元数据，插件管理器不在范围）。
