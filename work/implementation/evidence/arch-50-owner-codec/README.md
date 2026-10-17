# arch-50 — `user:<shortId>` 归属编码收敛到唯一 codec

票：<https://github.com/eafen405/OurFairy/issues/50>（地图 #69 / `/implement-spec`）
分支：`arch/50-owner-codec`，worktree `/home/eafen405/projects/OurFairy/.worktrees/arch-50-owner-codec`
集成分支基线：`42bbf89`（开工时先 `git merge` 到该 tip）→ 汇报前集成分支前进（#66 合入并 pin 至 `1c95299`），两次合入后最终合并提交 `3f76997`；分支 tip（本证据提交）即 **FINAL_SHA**，见汇报
提交：`4cd3744`（代码 + 新测试 + 证据）；证据补记见本文件所在提交

## 前提核对（动手前）

| 票面证据 | 核对结果 |
| --- | --- |
| `backend/sessions/src/service.mjs:140,158,178,238,259` 硬编码 `` `user:${owner.shortId}` `` | 成立，当前行号与票面一致（5 处） |
| `backend/spaces/src/scope.mjs:31` 自建正则 `/^user:[1-9]\d*$/` + `slice(5)` | 成立，但当前位于 `:39–:40`（票面行号取自 `d189d85`，其后合并使之下移） |
| `backend/search/src/index.mjs:13`–`14` 同一正则 + `slice(5)` | **前提已变化**：#49 已将它改为 `shortIdOf`；本票无需再改（`tests/conversation-search.test.mjs` 已断言） |
| `backend/chat/src/delivery.mjs:16` 生成、`:60` `replace(/^user:/, '')` 反向解析 | 成立，行号一致 |
| `backend/attachments/src/service.mjs:143` 经 `ourfairySpaces.owner()` 再 `Number(...)` 回转 | 成立，当前位于 `:142` |
| 全仓 grep（模板串 / `^user:` / `owner.slice` / `owner.replace` / `user:<数字>`） | 产品源码中另有 `backend/probe/src/index.mjs:192` `'user:1'` 与 `backend/spaces/test-support/scope-contributors.mjs:25`；均为测试专用，见「范围外发现」 |

结论：前提成立（票面把 search 列为待改点，实际上 #49 已先落地；其余四处与票面一致）。五个包中，本票改 sessions、spaces、chat、attachments 四个消费点，search 已是 codec 消费者。

## 改了什么

1. **sessions**（`backend/sessions/src/service.mjs`）：新增 `import { ownerOf } from '@ourfairy/dsh-identity/owner'`；5 处模板串改为 `ownerOf(owner.shortId)`。
2. **spaces**（`backend/spaces/src/scope.mjs`）：`owner()` 改为 `shortIdOf(session?.header?.owner)`，删除自建正则与 `slice(5)`；返回 short number（number）。`privateRoot()` 用模板串生成目录名（`path.join` 只接受 string），目录布局 `spaces/private/<shortId>` 不变。
3. **spaces**（`backend/spaces/src/groups.mjs`）：删除两处对 `scope.owner()` 的 `Number()` 再转换。
4. **spaces**（`backend/spaces/package.json`）：新增 `"@ourfairy/dsh-identity": "workspace:~"` peerDependency，与 #49 中 search 的做法一致；identity 已在 launcher 的 `LINKED_PACKAGES` 中链接，依赖方向 identity → 无产品包，不会成环。
5. **chat**（`backend/chat/src/delivery.mjs`）：生成改 `ownerOf(row.senderShortId)`；解析改 `shortIdOf(agent.session.header.owner)`，删除 `replace(/^user:/, '') + Number`。
6. **attachments**（`backend/attachments/src/service.mjs`）：`userByShortId(ourfairySpaces.owner(...))`，删除 `Number(...)` 回转，不再自己解读 owner 编码。
7. **新测试** `tests/owner-codec.test.mjs`（3 条）。

不改：`identity/src/owner.mjs`（#49 已提供唯一 codec）、`identity/src/index.mjs` 的 `principalIdOf`（已是 `ownerOf` 委托）、`search`（已收敛）。

## TDD 证据（red → green）

- 实现前 3/3 全红 ——
  1. 源码扫描命中 sessions 的 `` `user:${...}` ``、spaces 的 `^user:` + `owner.slice(`、chat 的模板串 + `replace(/^user:/`；
  2. sessions 未从 codec import、spaces/chat 未使用 codec；
  3. attachments 与 groups 仍对 `scope.owner()` 做 `Number(...)` 回转。
- 实现后 3/3 通过。

为什么用源码级断言：这是**行为保持**的收敛 —— 两套写法对规范 owner 的行为完全相同，行为测试无法区分；票面的可交付物就是「唯一 codec」。这也符合 `CODING_STANDARDS.md`「声称须可执行」：新测试就是「编码只有一处定义」这句话失效时会失败的检查。#49 已用同样方式为 search 的 seam 留证。业务行为本身由既有 `text-delivery`（投递 origin）、`spaces`/`groups`（私有/群组根）、`attachments`/`file-delivery`、`owned-sessions` 套件覆盖，未重复 codec 单测。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test tests/owner-codec.test.mjs`（实现前） | 3 红 |
| `node --test tests/owner-codec.test.mjs`（实现后） | 3/3 通过 |
| `node --test tests/spaces.test.mjs tests/groups.test.mjs tests/text-delivery.test.mjs tests/file-delivery.test.mjs tests/owned-sessions.test.mjs tests/attachments.test.mjs tests/jobs.test.mjs tests/baseline-boot.test.mjs` | 54/54 通过 |
| `npm test`（开工基线，未含新测试） | 122/123；唯一失败为既有 PDF 资源预算用例在并发负载下报 `worker-unavailable`（期望 `resource-limit`），与 #49/#64 记录的是同一 flake |
| `npm test`（改后） | 125/126；同样只有该 PDF flake |
| `node --test tests/pdf.test.mjs`（单独重跑） | 5/5 通过，确认失败属负载抖动 |
| 提交时 pre-commit hook（`npm test` + `npm run combo:verify`，基线 `42bbf89`） | **126/126 通过**，`combo: combination verified` |
| 合入前 `npm test`（`4cd3744`） | **126/126 通过** |
| 合入前 `npm run combo:verify` | `combo: combination verified` |
| 合入最新集成分支后 `npm test`（`1c95299`） | **127/127 通过** |
| 合入最新集成分支后 `npm run combo:verify` | `combo: combination verified` |

## 行为与语义说明

- **`scope.owner()` 返回类型 string → number**：仓库内调用方只有 `groups`（两处）与 `attachments`（一处），均已同步删除 `Number()`；`privateRoot()` 的目录布局与错误语义（非 owner 仍 `FS_PERMISSION_DENIED`）不变。外部 HTTP/Android 契约不暴露该方法的返回类型。
- **chat sender 解析收紧**：对 `user:02`、`user: 2` 等非规范串，旧实现 `Number(replace(...))` 会解析出 2（而 sessions/spaces 都拒绝），现在统一由 codec 拒绝，得到 403 `delivery/unknown-sender`。产品路径不会产生此类 header（owner 只由 sessions 服务端写入），这是码表唯一后的收紧，不是新增防御。
- **codec 拒绝超出安全整数的 short number**（同 #49 已记录的偏差）：真实 short number 由 SQLite INTEGER 分配，不可触发。

## 未完成 / 偏差

- **无未完成项。**
- 偏差：见上两条（非规范 owner 串与超大 short number 的拒绝边界）；均只影响不可由产品路径产生的 header。

## 范围外发现（未改动）

1. `backend/probe/src/index.mjs:192` `meta: { owner: 'user:1' }`：测试专用 liveness probe（其 package.json 自述 “Mounted through a --patch overlay and never part of the product bundle”），固定法厄同编号 1 的 fixture，不是产品授权路径；新测试的源码扫描显式排除 `probe/`，理由写在测试注释里。若强行让它依赖 identity，会把产品模块耦合进 baseline probe，收益不成比例。
2. `backend/spaces/test-support/scope-contributors.mjs:25` `` `user:${config.shortId}` ``：测试 fixture，且 `scope.owner()` 的 codec 校验会让任何漂移立即以 `FS_PERMISSION_DENIED` 失败，不会静默通过。
3. 本票未改 Android 客户端（不在票面范围），归属判定全部在服务端。

## 合并

汇报前执行 `git merge integration/ourfairy-v1`。集成分支在本票提交后前进了两次：`42bbf89 → f360385`（#66 代码合入）→ `1c95299`（#66 pin 与证据）。第一次证据提交时 combo verify 因集成分支前进而失败，按协议先合入再重试；最终合并提交 `3f76997`，其后的证据提交即分支 tip（FINAL_SHA 见汇报，SHA 无法自我引用）。

合并状态下复跑验收：`npm test` **127/127 通过**，`npm run combo:verify` **三项 ok**。

`#66` 改的是 sessions 的事件读取（`d79253d`），与本票的 owner 码表改动无冲突；合并后全量复跑通过。
