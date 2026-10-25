# 210 — T5：delivery / gateway / groups / search / speech / probe 迁 `.ts`

**票据**：[#210](https://github.com/eafen405/OurFairy/issues/210)（规格 [#205](https://github.com/eafen405/OurFairy/issues/205) 的 T5）
**分支**：`ticket/210-ts-remaining`（基于 `integration/spec-205` @ `47164df889`）
**约定**：规格 #205 的「不改行为」。迁移只加类型，不加运行期检查。

本目录记录本票改了什么、跑了什么、留下了哪些断言式窄化，以及 T4 交下来的三个决定。

---

## 1. 改了什么

### 1.1 六个包整体迁移（包内原子）

| 包 | 迁走的源 | 新增 | 删除 |
| --- | --- | --- | --- |
| `backend/delivery` | `src/index.mjs`（115 行） | `src/index.ts`、`tsconfig.json` | `src/index.mjs` |
| `backend/gateway` | `src/{http,index,service}.mjs`（45 / 31 / 484 行） | `src/{http,index,service}.ts`、`tsconfig.json` | 三个 `.mjs` |
| `backend/groups` | `src/index.mjs`（69 行） | `src/index.ts`、`tsconfig.json` | `src/index.mjs` |
| `backend/search` | `src/index.mjs`（62 行） | `src/index.ts`、`tsconfig.json` | `src/index.mjs` |
| `backend/speech` | `src/{index,service}.mjs`（65 / 119 行） | `src/{index,service}.ts`、`tsconfig.json` | 两个 `.mjs` |
| `backend/probe` | `src/index.mjs`（451 行） | `src/index.ts`、`tsconfig.json` | `src/index.mjs` |

六个 manifest 同时改：`main` → `./dist/index.js`，新增 `types` → `./dist/index.d.ts`，
`exports["."]` → `{ "types": …, "default": … }`（**`types` 在 `default` 之前**，条件按声明顺序匹配），
`files` → `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "locale/*.json"]`。

两处例外按票据要求保留：

- `backend/delivery` 与 `backend/groups` 的 `exports` 保留 `"./package.json": "./package.json"`。
- `backend/probe` 的 `files` 为 `["dist/**/*.js", "dist/**/*.d.ts", "overlay.patch.yml", "README.md"]`；
  probe 没有 `locale` 条目，也没有 `"./locale/*.json"` 导出，**不新增**。

`peerDependencies` 一律未改：新增的 import 全部是 `import type`（运行期擦除），
按本仓既有约定（chat 用 `import type {} from '@ourfairy/dsh-spaces'`，但 `peerDependencies` 里没有 `dsh-spaces`）
不需要声明 peer。

### 1.2 根 solution

`tsconfig.json` 增六条 project reference：`./backend/delivery`、`./backend/gateway`、
`./backend/groups`、`./backend/search`、`./backend/speech`、`./backend/probe`。
每个包的 `tsconfig.json` 指向它真正 import 的兄弟包：

| 包 | references |
| --- | --- |
| delivery | `../attachments`、`../chat`、`../identity`、`../sessions` |
| gateway | `../chat`、`../http`、`../identity` |
| groups | `../identity`、`../spaces` |
| search | `../identity`、`../sessions` |
| speech | `../http`、`../identity` |
| probe | 无（probe 不 import 兄弟包） |

### 1.3 测试与文档的路径

- `tests/gateway-service.test.mjs:22`：`../backend/gateway/src/service.mjs` → `../backend/gateway/dist/service.js`
- `tests/gateway.test.mjs:29`：同上
- `tests/identity-interfaces.test.mjs:111`：它**读源文件文本**断言「消费者不碰裸 store」，
  三个路径随改名一起改（`delivery/src/index.mjs` → `.ts`、`groups/src/index.mjs` → `.ts`、`search/src/index.mjs` → `.ts`），
  **断言本身一字未动**。
- `docs/decisions/upstream-compatibility-calibration.md:28,63`：两处指向投递源文件的相对链接改为 `.ts`。

`tests/` 里其余用例不 import 这六个包的源码：它们走装好的 profile（boot、doctor、probe、bundle 测试）。

---

### 1.4 第二稿对代码的一处调整

合并审查指出 parity 脚本有两处盲区（§4.1）。补上盲区后，
gateway 的两处 `(body ?? {}) as Record<string, unknown>` 暴露为一处**纯形状**的差异：
断言挂在整个 `??` 表达式上，TypeScript 因此必须给它加括号，产物的 token 流就与迁移前不同。
把断言改挂到空对象上 —— `body ?? ({} as Record<string, unknown>)` ——
**运行期完全相同**（两边都是 `body ?? {}`），产物与迁移前逐字相同。
这是本票唯一一处对已提交代码的改动，只动类型，不动行为。

---

## 2. 跑过的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run clean && npm run build` | 干净通过（clean 移除 12 个构建目录，build 无输出无错） |
| `node --test tests/gateway-service.test.mjs tests/gateway.test.mjs tests/product-sources.test.mjs tests/bundle-packages.test.mjs tests/bundle-groups.test.mjs tests/baseline-boot.test.mjs tests/plugin-compatibility.test.mjs tests/docs.test.mjs tests/identity-interfaces.test.mjs tests/model-double.test.mjs tests/groups.test.mjs` | **60/60 通过**（0 失败，0 跳过） |
| `npm run backend:doctor` | **doctor: all checks passed**（见 §2.3） |
| `OURFAIRY_PORT=0 npm run backend:probe` | **ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)** |
| `npm run combo:verify` | **combo: combination verified**（ourfairy/dsh/android source 三行全 ok） |
| `node work/implementation/evidence/210-ts-remaining/parity-scan.mjs` | **退出码 0**：9 个文件归一后残差全为零；类别分解见 §4.3 |
| `npm run evidence:index` | 重新生成 `work/implementation/evidence/README.md` |

### 2.1 red → green

`tdd` skill 在本会话不可加载（T1–T4 同样不可用），按手工 red→green 走：

- **red**：`npm run build` 在每个包刚接进 solution 时失败，报的都是真实类型缺口
  （例：`backend/groups/src/index.ts(16,32): error TS2459: Module '"@ourfairy/dsh-identity"' declares 'PublicUser' locally, but it is not exported.`、
  `backend/speech/src/service.ts(48,10): error TS2352: Conversion of type 'Record<string, unknown>' to type 'SpeechSettings' may be a mistake`、
  `backend/delivery/src/index.ts(140,36): error TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'`）。
- **green**：补齐类型标注与边界窄化后 `npm run build` 无错。

### 2.2 probe 的端口

本机 3080 端口被一个无关的本地 `dsh web`（pid 1521）占着，因此 probe 跑在
`OURFAIRY_PORT=0`（临时端口）上，结果是 `ok`。

### 2.3 doctor 的「product packages」

doctor 的每一项都是 `ok`，其中「product packages」列出的是这六个包**发布**的文件：
`backend/delivery/dist/index.{d.ts,js}`、`backend/gateway/dist/{http,index,service}.{d.ts,js}`、
`backend/groups/dist/index.{d.ts,js}`、`backend/probe/dist/index.{d.ts,js}`（外加
`backend/probe/overlay.patch.yml`）、`backend/search/dist/index.{d.ts,js}`、
`backend/speech/dist/{index,service}.{d.ts,js}`。
**六个包的 `src/*` 一个都不在列表里**（全仓的 `src/*` 也不在）。
同一次 doctor 还报：`bundle packages: 11 declared package(s) mounted by 16 row(s)`、
`plugin compatibility: 13 installed product package(s) compatible with dsh 0.2.1-rc.2`。

### 2.4 没有跑的

- **全量 `npm test`**：按票据留给 T6。
- **CI / push**：本票不触发。
- 若仓库自带的 pre-commit 钩子在提交时跑了全量门禁，那是钩子的行为，不是本票的门禁。

---

## 3. T4 交下来的三个决定

### 3.1 消息源扩展的单一权威

**决定：选项 (b) —— 保留每个包自己的窄视图类型，两边都从同一个声明派生；不去增补原生的 `MessageSourceMap`。**

具体做法：

- 聊天侧（`backend/chat/src/units.ts` 的 `ProductMessage`、T4 已落地）**不动**：chat 是
  独立 TS 程序，它的 `user` 源视图类型留在 chat 里。
- 投递侧（本票）在 `backend/delivery/src/index.ts` 新增**投递源视图类型**：

  ```ts
  interface ProductDeliveredSource {
    readonly deliveryId: string
    readonly senderSessionId: string
    readonly attachments?: readonly PreparedFile[]
  }
  ```

- **形状的权威**是 attachments 包：`PreparedFile` 与 `DeliverySelector` 都从同一个接缝派生
  （`Awaited<ReturnType<Context['ourfairyAttachments']['prepareDeliveryFile']>>` 与
  `Parameters<Context['ourfairyAttachments']['prepareDeliveryFile']>[1]`），
  与 chat 从 `Context['ourfairyAttachments']['inputs']` 派生 `AttachmentInput` 是同一个权威。

**为什么不增补原生 map**：如果 chat 与 delivery 各自 `declare module '@deepseek-ai/dsh-llm'`
去增补 `MessageSourceMap`，两个独立 TS 程序会各自产生一份全局增补，合并时会撞
（`Subsequent property declarations must have the same type`）。T4 已经因为「T5 会去写
delivery/message 的源」而避开了增补，本票延续这个选择：**产品扩展一律是包内的窄视图类型，
原生 map 不动。**

**为什么不把声明搬到 chat 或 attachments**：

- 搬到 chat：attachments 包读 `source.attachments`（`backend/attachments/src/service.ts` 的
  `AdmittedMessage`）就会依赖 chat，而 chat 依赖 attachments —— 成环。
- 搬到 attachments：`rpcId` 是 chat 自己的概念（一次 `/chat/send` 的请求号），
  放进 attachments 包在语义上不成立；而且 attachments 与 chat 都已在 T2/T3 合并，本票不改它们。

**一个必须说清的细节**：产品写的 `source.attachments` 在两种源上形状**不同** ——
`user` 源上写的是 `AttachmentInput`（带 `uploadId`），`delivered-message` 源上写的是
`PreparedFile`（不带 `uploadId`，因为投递快照的是已准备好的文件）。
这是迁移前就有的运行期事实，**没有被改动**；因此两侧各用自己的视图类型是诚实的，
强行合并成一个类型反而会说谎。

### 3.2 `Events['ourfairy/delivery']`

**决定：delivery 在自己的包里声明这条事件，载荷形状与 chat 测试夹具声明的完全一致。**

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'ourfairy/delivery': (result: { readonly messageId: string; readonly acceptedSeq: number }) => void | Promise<void>
  }
}
```

- chat 的测试夹具 `backend/chat/test-support/fail-outlets.ts` 的声明**不动**。
- 两个声明在**不同**的 TS 程序里（delivery 的工程只引用 `../chat`，不引用 chat 的
  test-support 工程），因此不会合并；即便将来某个程序同时装了两份，因为形状**逐字相同**，
  接口合并也仍然合法。
- 运行期载荷比声明的多（`deliveryId`、`sessionId`）——这是迁移前就有的事实。`ctx.parallel`
  的实参是一个变量（不是新鲜字面量），因此多余字段不触发多余属性检查，**载荷一个字节没变**。

### 3.3 `ctx.ourfairyChat` / `ctx.ourfairyChatRuntime`

**决定：delivery 不重新声明，直接 `import type {} from '@ourfairy/dsh-chat'`。**

delivery 读 `ctx.ourfairyChatRuntime`（投递队列、会话队列、活会话、事件读、落盘屏障）。
chat 在 `backend/chat/src/runtime-facade.ts` 里用 `declare module '@deepseek-ai/cordis'` 声明了
`ourfairyChatRuntime: ChatRuntimeFacade`，并从包根导出该类型；delivery 用一条
`import type {} from '@ourfairy/dsh-chat'` 把它带进自己的程序。
**没有第二份声明。**

---

## 4. 机械复查（parity scan）

脚本：`work/implementation/evidence/210-ts-remaining/parity-scan.mjs`（从 T4 的
`209-ts-chat/parity-scan.mjs` 复制并适配：文件名单换成这九个，基线换成 `47164df889`）。

脚本对每个文件跑五项检查，源码与 **dist 产物**各跑一遍（`source` / `runtime`）：

1. **运算符与标点计数**（逐个的出现次数）。括号与分号**也在内**：
   只挪动一个花括号或分号同样改变了代码的形状，看不见它们的运算符表会把两个不同的文件判成相同。
2. **AST 字面量多重集**（从 TypeScript 的 AST 读，长字符串里的字面量不会被数两次）。
3. **AST 结构签名**：每个节点的 kind，携带名字或值的节点再带上它的文本。
   它**完全不经过扫描器**，所以扫描器的怪癖骗不过它；模板字面量贡献它的头、替换表达式与尾，
   两个模板字面量之间的代码就是代码，不会被并成一个 token。
4. **顺序敏感的 token 流**（扫描器）。模板字面量**逐段**走：头 → 每个替换表达式
   （花括号计数）→ 中段或尾；**替换表达式里嵌套的模板**同样逐段走。
   只走到第一段、或不钻进嵌套模板，扫描器就会留在代码模式，
   后面的一整个函数会被并进**一个** token 里而从比较中消失。
5. **声明过的差异归一后的残差**：每一处差异都必须落在声明过的类别里
   （§4.3 的表），否则扫描打印残差并**以非零码退出**。

另有一项**行对比**（布局敏感），**每个文件都打印**，不挂在计数增量后面 ——
这是 T4 修掉的第一个盲点。

### 4.1 本票补掉的两处盲区

- **运算符表漏了括号与分号**（T4 的脚本也漏）：现在计入 `(`, `)`, `{`, `}`, `;`。
  补上之后，「只挪了一个括号」这类差异会出现在运算符行里，而不是被藏进 token 流的细节。
- **模板尾 token 吞掉一整个函数**：T4 的脚本已经会逐段走模板，但它**没有处理替换表达式里
  嵌套的模板** —— gateway 的 `guard()` 里就有（`` `${hits.map(reply => `${reply.sessionId}:${reply.model}`).join(', ')}` ``）。
  扫描器因此留在代码模式，之后的整个文件被读成模板文本。
  本票改成**递归**地逐段走：遇到嵌套模板就递归走它。

### 4.2 声明过的差异（归一化类别）

每一类都是**对称**的 token 流变换（对旧流与新流各做一次），所以过了这一关还剩下的差异，
就是迁移没有声明过的差异：

| 类别 | 是什么 |
| --- | --- |
| `relative-specifier` | 相对 import 必须带产物真正用的 `.js` 说明符。 |
| `arrow-param-parens` | 带类型标注的箭头参数必须加括号。 |
| `async-on-execute` | 原生工具契约要求工具的 `execute` 是异步的。 |
| `safe-integer-helper` | `Number.isSafeInteger` 不是类型守卫，检查被包成谓词助手。 |
| `explicit-return-undefined` | `agent/created` 处理器要返回 `undefined`。**这是唯一一类带「值」差异的类别** —— token 比较看不见返回值，所以那处偏差记在 §5.1。 |

### 4.3 逐文件的类别分解

| 文件 | 归一后剩下的残差 | 归一前触发的类别 |
| --- | --- | --- |
| `backend/delivery/src/index.ts` | 无 | `arrow-param-parens`、`safe-integer-helper`、`explicit-return-undefined` |
| `backend/gateway/src/http.ts` | 无 | `relative-specifier` |
| `backend/gateway/src/index.ts` | 无 | `relative-specifier` |
| `backend/gateway/src/service.ts` | 无 | `arrow-param-parens`、`safe-integer-helper` |
| `backend/groups/src/index.ts` | 无 | `arrow-param-parens`、`async-on-execute`、`explicit-return-undefined` |
| `backend/probe/src/index.ts` | 无 | **无**（运算符、字面量、结构、token **全部相同**） |
| `backend/search/src/index.ts` | 无 | `arrow-param-parens`、`explicit-return-undefined` |
| `backend/speech/src/index.ts` | 无 | `relative-specifier` |
| `backend/speech/src/service.ts` | 无 | `arrow-param-parens`、`safe-integer-helper` |

**九个文件的残差都是零**：所有差异都落在 §4.2 的声明类别里，扫描以 0 退出。
`probe` 连类别都没用上 —— 它的运算符、字面量、结构与 token 流与迁移前逐字相同。

归一前的原始差异（脚本照实打印）：

- 运算符：只有括号与分号有变化，正是上面那些类别带来的
  （delivery `(: 105 -> 112, ): 105 -> 112, {: 60 -> 62, }: 60 -> 62, ;: 65 -> 68)`，
  groups `(: 66 -> 69, ): 66 -> 69, ;: 40 -> 41)`，search `(: 45 -> 47, ): 45 -> 47, ;: 39 -> 40)`，
  gateway/service `(: 305 -> 311, ): 305 -> 311, {: 133 -> 134, }: 133 -> 134, ;: 163 -> 164)`，
  speech/service 同样只有括号与分号）。
- 字面量：只有相对说明符 `./x.mjs` → `./x.js`（gateway 的 http/index、speech 的 index）。

### 4.4 逐条解释

- **(a) 箭头函数的参数多了括号**：`const receipt = row =>` → `const receipt = (row) =>`。
  原因：参数带类型标注时 TypeScript 要求括号。运行期完全相同（括号不是运行期语义）。
  涉及 delivery 4 处、groups 3 处、search 2 处、gateway/service 1 处、speech/service 1 处。
- **(b) `Number.isSafeInteger(...)` → `isSafeInteger(...)` 谓词助手**：三处
  （delivery 的 `fileSelectors`、gateway 的 `modelEntry`、speech 的 `resolveSpeechSettings`）。
  原因：`Number.isSafeInteger` **不是**类型守卫，写不出 `entry[field] < 1` 这种比较；
  助手把它包成 `(value: unknown) => value is number`。运行期检查是同一个 `Number.isSafeInteger`，
  只是多了一层函数调用。**这正是票据里点名的坑**（T4 的 `backend/attachments/src/pdf.ts`
  已有同样的助手，形状照抄）。
- **(c) delivery 的 `register` 从「简洁箭头」变成「块体 + `return undefined`」**：
  形状的变化是 `arrow-param-parens` + `explicit-return-undefined` 归一掉的；
  **但这一处还带着「值」的变化**（旧值是 dsh 的工具注销函数），token 比较看不见 ——
  详见 §5.1。
- **(d) 相对说明符 `./x.mjs` → `./x.js`**：Node 的类型剥离会删类型但不会改说明符，
  `.ts` 里的相对 import 必须带 `.js` 后缀。**这是迁移规则本身**。
- **(e) gateway 的 `catch` 里多了两对括号**：`(error as Error | undefined)?.message ?? String(error)`。
  原因：严格模式下 `catch` 变量是 `unknown`，读 `.message` 需要窄化；而把 `?.` 去掉会改行为
  （`error` 为 `null` 时原本走 `?? String(error)`，改后会抛 TypeError）。括号是
  `as` 断言在可选链里必须带的，**运行期语义不变**（`(error)?.message` 与 `error?.message` 等价）。
  同样的形状在 delivery 的两处 `error.message`、probe 的一处 `error.code ?? error.message` 上。
- **(f) groups 的三个工具 `execute` 前面多了 `async`**：原生工具契约要求
  `execute` 返回 `Promise`。原生 `defineTool` 自己把用户的 `execute` 包在一个 `async` 函数里
  并 `await` 它，所以**解析出的值与抛出的错误完全一致**，只是多两个微任务 tick。
  详见 §5.2。
- **(g) search 的 `register` 多了一句 `return undefined`**：与 (c) 的形状相同，
  但 search 迁移前的 `register` **本来就是块体**，返回值本来就是 `undefined`，
  所以这一处**只改形状、不改值**。

---

## 5. 找到的行为差异

逐条列出，全部已解决。

### 5.1 delivery 的 `register` 返回值变了 —— 一处**真正的**行为差异（已验证为惰性）

**这一节更正了本证据早先版本里的一句话**：早先写的是「`register` 原本就返回 `undefined`」。
**对 search 和 groups 这句话成立，对 delivery 不成立。** 下面是核实过的事实。

**旧代码返回的是什么**

`backend/delivery/src/index.mjs:97`（迁移前）：

```js
const register = agent => agent.ctx.tools.register(defineTool({ name: 'deliver_message', … }))
```

这是**简洁箭头**，它的值就是 `agent.ctx.tools.register(...)` 的返回值。dsh 的
`tools.register()` 返回**注销函数**（`packages/core/tools/src/index.ts:1071`：
「register the tool and return the exact disposer that unregisters the tool」）。

**为什么这个值有后果**

`agent/created` 是用 `ctx.serial` 派发的（`packages/core/agent/src/index.ts:555`），
而 cordis 的 `isBailed` 把**任何不是 `null` / `false` / `undefined` 的值**都算作 bail
（`vendor/cordis/src/events.ts:14-16`）；`serial` 「awaits listeners in order until one
bails」并返回第一个 bail 值。

⇒ **迁移前的 delivery `register` 会 bail 掉这次 `agent/created` 派发**：
在它之后注册的 `agent/created` 监听器不会为该 agent 运行。
⇒ 迁移后的 `register` 显式返回 `undefined`，**不再 bail**，后面的监听器会运行。

**新代码返回的是什么**

`backend/delivery/src/index.ts:182-188`：块体，末尾显式 `return undefined`。
这是 `ctx.on('agent/created', …)` 的处理器类型（`undefined | Promise<undefined>`）要求的形状。

**这个差异在产品层面是惰性的 —— 怎么测的**

1. 产品里注册 `agent/created` 的一共**四行**（合并记录里「没有别的行注册 `agent/created`」
   这句不准确）：`attachments`（pdf 三个工具）、`delivery`、`groups`、`search`。
   这四个监听器**只做一件事**：把自己的工具注册到 agent 上。
2. `tests/model-double.test.mjs` 断言**精确的 18 个工具目录**（`assert.deepEqual` 排序后的全量清单），
   迁移前后完全一致。
3. 我直接量了一次：把 delivery 的 `register` 临时改回**迁移前的简洁箭头形状**
   （类型上需要一句 `as unknown as undefined` 才能编译，运行期的值仍是注销函数），
   重新 `npm run build`，跑 `node --test tests/model-double.test.mjs` → **2/2 通过，18 个工具目录不变**；
   随后把文件恢复原样并重建。⇒ **旧形状没有压掉任何一个工具注册。**
4. 为什么旧形状没有压掉：旧行为**依赖监听器的注册顺序** —— 只有当 delivery 的监听器排在
   其它三行之后时，那次 bail 才不压掉任何东西。组合的装载顺序由 loader 的激活顺序决定，
   而 bundle 的 `cordis.patch.yml` 自己写着「Row order inside a group carries no load semantics」。
   换句话说，旧行为是一枚**顺序依赖的哑雷**：装载顺序一变，别的行的工具就会被静默丢掉。

**这算不算违反「不改行为」—— 我的判断**

- **它是一个行为差异**（返回值不同，语义不同），所以本证据把它单列，而不是塞进「类型改写」里。
- **但它不是回归**：旧行为是**意外的** bail —— 那个值是简洁箭头的副产品，不是任何人的决定；
  类型一直说的是 `undefined`，而 search 与 groups 迁移前就已经是 `undefined`。
  新行为正是类型一直声称的那个行为，并且消掉了上面那枚顺序哑雷。
- **我的判断**：应当记为**一处有意为之、且已验证为惰性的偏差**（deviation），
  而不是记为「不改行为」规则的违反。**由 Lead 拍板**；如果 Lead 认为必须保持旧值，
  改法是把 handler 写成 `ctx.on('agent/created', ({ agent }) => { register(agent) }, …)`
  （让 `register` 继续返回注销函数、handler 丢弃它），代价是保留那枚顺序哑雷。

### 5.2 其余的行为差异

1. **groups 的三个工具 `execute` 从同步变成 `async`**（唯一一处真正的运行期形状变化）。
   - 旧：`execute: (_args, exec) => ({ groups: … })`（同步返回对象）
   - 新：`execute: async (_args, exec) => ({ groups: … })`（返回 Promise）
   - 原因：原生 `defineTool` 的契约是 `execute(args, exec): Promise<…>`；`defineTool` 把用户的
     `execute` 包在自己的 `async` 函数里并 `return userExecute(…)`，所以同步返回值与 Promise
     返回值经过这层包装后**解析出的值相同**，同步抛出与 Promise 拒绝的**错误类型和消息也相同**。
   - 差别只有微任务 tick 数：同步路径少 2 个 tick。仓库里没有依赖该时序的断言
     （`tests/bundle-groups.test.mjs` 走的是装配与工具注册，不调用这三个工具体）。
   - 为什么不做成「同步 + 类型断言」：那会让类型撒谎（声称一个同步函数返回 Promise），
     而 `async` 是原生契约本来要求的形状，且运行期可观察行为不变。
2. **`register` 助手显式 `return undefined`**（delivery / search）。
   - 旧：隐式返回 `undefined`；新：显式 `return undefined`。**值相同**。
   - 原因：`ctx.on('agent/created', …)` 的处理器返回类型是 `undefined | Promise<undefined>`。
   - **更正**：这条只对 **search** 成立。**delivery 迁移前的 `register` 是简洁箭头，
     返回的是 dsh 的工具注销函数**，值不同 —— 见 §5.1。
3. **`isSafeInteger` 谓词助手**（delivery / gateway / speech）。
   - 旧：`Number.isSafeInteger(x)`；新：`isSafeInteger(x)`，助手内部仍是 `Number.isSafeInteger(x)`。
   - **判定与消息完全相同**，只多一层函数调用。
4. **箭头函数参数括号**（delivery / groups / search）。
   - 运行期无语义。
5. **`catch` 里 `as` 断言的括号**（delivery / gateway / probe）。
   - 运行期无语义（`(error)?.message` ≡ `error?.message`）。
6. **相对说明符 `.mjs` → `.js`**（gateway ×4、speech ×1）。
   - 迁移规则本身；`.js` 指向的正是同名 `.ts` 编译出来的产物。

**没有找到未解决的行为差异。**

---

## 6. 留下的断言式窄化清单

`any` / `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error`：**一个都没有**（可 grep 验证）。
所有窄化都在类型层，运行期不产生任何检查。

### 6.1 `as`（每条都写着权威与原因）

| 位置 | 断言 | 权威与原因 |
| --- | --- | --- |
| `delivery/src/index.ts:89` | `file.prepared as PreparedFile` | 数据库行边界：store 把准备好的文件按自己的 JSON 存着，attachments 行是那个形状的权威；清单只在所有文件都准备好之后取。 |
| `delivery/src/index.ts:91` | `row.deliveryId as DeliveryId` | 原生 `SessionEventMap['delivery/message']` 用品牌串 `DeliveryId`；这行的 id 就是它。 |
| `delivery/src/index.ts:92` | `row.senderSessionId as SessionId` | 同上（`DeliveryOrigin.sessionId`）。 |
| `delivery/src/index.ts:94` | `source: {…} as ProductDeliveredSource` | 产品扩展的本地视图类型（§3.1）；断言让字面量不再触发多余属性检查，运行期对象一模一样。 |
| `delivery/src/index.ts:98,100,102,105` | `row.sessionId as SessionId` | 身份行存的是普通字符串，session 的权威是 dsh 的品牌串；chat 自己的运行时也做同样的窄化（`backend/chat/src/runtime.ts:169`）。 |
| `delivery/src/index.ts:113` | `read.events as SessionEvent[]` | 持久化句柄交出的切片是只读数组，session store 收下即可；复制它会改变「谁持有这份数组」。 |
| `delivery/src/index.ts:117` | `read.events.length as SessionLogOffset` | dsh 的事件位置是品牌数字。 |
| `delivery/src/index.ts:130,136` | `(error as Error).message` | catch 边界：日志要的是错误的消息；断言只在类型层，值不变。 |
| `delivery/src/index.ts:154` | `users.byShortId(recipientShortId) as UserRow` | 收件人上面已经查过，身份面把查询类型标成可选；迁移不再加第二次检查。 |
| `delivery/src/index.ts:157` | `deliveryId as SessionId` | chat 门面的投递队列用 session 品牌当队列键，键就是这个 id。 |
| `delivery/src/index.ts:162,169` | `deliveries.prepare(…) as DeliveryRow` / `prepareFile(…) as DeliveryRow` | store 在同一个事务里写完再读回，行就在那里；断言让迁移保留原来的失败，而不是加一道检查。 |
| `delivery/src/index.ts:166` | `row.files[index].selector as DeliverySelector` | 数据库行边界：选择器是 attachments 行的形状。 |
| `delivery/src/index.ts:167` | `file.prepared as PreparedFile \| null \| undefined` | 同 89。 |
| `delivery/src/index.ts:182` | `exec.agent as Agent` | 工具契约把 agent 标成可选，投递需要一个；迁移不加工具原来没有的检查（attachments 的 `pdf.ts` 同样写 `exec.agent as Agent`）。 |
| `gateway/src/service.ts:59,342,356,485` | `(error as Error \| undefined)?.message ?? String(error)` | catch 边界；`?.` 保留，null 时仍走 `String(error)`。 |
| `gateway/src/service.ts:227` | `{ ...entry } as RouteModel` | 草稿校验边界：上面的检查已经证明 `id` 是非空串，模型的其余字段由部署自己拥有。 |
| `gateway/src/service.ts:327` | `… as unknown as GatewayRow \| undefined` | 设置行边界：原生行的 value/base/user 列是不透明 JSON，网关按自己的读法读它们。 |
| `gateway/src/service.ts:352,419` | `ref as CredentialRef` | 凭据接缝用品牌串命名它的引用。 |
| `gateway/src/service.ts:362` | `structuredClone(…) as Record<string, RouteProfile>` | 同 327（`llm-pi-ai` 行的 providers 字典）。 |
| `gateway/src/service.ts:477,575` | `body ?? ({} as Record<string, unknown>)` | HTTP 边界：请求体是 JSON 对象，缺体时空对象。断言挂在空对象上而不是整个表达式上，这样产物的 token 流与迁移前逐字相同（`body ?? {}`），见 §4。 |
| `gateway/src/service.ts:513` | `effort as ReasoningEffortId` | 共享选择的 effort 是适配器拥有的 id；设置行里存的就是它。 |
| `search/src/index.ts:46` | `(exec.agent as Agent).session.id` | 工具契约边界；上面的 `caller(exec)` 已经拒绝过没有 agent 的执行。 |
| `search/src/index.ts:52` | `… as unknown as ToolValue` | 查询索引交回的是普通 JSON 记录，其类型没有索引签名；工具的输出 schema 是开放的。 |
| `search/src/index.ts:62` | `sessionId as SessionId` | dsh 的会话 id 是品牌串。 |
| `speech/src/index.ts:68` | `values().apiKeyEnv as CredentialRef` | 凭据接缝用品牌串命名它的引用；`apiKeyEnv` 就是它解析的环境变量名。 |
| `speech/src/service.ts:48` | `config as unknown as SpeechSettings` | 设置边界：上面的检查就是运行期证明，迁移不复制一份对象。 |
| `speech/src/service.ts:124` | `JSON.parse(…) as Record<string, unknown>` | 解析边界：ASR 的回答是 JSON；值不是对象时仍在读属性处失败，和以前一样。 |
| `probe/src/index.ts`（11 处） | `ctx.get(…) as <本地视图类型> \| undefined` | 探针只读装好的组合，它的服务类型是探针自己的读法；`ctx.get` 的反射层没有这些名字的类型。 |

### 6.2 `!`（非空断言，两处）

两处都是 `noUncheckedIndexedAccess` 下的下标访问，**只在类型层**，运行期逐字相同：

- `delivery/src/index.ts:166` — `row.files[index]!`：循环上界就是文件数，下标必在范围内。
- `speech/src/service.ts:94` — `req.headers['content-type']?.split(';')[0]!`：`split` 永远至少返回一段。

dsh 自己的代码用同一个写法（`packages/core/session/src/index.ts:1004`：`this.log[seq]!`）。

---

## 7. 脚本

- `work/implementation/evidence/210-ts-remaining/parity-scan.mjs` —— 机械复查，可重复运行：
  `node work/implementation/evidence/210-ts-remaining/parity-scan.mjs [base-ref]`（默认基线 `47164df889`）。
  **退出码即结论**：归一化后还有残差就打印残差并以非零码退出；
  九个文件全部归零时以 0 退出。下一张票可以直接把它当门禁用。

---

## 8. 未完成 / 留给下一票

- **全量 `npm test`** 未跑（按票据留给 T6）。本票跑的是十一个相关测试文件
  （`gateway-service`、`gateway`、`product-sources`、`bundle-packages`、`bundle-groups`、
  `baseline-boot`、`plugin-compatibility`、`docs`、`identity-interfaces`、`model-double`、
  `groups`），**60/60 通过**。`model-double` 是 §5.1 那处 `register` 差异的判定性测试
  （它断言精确的 18 个工具目录）。
- `scripts/` 未迁（那是 T6）。
- 根 `README.md` 与 `AGENTS.md` 里关于「无构建」「`.mjs`」一类声称的改写由 T6 收口时一并处理；
  本票只改了 `docs/decisions/upstream-compatibility-calibration.md` 里两处会失效的相对链接。
