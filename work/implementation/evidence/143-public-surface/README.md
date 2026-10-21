# 143-public-surface — 票 #143 证据

## 改了什么

`IdentityStore` 的公开面从 24 个方法收窄到 19 个。只改了方法区（`readDelivery` 之后到类尾），
文件头部的 DDL 常量区、import 区一行未动。

**删除的四个公开方法**（各自原来的调用方情况不同，不是同一句话）：

| 方法 | 删除前的调用方 |
| --- | --- |
| `userByName` | 唯一调用方是 `tests/identity-store.test.mjs` |
| `listUsers` | 唯一调用方是 `tests/identity-store.test.mjs` |
| `inviteState` | 全仓零调用方 |
| `liveSessionCount` | 全仓零调用方 |

**`readDelivery` 转为模块私有**：改为 `#readDelivery`，同包的 `prepareDelivery`、
`prepareDeliveryFile`、`pendingDeliveries` 仍能调用。`identity.deliveries` 面的四个方法
（`prepare`、`prepareFile`、`pending`、`complete`）名称与行为不变。

**`backend/identity/src/interfaces.mjs` 与 `backend/identity/src/index.mjs` 一行未改**：
消费方看到的领域面与调用链不变，本票只动 store 自己的公开面。

### 测试改动

- `tests/identity-store.test.mjs`：删掉 `userByName` 与 `listUsers` 的两条断言；用例改名为
  「a removed user no longer signs in or authenticates」。被删断言声称的行为由兄弟断言承担：
  同一用例里「删除后不能登录」（`identity/bad-credentials`）与「删除后不能认证」保留；
  「删除后名字仍被占用」仍由既有的 `identity/name-taken` 断言（`a removed name stays reserved`）承担。
- `tests/identity-interfaces.test.mjs`：
  - 泄漏名单去掉已不存在的方法名（`inviteState`、`listUsers`、`liveSessionCount`、`userByName`、
    `readDelivery`），留下仍存在的 store 成员（`authenticate`、`close`、`createInvite`、`now`、
    `register`、`seedPhaethon`、`signIn`、`signOut`），「领域面不泄漏 store 成员」这条保障仍在；
    四个领域的键集断言不变。
  - 新增两条断言：公开面方法名集合恰为那 19 个（多一个或少一个都失败）；`store.readDelivery`
    从包外不可达。

## 实际命令与结果

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `node --test tests/identity-interfaces.test.mjs` | 只加断言、未改实现 | **red**：19 方法断言以 24 个实际方法名失败（多出 `inviteState`、`listUsers`、`liveSessionCount`、`readDelivery`、`userByName`）；「delivery read」断言以 `[Function: readDelivery]` 失败 |
| `node --test tests/identity-store.test.mjs tests/identity-interfaces.test.mjs` | 改完实现后 | 18 tests / 18 pass / 0 fail |
| `npm test`（pre-commit hook 内，提交 `2efaee4`） | 第一步提交（`readDelivery` 转私有） | 235 tests / 235 pass / 0 fail |
| `npm run combo:verify`（同上） | 同上 | `combo: combination verified`（ourfairy 行 based on integration tip） |
| `npm test`（pre-commit hook 内，提交 `8396328`） | 第二步提交（删四个方法） | 236 tests / 236 pass / 0 fail |
| `npm run combo:verify`（同上） | 同上 | `combo: combination verified` |
| `git merge integration/spec-132` | 收口前 | `Already up to date.` —— 集成分支 tip 仍是 `2f6504d`，期间没有别的票合入 |
| `npm test` | 合并后、最终树 | 236 tests / 236 pass / 0 fail |
| `npm run combo:verify` | 合并后、最终树 | `combo: combination verified` |
| `npm test` + `npm run combo:verify`（pre-commit hook 内，证据提交） | 最终树 | 236 tests / 236 pass / 0 fail；`combo: combination verified` |

## Red / green 说明

本票的验收接缝就是 `IdentityStore` 的公开接口本身，既有测试已经从这里进入，**没有新增测试文件**。

先写会失败的断言再改实现：

1. 在 `tests/identity-interfaces.test.mjs` 写下「公开面方法名集合恰为那 19 个」与「`store.readDelivery`
   从包外不可达」两条断言，此时实现未动：
   - 19 方法断言 **red**，实际取到 24 个方法名（`deepStrictEqual` 差异里多出 `inviteState`、
     `listUsers`、`liveSessionCount`、`readDelivery`、`userByName`）；
   - 「delivery read」断言 **red**，实际取到 `[Function: readDelivery]`。
2. 改实现（`readDelivery` → `#readDelivery` 并更新 5 处同包调用，删除四个公开方法），再跑
   `node --test tests/identity-store.test.mjs tests/identity-interfaces.test.mjs`：**green**，18/18。

结构类声称用「接缝断言」而不是扫源码的正则：19 方法那条断言直接读
`Object.getOwnPropertyNames(IdentityStore.prototype)`——公开面多一个或少一个方法都会让它失败；
`#readDelivery` 作为私有类字段根本不落在原型上，同包可调用由既有的投递行为断言
（`uploads and deliveries answer under their own domain`）承担。

## 未执行项与说明

- 未 push、未合入 `integration/spec-132`、未改 `combo.json`、未评论或关闭 GitHub issue #143。
- 未改 `work/implementation/evidence/README.md`（证据索引由收口票 #145 统一登记）。
- 未做真机/客户端验收：本票只涉及后端 store 的公开面，不涉及客户端。
- 已知 flake 出现过一次并自行消失：证据提交的第一次尝试被 `tests/speech.test.mjs` 的
  `speech/timeout` 挡住（236 tests / 235 pass / 1 fail），当时机器 load average 33（并行实施中的
  #144 也在跑全量）。等负载降下来重跑同一条命令即 236/236 全绿。没有为它改任何代码。
- 「listing hides removed identities」这条行为随 `listUsers` 一并消失：方法删了，它声称的
  「已删除身份不出现在列表里」就没有列表可言了。票面已认可这一点（删除的是方法不是行为），
  其余行为断言由兄弟断言承担。
