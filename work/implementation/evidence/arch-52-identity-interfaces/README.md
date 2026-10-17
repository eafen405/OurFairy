# arch-52 — identity 以裸 store 暴露 32 个成员（收窄为按领域 interface，不拆库）

- 票：#52（地图 #69 架构收口）
- 仓库：OurFairy（后端）
- 分支：`arch/52-identity-interfaces`
- worktree：`/home/eafen405/projects/OurFairy/.worktrees/arch-52-identity-interfaces`
- 基线：开工先 `git merge integration/ourfairy-v1`，tip `fefed2b`（含 #50/#51/#53/#62/#64/#66/#67 等全部前置）；收尾时集成分支前进到 `26cc002`（#68 pin），已再次合并
- 实现提交：`827d798`（`refactor(backend): expose identity by domain and keep the store inside`）
- 合并提交：`fb84ef6`（第二父 `26cc002`，无冲突；合入 #68 的 combo pin 与证据）
- 证据提交：本 README 所在提交（含本目录与全部日志），即分支 tip / FINAL_SHA
- 验收状态：合并后全量 `npm test` **139/139 pass**、`npm run combo:verify` **3 仓 ok**（`full-npm-test-merged.log`、`combo-verify-merged.log`）；证据提交的 pre-commit hook 再复跑同一组命令并通过（`commit-evidence.log`）

> 合并提交 `fb84ef6` 用 `--no-verify`：pre-commit hook 跑 combo 检查时 HEAD 仍是合并前的实现提交（`827d798`），「worktree 基于 integration tip」在合并提交落盘前必然失败——这是 hook 时机与 merge 语义的固有矛盾（#62/#57 同样处理）。消解：合并落盘后立刻在同一树跑 `npm test` 139/139 与 `combo:verify`（上述两份日志），随后的证据提交走真实 hook 并通过。
>
> 另有一次证据提交尝试在合并前失败（138/139，只有 `doctor passes on a clean isolated home` 红）：共享 rikkahub checkout 已到 `c3eea8a`（#68 合入）而当时集成分支仍 pin `81f1b06`，属组合中间态，非本票改动；原文保留在 `hook-attempt-1-pin-drift.log`。合入 `26cc002`（#68 pin）后消解。

## 前提核对（先复核再动手）

票面行号来自评审基线 `d189d85bd`，逐条在当前 tip 复核（`premise-check.log`）：

| 票面说法 | 复核结果 |
| --- | --- |
| `identity/src/index.mjs:39` `this.store = store` 公开 700 行 store | **成立**（当前在 `:40`） |
| `chat/src/delivery.mjs:9` 用 `prepareDelivery`/`prepareDeliveryFile`/`userByShortId` | **成立**：`delivery.mjs:10` 取 `ctx.identity.store`，占 5 个调用点 |
| `spaces/src/groups.mjs:8` 用 5 个方法 | **成立**：`groups.mjs:8`，`users`+`groups` 共 5 个调用点 |
| `attachments/src/service.mjs:41` 用 3 个 upload 方法 | **成立**：另有 `:143` 第四次取 `identity.store.userByShortId`（票面表未计） |
| `search/src/index.mjs:14` 只取 `userByShortId` | **成立**（当前在 `:15`） |
| 前置票已改现状 | #62 删除 `identity.register`/`signIn` 转发后，`identity/http.mjs` 路由直接读 `service.store`；本票保留该包内直取，只是把 store 从 service 公开面移走 |

## 最终 interface 形状（按领域，不按消费者）

新增包内模块 `backend/identity/src/interfaces.mjs`，唯一导出 `identityInterfaces(store)`，返回四个领域面；`IdentityService` 在构造时把它们挂到 `ctx.identity`：

| 面 | 方法 → store 实现 | 消费者 |
| --- | --- | --- |
| `identity.users` | `byShortId` → `userByShortId` | chat delivery、spaces groups、attachments、search（四包共用的 users 领域操作只在这里出现一次） |
| `identity.groups` | `forMember` → `groupsForMember`；`create` → `createGroup`；`changeMember` → `changeGroupMember`；`owns` → `ownsGroup` | spaces group tools |
| `identity.uploads` | `read` → `readUpload`；`insert` → `insertUpload`；`update` → `updateUpload` | attachments |
| `identity.deliveries` | `prepare` → `prepareDelivery`；`prepareFile` → `prepareDeliveryFile`；`pending` → `pendingDeliveries`；`complete` → `completeDelivery` | chat delivery |

- 共 12 个方法，全部有真实消费者；没有为「以后可能用到」加 `readDelivery`、`listUsers`、`inviteState` 等。新增领域操作是增量改动。
- `groups.userByShortId` 按领域归入 `users`，不在 groups 面复制（票面关键判断）。
- 形状按领域而非按包：chat 同时用 `users` + `deliveries`，attachments 同时用 `users` + `uploads`，没有为四个包各造镜像。

## 不拆库的依据

票面明确「不拆库」。实现也沿用现有结构：

- `store.mjs` 只有一个 `DatabaseSync` 连接、一个 `#transaction()`（`BEGIN IMMEDIATE`）与一套 `SCHEMA_VERSION = 6` 迁移阶梯；四张领域表在同一次迁移事务里创建/升级。
- 若拆成四个库，跨领域原子性（例如 group 创建要读 users）要么退化为跨库事务，要么复制迁移阶梯与版本号，正是票面说的「搬动复杂度」。
- 本票**未改表结构、未改迁移、未改业务规则**；只把 store 从公开面收回包内，各领域表继续共用同一数据库文件与迁移阶梯。

## 改动文件

- `backend/identity/src/interfaces.mjs`（新）：领域面定义，JSDoc 写明每个面的消费者；未从 package.json 导出，只在包内使用。
- `backend/identity/src/index.mjs`：删除 `this.store = store`；`users`/`groups`/`uploads`/`deliveries` 四个面挂到 service；`authenticateRequest`/`createInvite`/`signOutRequest` 改读模块私有 symbol 上的 store。
- `backend/identity/src/http.mjs`：`identityHandlers({ service, store, fence })`；`/identity/register`、`/identity/sign-in` 继续直接调包内 store（保留 #62 删除纯转发的决定，KDoc 说明原因）。
- `backend/chat/src/delivery.mjs`、`backend/spaces/src/groups.mjs`、`backend/attachments/src/service.mjs`、`backend/search/src/index.mjs`：四个消费者改走领域面；attachments 的 `get store()` 收窄为 `get uploads()`，users 读取用 `identity.users.byShortId`。
- `tests/identity-interfaces.test.mjs`（新）：4 条契约测试。

## 关键实现发现（如实记录）

第一版把 store 存进 `#store` 私有字段，单元契约测试全绿，但定向行为测试出现 32 条失败（`targeted-consumers.log`，`sessions/internal`）。加临时错误栈后定位：

```
TypeError: Cannot read private member #store from an object whose class did not declare it
    at Proxy.authenticateRequest (.../@ourfairy/dsh-identity/src/index.mjs:61:51)
```

Cordis 调用 service 方法时 `this` 是 traceable proxy（`vendor/cordis/lib/index.js:120`），`#` 私有字段无法通过 proxy 读取。改为**模块私有 Symbol** `STORE` 持有 store（`this[STORE]`）：package 外部无法访问（symbol 未导出），公开面不再有 store 属性。修复后定向 71/71（`targeted-consumers-2.log`），全量 139/139。该失败也证明行为测试确实覆盖了 service 接线，不是只靠源码断言。

## TDD 证据

| 步骤 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| red 1 | `node --test tests/identity-interfaces.test.mjs` | 模块不存在，1 fail / 0 pass | `red-interfaces.log` |
| 实现领域面 | — | 3 条形态/委托测试转绿，第 4 条仍红：`IdentityService must not republish the store` | `red-consumers.log`（3 pass / 1 fail） |
| red 2 → green | 改 service/http/四消费者后同命令 | 4/4 pass | `green-interfaces.log` |
| 定向行为 | 上表 10 个测试文件 | **71/71 pass**（含 chat 投递、文件投递、groups、attachments、search、identity HTTP/store、speech、owned sessions） | `targeted-consumers-2.log` |
| 全量（合并前） | `npm test` | **139/139 pass**（基线 135 + 新增 4） | `full-npm-test.log` |
| 组合（合并前） | `npm run combo:verify` | 3 仓 ok / combination verified | `combo-verify.log` |
| 全量（合并后） | `npm test` | **139/139 pass** | `full-npm-test-merged.log` |
| 组合（合并后） | `npm run combo:verify` | 3 仓 ok，`based on the integration tip` | `combo-verify-merged.log` |
| 提交 hook | `git commit`（证据提交） | 复跑 139/139 + combo verified 后落盘 | `commit-evidence.log` |

> 自引用说明：`commit-evidence.log` 是证据提交（amend 前 `27631a8`）的 pre-commit 原文；随后只把该日志加入同一提交并 amend，产品树未变，amend 自身的 hook 同样 139/139 + combo verified（终端输出），最终 tip 见实现者报告。

契约测试内容：

1. 四个面恰为 `users`/`groups`/`uploads`/`deliveries`，各自键恰为生产使用的方法；`identity.store` 不存在；store 的其余公开成员（`register`/`signIn`/`authenticate`/`seedPhaethon`/`now` 等 13 个）不出现在任何面上。
2. `users.byShortId`、`groups.create/forMember/owns/changeMember` 经领域面委托到底层 store（含 owner 必须留在群里的 409 规则）。
3. `uploads.insert/read/update`、`deliveries.prepare/prepareFile/pending/complete` 经领域面完成生命周期；底层仍是同一 store/同一事务。
4. 源码边界：`IdentityService` 不得再赋值 `this.store`、必须调用 `identityInterfaces(`；四个消费者源码不得出现 `identity.store`。行为由上述定向测试与全量测试覆盖，源码断言只钉住跨包可达性（沿用 `tests/conversation-search.test.mjs` 的 reach-through 先例）。

## 未做 / 范围外

- 未新增 `backend/identity/README.md`：票面把「identity 无 README」作为 `store` 无文档的旁证，但修复方向是收窄暴露面；地图 §Out of scope 明确不顺手扩展，接口本身已在 `interfaces.mjs` 的 JSDoc 中写明消费者。若需要包级 README，应另立票。
- 未拆分数据库/表/迁移；未改表结构与业务规则。
- `tests/identity-store.test.mjs` 仍直接 `new IdentityStore(...)`：这是测试基础设施（需要构造 v1 fixture、验证迁移与并发），不属于消费者；本票保留。
- 未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。

## 实际命令

```bash
cd /home/eafen405/projects/OurFairy/.worktrees/arch-52-identity-interfaces
git merge integration/ourfairy-v1                          # tip fefed2b，无冲突
# 收尾：集成分支前进到 26cc002（#68 pin），再次合并（合并提交 fb84ef6，无冲突）
git stash push -u && git merge --no-verify integration/ourfairy-v1 && git stash pop

node --test tests/identity-interfaces.test.mjs             # red  → red-interfaces.log / red-consumers.log
node --test tests/identity-interfaces.test.mjs             # green 4/4
node --test tests/identity-interfaces.test.mjs tests/text-delivery.test.mjs tests/file-delivery.test.mjs \
  tests/groups.test.mjs tests/attachments.test.mjs tests/conversation-search.test.mjs \
  tests/identity-http.test.mjs tests/identity-store.test.mjs tests/speech.test.mjs \
  tests/owned-sessions.test.mjs                            # → 71/71 targeted-consumers-2.log
npm test                                                   # → 139/139 full-npm-test.log
npm run combo:verify                                       # → 3 repos ok combo-verify.log
git commit -m "refactor(backend): expose identity by domain and keep the store inside"
                                                           # → 827d798，hook 复跑全量+combo 通过
npm test                                                   # 合并后 → 139/139 full-npm-test-merged.log
npm run combo:verify                                       # 合并后 → 3 repos ok combo-verify-merged.log
git commit -m "docs(evidence): record arch-52 identity domain interface verification"
                                                           # → 证据提交，真实 hook 复跑全量+combo 通过
```
