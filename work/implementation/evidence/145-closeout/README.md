# 145-closeout — 票 #145 证据

票 #145 是 spec 132 的收口票：登记前两张票的证据目录、对本次增量跑一次两轴复核（Standards + Spec）、
把复核发现的问题在**本票分支**上修掉，再跑全量门禁。父票
[#132 收窄业务库公开面](https://github.com/eafen405/OurFairy/issues/132)。

- 票分支：`ticket/145-closeout`，基线 `integration/spec-132` = `67d1940`（已含 #143、#144 两次合并）。
- 复核范围：`main`（`f331c38`）→ `integration/spec-132`（`67d1940`）的增量，15 个文件、610 增 156 删
  （`git diff --stat main..integration/spec-132`）。
- 评审依据：Standards 轴 = [`AGENTS.md`](../../../../AGENTS.md) 与
  [`CODING_STANDARDS.md`](../../../../CODING_STANDARDS.md)；Spec 轴 =
  [`work/tickets/132/`](../../../tickets/132/README.md) 的票面副本与
  [`docs/specs/ourfairy-v1.md`](../../../../docs/specs/ourfairy-v1.md)。

## 改了什么

本票只做三件事，全部落在 `ticket/145-closeout` 分支上。

### 1. 证据索引登记

[`work/implementation/evidence/README.md`](../README.md) 新增一节「业务库公开面收敛（规格 #132）」，
位置在「客户端合仓（规格 #123）」与「阶段整合与评审」之间——与既有的 spec 分节同一体例（两列表格，
一行一个目录），并排在其它 spec 分节之后：

| 目录 | 内容 |
| --- | --- |
| `143-public-surface` | #143 store 公开面 24 → 19，删四个零生产调用的方法，`readDelivery` 转私有 |
| `144-schema-modules` | #144 五组 DDL 常量搬进 `src/schema/` 下的领域模块 |
| `145-closeout` | 本目录：两轴复核、可执行声称检查与全量门禁 |

前两个目录在 #143、#144 两张票里已经写好，本票把它们挂进索引；本票自己的目录一并登记，
与既有 `106-closeout`、`87-closeout` 的做法一致。

### 2. 两轴复核发现的两处问题（在本票分支上修掉）

| 编号 | 轴 | 位置 | 问题 | 处理 |
| --- | --- | --- | --- | --- |
| S1 | Standards | `backend/identity/src/schema/users.mjs:2` | DDL 拆分后，模块注释仍说本模块含 "the lookup indexes the queries use"，而三个查找索引已搬到 `schema/indexes.mjs`——注释与模块实际内容不符 | 改成只描述本模块实际持有的内容：users / invites / sessions 三张表，各自主键 |
| S2 | Standards | `tests/identity-interfaces.test.mjs:48` | 用例名声称这十九个方法是「生产调用方在用的」，但断言只固定方法名集合：某个方法失去生产调用方时，断言照样通过 | 用例名改成断言的事实本身（公开面恰是 spec 132 点名的那十九个方法）。按 `CODING_STANDARDS.md`「不做源码正则扫描充当检查」与票面「答不出就删除该声称，不为它补断言」，不补新断言 |

两处修改都在本票分支的提交 `0cd3249` 里，`integration/spec-132` 上没有打补丁。

### 3. 票面本地副本核对

`work/tickets/132/` 的四份副本与 GitHub issue 逐字一致，无需修正：

| 本地副本 | 对应的发布权威 | 核对结果 |
| --- | --- | --- |
| `README.md` | issue #132 | 正文逐字一致（本地多出的只有仓库惯例的标题行、子票表与 `---` 分隔） |
| `01-public-surface.md` | issue #143 | 正文逐字一致（本地多出标题行与 `**Status:**` 行） |
| `02-schema-modules.md` | issue #144 | 同上 |
| `03-closeout.md` | issue #145 | 同上 |

核对方式：`gh issue view <n> --json body -q .body` 取正文，与本地副本逐行 `diff`，差异只有上述惯例行。

## 复核跑了什么

评审流程按 [`CONVENTIONS.md`](../../CONVENTIONS.md) §8：用 `code-review` skill 的只读复核流程，
范围固定为 `main..integration/spec-132`。本环境没有 Skill 工具，改为读取该 skill 的 `SKILL.md` 后按其流程
手工执行（范围固定点、只报本次增量引入的缺陷、每条发现给出触发路径与影响）。

### Standards 轴

依据 `AGENTS.md` 与 `CODING_STANDARDS.md` 逐条看：公开面收窄后是否还留着没有调用方的方法、
删除是否静默丢掉了行为、DDL 搬移是否改变了交给 SQLite 的输入、注释与文档里的结构类声称是否有
「失效时会失败」的检查、是否越出票面写范围。

结论：两处问题（S1、S2），均已修。另有几项属仓库既有状态或超出 spec 132 范围，只记录不修，
见「未完成项」。

### Spec 轴

依据 `work/tickets/132/` 三张票面副本与父规格副本逐条对：

| 票面要求 | 核对结果 | 依据 |
| --- | --- | --- |
| #143 公开方法恰为 19 个 | 成立 | `tests/identity-interfaces.test.mjs` 读 `IdentityStore.prototype` 的名单断言 |
| #143 `userByName`/`listUsers`/`inviteState`/`liveSessionCount` 不再存在于类上 | 成立 | `grep -rn "userByName\|listUsers\|inviteState\|liveSessionCount" backend/ tests/ scripts/ docs/ android/` 无输出 |
| #143 `readDelivery` 模块私有、同包仍能调用 | 成立 | `#readDelivery` 不落在原型上；同包 `prepareDelivery`/`prepareDeliveryFile`/`pendingDeliveries` 仍调用它，投递行为由既有断言承担 |
| #143 被删断言的行为由兄弟断言承接 | 成立 | `tests/identity-store.test.mjs` 的 'a removed user no longer signs in or authenticates' 与 'a removed name stays reserved' |
| #143 领域面与消费方一行未改 | 成立 | `git diff --name-only main..integration/spec-132` 不含 `backend/identity/src/interfaces.mjs` 与 `backend/identity/src/index.mjs` |
| #143 提交说明写明四个方法各自的调用方情况 | 成立 | 提交 `8396328` 正文逐个列出（两个「测试是唯一调用方」、两个「全仓零调用」） |
| #144 五个模块各导出一段 DDL | 成立 | `backend/identity/src/schema/` 下五个模块，各一个导出常量 |
| #144 store 只拼唯一一份 `SCHEMA`，`meta` 表 DDL 留在 store | 成立 | `grep -rn "meta\|schema_version" backend/identity/src/schema/` 无输出 |
| #144 `SCHEMA_VERSION` 仍是 6，迁移顺序、事务边界、连接条数不变 | 成立 | `git diff 2f6504d..90bd341` 未触及 `#migrate()`、`#transaction()` 与构造器 |
| #144 存下的 schema 事实不变 | 成立 | 两条迁移路径的 `sqlite_master` 全量 dump 与旧树逐字节一致（本次复核实测，见下） |
| #144 两个测试文件未被本票修改 | 成立 | `git diff --name-only 2f6504d..90bd341` 不含 `tests/` |
| #143/#144 全量门槛 | 成立 | `npm test` 与 `npm run combo:verify`（见「实际命令与结果」） |
| 父票 Further Notes：零调用方法若被文档或外部脚本引用则记录 | 不适用 | 四个被删方法在 `docs/`、`scripts/`、`android/`、`backend/`、`tests/` 下均无引用 |

父规格 `docs/specs/ourfairy-v1.md` 的相关条款同样成立：业务库仍是一个迁移阶梯、一条连接、一个事务边界
（增量未触及这三处）；测试原则「不断言私有方法调用次数、内部类布局」不受影响——新增的两条断言固定的是
**公开**接口面，与本文件既有的四个领域面键集断言同类。

### 可执行声称检查

按 `CODING_STANDARDS.md`「声称须可执行」与票面要求，把本次增量里的结构类声称逐条对上「失效时会失败的
具体命令或测试」，并核对它断言的是同一事实：

| 声称 | 失效时失败的具体命令或测试 | 断言同一事实？ | 结论 |
| --- | --- | --- | --- |
| store 的公开面恰为 19 个方法 | `tests/identity-interfaces.test.mjs` 的 'the store publishes exactly the nineteen methods spec 132 named'（直接读 `Object.getOwnPropertyNames(IdentityStore.prototype)`），多一个或少一个方法即失败 | 是 | 有检查 |
| 改前是 24 个方法 | `git show main:backend/identity/src/store.mjs` 的同一读法（本次实测取到 24 个方法名） | 是（同一属性，不同树） | 可重放命令，非常驻测试 |
| `readDelivery` 不是公开操作 | `tests/identity-interfaces.test.mjs` 的 'the delivery read stays inside the package'（`store.readDelivery === undefined`），加上上面那条原型名单 | 是 | 有检查 |
| 领域面不泄漏 store 成员 | `tests/identity-interfaces.test.mjs` 第一条用例的四个面键集精确断言（`Object.keys(face)` 逐个相等），任何多出来的成员都会让它失败 | 是 | 有检查 |
| DDL 搬移是行为零变化 | ① `tests/identity-store.test.mjs` 与 `tests/identity-interfaces.test.mjs` 原样通过；② 拼出的 `SCHEMA` 字符串 sha256 前后一致（本次复核实测 `7ea33bc4…f6699f94d`，2913 bytes）；③ 两条迁移路径的 `sqlite_master`、列、外键、索引与版本 dump 前后逐字节一致（本次复核实测 `diff` 无输出） | 是 | 有检查（三处断言同一事实：交给 SQLite 的 DDL 与存下的 schema） |
| schema 版本权威不分裂（`meta` 与版本戳仍由迁移阶梯独占） | `tests/identity-store.test.mjs` 的 'refuses a database newer than this module understands'（版本检查早于任何 DDL、被拒文件不被改动）+ 本次 dump 里的 `meta.schema_version = 6` + `grep -rn "meta\|schema_version" backend/identity/src/schema/` 无输出 | 是 | 有检查 |
| 每张业务表有逻辑删除列、无外键、除主键外无唯一索引 | `tests/identity-store.test.mjs` 的 'adds the tables and columns v2 lacked…' 与 'carries no foreign key and no unique constraint beyond the primary key' | 是 | 有检查 |
| 索引不带唯一性；唯一性由 store 在事务内检查 | `tests/identity-store.test.mjs` 的 'refuses a duplicate name'（名字唯一性在 `#transaction` 内检查）+ 上一条（无唯一索引） | 是 | 有检查 |
| 群组成员唯一性在事务内检查 | `tests/groups.test.mjs` 的 'concurrent duplicate membership updates stay singular and restart preserves group access' | 是 | 有检查 |
| 上传域只做生命周期，引用资格由已接纳的 native 消息持有 | `tests/attachments.test.mjs` 的 'unfinished and foreign receipts never grant message or download access, including identical stored bytes' | 是 | 有检查 |
| 投递域只做协调，正文由 native 日志持有 | `tests/text-delivery.test.mjs` 的 'native log success with failed business update recovers after restart and exact retry stays single'（native 写成功、业务行写失败后恢复） | 是 | 有检查 |
| 这十九个方法每个都有生产调用方 | **没有**：原型名单断言只固定名字集合，某个方法失去调用方时它照样通过 | — | **不可执行**：按规则删掉了用例名里的这句派生声称（S2），不补断言。事实本身由本次复核逐个核对，见下表 |

「每个都有生产调用方」的逐个核对结果（复核命令：`grep -rn "\b<方法名>\b" --include=*.mjs backend/ scripts/`
再排除 store 自身；下面是每个方法在生产代码里的调用点）：

| 方法 | 生产调用点 | 方法 | 生产调用点 |
| --- | --- | --- | --- |
| `prepareDelivery` | `backend/identity/src/interfaces.mjs:48` | `createGroup` | `backend/identity/src/interfaces.mjs:38` |
| `prepareDeliveryFile` | `backend/identity/src/interfaces.mjs:49` | `changeGroupMember` | `backend/identity/src/interfaces.mjs:39` |
| `pendingDeliveries` | `backend/identity/src/interfaces.mjs:50` | `userByShortId` | `backend/identity/src/interfaces.mjs:34` |
| `completeDelivery` | `backend/identity/src/interfaces.mjs:51` | `seedPhaethon` | `backend/identity/src/index.mjs:108` |
| `insertUpload` | `backend/identity/src/interfaces.mjs:44` | `createInvite` | `backend/identity/src/index.mjs:78` |
| `readUpload` | `backend/identity/src/interfaces.mjs:43` | `register` | `backend/identity/src/http.mjs:148` |
| `updateUpload` | `backend/identity/src/interfaces.mjs:45` | `signIn` | `backend/identity/src/http.mjs:152` |
| `groupsForMember` | `backend/identity/src/interfaces.mjs:37` | `authenticate` | `backend/identity/src/index.mjs:64` |
| `ownsGroup` | `backend/identity/src/interfaces.mjs:40` | `signOut` | `backend/identity/src/index.mjs:88` |
| `close` | `backend/identity/src/index.mjs:109` | | |

十九个方法各至少一个生产调用点。这条性质目前靠复核与评审保证，没有常驻断言；仓库规则不允许用扫源码的
正则充当它的检查，所以本次只把用例名改成断言的事实，不为它加断言。

## 实际命令与结果

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `git diff --stat main..integration/spec-132` | 复核开始 | 15 files changed, 610 insertions(+), 156 deletions(-) |
| `gh issue view 143/144/145 --json body -q .body` + 与本地副本 `diff` | 票面核对 | 正文逐字一致（差异只有本地惯例的标题与 `**Status:**` 行） |
| `gh issue view 132 --json body -q .body` + 与 `work/tickets/132/README.md` 正文段 `diff` | 票面核对 | 一致 |
| `npm test` | 本票开工时的基线树 | 236 tests / 236 pass / 0 fail（suites 7，duration 120692 ms） |
| `npm run combo:verify` | 同上 | 三行 ok（ourfairy / dsh / android source）+ `combo: combination verified` |
| `node` 求值旧树与新树各一次的 `SCHEMA` 模板并比 sha256 | DDL 零变化核对 | 两者同为 `7ea33bc456e1081d414a4368b1316c1161a723ef15605852d557216f6699f94d`、2913 bytes，逐字节相同 |
| 两条迁移路径（全新文件、v2 文件升级）的 `sqlite_master` / 列 / 外键 / 索引 / 版本 dump，旧树与新树各跑一次后 `diff` | 同上 | 无输出（逐字节一致）；两边的 `meta.schema_version` 都是 6 |
| 旧树读 `IdentityStore.prototype` 的方法名 | 「24 → 19」核对 | 24 个（含 `inviteState`、`listUsers`、`liveSessionCount`、`readDelivery`、`userByName`） |
| 临时给 store 加一个第 20 个公开方法后跑 `node --test tests/identity-interfaces.test.mjs`，随即还原 | 「19 个方法」这条声称的可执行性（红检查） | **red**：6 tests / 5 pass / 1 fail，报 `a method with no production caller must not stay on the store`；还原后 `git diff --stat HEAD` 为空 |
| `grep -rn "userByName\|listUsers\|inviteState\|liveSessionCount" backend/ tests/ scripts/ docs/ android/` | 删方法的残留引用 | 无输出 |
| `npm test` | 修完 S1/S2、本证据文件写入后 | 236 tests / 236 pass / 0 fail（suites 7，duration 101832 ms） |
| `npm run combo:verify` | 同上 | 三行 ok + `combo: combination verified` |
| `npm test` + `npm run combo:verify`（pre-commit hook 内） | 本票的每个提交 | 通过才允许提交；本票两个提交都过了 |

复现「DDL 零变化」的两段脚本是临时文件，跑完未入库；README 记录了等价的可重放版本。

## 未执行项与说明

- 未 push、未合入 `integration/spec-132`（由 Lead 合并）、未改 `combo.json`、未评论或关闭 GitHub issue
  #143 / #144 / #145。
- 未做真机/客户端验收：本 spec 只动后端 identity 包的公开面与 DDL 归属，不涉及 `android/`。
- 未新增测试断言。S2 按仓库规则「不为它补断言」处理——「每个方法都有生产调用方」没有常驻检查，
  事实由上面的调用点清单记录（见「未完成项」第 3 条）。
- 一次失败的提交尝试如实记录：第一次提交时把证据索引的登记与本证据文件分开做，索引先指向尚不存在的
  `145-closeout/README.md`，仓库自带的 `tests/docs.test.mjs`（'every relative link in the repository
  Markdown resolves'）因此失败，pre-commit hook 拦下了提交。改为先写本文件、再登记索引后通过。
  本次增量没有因此改动任何实现或测试断言。

### 未完成项（超出 spec 132 范围，报 Lead）

1. **既有注释与 AGENTS.md 不符**：`backend/identity/src/store.mjs:7` 的文件头写着「The schema declares
   no UNIQUE constraint and no foreign key (AGENTS.md forbids both)」，但 `AGENTS.md` 的数据库一节并没有
   这条禁令（它要求的是逻辑删除列、关联人员与创建/更新时间）。这条文字在 `main` 上就是这样，本次增量未碰
   这行，故未改。无外键、无唯一索引这件事本身有检查
   （`tests/identity-store.test.mjs` 的 'carries no foreign key and no unique constraint beyond the primary key'），
   错的只是「AGENTS.md forbids both」这个出处。
2. **已发布票面 #144 的兄弟票编号写错**：票面正文写「`#142` 与本票同时改 store，但行区间不相交：`#142`
   改方法区」，实际改方法区的是 #143（issue #142 是 spec 131 的 http 包票）。**已由 Lead 处理**：本地副本
   `work/tickets/132/02-schema-modules.md` 与已发布 issue #144 的正文同步改正，提交 `c560820`。
3. **「每个公开方法都有生产调用方」没有常驻断言**：事实目前成立（调用点清单见上），但只有方法名集合被断言。
   按仓库规则不为它补扫源码式断言；要不要把它变成常驻检查（例如把四个领域面与服务操作的可达性做成
   一个结构断言），需要另开票决定。
4. **仓库既有 flake（与本 spec 无关，本票未改代码）**：`tests/speech.test.mjs` 的 ASR 超时（150ms）在机器
   负载高时假失败；`tests/conversation-search.test.mjs` 的 'read intervals have inclusive original positions…'
   偶发期望 8000 实得 8001（长 emoji 文本在传输分块时切点落进代理对中间，两半各编码成替换字符而多一个
   码点）。本票两次全量门禁均未复现；后者是仓库既有的潜在缺陷，按要求只记录不改。
   **已由 Lead 登记为 issue**：#146（8000 码点预算断言偶发多一个码点）、
   #147（`store.mjs` 文件头错引 `AGENTS.md` 的无外键/无唯一索引出处），两票都带 `needs-triage` 标签，
   均不在 spec 132 的增量内修。
