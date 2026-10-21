# 143: 公开面收窄：删除四个零生产调用的公开方法，`readDelivery` 转私有

**Status:** ready-for-agent

## Parent

[#132 收窄业务库公开面：删除零调用方法、DDL 常量按领域归位](https://github.com/eafen405/OurFairy/issues/132)

## What to build

让 `IdentityStore` 的公开面只留下有生产调用方的方法。改完之后，公开面是 19 个方法，每个都有生产调用方；
读者不必再猜某个方法是不是死代码。

删掉四个公开方法：

- `userByName`：唯一调用方是 `tests/identity-store.test.mjs`
- `listUsers`：唯一调用方是 `tests/identity-store.test.mjs`
- `inviteState`：全仓零调用方
- `liveSessionCount`：全仓零调用方

删除时同步删掉对应的测试断言，并在提交说明里写明这四个方法原来的调用方情况——「测试是唯一调用方」
与「零调用」不是同一句话，删除不是静默的行为损失。

`readDelivery` 只被同包的 `prepareDelivery` 与 `prepareDeliveryFile` 调用，转成模块私有（`#readDelivery`）。
它不进入任何领域面，`identity.deliveries` 面的四个方法（`prepare`、`prepareFile`、`pending`、`complete`）不变。

`tests/identity-interfaces.test.mjs` 的「store 不离开包」断言要更新到删除后的形状：不再断言已经不存在的方法名，
但「领域面不泄漏 store 成员」这条保障仍在。同时把「store 的公开面就是这 19 个方法」写成一条会失败的检查，
让「24 → 19」这句声称可执行，而不是只写在票面上。

删除的是方法，不是行为：被删断言所声称的行为由同一文件里的兄弟断言承担——「删除后不能登录」与
「删除后不能认证」仍在同一用例里，「删除后名字仍被占用」由既有的 `identity/name-taken` 断言承担。

## Acceptance criteria

- [ ] `IdentityStore` 的公开方法恰为 19 个：`prepareDelivery`、`prepareDeliveryFile`、`pendingDeliveries`、`completeDelivery`、`insertUpload`、`readUpload`、`updateUpload`、`groupsForMember`、`ownsGroup`、`createGroup`、`changeGroupMember`、`close`、`seedPhaethon`、`userByShortId`、`createInvite`、`register`、`signIn`、`authenticate`、`signOut`
- [ ] `userByName`、`listUsers`、`inviteState`、`liveSessionCount` 不再存在于类上
- [ ] `readDelivery` 是模块私有（`#readDelivery`），同包内部仍能调用
- [ ] `tests/identity-store.test.mjs` 中 `userByName` 与 `listUsers` 的断言被删除；同一用例的「删除后不能登录」与「删除后不能认证」断言保留，删除后名字仍被占用的行为仍由既有的 `identity/name-taken` 断言承担
- [ ] `tests/identity-interfaces.test.mjs` 的领域面键集断言更新到删除后的形状：四个面的键集不变，泄漏名单不再列已删除的方法
- [ ] 存在一条断言，公开面方法名集合等于上面那 19 个；多一个或少一个方法都会让它失败
- [ ] 提交说明写明这四个方法各自的调用方情况（测试是唯一调用方 / 零调用）
- [ ] 领域面与消费方一行未改：`backend/identity/src/interfaces.mjs` 与 `backend/identity/src/index.mjs` 不因本次删除而变化
- [ ] `npm test` 通过
- [ ] 证据写入 `work/implementation/evidence/143-public-surface/README.md`

## Blocked by

None (can start immediately).
