# #244 长期记忆 CRUD 与双层检索

日期：2026-10-27。票面：[`work/tickets/fairy-memory/04-memory-crud.md`](../../../tickets/fairy-memory/04-memory-crud.md)。
分支 `ticket/244-memory-crud`，worktree `.worktrees/244-memory-crud`，基线 `f7d530e5c4`
（`integration/spec-240`）。规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md)
Implementation Decisions §2–§3；条目 ADR：[`docs/adr/0002-physical-memory-deletion.md`](../../../../docs/adr/0002-physical-memory-deletion.md)。

本票只做长期记忆的增删查改与双层检索。印象（#245）、维护状态机与子会话（#246）、
维护与压缩设置（#247）、Android 与网关均未做，只预留了表结构。

## 改动

新包 `backend/memory`（`@ourfairy/dsh-memory`）：

| 文件 | 职责 |
| --- | --- |
| `src/store.ts` | 独立 `memory.sqlite`：同步单连接、WAL、`meta.schema_version` 版本化迁移、`BEGIN IMMEDIATE` 事务；三张表 |
| `src/service.ts` | `MemoryService`（ctx 名 `ourfairyMemory`）：门禁、检索预算、归属派生 |
| `src/tools.ts` | 五个工具的定义与注册（`ParameterSchemaSpec`，非 zod） |
| `src/index.ts` | 行装配：`Config.path`、store 生命周期、`agent/created` 注册 + `agents.list()` 回放、`agent/disposed` 清理 |
| `README.md` | 工具表、结果形状、门禁语义、错误码、数据表 |
| `package.json` / `tsconfig.json` / `locale/en.json` | 产品包骨架（`exports` 含 `./package.json`、`./locale/*.json`；`files` 含 README 与 locale） |

装配与断言同步：`backend/v1-bundle/cordis.patch.yml` 的 `plugins` 组新增 `memory` 行
（`path: !!js dshHomePath('memory/memory.sqlite')`）；`backend/v1-bundle/package.json` 增加
`"@ourfairy/dsh-memory": "file:../memory"`；根 `tsconfig.json` 增加项目引用。

测试：新增 `tests/memory-crud.test.mjs`（真实 profile + 真实 Loader + 模型替身 + 认证产品会话）；
`tests/model-double.test.mjs` 的精确工具目录加入 `memory_add/search/edit/delete/switch`。

## 关键决定

- **检索**：`instr(content, ?) > 0` 字面匹配（不做 LIKE 通配、不做向量/语义扩展）；排序
  `content_updated_at DESC, id DESC`；日期为 `content_updated_at BETWEEN ? AND ?` 闭区间。
- **预算**：20 条 / 8000 Unicode 码点。逐条整条取舍，正文从不裁剪；被省略的编号绝不出现在结果里。
  `matched` 是该层匹配总数。#240 收口复核把同一预算改成写入上限：`memory_add` 与 `memory_edit`
  （按编辑后正文）拒绝超过 8000 字符的内容，因为这样的行会被每次检索整条省略，任何会话都无法
  看到编号、也就无法再编辑/删除/切换；本票原先“存下但永不返回”的行为是功能缺陷。决定与测试见
  [`backend/memory/README.md`](../../../../backend/memory/README.md) 与
  `tests/memory-crud.test.mjs`。
- **门禁**：`Map<sessionId, Set<memoryId>>`，键是实际调用工具的 `agent.session.id`；查询写入、
  edit/delete/switch 读取；`agent/disposed` 清该会话的集合（重启后必须重新查询）。删除后编号仍
  可能在集合里，但行已不存在，统一答 `memory/unknown-memory`。
- **归属**：搜索时按每条记忆的 `source_session` 读 `sessionPersistence.stat()` 的不可变 header 派生
  `owner_short_id`；编辑把来源会话改成编辑会话，因此归属随内容走。
- **错误码**：`memory/{invalid-content,invalid-query,invalid-range,missing-owner,not-queried,
  unknown-memory,no-match,ambiguous-match,invalid-patch,misconfigured,schema-too-new}`，消息以码开头。
- **存储**：`id INTEGER PRIMARY KEY AUTOINCREMENT`（删除后不复用），失效记忆物理 `DELETE`；
  `impressions`（带 `deleted_at`）与 `maintenance_state` 只建表，本票无读写入口。

## TDD 红绿

先加载 `tdd` skill，按切片先写失败用例再实现（每轮 `npm run build` 后跑真实后端）：

1. 骨架就位、工具未实现：`✖ ... got Error: unknown tool "memory_add"`（红）→ 实现 add/search 转绿。
2. 追加编辑/删除/切换/门禁用例：`✖ ... unknown tool "memory_switch"`（红）→ 实现转绿。
3. 追加日期、预算、字面匹配、归属用例：预算用例暴露模型替身逐 chunk 解码把跨块多字节字符变成
   U+FFFD（正文多 1 个码点），改为先收字节再一次 UTF-8 解码后转绿；实现本身未改。

## 验证（在 worktree 内实际运行）

```sh
npm run build
# 通过（scripts/tsc.ts --fresh，无输出即成功）

node --test tests/memory-crud.test.mjs
# tests 11 / pass 11 / fail 0（约 7 s）

node --test tests/model-double.test.mjs
# tests 2 / pass 2 / fail 0（工具目录含五个 memory_*）

node --test tests/bundle-packages.test.mjs tests/bundle-groups.test.mjs tests/baseline-boot.test.mjs
# tests 19 / pass 19 / fail 0（含「每个 files 条目都发布真实文件」与 locale 断言）

node --test tests/docs.test.mjs
# tests 1 / pass 1 / fail 0（本包 README 的相对链接可解析）
```

全量 `npm test`、`npm run combo:verify`、Android 未跑（按票面留到集成收口）。

## 未完成与风险

- 印象读写端点、维护状态机/子会话、维护与压缩设置、Android 与网关：另有票（#245–#247、#248）。
- 门禁是进程内状态：重启后同会话必须重新查询（规格只要求按调用会话记录，未要求持久）。
- 跨用户编辑会依据「来源会话指向支撑当前内容的会话」把归属改为编辑者；这是规格 §2 的直接结果，
  不是遗漏。
- 真实轻量模型的语义质量验收属于 #248，本票只有模型替身证据。
