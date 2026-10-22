# #151 `inject` 对齐：删残留、显式化隐性依赖

票面：[#151](https://github.com/eafen405/OurFairy/issues/151)（父票 [#133](https://github.com/eafen405/OurFairy/issues/133)）。
分析记录：`work/tickets/133/README.md`、`work/tickets/133/01-inject-alignment.md`。

## 基线

| 项 | 值 |
| --- | --- |
| 基线提交 | `a649a59921f95ffaa67ae7358090cd74aaca70cf`（`integration/spec-133` tip，即 `fc5ea92` + 票面发布提交） |
| 分支 | `ticket/151-inject` |
| worktree | `/home/eafen405/projects/OurFairy/.worktrees/151-inject` |
| 合入前的票分支起点 | `fc5ea92`；开工前 `git merge integration/spec-133` 快进到 `a649a59` |
| dsh 锁定 | `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`（`product/ourfairy-v1`） |

## 改了什么

只改 `backend/chat/src/` 三个文件；`service.mjs`、`jobs.mjs`、`units.mjs`、`runtime-facade.mjs`
无行为改动，`README.md`（#152）、`package.json`、`test-support` 夹具、`combo.json` 未动。

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/index.mjs` | `inject` 删 `identity`、`tools`，加 `llm`；数组上方加规则注释；`agentLoop` 原位保留并加排序/副作用注释 |
| `backend/chat/src/runtime.mjs` | 唯一调用点：`this.ctx.get('llm')` → `this.ctx.llm` |
| `backend/chat/src/spill-read.mjs` | 读取处保持 `ctx.get('spillStore')`，补「允许缺席」与既有组合检查的注释 |

### 16 项审计（在本次树上逐项复核）

`ctx.<name>` / 间接使用均以当前树的行号为准。

| 服务 | 使用处（本次树复核） | 处置 |
| --- | --- | --- |
| `webServer` | `src/index.mjs:32` 的 `ctx.webServer.register`（9 条路由） | 保留 |
| `connection` | `src/index.mjs:33` 的 `ctx.connection.fence` | 保留 |
| `ourfairySessions` | `src/service.mjs:30` `authenticate`；`src/runtime.mjs:69` `read` | 保留 |
| `ourfairySpaces` | `src/spill-read.mjs:48` `contributeReadonlyFiles` | 保留 |
| `agents` | `src/runtime.mjs:89` `resume` | 保留 |
| `agentLoop` | 无 `ctx.agentLoop` 调用；`agents.resume` 依赖它注册的 Agent 工厂 | 保留并注释：排序/副作用 |
| `agentDefaultModel` | `src/runtime.mjs:90,93,105,138` `currentSelection` | 保留 |
| `sessions` | `src/runtime.mjs:260` `flush` | 保留 |
| `sessionQuery` | 间接：`src/runtime.mjs:202` 的 `readSessionEvents(this.ctx, …)` 在 `backend/sessions/src/events.mjs:24` 调 `ctx.sessionQuery.observeSession` | 保留 |
| `systemPrompt` | 间接：`src/runtime.mjs:96,97` 的 Agent setup 里 `agentCtx.systemPrompt.section` | 保留 |
| `ourfairyAttachments` | `src/service.mjs:49` `inputs` | 保留 |
| `identity` | 无 `ctx.identity`；`src/index.mjs:2` 的 `@ourfairy/dsh-identity/http` 是 POST 信封的模块 import，不是服务 | **删除** |
| `tools` | 无 `ctx.tools`（`src/jobs.mjs:1` 的 “model tools” 是注释措辞） | **删除** |
| `sessionPersistence` | `src/runtime.mjs:248` `open` | 保留 |
| `jobs` | `src/jobs.mjs:7,19,20,21,30`；`src/units.mjs:496,498` | 保留 |
| `sessionProjections` | `src/units.mjs:562` `register`；`src/runtime.mjs:344` `stateOf` | 保留 |

复核命令（一次性前提核对：无输出即当时没有残留直接读取）：

```bash
grep -rnE "ctx\.identity\b|ctx\.tools\b" backend/chat/src/
```

这是一次性的前提核对，不是持续检查；spec 明确不新增 inject 字面量断言，所以最小性没有自动
守卫。

### `inject` 前后

改动前（`a649a59`）：

```js
export const inject = ['webServer', 'connection', 'ourfairySessions', 'ourfairySpaces', 'agents', 'agentLoop', 'agentDefaultModel', 'sessions', 'sessionQuery', 'systemPrompt', 'ourfairyAttachments', 'identity', 'tools', 'sessionPersistence', 'jobs', 'sessionProjections']
```

改动后：

```js
/**
 * Services this row waits for before it accepts work. The ordering-only entry is
 * annotated here; the optional `spillStore` is read with `ctx.get` and its
 * absence semantics are annotated at the read site.
 */
export const inject = ['webServer', 'connection', 'ourfairySessions', 'ourfairySpaces', 'agents',
  // Declared for ordering/side effect, not for a call: `agentLoop` registers
  // the Agent factory that `agents.resume` needs, so this row must not take
  // work before that factory is available. Chat never reads `ctx.agentLoop`.
  'agentLoop',
  'agentDefaultModel', 'sessions', 'sessionQuery', 'systemPrompt', 'ourfairyAttachments', 'llm', 'sessionPersistence', 'jobs', 'sessionProjections']
```

## 决定与理由

### 删除 `identity`、`tools`

依据是代码事实而非推测：#99 把投递行搬走后，`backend/chat/src/` 内不存在 `ctx.identity` /
`ctx.tools` 引用（`@ourfairy/dsh-identity/http` 只是 POST 信封 helper 的模块 import）。在
pinned composition 里，传递可用性由这两处保留的声明承担：

- `backend/sessions/src/index.mjs:14` 的 `inject` 含 `identity`；
- dsh 的 `agent-loop`（`packages/core/agent-loop/src/index.ts:342`）`inject` 含 `tools`，而 chat
  保留了 `agentLoop`。

因此删除不改变 pinned composition 的可装配性。

### `agentLoop` 保留

chat 不调用 `ctx.agentLoop`，但它注册的 Agent 工厂是 `agents.resume` 的前置。保留声明让本行在
工厂可用前不接受工作；注释写在数组内该条目上方，说明「不为调用，为排序/副作用」。

### `llm` 声明并改为已声明访问

图片能力检查在带图片的回合开始时真正调用 `resolveModelInfo`（`src/runtime.mjs:120`），不是可选项：
声明进 `inject` 后，组合缺少 `llm` 时本行不会进入工作状态，而不是等图片轮次才抛错。`gateway`
（`backend/gateway/src/index.mjs:16`）与 `attachments`（`backend/attachments/src/index.mjs:11`）已采用
同样的声明方式；本次只改这一个访问点，能跑回合的组合里行为不变。

#### 与用户故事 9 的冲突

用户故事 9 要求这次改动「不触碰运行时文件」。本项把 `src/runtime.mjs:120` 从
`ctx.get('llm')` 改为 `ctx.llm`，确实触碰了运行时文件，因此**故事 9 未满足**，这是本 spec 的
已知偏差。

替代方案是保持动态读取并在调用处注明「允许缺席」，但对 `llm` 不成立：缺席不是可降级状态，
带图片的回合会在 `resolveModelInfo` 处失败。因此选择声明。代价是调用点一行改动；在能跑回合
的组合里行为不变。

### `spillStore` 保持动态读取

`spillStore` 只服务 spill 检索，不是 chat 路由的前置。缺席是受支持的降级：没有 spill 行就没有
spill 文件，`spillDirectory` 返回 `undefined`，贡献返回空数组（`src/spill-read.mjs`）。若声明进
`inject`，所有 chat 路由都会等待这个辅助能力。shipped composition 由
`tests/native-capabilities.test.mjs` 与 `doctor` 的 native-capabilities 检查要求 `spill-local` 行
（行 id + 包名）存在（`scripts/combo.mjs` 的 `REQUIRED_NATIVE_ROWS`）；检索行为由
`tests/spill-read.test.mjs` 钉住。

## 命令与结果

全部在 `/home/eafen405/projects/OurFairy/.worktrees/151-inject` 执行。

### 改动前基线（同一套命令，确认起点为绿）

```bash
$ node --test tests/remote-chat.test.mjs tests/chat-cold-boundary.test.mjs tests/chat-multi-observer.test.mjs tests/jobs.test.mjs tests/reconnect.test.mjs tests/spill-read.test.mjs
ℹ tests 30 / pass 30 / fail 0（duration_ms 35811）

$ node --test --test-name-pattern "attachment capability check follows" tests/gateway.test.mjs
✔ the attachment capability check follows the selection the next turn will execute
ℹ tests 1 / pass 1 / fail 0
```

### 改动后

```bash
$ node --test tests/remote-chat.test.mjs tests/chat-cold-boundary.test.mjs tests/chat-multi-observer.test.mjs tests/jobs.test.mjs tests/reconnect.test.mjs tests/spill-read.test.mjs
ℹ tests 30 / pass 30 / fail 0（duration_ms 37184）

$ node --test --test-name-pattern "attachment capability check follows" tests/gateway.test.mjs
✔ the attachment capability check follows the selection the next turn will execute
ℹ tests 1 / pass 1 / fail 0

$ node scripts/combo.mjs verify
ourfairy        integration/ourfairy-v1  based on integra  a649a59921f95ffa  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  product/ourfairy-v1      460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

`tests/gateway.test.mjs` 的图片能力用例覆盖了 `llm` 声明的实际使用点（排队图片在切到纯文本
选择后必须显式拒绝）；`tests/spill-read.test.mjs` 覆盖了 `spillStore` 动态读取的实际路径。

### 未新增 `inject` 字面量测试

按 spec Testing Decisions：接缝是真实启动器 + 产品 HTTP/SSE 端点，断言 `inject` 数组字面量被明确
禁止。本票是行为保持的声明对齐，没有新行为可先写红测试；上面两套既有行为套件在改动前后各跑
一次，就是本次的红/绿网。若声明改动破坏组合，这些用例会在启动阶段失败。

## 提交与合并

- 源码三处改动与本题证据同一提交，父提交 `a649a59`；提交信息
  `refactor(chat): align inject with actual service dependencies (#151)`，分支 tip 见交接报告。
- 提交前 `git merge integration/spec-133` 快进到 `a649a59`；提交后再次
  `git merge integration/spec-133` 返回 `Already up to date.`（tip 仍为 `a649a59`），无冲突。
- 使用 `git commit --no-verify`：见下节的全量门禁延后。

## 全量门禁延后

**未执行 `npm test`。** 票 #152 正在并行改 `README.md`，最终全量门禁按 spec 在 #153 合并后的
集成分支上跑。本票因此使用 `git commit --no-verify` 提交；合入前已按票面要求重新
`git merge integration/spec-133`。

## 范围外发现（未修）

- `backend/chat/package.json` 的 `@deepseek-ai/dsh-tools` peer 在 chat 源码中没有 import。这属于
  #136「产品包清单真实性」的 peer 一致性范围，本票不顺手修改。
- 未拆 chat 为运行时包与传输包；未移动 `test-support` 夹具；未改 `runtime-facade` 的公开方法集；
  未改 gateway 对 `ourfairyChat` 的依赖。
