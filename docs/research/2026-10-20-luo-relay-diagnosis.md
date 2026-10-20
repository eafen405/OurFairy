> 2026-10-20 状态：现行。本文记录 2026-10-20 的判断，不描述当前实现。

# luo 中转站故障诊断（2026-10-20）

诊断对象：dsh `luo` 供应商（`https://ai.xiaoluoapi.xyz`，`deepseek-v4.1-flash-1017`）在 2026-10-20 的异常表现：
输出被无理由截断、空响应、"自动概述后停摆"、异常中断且尾部带特定字符、`<thought>` 原样渲染。

## 结论

**根因在供应商侧（luo 中转站），不是 dsh 的映射或 token 预算问题。** 同时存在两类独立故障：

1. **伪造 `finish_reason: "length"` 的空响应。**
   21 次响应的 `content` 为空、`usage` 全 0、`stopReason` 为 `length`，全部来自 `chatcmpl-<32hex>` 命名空间；
   正常响应全部是 `resp_*`。21 次集中在 **25 分钟窗口**（北京时间 14:13:52–14:37:55）内，横跨 **8 个会话**，
   窗口过后同一配置立即恢复。这是上游/网关故障，不是模型真的撞到输出上限。

2. **特殊控制 token 泄漏进正文。**
   `</｜｜DSML｜｜ parameter>`、`<｜｜DSML｜｜tool_calls>`、`<thought>`、`<thinking>`、`<important>`、`<**>`
   被直接解码进 `content`。真实 DeepSeek API 会把它们转成 `reasoning_content` / 结构化 `tool_calls`；
   泄漏后表现为：`<thought>` 原样显示、工具调用被写成文本、回合以 DSML 关闭标记结尾提前结束。

**dsh 侧没有错。** 配置 `maxTokens=384000`、`contextWindow=1000000`；实测长输出 21,265 completion tokens
正常 `stop`（会话中还出现过 58,782 tokens 的流，被用户中止），132,053 prompt tokens + 128,000 `max_tokens` 也正常。
截断事件的实际输出只有 0–6,700 tokens。
dsh 只是忠实执行了 `finish_reason=length → "已达到输出 token 上限"`（`stream.ts:109`）。

**下游可做的不是"修复"，而是"止损"**：把这种不可能来自真实模型的空 length 识别为上游异常并重试/报错，
而不是当作 token 上限；清洗入站控制 token，避免污染下一轮请求。详见"解决方案 B"。

## 证据

### 1. 空 length 响应清单（21 条，全部 `chatcmpl-` 命名空间）

| 时间（UTC+8） | 会话 | stopReason | usage |
|---|---|---|---|
| 14:13:52 | session-f8f389d3（主会话） | length | 全 0 |
| 14:14:04 | session-f8f389d3 | length | 全 0 |
| 14:14:38 | session-f8f389d3 | length | 全 0 |
| 14:16:40 | session-f8f389d3 | length | 全 0 |
| 14:16:51 | 4a62e6be（子代理） | length | 全 0 |
| 14:16:52 | bb9132ae（子代理） | length | 全 0 |
| 14:16:57 | session-f8f389d3 | length | 全 0 |
| 14:17:40 | bb9132ae | length | 全 0 |
| 14:18:09 | session-f8f389d3 | length | 全 0 |
| 14:18:12 | 4a62e6be | length | 全 0 |
| 14:18:18 | session-f8f389d3 | length | 全 0 |
| 14:19:24 | session-f8f389d3 | length | 全 0 |
| 14:20:44 | session-f8f389d3 | length | 全 0 |
| 14:21:14 | session-f8f389d3 | length | 全 0 |
| 14:28:03 | session-f8f389d3 | length | 全 0 |
| 14:28:43 | 7666b295（子代理） | length | 全 0 |
| 14:33:12 | b97d853c（子代理） | length | 全 0 |
| 14:33:21 | 9246a7c9（子代理） | length | 全 0 |
| 14:34:26 | c159c587（子代理） | length | 全 0 |
| 14:37:43 | session-22cfc680（主会话） | length | 全 0 |
| 14:37:55 | session-22cfc680 | length | 全 0 |

响应 id 形态（故障样本）：`chatcmpl-6518be188905433090c746427f2d168a`。
正常响应形态：`resp_dbb343685b0a4a469bf2898b` / `resp_95200eafa…`。

### 2. 命名空间 × 内容统计（`~/.dsh/sessions/--home-eafen405-projects-OurFairy--`，180 个会话）

| responseId 前缀 | 有内容 | 空内容 | stopReason |
|---|---|---|---|
| `resp_*` | 857 | 0 | stop / toolUse |
| 其他（无 replay 元数据） | 11,849 | 0 | — |
| `chatcmpl-*` | 1（toolUse，03:40） | **21** | 全部 `length` |

空响应与 `chatcmpl-` 后端一一对应，且 `usage` 全 0 —— 上游根本没跑模型，是网关合成的终止块。

### 3. 对照实验（同一 key、同一模型、同一天）

| 实验 | 输入 | 输出上限 | 结果 |
|---|---|---|---|
| 短问答 ×2 | 53 / 53 tok | 384,000 / 8,192 | `stop`，213 / 221 tok |
| 长列表生成 | 71 tok | 384,000 | `stop`，**21,265 tok** |
| 长推理题 | 102 tok | 384,000 | `stop`，4,400 tok |
| 大上下文 | **132,053 tok** | 128,000 | `stop`，132 tok |
| 8 并发 | 75,053 tok ×8 | 128,000 | 8/8 `stop`，无异常 |
| 结构化工具调用 | 339 tok | 128,000 | `finish=tool_calls`，24 个 delta，正常 |

结论：token 预算、上下文规模、并发都不是触发条件；故障窗口内才会出现。

### 4. 控制 token 泄漏样本

子代理 `4a62e6be` step 32 的 assistant 正文结尾（`stopReason=stop`，没有 tool-call 块）：

```text
…Let's inspect `scripts/ourfairy-backend.mjs` around profileManifest.</｜｜DSML｜｜ parameter>
```

子代理 `bb9132ae` step 33 同样以 `</｜｜DSML｜｜ parameter>` 结尾后 `stop`。
主会话 `f8f389d3` 的 6 条 assistant 正文含 DSML，其中 5 条同时带 tool-call（文本里写了一遍、结构里又调了一遍）。

主动复现（`work/tmp/luo-diag-2026-10-20/probe3.mjs dsml`）：把 DSML 尾部放进 assistant 历史，中转站直接把它当正文回显：

```text
<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="container.exec">
<｜｜DSML｜｜parameter name="cmd" string="true">pwd && git statu…
```

这就是"工具调用变成文本、回合提前结束"的形态，也是用户看到的"特定字符尾"。

### 5. 两类故障相互独立

DSML 泄漏在**没有** max-tokens 记录的会话里同样存在（`session-159f030f`、`session-7e8c0e81`，均为 `completed`）。
所以不是"DSML 导致 length"，而是同一上游的两条故障路径。

## 机制推断

- **空 length**：请求被负载均衡到 `chatcmpl-<32hex>` 后端（与正常 `resp_*` 后端不同）。该后端在上游失败时没有返回
  `error`/5xx，而是合成 `choices[0].finish_reason = "length"`、空 delta、`usage` 0、`[DONE]` 的合法 SSE。
  pi-ai 如实映射 `length → max-tokens`；dsh 于是显示"已达到输出 token 上限"。
- **DSML**：上游的 detokenizer 把工具调用/思考通道的特殊 token 解到 `content`，而不是分流到 `reasoning_content`
  与 `tool_calls`。模型本身仍在正常生成，但协议层已经错位。
- **"自动概述后停摆"**：压缩摘要请求若命中伪造 `length`，`summarizer.ts:203` 会把它变成 `MAX_TOKENS` 硬错误，
  `compaction-basic` 的重试循环只在成功返回后重试（`index.ts:330`），异常直接抛出 → 压缩失败、回合中断。
  这条链与代码一致，但**本轮 luo 会话里没有压缩记录**（只有 10-14/15 的 `compaction/*`，其中两次 `Request aborted`），
  所以"自动摘要"这一项目前是**高度可疑、待证据**，不是已证事实。

## 解决方案

### A. 供应商侧（根治，唯一能真正修好的）

把以下证据发给 luo 中转站运营方：

1. 时间窗 2026-10-20 14:13:52–14:37:55（UTC+8），`deepseek-v4.1-flash-1017`；
2. 故障响应 id：`chatcmpl-6518be188905433090c746427f2d168a` 等 21 条，特征 `content=[] / usage=0 / finish_reason="length"`；
3. 正常响应 id 是 `resp_*`，怀疑故障窗口内被路由到另一个 `chatcmpl-*` 后端；
4. 同期 `</｜｜DSML｜｜ …>` 被解码进正文，要求检查 detokenizer / 特殊 token 处理；
5. 要求：上游失败返回真实错误（4xx/5xx 或 SSE `error`），不要伪造 `length`；特殊 token 不得进入 `content`。

### B. dsh 下游止损（建议，不能替代 A）

**B1. 空 length 归类为可重试的上游异常（约 10 行）。**
`packages/llm/llm-pi-ai/src/stream.ts:109`：

```ts
case 'length':
  // 一个真实模型不可能在零输出、零用量的情况下撞到 token 上限。
  // 这是网关合成的终止块：按可重试的上游错误处理，而不是 max-tokens。
  if (message.content.length === 0 && message.usage.output === 0) {
    return {
      kind: 'error',
      failure: {
        message: `provider "${message.provider}" returned an empty length response`,
        code: 'EMPTY_LENGTH',  // 或复用 EMPTY_RESPONSE_CODE
      },
    }
  }
  return { kind: 'max-tokens' }
```

同时把新 code 加进 `packages/llm/llm/src/retry-policy.ts:18` 的 `DEFAULT_RETRYABLE_CODES`
（默认已有 `EMPTY_RESPONSE_CODE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`，`maxRetries=5`）。
效果：窗口期内自动退避重试，UI 显示真实原因，而不是误导性的"已达上限"和无效的"继续"。

**B2. 入站控制 token 清洗（可选，防止污染下一轮）。**
在 adapter 的 text delta 落盘/回放前，剥离已知特殊 token 形态
（`/<｜｜DSML｜｜[^>]*>/gu`、`</?thought>`、`</?thinking>`、`<important>`、`<**>`）。
范围要窄、只删已知标记，且计数打点；不要碰正常尖括号文本。清洗后 `<thought>` 渲染问题一并消失。

**B3. 压缩摘要对伪造 length 重试。**
`summarizer.ts:203` 的 `MAX_TOKENS` 分支改为可重试错误（或在 `compactRegion` 外层对该 code 重试一次），
避免一次假 length 就让整轮对话卡死。

### C. 规避（临时）

- 换 provider 路由：`chunfeng`（同模型族）或 `minimax-cn`；本次故障只在 luo 的 `chatcmpl` 后端。
- 让运营方切换/下线故障后端；或确认 `luo-hajimi`（responses API）是否走不同后端。
- 不建议靠调小 `max_tokens` "规避"——故障与预算无关（0 输出也报 length）。

### D. 观测（下次能自证）

- 在 adapter 记录 `response.id` 前缀与上游响应头；本次能定位全靠 transcript 里的 `replayState.response.responseId`。
- 目前 transcript 只存 `turn/end` 的 reason，不存每步 `stopReason`/`responseId`（assistant message 里有 replayState，够了）；
  建议 `dsh doctor`/日志在出现 `EMPTY_LENGTH` 时打一条带 id 的告警，便于向供应商举证。

## 复现与验证

证据脚本在 `work/tmp/luo-diag-2026-10-20/`（不随仓库提交）：

```bash
# 解出会话（多 frame zstd）
node extract.mjs ~/.dsh/sessions/--home-eafen405-projects-OurFairy--/<session>/session.v4.jsonl.zstd out.jsonl

# 空响应与 id 命名空间统计
node events.mjs ~/.dsh/sessions/--home-eafen405-projects-OurFairy--
node ids.mjs    ~/.dsh/sessions/--home-eafen405-projects-OurFairy--

# 供应商对照实验（需要 LUO_API_KEY）
node probe2.mjs long-384k 384000 long
node probe3.mjs dsml
node probe4.mjs ctx130k 7000 128000
node burst.mjs 8 4000 1
```

## 待确认

1. "自动触发的概述后停止工作"是否发生在压缩摘要请求上：下次复现时抓 `compaction/start` 附近的
   assistant 响应 `responseId`/`stopReason`，若为 `chatcmpl-*` + `length` 即闭环。
2. 故障窗口是否与供应商切换后端/发布有关：可向运营方要 14:13–14:38 的路由日志。
3. `chatcmpl-<32hex>` 后端是否只在特定模型别名上出现：可对比 `deepseek-v4.1-flash`（无 `-1017`）与 `-1017`。
