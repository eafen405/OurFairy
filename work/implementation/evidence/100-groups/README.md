# 100-groups — 票 #100 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/04-groups-row.md`；落点 `work/implementation/notes/73-row-plan.md`、
> `73-boundary.md`、`73-execution.md`。分支 `ticket/100-groups`；基线
> `integration/spec-73`（开工 `d73f88f`，收尾前已合入 `0a8f2de`，含 #98 的 peer 范围改写）。

## 改了什么

- 新包 `backend/groups`（`@ourfairy/dsh-groups`）：`installGroups` 从 `backend/spaces/src/groups.mjs`
  整体迁入 `src/index.mjs` 并改为插件 `apply`，导出 `name: ourfairy-groups`、
  `inject: ['ourfairySpaces','identity','agents']`。包内 `README.md` + `locale/en.json`
  （`meta.title/description`），`exports` 含 `.`/`./package.json`/`./locale/*.json`，
  peers 用明确 semver（cordis、dsh-agent、dsh-tools、identity、spaces）。
- `backend/spaces/src/index.mjs` 删除 `installGroups` 的 import 与 `ctx.inject(...)`；
  `backend/spaces/src/groups.mjs` 删除。spaces 仍独占 scope 计算，群组只经
  `ctx.ourfairySpaces.contributeExtraRoots` 注册额外根。
- bundle 登记：`backend/v1-bundle/package.json` 增加
  `"@ourfairy/dsh-groups": "file:../groups"`；`cordis.patch.yml` 追加 `id: groups` /
  `name: '@ourfairy/dsh-groups'` 行（只追加，未重排既有行）。
- `tests/identity-interfaces.test.mjs` 的消费者路径从已删除的 `spaces/src/groups.mjs`
  改为 `groups/src/index.mjs`。

## 新增测试

`tests/groups-row.test.mjs`（1 条）：用 overlay 单独 `disable` `groups` 行，断言
群组工具（`groups`/`group_create`/`group_members`）与管理员的群组根缺席，而私有/公有文件读写与
受限脚本仍工作；断言全部来自调用方可见的工具结果与会话投影。

## 实际执行与结果

在 `ticket/100-groups` 的最终状态上执行：

```
$ node --test tests/groups.test.mjs tests/groups-row.test.mjs tests/identity-interfaces.test.mjs
ℹ tests 9  pass 9  fail 0
```

```
$ npm test
ℹ tests 161  pass 160  fail 1
✖ read intervals have inclusive original positions, omit tool results, and bound message text
  AssertionError: 8001 !== 8000 (tests/conversation-search.test.mjs:140)
```

单独重跑同一文件通过（并发全量下的已知负载抖动，见 #101 证据同一现象）：

```
$ node --test tests/conversation-search.test.mjs
ℹ tests 6  pass 6  fail 0
```

`npm run combo:verify`：ourfairy 一项 ok；rikkahub 一项按 `73-execution.md` 预期 MISMATCH
（外部归档提交 `2d97ed14` ≠ `combo.json` 锁定 `460109d1`）。本票未改 `combo.json`。

## 未执行项与原因

- 未在真实模型服务/真机上验证；本票只改装配与行，测试用模型替身与真实 bwrap 子进程。
- 未跑 Android 构建（不在本票范围）。
