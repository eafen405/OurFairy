# 144-schema-modules — 票 #144 证据

## 改了什么

`backend/identity/src/store.mjs` 的文件头部原来混着五组 DDL 常量。本票把它们搬进 identity 包内
新建的 `src/schema/` 目录，每个领域一个模块，各自导出自己那一份 DDL 片段：

| 模块 | 导出 | 内容 |
| --- | --- | --- |
| [`users.mjs`](../../../../backend/identity/src/schema/users.mjs) | `USERS_SCHEMA` | `users`、`invites`、`sessions` 三张表 |
| [`indexes.mjs`](../../../../backend/identity/src/schema/indexes.mjs) | `INDEXES_SCHEMA` | `sessions_by_user`、`users_by_short_id`、`users_by_name` |
| [`groups.mjs`](../../../../backend/identity/src/schema/groups.mjs) | `GROUPS_SCHEMA` | `groups`、`group_members` 与它们的三个索引 |
| [`uploads.mjs`](../../../../backend/identity/src/schema/uploads.mjs) | `UPLOADS_SCHEMA` | `uploads` |
| [`deliveries.mjs`](../../../../backend/identity/src/schema/deliveries.mjs) | `DELIVERIES_SCHEMA` | `deliveries` |

store 侧只改了文件头部：

- 顶部 import 区新增五行 `import { … } from './schema/*.mjs'`；
- 删掉 `TABLE_DDL`、`INDEX_DDL`、`GROUP_SCHEMA`、`UPLOAD_SCHEMA`、`DELIVERY_SCHEMA` 五个常量；
- `SCHEMA` 模板保持原样，只把插值换成 `${USERS_SCHEMA};`、`${INDEXES_SCHEMA}`、`${GROUPS_SCHEMA}`、
  `${UPLOADS_SCHEMA}`、`${DELIVERIES_SCHEMA}`——仍拼成唯一一份 `SCHEMA`，仍在 `#migrate()` 里
  一次性执行。

没动的地方（并行票 #143 的写范围与本票禁改区）：store 的方法区（`readDelivery` 之后到类尾）与
`#migrate()` 一行未改；`tests/` 下任何文件；`interfaces.mjs`、`index.mjs`、`package.json`；
`work/implementation/evidence/README.md`（证据索引由收口票 #145 登记）。

`meta` 表的 DDL 留在 store——迁移阶梯独占它，schema 版本权威因此不分裂。`SCHEMA_VERSION` 仍是 6，
迁移顺序、事务边界、连接条数均不变。

数据库结构没有变动：存下的表、列、索引、约束一字不变（对账见下）。

## 实际命令与结果

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `node --test tests/identity-store.test.mjs tests/identity-interfaces.test.mjs` | before（基线 `2f6504d`） | 16 tests / 16 pass / 0 fail（suites 4） |
| 同上 | after（搬移后） | 16 tests / 16 pass / 0 fail（suites 4）——条数与 before 相同 |
| `npm test` | before | 234 tests / 234 pass / 0 fail（suites 7，约 124s） |
| `npm test` | after（pre-commit hook 内，搬移提交 `90bd341` 及其 amend 前后两轮） | 234 tests / 234 pass / 0 fail（suites 7） |
| `npm run combo:verify` | 同上 | `combo: combination verified`；ourfairy 行 `ok (worktree is based on the integration tip)` |
| `git merge integration/spec-132` | 报告前 | `Already up to date.`——集成分支 tip 仍是 `2f6504d`，与本票基线同一提交 |
| `npm test` | 合并后最终树 | 234 tests / 234 pass / 0 fail（suites 7，约 130s） |
| `npm run combo:verify` | 合并后最终树 | `combo: combination verified`；ourfairy 行 actual `90bd34160fcc37c9`，dsh 行与 android source 行 ok |
| `npm test` | after（pre-commit hook 内，本证据文件的提交） | 234 tests / 234 pass / 0 fail（suites 7，约 104s） |

没有出现 `speech/timeout`。另有一次与本票无关的例外，如实记录如下。

一次例外，如实记录：本证据文件**首次**提交的那轮 pre-commit hook 里，`npm test` 出现一条与本票无关的失败——
`tests/conversation-search.test.mjs` 的 `read intervals have inclusive original positions, omit tool results,
and bound message text`（期望 8000，实得 8001）；该轮 hook 因此中止了提交，重跑后是 234/234。单独重跑该
文件两次均 6/6 通过；此前四轮全量（基线、搬移后的两轮 pre-commit hook、合并后最终树）都是 234/234。
判定为负载相关的既有 flake，本票未改任何代码：

- 该断言数的是消息文本的 Unicode 码点数，`'消息预算😀'.repeat(2000)` 恰好 8000 个码点；
- 传输按块切分时若切点落在一个 emoji 的代理对中间，两半各自编码成替换字符，码点数就多一个——
  与实测的「8001」一致（机理为推断，未单独复现）；
- 这条路径是 native log → 搜索投影 → `conversation_read` 的文本预算，不经过 identity store 的
  DDL；本票只搬常量归属。

## 对账：拼出的 SCHEMA 与存下的 schema 都逐字不变

两层对账，一次性脚本跑完即删、未入库；下面的命令可原样重放。

### 1. 源级：store 拼出的 `SCHEMA` 字符串

搬移前后各求值一次 `SCHEMA` 模板（前半取 `git show 2f6504d:backend/identity/src/store.mjs` 的原
常量，后半取工作树的新模块），结果：

```
old SCHEMA sha256: 7ea33bc456e1081d414a4368b1316c1161a723ef15605852d557216f6699f94d length 2913
new SCHEMA sha256: 7ea33bc456e1081d414a4368b1316c1161a723ef15605852d557216f6699f94d length 2913
SCHEMA string byte-identical ✓
```

即 store 交给 SQLite 的那段 DDL 一字未变——不只是「结果一样」，是「输入一模一样」。

### 2. 存储级：`sqlite_master`

两条迁移路径各对一次：全新文件（`version === undefined` 分支）与 v2 文件升级
（`version < SCHEMA_VERSION` 分支）。每次导出全部对象（表、索引、`sqlite_sequence`）的
`type/name/tbl_name/sql`、每表列清单、每表外键清单、每表索引清单与 `schema_version`，
前后两份 JSON 用 `cmp` 比对：**无差异**。

重放命令（在仓库根目录执行，输出即 `sqlite_master` 全量）：

```bash
node --input-type=module -e "
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { IdentityStore } from './backend/identity/src/store.mjs'
const dir = mkdtempSync(join(tmpdir(), 'of144-'))
const path = join(dir, 'f.sqlite')
new IdentityStore({ path }).close()
const db = new DatabaseSync(path)
console.log(JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(), null, 2))
db.close()
rmSync(dir, { recursive: true, force: true })
" > /tmp/schema.json
```

在旧提交上重放同一段命令再 `diff` 两次输出，结果为空：

```bash
git archive 2f6504d | tar -x -C /tmp/of144-old && cd /tmp/of144-old && <上面同一段命令> > /tmp/schema-old.json
diff /tmp/schema-old.json /tmp/schema.json   # 无输出
```

## 行为零变化的既有断言

本票不改任何测试文件，验收接缝是既有断言：

- `tests/identity-store.test.mjs` 的 `upgrading a v2 file` 一节断言：每张业务表有逻辑删除列
  `deleted_at`（`deliveries` 之外还有 `updated_at`）、无外键、除主键外无唯一索引、
  `created_by`/`redeemed_by`/`user_id`/`owner_short_id`/`updated_by`/`attachments_json` 等人员
  关联列在位、`sessions_by_user` 索引在位，以及「版本检查早于任何 DDL」
  （`identity/schema-too-new` 的文件不被改动）。
- `tests/identity-interfaces.test.mjs` 断言服务与消费方只经领域面访问 identity。

这两份文件一行未改，原样通过（16/16），即「行为零变化」的可执行证据。

## 未执行项与说明

- 未 push、未合入 `integration/spec-132`（由 Lead 合并）、未改 `combo.json`、未评论或关闭 GitHub
  issue #144。
- 未新增测试断言、未修改 `tests/` 下任何文件（票面明确要求）。因此「存下的 schema 一字不变」的
  常态化断言仍是既有那几条；若要一条常驻的「模块清单 ↔ 实际 DDL」对账检查，应另开一票
  （收口票 #145 或新票），本票不越界加断言。
- 对账用的两个一次性脚本（`SCHEMA` 字符串求值、`sqlite_master` dump）跑完即删、未入库；上面
  `node --input-type=module -e` 片段是等价的可重放版本。
- 未做真机/客户端验收：本票只动后端 DDL 常量的归属。
