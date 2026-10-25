# 207-ts-identity-sessions — 票 #207（T2 identity + sessions 迁 .ts）证据

分支 `ticket/207-ts-identity-sessions`，基线 `integration/spec-205` @ `0b816e441b`。dsh 检出
`/home/eafen405/projects/deepseek-harness` @ `d1b6099ae716`（与 `combo.json` 锁定一致，已构建，本票未重建）。
Node v24.18.0，编译用 dsh 自带的 TypeScript 6.0.3。

`tdd` skill 在本会话不可用（无 `Skill` 工具，磁盘上也没有该 skill），按同样的 red→green 纪律手工执行：
先落断言看它红，再让它绿，红绿都记在下面。

## 改了什么

### 两个包的源码（`.mjs` → `.ts`，包内原子）

| 包 | 文件 |
| --- | --- |
| `backend/identity` | `src/{codes,index,interfaces,owner,routes,store}.ts`、`src/schema/{deliveries,groups,indexes,uploads,users}.ts`（11 个，`.mjs` 源文件已删，不留 shim） |
| `backend/sessions` | `src/{events,http,index,service}.ts`（4 个） |
| `backend/sessions` | `test-support/{persist-fixtures,resume-empty}.ts`（2 个测试专用行，见下「test-support 决定」） |

相对 import 一律写 `.js` 说明符（`./codes.js`、`./schema/users.js`）：Node 的类型剥离只删类型、不改写说明符，
编译产物的路径才对得上。`backend/http` 之前没有相对 import，这一票是它的第一个实例。

### 清单与工程文件

- `backend/identity/package.json`：`main` → `./dist/index.js`，`types` → `./dist/index.d.ts`；
  `exports` 的 `"."`、`"./routes"`、`"./owner"` 各写成 `{ "types": …, "default": … }`（条件按声明顺序匹配，
  `types` 在前）；`"./locale/*.json"` 保持纯字符串目标；`files` → `["dist/**/*.js", "dist/**/*.d.ts",
  "README.md", "locale/*.json"]`。
- `backend/sessions/package.json`：同样切 `dist`；`exports` 为 `"."` 与 `"./events"`。
- `backend/identity/tsconfig.json`、`backend/sessions/tsconfig.json`：照 `backend/http` 的形状
  （`rootDir: src`、`outDir: dist`、`tsBuildInfoFile: dist/.tsbuildinfo`、`include: ["src/**/*.ts"]`）；
  `references` 为 identity → `../http`，sessions → `../http` + `../identity`。
- 根 `tsconfig.json`：solution 增加 `./backend/identity`、`./backend/sessions` 两个 reference。
- 两个包的 README 没有点名 `.mjs` 路径，本票无需改。

### 测试 import 与断言（同一提交内）

- `tests/identity-store.test.mjs` → `../backend/identity/dist/{store,codes}.js`
- `tests/identity-interfaces.test.mjs` → `../backend/identity/dist/{interfaces,store}.js`
- `tests/owner-codec.test.mjs` → `../backend/identity/dist/owner.js`
- `tests/conversation-search.test.mjs` → `../backend/identity/dist/owner.js`
- `tests/owned-sessions.test.mjs` → 两个 test-support 行改为 `backend/sessions/test-support/*.ts`
- `tests/identity-interfaces.test.mjs` 里扫描服务源码的那条断言改为读 `backend/identity/src/index.ts`
  （文件改名了，断言本身一字未动）。
- `tests/product-sources.test.mjs` 的陈旧探针从 `backend/identity/src/staleness-probe.mjs` 改为
  `backend/identity/dist/staleness-probe.js`：identity 现在发布的是构建产物，探针必须落在它发布的目录里，
  否则新增文件不再进哈希，断言会假绿。断言文字未改。

### 文档链接

`tests/docs.test.mjs` 断言仓库里每个 Markdown 相对链接都可达。源码改名后有 9 条链接指向不存在的文件：
`docs/decisions/upstream-compatibility-calibration.md`（4 条）与
`work/implementation/evidence/144-schema-modules/README.md`（5 条 schema 链接）。这 9 条改成新的 `.ts` 路径，
正文未改。

## 类型口径

档位照 `tsconfig.base.json`：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` +
`noImplicitOverride` + `noUnusedLocals` + `noUnusedParameters`（#201 的决议）。

- 没有 `@ts-nocheck`，没有 `@ts-ignore`，没有 `@ts-expect-error`。
- 导出的签名里没有 `any`。
- 保留的 `as`（全部是「品牌/边界」上的断言，每处都写了理由）：
  - `backend/identity/src/owner.ts`：`ownerOf` 返回 dsh 的 `SessionOwnerId` 品牌类型。品牌是类型层的，
    运行期字符串不变；owner codec 正是唯一写这个字符串的地方。
  - `backend/sessions/src/service.ts`：`primarySessionIdOf` / `sessionIdOf` 返回 dsh 的 `SessionId` 品牌类型；
    `_ownedHeader` 把请求里带来的 session id 认作 `SessionId`（运行期是同一个字符串）。
  - `backend/identity/src/store.ts`：`updateUpload` 的四列绑定（`status` / `offset` / `original` / `image`）
    与 `#readDelivery` 的附件列表读取，都是 DB 边界上的断言，理由写在代码注释里；
    断言只发生在类型层，运行期不再多一道检查（见末节「回退三处行为变化」）。
- 动态形状一律用真守卫收窄，不用断言：
  - SQLite 行：`rowOf` / `requiredRow` / `rowsOf` 三个小工具把驱动的 `SQLOutputValue` 行收成表自己的行形状
    （schema 是列类型的权威），JSON 列走 `jsonValue`（`JSON.parse` 的结果先落进 `unknown`）。
  - `shortId` / 成员操作码：`isShortId` / `isMemberAction` 两个类型守卫。
- dsh 的上下文接缝用 `import type {} from '@deepseek-ai/dsh-…'` 加载其 `Context` 增强：
  `dsh-client-connection`（`ctx.connection`）、`dsh-host-webserver`（`ctx.webServer`）、
  `dsh-session`（`ctx.sessions`）、`dsh-session-persistence`（`ctx.sessionPersistence`）、
  `dsh-session-query`（`ctx.sessionQuery`）。这些 import 是纯类型的，编译产物里没有新的运行期依赖
  （`backend/identity/dist/index.js` 的 import 与迁移前逐条相同）。
- 产品自己的服务在各自的包里声明上下文增强：identity 声明 `ctx.identity`，sessions 声明 `ctx.ourfairySessions`。
- 身份模块的 `{kind: 'user', id}` 主体在 dsh 的 `PrincipalMap` 里没有对应项，按 dsh 自己的扩展点
  （`packages/api/remote-access` 也是这么合并非 owner 种类的）在产品包里补了 `user` 一项。

### 行为面：迁移中收窄的一处边界

迁移中曾有三处「原来会静默继续、现在会明确失败」的地方，都是损坏数据或调用方给错类型的路径。
三处经迁移评审判定违反本票「不改行为」的约定，已在同一分支回退（见末节「回退三处行为变化」），
只剩一处：

1. `apply` 里某个路径没有对应 handler 时抛错（原来会把 `undefined` 注册给 carrier）。这一处静态不可达：
   `IDENTITY_PATHS` 与 handler 表在同一个包内共用同一组五个路径字符串，`handlers.get(path)` 取不到 `undefined`。

另外两处是等价改写，不是行为变化：`pendingDeliveries` 过滤掉不可能存在的空行；
`resume-empty` 夹具在 `stat` 拿不到行时抛错，与原来「读 `undefined` 的属性」同样落到夹具自己的 catch。

还有一处改写是为了拿到类型：`signOutRequest` 里 `this.ctx.get('connection')`（cordis 的签名返回 `any`）
改成 `this.ctx.connection`。两者在当前组合里解析到同一个服务——identity 行 `inject` 了 `connection`，
它必然已挂载——区别只在 cordis 的 `get` 与代理取值的查找路径不同；换成代理取值后，这次调用是被类型检查的。

## test-support 决定

`backend/sessions/test-support/` 的两个文件是**测试专用**的 dsh 插件行：它们由测试用绝对路径交给 loader，
不在包的 `files` 里，因此从不随包发布，也不进 profile。

- **类型检查**：单独的 noEmit 工程 `backend/sessions/tsconfig.test-support.json`（`noEmit: true`、
  `allowImportingTsExtensions`、`erasableSyntaxOnly`），作为根 solution 的叶子 reference 参与 `tsc -b`；
  它的 buildinfo 落在 `backend/sessions/dist/.tsbuildinfo.test-support`（已被 `/backend/*/dist/` 忽略，
  `npm run clean` 也会清掉）。noEmit 工程只做类型检查、不产出 JS，所以夹具不会进包的 `dist`，
  也就不会被 `files: ["dist/**/*.js"]` 发布。
- **测试怎么到达**：测试把夹具路径指向 `backend/sessions/test-support/*.ts`，由 Node 的类型剥离直接执行
  （Node 22.18 起默认开启且不再发 experimental warning）。这条路线与 T6 计划里 `scripts/` 走 `.ts` 的做法一致。
- **为什么不是「编译进 dist 再加载」**：那要让夹具落进 `dist/`，而 `dist/**/*.js` 是包的发布集，
  夹具就会被发布出去——与「不随包发布」的要求冲突；要避开就得给夹具单开一个输出目录和一条清理路径，
  比现在多一套机器。

## Red / green

**Red 1（包内原子）**——源码已迁成 `.ts`、清单已切 `dist`，测试仍指旧源码路径：

```
$ node --test tests/identity-store.test.mjs tests/identity-interfaces.test.mjs tests/owner-codec.test.mjs
✖ tests/identity-interfaces.test.mjs
✖ tests/identity-store.test.mjs
✖ the codec's two directions round-trip exactly the short numbers it accepts
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../backend/identity/src/owner.mjs' imported from .../tests/owner-codec.test.mjs
```

**Green**——测试 import 改到 `dist/*.js`、夹具路径改到 `.ts` 之后：

```
$ node --test tests/identity-store.test.mjs tests/identity-interfaces.test.mjs tests/owner-codec.test.mjs
ℹ tests 19  ℹ pass 19  ℹ fail 0
```

**Red 2（陈旧探针落点）**——identity 改发布 `dist` 后，探针仍写在 `src/`：

```
$ node --test tests/product-sources.test.mjs
✖ a new product source file changes the hash and decides install
  AssertionError: backend/identity/src/staleness-probe.mjs is published by its package,
  so its content must reach the staleness hash
ℹ tests 9  ℹ pass 8  ℹ fail 1
```

**Green**——探针改落 `backend/identity/dist/staleness-probe.js`（包真正发布的目录）之后：9/9 通过。

**Red 3（test-support 确实被检查）**——往夹具里塞一个类型错误，`tsc -b` 当场报出来：

```
$ node node_modules/typescript/bin/tsc -b tsconfig.json
backend/sessions/test-support/persist-fixtures.ts(35,7): error TS2322:
  Type 'string' is not assignable to type 'number'.
```

（该行随后删除；noEmit 工程确实在检查这两个文件，不是空转。）

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run clean` | `removed 3 build output directories`（http/identity/sessions 的 `dist`） |
| `npm run build` | 干净树编译通过，无输出。产物：`backend/identity/dist/{codes,index,interfaces,owner,routes,store}.{js,d.ts}` + `dist/schema/*.js`，`backend/sessions/dist/{events,http,index,service}.{js,d.ts}` |
| `node --test tests/identity-store.test.mjs tests/identity-interfaces.test.mjs tests/owner-codec.test.mjs` | 19 tests / 19 pass / 0 fail |
| `node --test tests/owned-sessions.test.mjs` | 7 tests / 7 pass / 0 fail（含两个 `.ts` 夹具行被 loader 加载） |
| `node --test tests/conversation-search.test.mjs tests/native-rows.test.mjs tests/identity-http.test.mjs` | 21 tests / 21 pass / 0 fail |
| `node --test tests/product-sources.test.mjs` | 9 tests / 9 pass / 0 fail |
| `node --test tests/bundle-packages.test.mjs tests/config-contracts.test.mjs tests/composition-module.test.mjs tests/launcher-import.test.mjs tests/bundle-manifest.test.mjs tests/dsh-checkout.test.mjs` | 27 tests / 27 pass / 0 fail |
| `node --test tests/docs.test.mjs` | 1 test / 1 pass / 0 fail |
| `npm run backend:doctor` | `doctor: all checks passed`。`product packages` 里 identity/sessions 只剩 `dist/*`（`.js` + `.d.ts`）+ `README.md` + `locale/en.json` + `package.json`，**没有** `src/*`，也**没有** `test-support/*` |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)` |
| `npm run combo:verify` | `combo: combination verified`（ourfairy / dsh / android source 三行 ok） |
| `git check-ignore -v backend/sessions/dist/.tsbuildinfo.test-support` | `.gitignore:11:/backend/*/dist/` |

`backend:probe` 用了 `OURFAIRY_PORT=0`：本机 3080 端口被一个与本票无关的 `dsh web` 占着（与 T1 记录的情况相同）。

## 没有跑的

- **没有主动跑全量 `npm test`**：票面「不跑全量」把全量留给 T6。本票主动跑的是上表列出的相关文件。
  提交时仓库自带的 pre-commit 钩子会因为包 manifest 属于权威路径而判成 `full` 模式、替本票跑一次全量
  （`node scripts/precommit.mjs --print` 输出 `"mode": "full"`）：**钩子那次** `npm test` 是
  293 tests / 293 pass / 0 fail，`combo:verify` 是 `combo: combination verified`。
  那是钩子的行为，不构成本票的门禁。
- **没有触发 CI**：没有 push。
- **没有合入 `integration/spec-205`**：由 Lead 合。
- 没有改 `combo.json`、Android 客户端、dsh 检出；没有加根 `devDependencies`、lockfile 或第二份 TypeScript。
- 没有迁 `spaces` / `attachments` / `chat` / `delivery` / `gateway` / `groups` / `search` / `speech` / `probe`，
  也没有迁 `scripts/`。

## 未完成项与留给下一票的提醒

- **`.js` 说明符规则有了第一个实例**：`backend/http` 没有相对 import，本票的 identity/sessions 才是
   `./x.js` 的真实用例。T3 起的包照抄即可（`import './x.js'`，不是 `'./x.ts'`）。
- **dsh 的上下文接缝靠空的类型 import 加载**：`import type {} from '@deepseek-ai/dsh-<pkg>'`。
  这条 import 在编译产物里被抹掉，不引入运行期依赖，但**编译期**要求链接农场里有那个包
  （`scripts/link-types.mjs` 会链上 dsh 的全部包 ✓）。
- **品牌类型是下一票会碰到的边界**：dsh 把 session id / owner id 都做成品牌字符串（`SessionId`、
  `SessionOwnerId`）。产品自己造的 id（`primarySessionIdOf` / `sessionIdOf`）和 owner（`ownerOf`）
  必须过一次品牌；本票用了一处带注释的 `as`。T3+ 的包若自己造 id，同样处理，别用 `any` 绕过去。
- **`ctx.connection` 的请求形状**：Connection 交给 authenticator 的是 `ConnectionTrustRequest`
  （可能是 Fetch 的 `Headers` 袋），产品的读凭据路径要的是 node 请求。本票用一个类型守卫
  （`'socket' in request`）把两者分开：node 请求照旧读凭据，其它形状一律「没有凭据」。
  守卫实现本身不需要断言，但守卫的谓词类型 `request is IncomingMessage` 依赖
  `IncomingMessage` 可赋给 `ConnectionTrustRequest`——dsh 改这个类型时这里会先红。
- **陈旧探针的落点要跟发布集走**：每个包迁完后，「新增一个已发布文件必须进哈希」这条断言的探针
  都要落在该包真正发布的目录（迁完的包是 `dist/`）。T3 迁 `spaces`/`attachments` 时，
  `tests/product-sources.test.mjs` 里的探针若指向这些包的 `src/`，要一并改。
- **`backend/sessions/test-support` 不进包、不进 profile**：doctor 的 `product packages` 清单里
  不应出现 `test-support/`；若将来有人把它写进 `files`，夹具就会随包发布。
- **`SessionHeader.createdAt` 是必填**：dsh 的类型里它是必填数字，本票去掉了旧代码里的 `?? 0`；
  下一票若按旧习惯写 `?? 0`，TS 会报 TS2869。


## 回退三处行为变化（fix(#207)）

迁移评审核对 `integration/spec-205` 侧的合并结果时，发现迁移引入了三处**可观察的行为变化**，
与本票「不改行为」的约定冲突。本节记录差异、证据、改法与回退后的验证。

### 差异一：`updateUpload` 不该拒收非数字的 `status` / `offset`

- 迁移前（`backend/identity/src/store.mjs` @ `0b816e441b`）：`updateUpload` 不做类型检查，值直接交给 SQLite。
- 迁移后（提交 `e7e7b3abd1`）：`backend/identity/src/store.ts` 在绑定前加了运行期 `typeof value !== 'number'`，
  抛 `Error: upload lifecycle field status must be a number`。
- 这是**成功→失败**的翻转，不是文案差异：`'2'` 在迁移前会写进 INTEGER 列（SQLite 亲和性），
  迁移后直接抛错。

### 差异二：`#readDelivery` 不该新造错误码

- 迁移前：`JSON.parse(row.attachments_json)` 原样返回。
- 迁移后：读出的附件列表若不是文件列表，抛 `IdentityError(500, 'identity/corrupt-delivery')`。
- 影响面：`backend/delivery/src/index.mjs:66` 的 `deliveries.pending()` 在每行 try/catch **之外**，
  异常会穿过 `await recovery`（`index.mjs:72`）让**每一次**投递都失败；迁移前只是记一条 warning 继续。
  同时给产品的错误码面新增了一个本票没要求的错误码。

### 差异三：`updateUpload` 不该在 `original` / `image` 上多一道 JSON 检查

- 迁移前：`value === null ? null : JSON.stringify(value)`，编码不出来就交给绑定层，
  由 node:sqlite 抛 `TypeError: Provided value cannot be bound to SQLite parameter 1.`。
- 迁移后：编码不出来时先抛 `Error: upload lifecycle field original must be JSON`。
- 两边都失败，但**错误的类型与文案不同**，对调用方是可观察的；本票是类型层迁移，不是加固，
  要保留的是迁移前那个错误。

### 实证证据

迁移评审提供的对照（同一个 SQLite 文件实测）：`{ status: '2' }` 迁移前成功并存成 `status = 2`、
迁移后抛错；`{ status: 'abc' }` 迁移前存成 TEXT `'abc'`、迁移后抛错；`{ status: null }` 两边都抛
`NOT NULL constraint failed: uploads.status`；`{ status: undefined }` 两边都抛 node:sqlite 的 `TypeError`。
投递读：`attachments_json` 是合法 JSON 但不是文件列表时，迁移前 `pendingDeliveries()` **返回**该行，
迁移后**抛** `identity/corrupt-delivery`；`attachments_json` 本身不是合法 JSON 时两边都抛 `SyntaxError`。
`original` / `image`：迁移前 `undefined` 与函数值都走 node:sqlite 的 `TypeError`，
迁移后走 `upload lifecycle field original must be JSON`。

### 改了什么

`backend/identity/src/store.ts`（本票两个包中只有这一个文件被动）：

1. `updateUpload` 的 `status` / `offset`：删掉运行期 `typeof` 守卫；值改在**编译期边界**上收窄——
   `src/schema/uploads.ts` 声明两列 INTEGER，调用方自己的类型是权威，`as number` 把 `Object.entries`
   抹掉的声明类型还原回来（#201 允许在 DB 绑定边界用 `as`，理由写在代码注释里）。运行期不再检查，
   SQLite 自己的亲和性、NOT NULL 约束与 node:sqlite 的 `TypeError` 全部按迁移前生效。
2. `updateUpload` 的 `original` / `image`：删掉运行期 JSON 检查；`src/schema/uploads.ts` 声明两列 TEXT，
   `as string` 在绑定边界上写明这个声明类型。JSON 编码不出来的值仍是 `undefined`，
   由绑定层抛 node:sqlite 自己的 `TypeError`，与迁移前一致。
3. `#readDelivery`：删掉 `isDeliveryFiles` 守卫与 `identity/corrupt-delivery` 错误码，
   `JSON.parse` 的行为与迁移前逐字一致；随之失去用途的 `isDeliveryFiles` 与 `isRecord` 一并删除，不留死代码。

未动的第四处：`backend/identity/src/index.ts:197` 的「路径没有 handler 就抛错」静态不可达，保留。

### 回退后的验证

| 命令 | 结果 |
| --- | --- |
| `npm run clean && npm run build` | 干净树编译通过，无输出 |
| `node --test tests/{identity-store,identity-interfaces,owner-codec,owned-sessions,conversation-search,native-rows,identity-http,product-sources,bundle-packages,config-contracts,composition-module,launcher-import,bundle-manifest,dsh-checkout,docs}.test.mjs` | `ℹ tests 84  ℹ pass 84  ℹ fail 0` |
| `node work/implementation/evidence/207-ts-identity-sessions/compare-pre-migration.mjs` | 每个用例 OLD/NEW 一致，末行 `differences: 0`，退出码 0 |
| `npm run backend:doctor` | `doctor: all checks passed` |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)` |
| `npm run combo:verify` | `combo: combination verified` |

`backend:probe` 仍用 `OURFAIRY_PORT=0`：本机 3080 端口被一个与本票无关的 `dsh web` 占着。

### 旧新对照的复跑方式

对照脚本随证据入库：[`compare-pre-migration.mjs`](compare-pre-migration.mjs)。它自己用
`git archive 0b816e441b backend/identity` 把迁移前的包解到临时目录，再与本票构建产物
`backend/identity/dist/store.js` 并排跑；每个用例各用一个临时 SQLite 文件，跑完全部删除。
**原始输出不入库**（按[证据索引](../README.md)的约定），复跑命令是：

```
npm run clean && npm run build
node work/implementation/evidence/207-ts-identity-sessions/compare-pre-migration.mjs
```

脚本对每个用例打印 OLD 与 NEW 各自的结果和行里剩下的值，并逐条比对；任何一条不一致就以退出码 1 结束。
回退后的实测（节选）：

```
=== upload reference binding ===

updateUpload({ original: "abc" })
  OLD: ok — stored original = "\"abc\"" (sqlite typeof text)
  NEW: ok — stored original = "\"abc\"" (sqlite typeof text)
  same: yes

updateUpload({ original: undefined })
  OLD: threw TypeError: Provided value cannot be bound to SQLite parameter 1. — stored original = null (sqlite typeof null)
  NEW: threw TypeError: Provided value cannot be bound to SQLite parameter 1. — stored original = null (sqlite typeof null)
  same: yes

updateUpload({ original: a function })
  OLD: threw TypeError: Provided value cannot be bound to SQLite parameter 1. — stored original = null (sqlite typeof null)
  NEW: threw TypeError: Provided value cannot be bound to SQLite parameter 1. — stored original = null (sqlite typeof null)
  same: yes

=== delivery read of a non-file-list attachments_json ===

attachments_json = null
  OLD: ok, returned 1 row(s), files = null
  NEW: ok, returned 1 row(s), files = null
  same: yes

attachments_json = [
  OLD: threw SyntaxError: Unexpected end of JSON input
  NEW: threw SyntaxError: Unexpected end of JSON input
  same: yes

differences: 0
```

回退前（把 `backend/identity/src/store.ts` 换回 `e7e7b3abd1`、重建 `dist` 后跑同一脚本）
13 个用例不一致，NEW 一侧分别是
`upload lifecycle field status must be a number`、
`upload lifecycle field offset must be a number`、
`upload lifecycle field original must be JSON`、
`upload lifecycle field image must be JSON` 与
`IdentityError: the stored delivery row does not name its files`——即上面三处差异的机器证据。
