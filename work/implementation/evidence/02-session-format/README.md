# 票 #25 证据：扩展会话归属与投递的正式记录格式（dsh 原生侧）

- 父规格：issue #23；本票：issue #25（票面 `work/tickets/ourfairy-v1/02-session-format.md`）
- 仓库：dsh fork `eafen405/deepseek-harness`
- 分支：`ticket/25-session-format` → 已合并 `product/ourfairy-v1`
- 提交：
  - `36668737699d36da33bb03d4483e0577ca0bf552` 会话归属（可选相容扩展）
  - `b7986437a0856ec542e168bfdf5f17f8221b12ef` 投递事件（新 surface 事件类型）
  - `0284c1d01989e2c300626ae3e81d16c23fb34923` 收窄被放宽的 `AssistantMessage.source` 的全部消费者
  - 合并提交：`2f084be06e75cd56c2a7ac9a31e155db9f4deee0`（`product/ourfairy-v1`，已推送到 fork）
- 记录：`docs/persistence-changes/2026-10-14-session-owner-and-delivery.md`（+ `.zh.md` / `.i18n.yaml` / `.schema.json`）

## 复现命令

以下命令在合并后的 `product/ourfairy-v1`（`2f084be06e75cd56c2a7ac9a31e155db9f4deee0`）上执行，代理环境变量已清除（本机 `http_proxy` 指向 127.0.0.1:7890，Node 的 fetch 会把 loopback 也送进代理）：

```bash
CLEAN="env -u NODE_USE_ENV_PROXY -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy"
$CLEAN corepack pnpm@11.28.5 run typecheck
$CLEAN corepack pnpm@11.28.5 run verify-persistence-catalog
$CLEAN corepack pnpm@11.28.5 run verify-session-format-catalog
$CLEAN corepack pnpm@11.28.5 run verify-persistence-formats
$CLEAN corepack pnpm@11.28.5 run verify-persistence-releases
$CLEAN corepack pnpm@11.28.5 run verify-persistence-changes
```

## 逐条对应票面验收

### 1. 明确格式演进/安全读取方案，归属与投递来源贯穿会话头、创建元数据、编码/解码、事件验证与 catalog；已发布旧代不被覆写

**方案**：`owner` 作为**可选**字段做相容扩展，**不升 `SESSION_FORMAT_VERSION`**。v4 自持 header 编解码（`session-format-v3-to-v4/src/codec.ts`：`releasedV2PhysicalRow` / `decodePhysicalV4Header` / 剥离并回填的 `encodeHeader`）。**released v2 契约未拓宽**（`session-format-v1-to-v2` 未改）。

贯穿路径：`SessionHeader.owner?` → `CreateSessionOptions.meta.owner?` → `CreateAgentOptions.meta.owner` → `prepare()` 映射 → `fork()` 继承 → `SessionFormatHeader.owner?` → v4 编解码 → `assertReleasedV4Header` 准入 → JSONL header 白名单五处 → `currentHeader` → 生成的 catalog。

证据：
- `verify-persistence-catalog` **EXIT=0** — `… are up to date.`
- `verify-session-format-catalog` **EXIT=0** — `generated.ts is up to date.`
- `packages/session/session-format-v3-to-v4/tests/codec.spec.ts:46` `it('admits the durable session owner on the native v4 header and refuses a malformed one')`

### 2. 使用正式会话/持久化接口证明往返与重启读取保留必要字段（不能只验证类型可编译）

证据（**走真实持久化接口**，不是类型检查）：
- `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts:439` `it('round-trips the durable session owner through the header line')`
- 同文件 `:2567` `it('restores the durable session owner through a real persistence reopen')` — **真实重开持久化**后仍保留归属
- 实测：`session-persistence-jsonl` **19 files / 746 passed | 1 skipped (747)**，EXIT=0
- 实测：`core/session` **19 files / 562 passed (562)**，EXIT=0

### 3. 投递可表达真实来源、稳定身份与附件引用，不伪造 turn/step/stream，也不以可忽略记录掩盖未来模型可见内容

**新 surface 事件类型** `delivery/message`（**未复用 `assistant/message`**，那必须伪造 turn/step/stream）。命名与既有的 `session-log-deepseek/delivery-accepted`（增量上传标记，另一概念）明确区分；来源 kind 定为 `'delivered-message'`，**故意不叫 `'delivery'`**，因为 `'delivery-accepted'` 含子串 `delivery`，字符串层面要不可能混淆。

payload：`{ deliveryId, origin: { sessionId, owner? }, message, attachments? }`；`DeliveryAttachmentRef = ImageBlock['attachment'] | FileBlock['attachment']`（从 `@deepseek-ai/dsh-llm` 取类型，**未新增包依赖**）。

证据：
- `packages/core/session/tests/delivery-message.spec.ts:44` `derives an assistant message from a non-model delivery source`
- 同文件 `:54` `carries no fabricated model turn, step, or stream field`
- 同文件 `:69` `is required vocabulary rather than an ignorable record`
- 同文件 `:73` `forbids citing source events, exactly like an embedded assistant message`
- 同文件 `:79` `refuses a payload whose delivery identity and message source disagree`
- 提取/序列化/查询侧：`packages/session-query/session-query/tests/delivery-extraction.spec.ts`、`packages/llm/llm-deepseek/tests/delivery-serialize.spec.ts`

### 4. 相容扩展并同步必要的 surface、消息、查询及协议消费者，本票独立保持构建与兼容检查通过；历史缺归属不猜为用户 1

**「不猜为用户 1」**：
- `SessionHeader.owner` 缺失是**合法**状态，格式层从不默认或猜测归属（`core/session/src/index.ts` 的校验注释明写）。
- 测试 `jsonl.spec.ts:455` `it('keeps an unowned header ownerless instead of defaulting it to a user')`
- 「缺归属即拒绝」属于**产品/授权边界**（票 #27），不在格式层强制 —— 格式层只保证「不发明归属」。

**`typecheck` 真实结果 EXIT=0**（host + client 两个工程都过）。独立复核：推送 `product/ourfairy-v1` 时 dsh 上游自带的 `pre-push` lefthook 钩子在**合并后的提交**上重跑了 `pnpm run typecheck`，`✓ typecheck (126.45 seconds)` 通过。

**被放宽的联合类型的真实连锁影响**（详见下节「红 → 修了什么 → 绿」）。

### 5. 未完成产品接线的入口保持未开放；原有合法格式/数据路径按明确策略处理；不删除旧格式 reader

- 未挂载/未接线的入口保持不开放，本票未开放任何新入口。
- **未删除任何旧格式 reader**：v0–v3 reader 全部保留。
- 证据：`verify-persistence-formats` **EXIT=0** — `Persistence formats: v0 through v4 verified (5 complete references).`
- 证据：`verify-persistence-releases` **EXIT=0** — `Persistence release archive: 26 records, 25 adjacent transitions verified.`

### 6. 已有日志回放、字段往返与未知必读事件行为有回归证据；交付受影响消费者清单与后续使用契约

**未知必读事件行为**：`packages/session/session-format-v3-to-v4/tests/codec.spec.ts:141` `it('preserves unknown ignorable values and requires installed vocabulary for unknown required events')`

**受影响消费者清单**（改 `AssistantMessage.source` 后必须同步的封闭 switch / 格式投影）：

| 消费者 | 文件 | 处理 |
|---|---|---|
| LLM 适配器路由 | `packages/llm/llm/src/index.ts`（`forAdapter`） | 非 model 来源直接原样返回，不参与适配器路由 |
| pi-ai 重放 | `packages/llm/llm-pi-ai/src/replay.ts` | 引入 `FOREIGN_ROUTE = 'dsh-foreign'` 哨兵；非 model 来源或无 `replayState` 走 `foreignAssistant` |
| token 计量 | `packages/llm/token-meter/src/turn-usage.ts`（`messageRoute`） | 非 model 来源不归属任何路由，返回 `undefined` |
| 会话引用投影 | `packages/context/session-reference/src/projection.ts` | 为 `delivery/message` 加**显式** `case`，文本作为 assistant 轮次进入对话；保留 `default: assertNever(...)` |
| DeepSeek 上传 wire | `packages/session/session-log-deepseek/src/index.ts` + `src/types.ts` | 为 `delivery/message` 加显式 `case`（与 `assistant/message` 合并），wire 类型的 `sourceEventSeqs?: never` 条件放宽为 `K extends 'assistant/message' \| 'delivery/message'` |
| claude-code-mods | `packages/experimental/claude-code-mods/src/index.ts` | 非 model 来源只贡献回答文本，**不写入伪造的 usage.model** |
| JSONL 世代校验 | `packages/session/session-persistence-jsonl/src/generation.ts` | 仅对 model 来源比对 `replayState` |
| 轨迹 UI | `packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts` | 非 model 来源用条件展开**整体省略** `providerMetadata`（而非给一个 `undefined`） |

**后续使用契约**：投递消息在收件方表现为**普通 assistant 消息**（`role: 'assistant'` + 非 model 来源），因此后续用户回复会进入既有模型历史；`delivery/message` 是**必需词汇**而非可忽略记录，因为它承载未来模型可见内容。本票不建立第二套消息系统。

## 红 → 修了什么 → 绿（如实记录）

1. **A1–A9（归属）** 先写红测试再实现 → 提交 `3666873769`。
2. **(b) 投递事件** 先写红测试再实现 → 提交 `b7986437a0`。
3. **93 个测试失败**：初判为环境问题。**对照证据**：
   - 未清代理：**5 个文件 / 93 个测试失败**
   - 清代理后：**70 个文件 / 1662 个测试通过，EXIT=0**
   → 确认为本机 Clash 代理把 loopback 也路由到 127.0.0.1:7890 所致，不是改动引入的失败。
4. **门禁第一次红**：
   - `verify-persistence-formats` EXIT=1（历史格式事实过期）→ 用 `verify-persistence-formats --write` 刷新 3 个文件（仅 Current-checkout 行 `63 / 597` → `64 / 606`，v0–v3 未改）→ EXIT=0。
   - `verify-persistence-changes` EXIT=1（8 个未确认变更）→ 见下。
5. **`typecheck` 真实结果是 EXIT=2，曾被管道掩盖成 0**：第一次跑成 `… | tail` 且脚本以 `echo` 收尾，打印出 `exit code 0`，但内部的 `EXIT=2` 才是真实结果。**这正是票面与协作约定警告的陷阱**，记录在此。真实原因是把 `AssistantMessage.source` 放宽为 `ModelMessageSource | DeliveredMessageSource` 的连锁影响：**4 个生产消费者 + 4 个既有测试**（外加我自己 2 个测试）需要收窄。收窄**只做类型层面**，**未削弱任何既有断言**，也**未回退联合类型设计**（放宽 source 是票面要求）。
   - 其中客户端工程报 `exactOptionalPropertyTypes` 下的 TS2375：三元的 `providerMetadata: … : undefined` 不可赋值 → 改为**条件展开**，非 model 来源整体省略该字段。
   - 修复后：**`TYPECHECK_EXIT=0`，0 个错误**（host + client 都过）；合并提交上钩子复跑同样通过（126.45s）。
6. **`persistence-changes --record` 调用形式踩坑**：`pnpm run persistence-changes -- --record …` 报 `Unexpected argument '--record'`，因为多余的 `--` 使 `--record` 变成位置参数，而该 CLI 用 `parseArgs({ strict: true, allowPositionals: false })`。**去掉多余的 `--`** 后正常。
7. **最终门禁全绿**（我在合并后的 `2f084be06e` 上独立复跑，非转述）：
   - `verify-persistence-catalog` **EXIT=0**（`… are up to date.`）
   - `verify-session-format-catalog` **EXIT=0**（`generated.ts is up to date.`）
   - `verify-persistence-formats` **EXIT=0**（`v0 through v4 verified (5 complete references).`）
   - `verify-persistence-releases` **EXIT=0**（`26 records, 25 adjacent transitions verified.`）
   - `verify-persistence-changes` **EXIT=0**（**`64 roots match 14 history records.`**）
   - `typecheck` **EXIT=0**

## 相关测试的真实数字（清代理 + `set -o pipefail`）

| 包 | 结果 |
|---|---|
| `core/session` | 562 passed（19 files） |
| `core/agent-loop` | 450 passed |
| `llm/llm` | 277 passed |
| `llm/llm-deepseek` | 550 passed |
| `llm/llm-pi-ai` | 388 passed |
| `llm/token-meter` | 121 passed |
| `context/session-reference` | 50 passed |
| `experimental/claude-code-mods` | 99 passed |
| `session/session-persistence-jsonl` | 746 passed \| 1 skipped（19 files） |
| `session/session-log-deepseek` | 46 passed |
| `session-query/session-query` | 101 passed |
| `client/ui-trajectory` | 200 passed \| 3 skipped |
| **合计** | **3590 passed，4 skipped** |

（`session-persistence-jsonl` 与 `core/session` 两个包由我在合并后的 `2f084be06e` 上独立复跑确认，数字一致。）

## 未执行 / 未通过项

- **「OurFairy 组合与兼容测试」部分**：票面把「OurFairy 组合及兼容测试」列为本票涉及范围。本票交付的是 dsh 原生侧改动 + 生成的 catalog/记录；OurFairy 侧的组合级兼容测试**未在本票内单独执行**，随主集成组合（票 #44）验证。当前已确认的相邻证据：`combo.json` 的 dsh pin 已更新到 `2f084be06e75cd56c2a7ac9a31e155db9f4deee0`，`node scripts/combo.mjs verify` 三个仓库全部 `ok`（`VERIFY_EXIT=0`）。
- **未跑整仓全量 vitest**：只跑了上表 12 个受影响包（票面要求「相关兼容检查」，未要求全仓）。全仓 lane 归 CI。
- **未做真机/真实云服务验证**：本票是后端原生表示改造，与设备无关；按当前目标范围，真机与真实云服务验收**不在本票**（且已明确暂不纳入本轮目标）。
- **`combo.json` 的 rikkahub pin 未更新**：rikkahub 的 `product/ourfairy-v1` 尚无产品提交（仍为 `0966502c4d65c1ee4b2a3e49a19703bb1978016c`）。rikkahub 侧的票 #26 改动仍在 `ticket/03-identity` 分支，合并后需同步更新该 pin。
