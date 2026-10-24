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

## 2. 跑过的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run clean && npm run build` | 干净通过（clean 移除 12 个构建目录，build 无输出无错） |
| `node --test tests/gateway-service.test.mjs tests/gateway.test.mjs` | **15/15 通过**（0 失败） |
| `node --test tests/product-sources.test.mjs tests/bundle-packages.test.mjs tests/bundle-groups.test.mjs tests/baseline-boot.test.mjs tests/plugin-compatibility.test.mjs tests/docs.test.mjs tests/identity-interfaces.test.mjs` | **39/39 通过**（0 失败） |
| `npm run backend:doctor` | **doctor: all checks passed**（见 §2.3） |
| `OURFAIRY_PORT=0 npm run backend:probe` | **ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)** |
| `npm run combo:verify` | **combo: combination verified**（ourfairy/dsh/android source 三行全 ok） |
| `node work/implementation/evidence/210-ts-remaining/parity-scan.mjs` | 9 个文件的运算符计数全部相同；字面量多重集只有相对说明符的差异；token 流的差异见 §4 |
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

脚本做的四件事，逐文件、源码与 **dist 产物**各做一遍：

1. 运算符计数（逐个运算符的出现次数）；
2. AST 字面量多重集；
3. **顺序敏感**的 token 流；
4. 行对比（布局敏感，**每个文件都打印**，不挂在计数增量后面——这是 T4 修掉的第一个盲点）。

T4 修掉的第二个盲点（扫描器把模板字面量之后的内容吞掉）由模板感知的 token 流处理：
扫描遇到 `TemplateHead`/`TemplateMiddle` 就扫到替换表达式的右花括号，再 `reScanTemplateToken()`
取回模板尾。**本票又补了一处**：扫描器的模板尾 token 带着「替换表达式的右花括号到下一个反引号
之间」的文本，一处改动会让一个 token 吞掉一整个函数，所以脚本另加一条
`source tokens (normalized)`：模板部分按 kind 记，模板自己的文本由上面的字面量多重集负责。
两条流都打印。

### 4.1 结果

| 文件 | 运算符 | 字面量 | token（normalized） |
| --- | --- | --- | --- |
| `backend/delivery/src/index.ts` | 相同 | 相同 | 见 §4.2 (a)(b)(c) |
| `backend/gateway/src/http.ts` | 相同 | `s:./service.mjs +1, s:./service.js -1` | 见 §4.2 (d) |
| `backend/gateway/src/index.ts` | 相同 | `s:./http.mjs +2, s:./service.mjs +2, s:./http.js -2, s:./service.js -2` | 见 §4.2 (d) |
| `backend/gateway/src/service.ts` | 相同 | 相同 | 见 §4.2 (b)(e) |
| `backend/groups/src/index.ts` | 相同 | 相同 | 见 §4.2 (a)(f) |
| `backend/probe/src/index.ts` | **相同** | **相同** | **完全相同** |
| `backend/search/src/index.ts` | 相同 | 相同 | 见 §4.2 (a)(g) |
| `backend/speech/src/index.ts` | 相同 | `s:./service.mjs +1, s:./service.js -1` | 见 §4.2 (d) |
| `backend/speech/src/service.ts` | 相同 | 相同 | 见 §4.2 (b) |

九个文件的**运算符计数全部相同**（源码与 dist 各一遍）。字面量多重集只有相对说明符
`./x.mjs` → `./x.js` 的差异 —— 那是迁移规则本身要求的。

### 4.2 逐条解释（没有未解释的差异）

- **(a) 箭头函数的参数多了括号**：`const receipt = row =>` → `const receipt = (row) =>`。
  原因：参数带类型标注时 TypeScript 要求括号。运行期完全相同（括号不是运行期语义）。
  涉及 delivery 4 处、groups 3 处、search 2 处。
- **(b) `Number.isSafeInteger(...)` → `isSafeInteger(...)` 谓词助手**：三处
  （delivery 的 `fileSelectors`、gateway 的 `modelEntry`、speech 的 `resolveSpeechSettings`）。
  原因：`Number.isSafeInteger` **不是**类型守卫，写不出 `entry[field] < 1` 这种比较；
  助手把它包成 `(value: unknown) => value is number`。运行期检查是同一个 `Number.isSafeInteger`，
  只是多了一层函数调用。**这正是票据里点名的坑**（T4 的 `backend/attachments/src/pdf.ts`
  已有同样的助手，形状照抄）。
- **(c) delivery 的 `register` 多了一句 `return undefined`**：`ctx.on('agent/created', …)` 的
  处理器返回类型是 `undefined | Promise<undefined>`，一个 `void` 的箭头过不了。
  运行期：`register` 原本就返回 `undefined`，只是从「隐式」变成「显式」。
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
  详见 §5。
- **(g) search 的 `register` 同样多了一句 `return undefined`**：同 (c)。

---

## 5. 找到的行为差异

逐条列出，全部已解决。

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
| `gateway/src/service.ts:477,575` | `(body ?? {}) as Record<string, unknown>` | HTTP 边界：请求体是 JSON 对象，缺体时空对象。 |
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

---

## 8. 未完成 / 留给下一票

- **全量 `npm test`** 未跑（按票据留给 T6）。本票跑的是票据点名的八个测试文件
  （`gateway-service`、`gateway` 两个文件 15 条；`product-sources`、`bundle-packages`、
  `bundle-groups`、`baseline-boot`、`plugin-compatibility`、`docs`、`identity-interfaces`
  七个文件 39 条），全部通过。
- `scripts/` 未迁（那是 T6）。
- 根 `README.md` 与 `AGENTS.md` 里关于「无构建」「`.mjs`」一类声称的改写由 T6 收口时一并处理；
  本票只改了 `docs/decisions/upstream-compatibility-calibration.md` 里两处会失效的相对链接。
