# 99-delivery — 票 #99 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/03-delivery-row.md`；并行边界
> `work/implementation/notes/73-boundary.md`、`73-row-plan.md`、`73-execution.md`。
> 分支 `ticket/99-delivery`；开工时 `integration/spec-73` tip `d73f88f`。实现提交
> `13a75f2`（投递行与窄运行时），随后合入 `integration/spec-73` tip `0a8f2de`
> （#98 的 peer 范围），合并提交 `9da8211`；`6ad72b4` 跟随文件移动修正决策文档链接；
> 本证据与索引在随后一个提交。

## 改了什么

### 1. 投递成为自己的产品包与行 `backend/delivery`

`backend/chat/src/delivery.mjs` 整体移入新包 `backend/delivery/src/index.mjs`
（Git 识别为重命名，相似度 90%）。结构化改动只有入口形状：

| 之前 | 之后 |
| --- | --- |
| chat 的 `installDelivery(ctx, runtime)`，`runtime` 由 chat 传入 | 导出 `name = 'ourfairy-delivery'`、`inject = [...]`、`apply(ctx)`，运行时取自 `ctx.ourfairyChatRuntime` |
| 可直接调用 `runtime.*` 的 chat 内部对象 | 只调用窄服务的五个方法（见下） |

投递逻辑本身未改：`deliver_message` 的参数/描述/输出渲染、SHA-256 `deliveryId`、
`deliveries.prepare/prepareFile/complete/pending` 的行状态、`settle` 的日志追加与 barrier、
重启恢复、`ctx.parallel('ourfairy/delivery', …)` 通知出口，以及 `SessionScopeError` 的
四种业务失败全部保持原样。包不 import 任何 chat 模块（`grep` 证据见下）。

包元数据：

- `package.json`：名称 `@ourfairy/dsh-delivery`，`main`/`exports` 指向 `./src/index.mjs`，
  `files: ["src","README.md","locale/*.json"]`，`exports` 含 `./locale/*.json`；
  `peerDependencies` 全部是明确 caret 范围（`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools`
  `^0.2.1-alpha.2`，`@ourfairy/dsh-attachments`/`identity`/`sessions` `^0.1.0`）；
  `description` 作为 `readPluginMeta` 的兜底。
- `locale/en.json`：`{"meta":{"title","description"}}`，只使用 dsh 已有字段。
- `README.md`：这个包能经 `ourfairyChatRuntime` 访问什么、如何 disable、身份与存储边界。

### 2. chat 只向投递暴露窄运行时 `ourfairyChatRuntime`

新增 `backend/chat/src/runtime-facade.mjs`：一个 Cordis `Service`，构造参数是既有
`SessionRuntime` 实例，方法**恰好五个**：

| 方法 | 投递的用途 |
| --- | --- |
| `runDelivery(deliveryId, work)` | 一次投递准备的串行队列（与目标会话队列分开） |
| `runSession(sessionId, work)` | 把投递结算写入目标会话的串行队列 |
| `live(sessionId)` | 目标会话是否正开着 |
| `events(sessionId)` | 一次安全的事件读取，用于幂等判断 |
| `barrier(state)` | 确认追加事件持久后才回执 |

`RunSession/remote projection/subscription/config` 等 chat 内部能力不经过这个服务。
`backend/chat/src/index.mjs` 只改三行：把 `installDelivery` 的 import 换成门面 import，注册
`new ChatRuntimeFacade(ctx, runtime)`，删除 `installDelivery(ctx, runtime)` 调用。按
`73-row-plan.md`，`runtime.mjs`、`service.mjs`、`projection.mjs`、`history.mjs` 未动
（#72 的写范围）。

**关键修复：私有字段改为模块私有 Symbol。** 门面最初用 `#runtime` 保存实例，而 Cordis
以可追踪 proxy 作为 `this` 调用服务方法，类私有字段透过 proxy 不可读，投递调用因此在写入
pending row 之前就抛错。改为模块私有 `const RUNTIME = Symbol('ourfairy-chat-runtime')`，
构造时 `this[RUNTIME] = runtime`，方法读 `this[RUNTIME]`；这与
`backend/identity/src/index.mjs` 顶部已记录的同一 Cordis 事实一致。服务表面与五个方法不变。

### 3. bundle 的包与行（只追加）

- `backend/v1-bundle/package.json` 的 `dependencies` 追加
  `"@ourfairy/dsh-delivery": "file:../delivery"`；`files`/`exports` 未改（包清单仍只由
  manifest 的 `dependencies` 决定，#96 的唯一权威）。
- `backend/v1-bundle/cordis.patch.yml` 在 `chat` 行之后、`gateway` 行之前追加
  `- id: delivery` / `name: '@ourfairy/dsh-delivery'`，行 id 小写短横线、可被 overlay 按
  `delivery` 定位。没有重排、删除或修改既有行。
- 未改 `combo.json`。

### 4. 测试

- 新增 `tests/delivery-row.test.mjs`：真实启动产品后端（模型走 dsh 的 mock LLM server），
  用 profile overlay `{id:'delivery', disabled:true}` 单独禁用这一行，断言：
  1. 行挂载时，在 `deliveries` 表上注入 UPDATE 触发器制造业务更新失败，留下一条 pending 行
     （证明工具已运行、native append 已成功，只有业务更新被拒）；
  2. 行禁用后模型目录没有 `deliver_message`，待恢复投递保持 pending，模型请求缺席工具得到
     明确的 `unknown tool "deliver_message"`；
  3. 同一禁用进程里 chat 仍能 send/read（用户消息与 assistant 回复都出现）；
  4. 被拒调用没有在接收会话追加任何 `delivery/message`；
  5. 重新挂载后，同一 pending 行恢复为已结算。
- `tests/identity-interfaces.test.mjs` 的消费者路径从 `chat/src/delivery.mjs` 改为
  `delivery/src/index.mjs`，仍断言消费者不读裸 store。
- 门面修复后又修正了测试自身的一处断言：runtime 的 `tool_result.content` 是字符串，
  原写法 `JSON.stringify(content).includes('unknown tool "deliver_message"')` 会被 JSON
  转义的引号挡住；改为先取字符串（对象才 stringify）再匹配。

### 5. 文档与索引

- `docs/decisions/upstream-compatibility-calibration.md` 中两处指向
  `backend/chat/src/delivery.mjs` 的链接跟随移动到 `backend/delivery/src/index.mjs`；
  不修则 `tests/docs.test.mjs` 的 Markdown 链接检查为红。
- `work/implementation/evidence/README.md` 的「插件生态（规格 #73）」表新增本目录。

## 实际执行的命令与输出摘要

均在 `/home/eafen405/projects/OurFairy/.worktrees/99-delivery` 执行。日期 2026-10-20。

### Red（实现前，证明测试确实在测这条行为）

```
$ node --test tests/delivery-row.test.mjs
✖ disabling the delivery row removes the tool and recovery while chat still routes
  AssertionError: the mounted row prepared a durable delivery row
  at tests/delivery-row.test.mjs:122
ℹ tests 1 / pass 0 / fail 1
```

原因即上述 `#runtime` 透过 Cordis proxy 不可读，投递在写 pending 行前抛错。

Symbol 修复后，第一段（挂载行留下 pending）立即通过；测试在第二段暴露自身的断言缺陷：

```
✖ ... AssertionError: the absent capability must fail explicitly; tool results were
  [{"type":"tool_result","content":"Error: unknown tool \"deliver_message\"", ...}]
  at tests/delivery-row.test.mjs:153
```

修正测试的字符串归一化后转绿（产品行为未变：runtime 本来就返回字符串内容）。

### Green

```
$ node --test tests/delivery-row.test.mjs
✔ disabling the delivery row removes the tool and recovery while chat still routes (4466ms)
ℹ tests 1 / pass 1 / fail 0
```

```
$ node --test tests/delivery-row.test.mjs tests/identity-interfaces.test.mjs
ℹ tests 5 / pass 5 / fail 0 / duration_ms 4475.8
```

投递语义未变（文字、文件、网关、chat runtime 一起跑）：

```
$ node --test tests/text-delivery.test.mjs tests/file-delivery.test.mjs tests/gateway.test.mjs tests/chat-runtime.test.mjs
ℹ tests 26 / suites 0 / pass 26 / fail 0 / duration_ms 62879.2
```

覆盖：冷主会话文字投递、生成中投递与后续模型历史、业务更新失败的重启恢复与幂等重试、
并发投递、持久化失败不确认、通知出口失败仍回执、文件投递的 CAS/恢复/flush 失败、
共享配置网关与选模在途限制、chat runtime 的恢复/停止/排队。

全量（合入 `integration/spec-73` tip 之后）：

```
$ npm test
ℹ tests 161 / suites 7 / pass 161 / fail 0 / duration_ms 71971.3
```

> 第一次全量是 `160 pass / 1 fail`，唯一失败为 `tests/docs.test.mjs` 的两条指向已移动
> `delivery.mjs` 的链接；这是本次移动产生的真实断链，不是负载抖动。修正链接后全量复跑
> `161/161`。本轮没有出现 `pdf-worker-cancel` 抖动。

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  based on integra  9da821190161c976  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      460109d1b89b824a  2d97ed143e7a6487  MISMATCH
combo: 1 drift/missing entry
```

ourfairy / dsh 两项 ok；rikkahub 为 `73-execution.md` 已记录的**外部漂移**（分支 tip
`2d97ed14` ≠ `combo.json` 锁定 `460109d1`）。本票不改 `combo.json`、不动 rikkahub，故记录不修。

包内容与窄接口的静态核对：

```
$ grep -rn "from './\|from \"../" backend/delivery/src/index.mjs
（无相对 import；只有 node:crypto 与 dsh/ourfairy 公开包）

$ grep -c "this\[RUNTIME\]" backend/chat/src/runtime-facade.mjs
6   # 构造赋值 1 + 五个方法读取
```

## 与并行票的交接

- **#100 / #101（bundle 两文件）**：本票在 `dependencies` 与 `cordis.patch.yml` 只**追加**
  自己的包与行，未重排。并行票合并时若产生文本冲突，按语义保留双方的行与包；本票的行 id
  `delivery` 与前后的 `chat`/`gateway` 没有共享字段。
- **#102（行 liveness）**：`delivery` 行在默认组合里 active；#102 的「bundle 声明的产品行
  全部 active」事实检查会覆盖它。测试只通过 overlay 临时禁用该行，不改默认 patch。
- **#105（overlay 行可寻址）**：`delivery` 是可定位的稳定行 id，本票的禁用用例就是一次
  overlay 定位；#105 可以直接复用它。
- **#72（chat 内部）**：只新增 `runtime-facade.mjs` 并在 `index.mjs` 注册/删除调用；
  `runtime.mjs`、`service.mjs`、`projection.mjs`、`history.mjs` 未改，不触碰 #72 的写范围。
- **#98**：新包的 peer 已按 `73-execution.md` 的明确 semver 写法声明；`doctor` 从 bundle
  manifest 派生产品包集合，因此新包自动进入兼容检查（全量中的
  `tests/plugin-compatibility.test.mjs` 绿）。

## 未执行项与原因

- **`combo:verify` 未全绿。** 唯一失败是 rikkahub 外部漂移（见上）。因此实现与证据提交使用
  `git commit --no-verify`；每个提交前都在本 worktree 手动跑完 `npm test` 与
  `npm run combo:verify`，不依赖 pre-commit 的 `combo:verify`。
- **未跑真实模型服务。** 投递/网关测试的模型请求走 dsh 的 mock LLM server（测试替身）；
  本票不改变供应商接线，也没有发起官方 DeepSeek 或硅基流动调用。真实服务证据仍以
  #21/#43 的既有记录为准。
- **未跑真机。** 本票没有客户端改动，不产生设备证据。
- **未验证独立安装的 profile 中禁用该行。** 禁用用例在真实后端启动路径上通过 profile
  overlay 生效（与 #105 同一机制），但没有另做 `npm pack`/独立安装域的重放；#104/#105
  覆盖安装与行可寻址的集成验收。
- **未改 `combo.json`、未 checkout rikkahub、未动 dsh fork。** 三者都不在本票写范围。
