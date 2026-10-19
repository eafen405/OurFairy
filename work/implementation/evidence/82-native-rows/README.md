# 82-native-rows — 票 #82 证据

票面：OurFairy#82（父规格 #71）。在 `backend/v1-bundle/cordis.patch.yml` 挂载 dsh 原生的
`llm-retry`、`spill-local`、`spill-policy` 三行，provider 行声明 `retryPolicy`，并用真实工具
输出测量 `maxInlineTokens`。基线 `integration/ourfairy-v1` @ `43dd235`。

固定组合（`combo.json`）：dsh `fe2bbc3b1c`（`product/ourfairy-v1`）。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/v1-bundle/cordis.patch.yml` | 新增「model-request recovery and tool-result retention」分组：`llm-retry`（无 config）、`spill-local`（`root: !!js dshHomePath('spill')`）、`spill-policy`（`maxInlineTokens: 8000`）。`llm-pi-ai` 的 `minimax-cn` profile 增加 `retryPolicy: { mode: normal }`。 |
| `tests/native-rows.test.mjs`（新增，4 条） | 真实 launcher + 真实 profile + 外部模型替身：限流后重试、backoff 期间停止、大结果 spill、以及「禁用原生行后不再重试」的反向对照。 |
| `tests/gateway.test.mjs`（+1 条） | 手机保存的路由必须保留部署层声明的重试策略；含一次重启复验。 |

没有改动产品业务代码（`backend/chat`、`backend/attachments`、`backend/spaces` 未触碰），也
没有新增自写重试循环或重试计数——产品代码里原本就没有，本票不新增。

## 三行的挂载位置与取值

```yaml
- id: llm-retry
  name: '@deepseek-ai/dsh-llm-retry'
- id: spill-local
  name: '@deepseek-ai/dsh-spill-local'
  config:
    root: !!js dshHomePath('spill')
- id: spill-policy
  name: '@deepseek-ai/dsh-spill-policy'
  config:
    maxInlineTokens: 8000
```

- `spill-local.root` 用 `dshHomePath('spill')`，与 `sessions`、`identity`、`attachments` 同一
  写法，落在 launcher 的隔离 `DSH_HOME`（`<OURFAIRY_HOME>/dsh-home`）内。测试断言 locator
  以该目录为前缀（`tests/native-rows.test.mjs` 的 `spillRoot` 断言），不依赖第二个路径常量。
- `retryPolicy` 写在 `llm-pi-ai` 的 `providers.minimax-cn` 下（每路由一份，见
  `packages/llm/llm-pi-ai/README.md` 的字段表第 89 行）。`mode: normal` 即原生默认：5 次重试、
  `EMPTY_RESPONSE`/`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`、500 ms→10 s 有界退避、10% 抖动
  （`packages/llm/llm/src/retry-policy.ts`）。显式写出是因为它是部署决定而不是继承来的巧合，
  且 `llm-retry` 只执行 provider 声明的策略（未声明时服务层按同一套默认解析，但读配置的人看不到）。

## `maxInlineTokens` 的实测

估算器：`@deepseek-ai/dsh-token-meter/estimate` 的 `estimateContent`（固定密度：4 字符/token，
每块 +4）。下表是实际调用该函数得到的值，不是按公式手算：

| 真实内容 | 字符数 | 估算 token |
| --- | --- | --- |
| bash 单流上限（`bash-local` 的 `maxOutputBytes: 64_000`）纯 ASCII | 64 000 | **16 004** |
| 同上，中文（UTF-8 3 字节/字符，21 333 字符占满 64 000 字节） | 21 333 | 5 338 |
| PDF 单页文本上限 4 000 字符（`pdf-worker.py` 的 `MAX_PAGE_CHARS`） | 4 000 | **1 004** |
| PDF 一次 5 页（`pdf_read_pages` 上限，5 × 4 000 字符） | 20 000 | **5 004** |
| `read` 默认上限 50 KiB（`READ_MAX_BYTES`）纯 ASCII | 51 200 | 12 804 |
| 一次 200 KB 的 bash 输出（截断前） | 200 000 | 50 004 |

取值 **8 000**：

- 大于一次完整 5 页 PDF 读取（5 004）和单页 PDF（1 004），普通 PDF 与检索结果保持内联，
  spill 不会对已有更严格自身预算的工具反复截断。
- 小于 bash 流上限的 ASCII 满载（16 004），所以 shell 的大输出确实会走 spill，而不是「预算比
  工具自身上限还大、永远不触发」。
- 与 base bundle 的 12 500 对照：两者都能触发 bash 的英文大输出（16 004），也都能让 PDF 5 页
  （5 004）与中文 bash 满载（5 338）内联。取 8 000 的理由是余量：它比最大的普通结果（PDF 5 页）
  高约 60%，同时给 bash 自身 64 000 字节的上限留出 2 倍间隔；12 500 只剩 2.5 倍，且逼近
  `read` 的 50 KiB 满载（12 804），一旦工具的自身上限变化或结果里带 reasoning/图片描述，就会
  意外越过预算。
- `read` 自身不经过 spill（`packages/spill/spill-policy/src/index.ts:135` 对
  `exec.name === 'read'` 直接放行），所以 `read` 的 12 804 只作为「预算接近工具自身上限」的
  参照，不是真实触发路径。

一次真实 spill 的端到端测量（`bash` 打印 140 000 + 30 000 字节，spill 后模型实际收到）：

```
preview  31 930 字符 / 7 987 估算 token（预算内）
locator  /tmp/<home>/dsh-home/spill/session-d850127a0036/311a04b3e33d-bash.txt
file     64 108 字节（bash 自身 64 000 字节尾截断后的完整结果）
```

注意：bash 工具自身在 64 000 字节处截断并把完整流另存到 subprocess 日志，spill 保存的是
**工具返回给模型的完整内容**（即已经过 bash 自身截断的结果），不复制 subprocess 日志。这与
规格「若某一类工具已经有更严格的自身预算，spill 不重复截断它」一致：两层预算各管各的输出，
spill 只负责模型上下文那一层。

## 关键行为与断言

### 1. 限流后在同一 durable step 重试

`sequence: ['rate_limit', 'success']` + 一次 `/chat/send`：

- 模型替身收到 2 个请求，行为依次为 `rate_limit`、`success`。
- 同一 `requestId` 恰好 1 条用户消息、1 条 `status: 2` 的 assistant 结算；
  `settledAttempt.seq` 等于该结算消息的 seq（原生结算，不从文本推断）。
- 投影 `events` 含 1 条 `llm/retry` 与 1 条 `llm/retry-started`：同一 `retryId`、同一
  `turn`/`step`，`failure.code = RATE_LIMIT`，且 `durableThroughSeq` 覆盖 started 事件。
- 第二次请求的模型可见历史里没有 `llm/retry`、`RATE_LIMIT`、`429`、`retryId`、`rate limit`
  任何字样；用户轮次仍只有一条。
- 冷重启（stop → start，新模型替身）后 `/chat/read` 从耐久日志回放出同样两条事件与同样的消息
  身份，且不产生任何模型请求。

`llm/retry` 是 durable 事件：用 `/chat/read` 的 `events` 读取（投影本来就把原生事件原样带出），
不需要 `readSessionEvents` 或测试专用探针行。这一点在 `#82` 之前就已经成立
（`llm/retry`、`llm/retry-started` 在 `KNOWN_SESSION_EVENT_TYPES` 中，
`packages/core/session/src/known-event-types.ts:48`）。

### 2. backoff 期间停止

`sequence: ['server_error']`（`repeatLast`）+ 在替身记录到第一个请求后立即 `/chat/stop`：

- 停止到 `replyStatus: 0` 用时 < 2 000 ms（实测约 60–120 ms，含一次 HTTP 往返）。
- 等待 1 600 ms（超过被取消的那次退避及其下一档）后替身请求数仍为 1：被取消的退避没有再发
  请求。
- 耐久日志里最后一次 `llm/retry` 没有对应的 `llm/retry-started`（`started.length ===
  scheduled.length - 1`）——等待被取消，重试从未开始。
- 历史一致：1 条用户消息、没有 `status: 2` 的 assistant 结算；`error` 为 `null`（用户停止不是
  模型失败）；`attempt` 为 `null`。
- 之后的下一轮能正常发出自己的请求。

### 3. 大工具结果的内联预览与 locator

`bash` 打印 140 000 字节 + 中间标记 + 30 000 字节 + 尾标记，模型收到的 `tool_result`：

- `is_error` 为 false（工具调用本身没有失败）。
- 预览 31 930 字符（< 48 000 断言上限），保留尾部、省略中间标记。
- 末尾是原生 notice：`(Omitted N bytes. Full formatted result stored at: <path>. Use read with offset/limit, or grep this path to search within it.)`。
- `<path>` 在隔离 `DSH_HOME` 的 `spill` 根下；文件存在，包含被省略的中间标记与尾部标记，
  长度 > 预览长度。
- 该轮仍以模型的下一条回复正常结束。

### 4. 反向对照：恢复确实来自挂载的行

用 `--patch` 覆盖层 `id: llm-retry, disabled: true` 启动同一 profile：

- 替身只收到 1 个请求（`rate_limit`），失败的那一步没有被重跑；
- 没有 `llm/retry*` 事件；
- 用户消息仍是 1 条，`projection.error` 带 429 文案。

产品代码里若有自写重试，这条会失败。

## 网关与 `keepDeploymentFields`

**结论：既有行为没有坏，不需要修改 `backend/gateway/src/service.mjs`。**

- `keepDeploymentFields`（`backend/gateway/src/service.mjs:127`）只把 `reasoningEfforts`、
  `compat` 两个**模型级**部署字段搬回草稿；`retryPolicy` 是**路由级**字段，草稿从不拥有它。
- 实测：网关 `saveRoute` 用 `{op:'set', path:['providers'], value:{...providers, [provider]: profile}}`
  写入用户层（profile 的 `cordis.patch.yml`），用户层里只有 `displayName`/`api`/`baseURL`/
  `apiKeyEnv`/`models`。bundler 与用户层在 provider profile 这一层做深度合并，所以 bundle 声明的
  `retryPolicy` 仍然生效。
- 证据是行为而非源码推断：新用例 `tests/gateway.test.mjs`「a route saved from the phone keeps
  the deployment retry policy the draft does not own」先保存路由，再发一轮 `rate_limit → success`，
  断言替身收到两个请求、投影里恰有 1 条 `llm/retry`、没有 error；随后**重启**再复验一次，证明
  持久化后的路由仍然带策略。
- 反向验证过「不修就坏」的假设：在只有三行、没有 `retryPolicy` 声明的中间状态下，同一路径的
  一轮只有 1 个请求并以 429 结束（见下「中间状态」）。

## 命令与结果

```
$ node --test tests/native-rows.test.mjs
✔ a rate-limited step retries once at the durable boundary without a second user message
✔ stopping while a retry backoff is pending ends the turn promptly and never starts it
✔ an oversized bash result reaches the model with a bounded preview and a complete spill file
✔ the recovery is the mounted row: without it the same failure ends the turn
ℹ tests 4 / pass 4 / fail 0

$ node --test tests/gateway.test.mjs
ℹ tests 9 / pass 9 / fail 0

$ npm test
ℹ tests 138 / pass 138 / fail 0

$ node scripts/ourfairy-backend.mjs doctor --json
"ok": true（node version、corepack pin、combo、dsh build、product packages、isolated home、
profile project linked、model double、bundle agent model 全部 ok）
```

`npm run combo:verify`：见「未执行项」。

## Red / green

Red（三行挂载前，同一份测试文件）：

```
$ node --test tests/native-rows.test.mjs
✖ a rate-limited step retries once at the durable boundary ...
  projection 里没有 llm/retry 事件（替身只收到 1 个请求）
✖ stopping while a retry backoff is pending ...
  condition not reached ... error: "500 ..."
✖ an oversized bash result ... 
  the model must receive a locator; preview tail 以 bash 自身的
  "[output truncated; ...]" 结尾，没有 spill notice
```

Green：挂载三行 + 声明 `retryPolicy` 后 4/4 通过。

网关的新用例在**只有三行、provider 未声明 `retryPolicy`** 的中间状态下也跑过一次，用来确认
「保存路由后策略是否存在」这条断言不是空转；当时它失败（保存后的那一轮只有 1 个请求并以 429
结束），声明 `retryPolicy` 后通过。这条中间状态没有单独提交，因为它不是可交付的组合。

## 替身与真实服务的分界

- **模型替身**：`@deepseek-ai/dsh-llm-mock-server`（真实 loopback HTTP 进程，Messages 协议，
  429 带 `Retry-After`）。全部 4 条行为断言都建立在这个替身上，不涉及任何真实云服务。
- **真实的部分**：真实 launcher、真实 profile 装配、真实 dsh CLI 子进程、真实 bash 子进程
  （bwrap 沙箱内）、真实文件系统上的 spill 文件、真实耐久 session 日志与冷重启恢复。
- **未使用**：真实 MiniMax / DeepSeek 端点；`Retry-After` 的实际退避语义没有在真实网关上验证
  （pi-ai 的 `maxRetries: 0` 路径不向 adapter 暴露 `retry-after`，本票实测到的退避均为本地
  指数退避 500 ms 起——见下）。

### 一个实测事实：pi-ai 路由的退避是本地计算的

模型替身的 429 带 `Retry-After: 1`（`retryAfterMs` 默认 1 000 ms）。实测的
`llm/retry.data.delayMs` 是 452.34 ms（500 × [0.9, 1.1] 的抖动下限），不是 1 000 ms。
原因在适配器侧：`llm-pi-ai` 用 pi-ai 的 SDK 调用，错误只以 `error.message` 文本到达
（`packages/llm/llm-pi-ai/src/stream.ts` 的 `classifyPiAiError`），`providerRetryAfterMs`
没有被填。`dsh-llm-retry` 因此在没有 provider 延迟时走本地有界退避。
这不影响本票的验收（重试、取消、事件都成立），但「provider 的 `Retry-After` 会被采纳」这句
对 MiniMax 路由目前**不成立**，需要的话应由 `llm-pi-ai` 侧修，属于上游范围，不在本票。

## 未执行项

- `npm run combo:verify` 未在本票分支上单跑：`doctor --json` 的 `combo combination` 检查通过了
  同一组合校验（`verifyCombination`，`scripts/ourfairy-backend.mjs`），但整条命令的独立输出没有
  留证。合并集成分支后由 Lead 在最终状态复跑。
- 真实模型服务（MiniMax / DeepSeek）上的重试未验证：需要真实 429，本机没有可控的限流入口。
- spill 的可读回（`read`/`grep` 打开 locator）由 #83 验收；本票只断言文件存在且完整。
- 图像结果的 spill 未覆盖：`llm-pi-ai` 未实现 `imageRequestPricing`，含图片的 tool 结果在
  spill-policy 里走「保留原内容 + warn」分支（`packages/spill/spill-policy/src/index.ts` 的
  `pricing()`），这是现状，不是本票修的。
- Android 客户端未改，不需要真机验收（规格第 30 条：响应形状不变）。
