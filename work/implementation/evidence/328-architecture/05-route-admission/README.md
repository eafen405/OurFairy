# #333 删除未被生产消费的路由准入声明

2026-11-08，spec #328 子票 [#333](https://github.com/eafen405/OurFairy/issues/333) 的交付证据。
方案 A（Lead 按探索笔记 `E2-routes.md` §5.3 拍板）：删除 `SurfaceEntry.auth` / `SurfaceAuth` 与 9 个 row
的 44 条 `auth:` 声明；不新增准入 module，不改 Host/Origin fence、错误词汇、认证、角色与归属代码。

## 范围与版本

- 基线：`integration/spec-328` @ `e8350e4`；票分支 `ticket/333-route-admission`，worktree
  `/home/fatfish/OurFairy/.worktrees/333-route-admission`。
- 合入：`git merge integration/spec-328`（tip `9e4a3a3`，含已合入的 #331/#332/#334）无冲突，
  merge commit `44ff775`。
- 环境：Node `v24.22.2`；`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`（与 `combo.json` 锁定一致）。
- 未改：`tests/helpers/backend.mjs`（#334 范围）、`docs/architecture/dsh-ecosystem-boundary.md`、
  `backend/http/README.md`、历史证据 `work/implementation/evidence/arch-272-http-surface/`；未新增测试文件、
  未改 Android、未改 fence/错误词汇/认证/角色/归属代码。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| [`backend/http/src/http.ts`](../../../../../backend/http/src/http.ts) | 删 `SurfaceAuth` 与 `SurfaceEntry.auth`；`SurfaceEntry` doc 写明准入不在发布表里、由 handler 执行 |
| [`backend/identity/src/routes.ts`](../../../../../backend/identity/src/routes.ts)（6 条）、[`backend/sessions/src/http.ts`](../../../../../backend/sessions/src/http.ts)（7）、[`backend/chat/src/index.ts`](../../../../../backend/chat/src/index.ts)（10）、[`backend/gateway/src/http.ts`](../../../../../backend/gateway/src/http.ts)（7）、[`backend/memory/src/impression.ts`](../../../../../backend/memory/src/impression.ts)（1）、[`backend/attachments/src/index.ts`](../../../../../backend/attachments/src/index.ts)（4）、[`backend/speech/src/index.ts`](../../../../../backend/speech/src/index.ts)（2）、[`backend/skill-creator/src/http.ts`](../../../../../backend/skill-creator/src/http.ts)（6）、[`backend/bill/src/http.ts`](../../../../../backend/bill/src/http.ts)（1） | 9 个 `SURFACE` 共 44 条删 `auth:`；bill 的注释改为行为表述 |
| [`tests/route-inventory.test.mjs`](../../../../../tests/route-inventory.test.mjs) | `FIELDS` 去 `auth`、删 `AUTH` 常量与成员断言；头部补「准入权威 = 真实 HTTP 套件」并列出套件名 |
| [`tests/mount-routes.test.mjs`](../../../../../tests/mount-routes.test.mjs) | fake entry 去 `auth`，与 `SURFACE` 字段集一致 |
| [`backend/bill/README.md`](../../../../../backend/bill/README.md) | `(auth: 'authentication')` 删掉，保留行为表述并指向 `tests/bill-route.test.mjs` 的 401/403 断言 |

提交：`80ae31f refactor(#333): delete the unconsumed route admission declaration`（13 files，+71/−65）、
merge `44ff775`。

## 为什么删除而不是对账

- **零生产消费者**：`mountRoutes` 只读 `entry.path`；speech 只读 `entry.method`；`entry.auth` 的唯一读者是
  route-inventory 的枚举成员断言，改成任一其他合法值不会让任何测试失败（E2 §2.4/§4.2 实测）。
- **单值枚举无法表达真实规则**：`/skills/detail` 对 common skill 是「可见即可」、`/skills/preference` 写的是
  调用者自己的偏好、`/skills/archive` 对 common 要管理员；`/attachments/chunk` 的归属是 upload 行加其会话。
  要「对账」就得给枚举加值或写例外表，声明只会变成近似物。
- **删除没有运行期行为变化**：fence、405、body 解析、错误信封与各 handler 的认证/角色/归属判断一行未动。
- **回潮有可执行检查**：`tests/route-inventory.test.mjs` 的 `Object.keys(entry).sort()` 精确字段集；加回
  `auth` 会让该断言立即失败（见下方红灯 1 的实测输出）。

## Red / green

### 红灯 1：字段集断言（先改测试、源码未动）

只改 [`tests/route-inventory.test.mjs`](../../../../../tests/route-inventory.test.mjs)：`FIELDS` 去掉 `auth`、
删 `AUTH` 常量与 `AUTH.includes(entry.auth)` 断言；`tests/mount-routes.test.mjs` 的 fake entry 同步去掉 `auth`。
源码仍有 44 条 `auth:` 时运行：

```
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/route-inventory.test.mjs tests/mount-routes.test.mjs
ℹ tests 10  ℹ pass 9  ℹ fail 1
✖ the nine rows publish 44 unique addresses, read-only and grouped as declared
  AssertionError [ERR_ASSERTION]: identity's entries carry exactly the surface fields
    actual:   [ 'auth', 'body', 'method', 'path', 'prefix', 'response' ]
    expected: [ 'body', 'method', 'path', 'prefix', 'response' ]
```

### 红灯 2：类型层（只删类型、44 条声明还未删）

只删 `backend/http/src/http.ts` 的 `SurfaceAuth` 与 `SurfaceEntry.auth` 后：

```
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run typecheck
exit 2；恰好 44 条 error TS2353: 'auth' does not exist in type 'SurfaceEntry'
按包：chat 10、gateway 7、sessions 7、identity 6、skill-creator 6、attachments 4、speech 2、bill 1、memory 1
```

### 绿灯

删完 44 条声明与 bill 的 README/注释后：

```
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run typecheck
exit 0

$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/route-inventory.test.mjs tests/mount-routes.test.mjs
ℹ tests 10  ℹ pass 10  ℹ fail 0
```

## 实际命令与结果

### 本票验证（合入 `integration/spec-328` 之后、最终树）

| 命令 | 结果 |
| --- | --- |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run typecheck` | exit 0 |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/route-inventory.test.mjs tests/mount-routes.test.mjs`（fresh build） | tests 10 / pass 10 / fail 0（1.9s） |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node --test tests/identity-http.test.mjs tests/bill-route.test.mjs tests/memory-impression.test.mjs` | tests 25 / pass 25 / fail 0（67.8s；identity-http 含全部 44 条地址的 fence 403 用例） |

合入前（分支基线 `e8350e4` + 本票改动）的准入回归：

| 命令 | 结果 |
| --- | --- |
| `node --test tests/identity-http.test.mjs tests/owned-sessions.test.mjs tests/bill-route.test.mjs tests/memory-impression.test.mjs tests/skill-sharing.test.mjs` | tests 52 / suites 7 / pass 52 / fail 0（101.3s） |

`tests/route-inventory.test.mjs` 的 `@covers` 覆盖 `backend/http` 与 9 个 row；其字段集断言即
「`auth` 不得回潮」的可执行检查。

### pre-commit 全量门禁：失败，但为共享机器负载伪红（按 Lead 授权本次提交跳过）

**(a) 失败事实。** 本改动跨 10 个 backend 包，`scripts/precommit.ts` 选择 `full` gate；`npm test`（771 tests /
45 suites）在 6 核、load average 17.33（1m）/23.01（5m）/19.20（15m）的并行负载下跑了 **2370.8s（约 39.5
分钟）**，结果 **771 tests / 752 pass / 19 fail**。失败全部落在依赖真实后台 + 模型替身时序的端到端套件：

| 文件 | 失败数 | 失败用例 |
| --- | --- | --- |
| `tests/skill-learning.test.mjs` | 10 | background detection 的优先级/两会话阈值/重试/预算类用例 |
| `tests/start-readiness.test.mjs` | 2 | readiness 失败上报、readiness 前退出 |
| `tests/session-archive.test.mjs` | 2 | restore 回到默认列表、restore 跨重启 |
| `tests/jobs.test.mjs` | 2 | awaited result / quiet completion 结算 |
| `tests/remote-chat.test.mjs` | 1 | stop 后保留已接受的排队输入 |
| `tests/skill-evolution.test.mjs` | 1 | 启动时回迁被顶掉的 pending 候选 |
| `tests/groups.test.mjs` | 1 | 并发重复成员更新保持单例 |

典型报错：`AssertionError: the reply never returned to ourfairy-user-…`、
`did not report ready within 15000ms; probe report: not written`、`ENOENT … start-report.json`、
状态/计数时序不匹配（如 `3 !== 0`、`[2,2]` vs `[3,2,2]`）。同一时段有 329/331/332/335 等多个 worktree 在跑
重型套件（load 全程 17–23），这些套件本身不读 `SURFACE`，而本票改动只删编译期类型字段与测试断言、
不含任何运行时代码变化，二者无因果关系。

**(b) 隔离重跑。** 单独按文件重跑上述失败文件（`node --test --test-concurrency=1 <file>`，逐文件串行）：

| 文件 | 第 1 轮（load 17→12） | 第 2 轮（load ~4.7–8.6） |
| --- | --- | --- |
| `tests/skill-evolution.test.mjs` | 15/15 pass | — |
| `tests/start-readiness.test.mjs` | 2/2 pass | — |
| `tests/session-archive.test.mjs` | 12/12 pass | — |
| `tests/groups.test.mjs` | 4/4 pass | — |
| `tests/skill-learning.test.mjs` | 失败（具体见第 2 轮） | 22 tests / 19 pass / 3 fail（`2 !== 0`、`1 !== 0`、reply never returned） |
| `tests/remote-chat.test.mjs` | 失败（同下） | 9 tests / 8 pass / 1 fail（`[2,2]` vs `[3,2,2]`） |
| `tests/jobs.test.mjs` | 失败（同下） | 10 tests / 8 pass / 2 fail（`3 !== 0` ×2） |

失败都是「等回复/等结算/事件顺序」类时序断言；负载下降后 skill-learning 的失败从 10 条降到 3 条，且
这些套件与 `SURFACE` 声明无交集。未再花时间做基线复现对照：Lead 明确不重试全量门禁，且本票不含运行时
代码变化，不影响交付判断。

**(c) 授权与权威。** **按 Lead 授权跳过本地 commit 门禁**（`git commit --no-verify` 与
`git merge --no-verify`，merge 的 pre-merge-commit 同样强制全量门禁）；全量 `npm test` 的权威结果留给
集成分支收口时独占运行。本票不代表「门禁已过」——这是未完成项，见文末。

## 合入集成分支

```
$ git merge integration/spec-328
  → merge commit 44ff775，无冲突（tip 9e4a3a3，含 #331/#332/#334）
```

合入后重跑类型门与本票相关套件，结果见「本票验证」表；`tests/route-inventory.test.mjs` 的边界文档指针
断言（`docs/architecture/dsh-ecosystem-boundary.md:20` 仍指向该清单）继续通过，未改该文档。

## AC 对照

1. **不再保留无生产消费者的准入声明**：`SurfaceAuth`、`SurfaceEntry.auth`、44 条 `auth:` 全部删除；
   `Object.keys` 精确字段集断言使加回 `auth` 立即红（红灯 1 即该断言的实测输出）。
2. **不新增准入 module、不改变 `/api` 之外的产品路由边界**：改动只有删除、注释与 README；未改
   `docs/architecture/dsh-ecosystem-boundary.md`，其「44 条产品地址都在 `/api` 之外」的指针测试仍绿。
3. **Host/Origin fence、错误词汇、认证、角色与归属语义不变**：这些代码一行未改；`identity-http` 的
   44 条地址 fence 用例（含畸形 body 先 403）与 52 条准入回归全绿。
4. **现有准入回归通过；字段集合断言在加回 `auth` 时失败**：52/52 与合入后 25/25、10/10 全绿；红灯 1
   演示了回潮即失败。

## 未完成 / 未执行

- **全量 `npm test` 未取得权威绿**：共享机器并行负载下 19 条时序敏感失败（清单见上）；按 Lead 授权跳过
  本地 commit 门禁，权威结果留给集成分支收口时独占运行。**不得把本文读成门禁已过。**
- 隔离重跑中 `skill-learning` / `remote-chat` / `jobs` 仍有偶发时序失败（同上表），未继续定位其基线复现；
  三个套件都不读 `SURFACE`，与本票改动无交集。
- 未补 E2 §4.3 建议的约 4 行负向断言（`/chat/page`、`/chat/checkpoint` 的匿名/他人断言，
  `/attachments/chunk` 的 foreign 404）：相关测试文件不在本票写范围，AC 也不要求；留待后续 wire/admission
  对账票或评审决定。
- 未跑 Android 门禁（本票不涉及 `android/`）；未 push、未合入 `integration/spec-328`、未改其它 worktree。
- `body`/`response` 的同类「只被计数矩阵消费」问题不在本票范围（ticket 只针对准入声明）。
