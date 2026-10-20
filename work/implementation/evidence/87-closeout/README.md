# 87-closeout — 票 #87 证据

票面：OurFairy#87（父规格 #71）。集成分支 `integration/spec-71`，收口时被测
HEAD `8821da3`（#86 合入后的 tip）；本文、索引与边界实测记录随后由一个只改
文档的提交加入。固定组合（`combo.json`）：dsh
`5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`，rikkahub
`2d97ed143e7a6487515e4aa784d937c785e76b3c`。

## 本轮收口改了什么

| 内容 | 位置 |
| --- | --- |
| rikkahub pin 从 `460109d1` 移到归档 tip `2d97ed14` | `combo.json`（`319c206`） |
| dsh pin 保持 `5b8ec0f175`（#84 合并 tip，已推 `fork` 远端） | `combo.json`（`78949a4`，#84 随该组合进入） |
| #86 升级依赖记录与 doctor `native capabilities` 检查 | `18164fa`，证据 [86-upgrade-review](../86-upgrade-review/README.md) |
| 评审修复：PDF stderr 有界化、取消映射、#84 证据、注释与链接 | `f87585b`，见 [81-pdf-subprocess](../81-pdf-subprocess/README.md) 与 [84-history-seam](../84-history-seam/README.md) |
| 本文与证据索引 | 收口提交 |

`combo.json` 的 dsh 字段本轮没有新提交可改：`product/ourfairy-v1` 的 tip 仍是
`5b8ec0f175`。#81/#82 已先合入 `integration/ourfairy-v1`；#83/#85/#86 在
`integration/spec-71` 上，随本分支交付。

## 最终集成状态与命令

在 `/home/eafen405/projects/OurFairy/.worktrees/spec71-integration`（HEAD
`8821da3`，工作树上只多了本证据提交）执行：

```
$ npm test
ℹ tests 150
ℹ suites 7
ℹ pass 150
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 77570.804446
```

```
$ npm run backend:doctor
ok    native capabilities: llm-retry:@deepseek-ai/dsh-llm-retry, spill-local:@deepseek-ai/dsh-spill-local,
      spill-policy:@deepseek-ai/dsh-spill-policy, subprocess:@deepseek-ai/dsh-subprocess-local,
      @deepseek-ai/dsh-agent/session-history
doctor: all checks passed
```

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  based on integra  8821da3dc9f7e68a  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      2d97ed143e7a6487  2d97ed143e7a6487  ok
combo: combination verified
```

dsh 侧接缝契约测试（#84，独立 dsh 检出，不在 `npm test` 内）：

```
$ corepack pnpm@11.28.5 exec vitest run packages/core/agent/tests/session-history.spec.ts \
    packages/core/agent/tests/session-history-loader.spec.ts
Test Files  2 passed (2)
     Tests  8 passed (8)
```

## 替身与真实服务分界

- **真实：** 启动器、已安装 profile、dsh 的 profile loader、真实隔离
  `OURFAIRY_HOME`/`DSH_HOME`、真实子进程与 bwrap、doctor 进程、dsh vitest。
- **替身：** 模型是 loopback Messages 替身；Android 不参与；未调用真实
  MiniMax/DeepSeek。
- 测试替身不改变被测的组合：行、服务、历史 seam 都来自锁定 dsh 与 bundle。

## 评审发现的处理

2026-10-20 对当时状态（`integration/spec-71` + #86 未提交工作树）跑了
Standards/Spec 两轴评审。逐项处理如下。

**已修复**

- PDF 的 `stderr: 'ignore'` 不是 subprocess 服务的输出模式（会被当成无上限
  collector）；改为 4 KiB 有界、丢弃的 collector（`f87585b`）。
- PDF 取消被映射成 `worker-unavailable`，与规格/证据表要求的数字状态不一致；
  服务终止（deadline/调用方停止，SIGTERM）统一为 `resource-limit`，测试与
  README/证据同步（`f87585b`）。
- #86 证据缺 “Full suite” 段、承诺了不存在的章节；补实测 150/150（本文件与
  `86-upgrade-review`）。
- 升级记录写 “doctor checks before a boot”，doctor 实际是手动命令；改为
  “run doctor before a boot”（`18164fa`）。
- 升级记录重复了两处 bundle 配置值（`maxInlineTokens`、`retryPolicy` 对象）；
  数字与对象只留在 bundle 与 #82 证据，记录只声明依赖与行为（`18164fa`）。
- profile loader 异常会原样逃出为未知错误；现在返回命名失败（`18164fa`）。
- #84 缺 OurFairy 侧证据目录；新增 `84-history-seam`，并实跑 dsh 契约测试
  8/8（`f87585b`）。
- #82 两处注释把上游行为说过头；`tests/gateway.test.mjs` 的 `repeatLast`
  注释已过时；按固定版本改写（`f87585b`）。
- #86 测试的未使用 `after` 导入已删除（`18164fa`）。

**记录为已知限制 / 不本轮修改**

- **图像结果的 spill**：规格要求文本与图像同一内联预算；锁定的 `llm-pi-ai`
  没有 `imageRequestPricing`，`spill-policy` 对含图像结果走「保留原内容 +
  warn」。这是上游能力缺口，不是产品可补的适配；#82 证据已记录
  `82-native-rows/README.md` 的「图像结果的 spill 未覆盖」。
- **历史 seam 比规格正文窄**：规格正文要求 seam 覆盖固定
  `throughSeq`/`beforeSeq`/`maxEvents`、冷读；实测 `api-session-controller`
  不在产品可解析安装域，`history.ts` 也不在公开 exports，引入 controller 被
  规格禁止。本票暴露 assistant 基线与 durable cursor/gap 判定；`/chat/page`
  的窗口与切片按 #85 AC5 归 #72。见 `84-history-seam/README.md`。
- **`REQUIRED_NATIVE_ROWS` 是依赖门禁，不是行清单**：它只列产品读取的四行与
  一个公开导出；完整行清单仍只有 `backend/v1-bundle/cordis.patch.yml`。与
  #73 的 `#96` 不冲突：该检查判断「产品依赖还在」，不判断「bundle 声明了
  哪些行」。合并 #73 时把 installed-profile 读取改为复用
  `scripts/combo.mjs` 的 `installedBundle()`，避免两次 loader 读取。
- **dsh 侧两处风格/测试缺口延迟**：`session-controller/src/history.ts` 的
  `AssistantStreamRecord` switch 未加 `assertNever`；`agent/README` 的
  dispose 行为没有单独测试。修改 dsh 会把锁定提交移出 #84 的 tip，并与并行
  的 #72/#73 组合核对冲突；本轮不改，记录在 `84-history-seam/README.md` 的
  「未执行 / 已知缺口」。
- **#85 每次 projection 的 seq 校验成本**未做性能测量；投影性能归 #72
  （#85 证据第 148 行已声明）。
- **`grep` 取回**：#83 票面写 read/grep，锁定的 dsh 没有原生 `grep` 工具；
  取回由 `read` 与受限 shell 的 `grep` 承担，测试断言工具目录没有 `grep`，
  不新增工具名（#83 证据已解释）。

## 与 #72/#73 的合并注意（供 Lead/合并者）

- **#72** 改 `backend/chat/src/runtime.mjs`、`service.mjs`、`projection.mjs`、
  `index.mjs`、`package.json` 与投影测试；#85 只替换算法调用点（原生
  assistant 基线/事件 cursor），不重写分页。合并时按 #72 的读取路径为准，
  #85 的 `attemptOf`/`contiguousEvents` 调用点落在其新结构上；合并后重跑
  `tests/reconnect.test.mjs` 与全量。
- **#73** 改 `scripts/combo.mjs`、`scripts/ourfairy-backend.mjs`、
  `combo.json`、`backend/v1-bundle/README.md` 与 bundle 包集合；语义合并：
  保留 #73 的 `installedBundle()`/`verifyBundlePackages`/`verifyPluginCompatibility`
  与 row inventory，保留 #86 的 `nativeCapabilities` doctor 检查并复用它读
  已安装 profile；`combo.json` 采用 rikkahub `2d97ed14` 与本轮 dsh pin；两边
  的 doctor 检查都保留。合并后重跑 `npm test`、`npm run backend:doctor`、
  `npm run combo:verify`。
- 两分支都未修改对方的专属文件；冲突预期只在上述共享接线点。

## 未执行

- 真实 MiniMax/DeepSeek 模型调用；真实 Android 设备/模拟器；dsh 全量测试
  （按 dsh 规则只跑变更路径）。
- 合并 #72/#73 之后的组合验证（由合并者在该组合上重跑；本文件记录的是
  `integration/spec-71` 最终状态）。

## 子票关闭

按 issue tracker 方式逐票 `gh issue comment` + `gh issue close`：#81、#82、
#83、#84、#85、#86，然后 #87 自身。父票 #71 的标题、正文与状态不修改。
