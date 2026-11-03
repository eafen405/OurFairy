# #276 补 SessionArchiveStore 的 store 级测试

日期：2026-10-31。票面：[#276](https://github.com/eafen405/OurFairy/issues/276)。
分支 `ticket/276-archive-store-tests`，worktree `.worktrees/276-archive-store-tests`，
基线 `9730d94aee`，合入 main 的提交 `a2b11bde10`。

`tests/session-archive.test.mjs` 的 12 个用例全部走 HTTP，没有任何测试直接实例化
`SessionArchiveStore`。本票补一个 store 级套件，让版本拒绝、归档幂等与列表过滤变成点名行为的
断言，而不是只靠「启动后端没失败」间接覆盖。

## 改动

只新增 [`tests/session-archive-store.test.mjs`](../../../../tests/session-archive-store.test.mjs)
（260 行，6 个用例 / 40 个断言）。未改 `archive-store.ts`、现有测试或表结构。

| 用例 | 断言 |
| --- | --- |
| 全新文件 | 表集合 `meta` / `session_archive` / `sqlite_sequence`；`schema_version = '1'`；`journal_mode = 'wal'` |
| 版本高于当前（`2`） | 普通 `Error`，消息精确为 `the session archive file was written by schema version 2`；拒绝后表集合仍只有 `meta`、版本仍 `'2'` |
| 版本不可读（`not-a-number`） | 普通 `Error`，消息含 `declares an unreadable schema version`；版本未被重写、表集合不变 |
| archive 幂等 | 时钟严格越过首个 `archived_at` 后再 archive：同一 `id`、仍 1 行、`archived_at` 不变 |
| restore 后再 archive | restore 返回 `true`、行回到 `status = 0` 且 `archived_at = NULL`、列表为空；再 archive 同一行，`archived_at` 更新 |
| 归档列表 | 重归档旧 id 使其实例最新，顺序为 `[session-first, session-second]`（证明按 `archived_at DESC` 而非 id）；owner 隔离；`status = 0` 排除；写 `deleted_at` 后即使 `status = 1` 也排除 |

## 实际命令与结果

```
$ npm run build                                     exit 0

$ node --test tests/session-archive-store.test.mjs
ℹ tests 6  ℹ suites 4  ℹ pass 6  ℹ fail 0  ℹ duration_ms 60.25

$ node --test tests/session-archive.test.mjs        # 现有 HTTP 套件未受影响
ℹ tests 12  ℹ pass 12  ℹ fail 0  ℹ duration_ms 18051.8
```

合入 main 后复跑：

```
$ node --test tests/session-archive-store.test.mjs
ℹ tests 6  ℹ pass 6  ℹ fail 0  ℹ duration_ms 66.4
```

## 变异检查（断言不是空转）

临时改 `dist` 后按字节还原，三处变异都让新套件失败：

1. 去掉 `archived_at` 的 `COALESCE`；
2. `ORDER BY archived_at DESC` 改成 `ORDER BY id DESC`；
3. 列表查询去掉 `deleted_at IS NULL`。

## 记录但不修的三处边界

1. [`archive-store.ts:168-180`](../../../../backend/sessions/src/archive-store.ts) —— 有 `meta`
   表但没有 `schema_version` 行时返回 `undefined`，被当作全新文件重跑 schema 并改写为 1；
   既有 `session_archive` 行会被保留并进入列表。注释只解释了「全新文件没有 `meta` 表」。
2. [`archive-store.ts:175`](../../../../backend/sessions/src/archive-store.ts) —— `Number('')`
   等强制成 0 的版本被当作旧文件重写为 1；只有 NaN / 非安全整数走「不可读」拒绝。
3. [`archive-store.ts:121-126`](../../../../backend/sessions/src/archive-store.ts) —— `archive`
   的 `ON CONFLICT` 会把 `owner_short_id` 改成新调用者。HTTP 上被 service 的 header 检查挡住，
   不可达，属 store 层已知分工。

顺带确认：**版本 0 在三个 store 有三种反应**——identity 拒绝（`schema-unsupported`）、
archive 重写为 1、memory 会尝试给不存在的表加列后失败。都不是发布过的版本，本票不收敛。
