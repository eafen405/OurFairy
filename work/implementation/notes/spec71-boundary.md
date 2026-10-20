# #71 边界与实测事实（给实现票的共同上下文）

父规格：[#71](https://github.com/eafen405/OurFairy/issues/71)。子票 #81–#87，任务图见各票 Blocked by。
本文件只记**在固定组合上实测过的事实**与**边界决定**；不重复规格正文。

## 组合与工具链

- 测量时产品集成分支 `integration/ourfairy-v1` @ `43dd235`，dsh fork `product/ourfairy-v1` @ `fe2bbc3b1c`；
  交付组合以 `combo.json` 为准（dsh `5b8ec0f175`、rikkahub `2d97ed14`）。
- 产品测试入口：仓库根 `npm test`（真实 launcher + 模型替身），`npm run backend:doctor`，`npm run combo:verify`。
- 产品 worktree 首次启动会在隔离 home 内 `pnpm install` 链接产品包；一个 home 约 16M，可安全放在 `/tmp`。
- dsh worktree 需要自己 `corepack pnpm@11.28.5 install`（每 worktree 独立 2.1G）；改 `src/` 后必须
  `corepack pnpm@11.28.5 run build:lib:host` 才能被产品 launcher 用到。
- **dsh 解析边界（实测）**：产品包（如 `@ourfairy/dsh-chat`）**能** `import '@deepseek-ai/dsh-subprocess'`、
  `@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-llm` 等 CLI 安装域内的包；**不能**导入只在 profile 安装域里的包
  （`@deepseek-ai/dsh-api-session-controller` 实测 `ERR_MODULE_NOT_FOUND`）。所以历史 seam 只能落在 CLI 安装域的公开包上。
- `@deepseek-ai/dsh-api-session-controller` 只导出 `"."`/`"./types"`/`"./client"`/`"./typert"`/`"./remote"`；
  `history.ts`、`assistant-stream.ts` 都不在公开 exports 里（实测 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。
  它也不在 CLI 安装域。**不要把 Client/Typert controller 引进产品**（规格明确禁止）。

## 已实测可用的原生行（#82 直接照做即可）

在真实 profile 上用 `--patch` 覆盖层挂这三行、探针调用，实测成功：

```yaml
- id: llm-retry
  name: '@deepseek-ai/dsh-llm-retry'
- id: spill-local
  name: '@deepseek-ai/dsh-spill-local'
  config:
    root: <DSH_HOME 内路径>
- id: spill-policy
  name: '@deepseek-ai/dsh-spill-policy'
  config:
    maxInlineTokens: <实测后确定>
```

- `ctx.subprocess.spawn` 从产品代码可用（探针实测 exit 0 + 读到 stdout）。
- `ctx.spillStore.saveText({owner:{sessionId},source,suggestedName,content})` 可用，返回 `{locator,bytes,retrievalHint}`，
  落盘在 `<root>/session-<sha256 前 12 位>/<random>-<name>`。
- `llm/retry`、`llm/retry-started` 已在 `KNOWN_SESSION_EVENT_TYPES` 中，持久化 reader 不会拒绝。
- `llm-pi-ai` 已实现 `providerRetryPolicy`（profile 级 `retryPolicy`），但**未实现** `imageRequestPricing`
  → 含图片的 tool 结果在 spill-policy 里会走「保留原内容 + warn」分支（`src/index.ts` 的 `pricing()`）。
  这是现状，不是本 spec 要修的；spill 验收用文本结果即可。
- 模型替身 `@deepseek-ai/dsh-llm-mock-server`：`sequence: ['rate_limit','success']`（429 + `Retry-After`）、
  `['server_error','success']`、`partial_eof` 等；`startMockLlmServer({...})` 返回 `requests`。

## 预算测量（用于 #82 的 `maxInlineTokens`）

`estimateContent`（token-meter）实测：英文约 4.0 字符/token，中文约 4.0 字符/token（该估算按字节/字符计）。
- bash 单流默认上限 64 000 字节 ≈ 11 254 估算 token；`read` 默认上限 50 KiB。
- PDF 单页文本上限 4 000 字符 ≈ 1 004 token；一次最多 5 页 ≈ 5 020 token。
- 现有 base bundle 用 12 500。取 8 000–12 500 之间都可以；**必须在票里记录实际测量与取值理由**，
  并让「预算足够小以触发 spill」的测试输出大于该值（例如 `bash` 打印 200 KB）。

## 边界决定（避免三 spec 重复劳动）

- **#72（投影性能）拥有**：`sessionProjections` 三单元、`/chat/page` 的固定截点 + 切片读取、
  `runtime.projection()` 的「durable 快照 + live overlay」。**#71 不改这些**。
- **#73（插件生态）拥有**：bundle 自描述、行级寻址、包/行清单权威、Config 元数据、launcher 包清单。
  #71 只**新增三行**到 `backend/v1-bundle/cordis.patch.yml`，不改装配机制、不改 `LINKED_PACKAGES`。
- **#71 拥有**：PDF 进程 seam、重试与 spill 的挂载与验收、spill 结果的可读回、历史/跟随的**算法**复用。
- 若 #72 先合入并改了 `service.mjs`/`runtime.mjs`，本 spec 的 #85 只改算法调用点并 rebase，不重写分页。

## 历史/跟随的现状（#84/#85 的起点）

- 产品现在自己维护：`runtime.mjs` 的 `state.attempt`（`BlockAssembler` 累计正文）、`settledAttempt`、
  `subscribe`/`publish`（每次投影都 `observeSession` 全量事件），`service.mjs` 的 `page()` 切片。
- 原生已有但**未公开导出**：`packages/api/session-controller/src/assistant-stream.ts`
  （`SessionAssistantStreamAccumulator`，含 `startedAfterSeq`、revision、dense index 校验）与
  `src/history.ts`（`follow` 的缺口检测与 assistant baseline 切点）。
- #84 应把这两个**算法**以窄的 Host 可调用形式暴露（新包或既有公开包的公开子路径），不复制、不导出 controller。
- #85 只替换产品里「累计正文 + 缺口修复」的实现；`/chat/page` 的字段与窗口语义保持不变。

## 证据协议

每票在 `work/implementation/evidence/<NN>-<slug>/README.md` 记录：改了什么、实际命令、输出摘要、
替身/真实服务分界、未执行项。原始日志不入库。

## 追加实测（2026-10-19，晚）

- 产品包可解析的 dsh 包（真实 boot 内 `require.resolve`）：`@deepseek-ai/dsh-subprocess`、
  `@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-llm`（含 `./assistant-stream`）、`@deepseek-ai/dsh-spill-local`、
  `@deepseek-ai/dsh-spill-policy`、`@deepseek-ai/dsh-llm-retry`、`@deepseek-ai/dsh-token-meter/estimate`、
  `@deepseek-ai/dsh-api-session-controller/types`。
- **不可解析**：`@deepseek-ai/dsh-api-session-controller`（主入口）——它只在 profile 安装域里，
  产品包没有把它声明为 peer。`/history`、`/assistant-stream` 也不是它的公开子路径。
- 由此：历史 seam 只能落在 CLI 安装域内的公开包（`dsh-llm` / `dsh-agent` 等）；新包若不在
  `apps/cli` 的依赖闭包里，产品无法导入。
- 产品已经在用原生的 `assembleAssistantStream` / `BlockAssembler`（`dsh-llm/assistant-stream`）。
  产品自己维护的是**帧接受状态机**（revision 重置、dense index、attempt 身份、`startedAfterSeq` 切点）
  以及 follow 的**缺口修复**——这两项才是 #84 要暴露的算法。
- `spill-local` 公开导出 `sessionDir(root, sessionId)` → `<root>/session-<sha256 前 12 位>`；
  #83 用它把「当前会话的 spill 目录」作为只读贡献挂进 spaces，不需要新导出。
