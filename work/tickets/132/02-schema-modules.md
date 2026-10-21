# 144: DDL 常量按领域归位：五组 DDL 搬进 `src/schema/` 下的领域模块

**Status:** ready-for-agent

## Parent

[#132 收窄业务库公开面：删除零调用方法、DDL 常量按领域归位](https://github.com/eafen405/OurFairy/issues/132)

## What to build

把 store 里那五组 DDL 常量搬进 identity 包内的 `src/schema/` 目录，每个领域一个模块，各自导出自己的 DDL 片段：

- 用户域：`users`、`invites`、`sessions` 三张表
- 索引：查询用到的查找索引
- 群组域：`groups`、`group_members` 与它们的索引
- 上传域：`uploads`
- 投递域：`deliveries`

store 导入这五段，拼成唯一一份 `SCHEMA` 字符串，仍在 `#migrate()` 里一次性执行。`meta` 表的 DDL 留在 store
——迁移阶梯独占它，不并入任何业务域，schema 版本权威因此不分裂。

这是纯文件搬移：数据库里存下的表、列、索引、约束一字不变，schema 版本号不变，迁移顺序不变，
事务边界不变，连接仍是一条。`tests/identity-store.test.mjs` 的迁移断言原样通过就是「行为零变化」的可执行证据，
所以本票不改那个测试文件。

`#142` 与本票同时改 store，但行区间不相交：`#142` 改方法区（公开方法与 `readDelivery` 的可见性），
本票改文件头部的 DDL 常量区与 import 区。

## Acceptance criteria

- [ ] `backend/identity/src/schema/` 下有五个模块，各自导出一段 DDL：用户表、索引、群组表与索引、上传表、投递表
- [ ] store 不再内联这五组 DDL，只导入片段并拼成唯一一份 `SCHEMA`
- [ ] `meta` 表的 DDL 仍在 store 里，版本戳仍由迁移阶梯独占
- [ ] `SCHEMA_VERSION` 仍是 6；`#migrate()` 的形状不变（幂等重放 + 一次形状探测式 `ALTER` + 事务内最后写版本）
- [ ] 存下的 schema 事实不变：表名集合、每表列、无外键、除主键外无唯一索引、每张业务表有逻辑删除列
- [ ] 「版本检查早于任何 DDL」仍成立：更高版本的文件被拒绝且文件不被改动
- [ ] `tests/identity-store.test.mjs` 未被修改，且原样通过
- [ ] `tests/identity-interfaces.test.mjs` 未被修改，且原样通过
- [ ] `npm test` 通过
- [ ] 证据写入 `work/implementation/evidence/144-schema-modules/README.md`

## Blocked by

None (can start immediately).
