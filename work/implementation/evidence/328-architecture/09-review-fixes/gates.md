# 复审修复 B：路由清单声称、CI 漂移检查、doctor 声称、Android 词汇表

2026-11-08，spec #328 三轴复审后的修复批次 B（路由 / CI / Android / 文档侧）证据。
批次 A 的汇总在 `09-review-fixes/README.md`（由另一位修复者维护）；本文件只记 B 的发现、处理与命令。

## 范围与版本

- 基线：`integration/spec-328` @ `7e3c0d1`；票分支 `ticket/328-fix-gates`，worktree
  `/home/fatfish/OurFairy/.worktrees/328-fix-gates`。
- 提交：`4608259`（#333 声称收窄）、`424a75b`（#335 CI 漂移检查）、`40ba150`（#335 doctor 断言）、
  `88602d8`（#336 词汇表 + 任务图登记）、本证据提交。
- 环境：Node `v24.22.2`；`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`。
- 写范围：`tests/route-inventory.test.mjs`、`backend/http/src/http.ts`（仅 doc）、
  `tests/combo-build.test.mjs`、`scripts/combo.ts`（仅注释）、`tests/lifecycle.test.mjs`、
  `android/GLOSSARY.md`、`work/tickets/328/README.md`、本文件。
  未触 `backend/skill-creator/**`、`android/app/**`、`android/app/src/test/**`、`tests/skill-*.test.mjs`、
  `09-review-fixes/README.md`；未改 `README.md`（#335 的 doctor 声称已由 #335 在上一批收窄，本批只补可执行断言）。

## 发现 → 处理

| # | 发现（复审） | 处理 |
| --- | --- | --- |
| 1 | **HARD #333**：`tests/route-inventory.test.mjs` 头部枚举 11 个 suite 文件作为「admission authority」，没有任何命令会因新地址无准入测试或 suite 改名而失败 | 删除枚举，改说「each row proves admission in its own suite」；保留 `Object.keys(entry)` 精确字段集断言（`auth` 回潮即红）。`backend/http/src/http.ts` 的 `SurfaceEntry` doc 同步收窄为同一措辞 |
| 2 | **#335**：`tests/combo-build.test.mjs` 只检查 build step 切片，命令副本放到 YAML 别处会漏；漂移测试没有跑真实 `combo.json` 记录 | 「无副本」断言扩到整个 `.github/workflows/check.yml`（固定字面量 + 当前记录逐条）；新增注入 runner 的真实记录测试（`requiredBuildSteps()` 的每条命令被执行且顺序一致）；`scripts/combo.ts` 头部「the only copy」改为「记录是权威编辑，漂移测试只拒绝第二份副本或漏调脚本」 |
| 3 | **#335**：`README.md` 声称 doctor 只确认 `build:lib:host`，没有可执行检查 | 在 `tests/lifecycle.test.mjs` 的 doctor --json 用例断言 `dsh CLI build` 的 detail 含 `build:lib:host only`；检查名与失败态未改 |
| 4 | **#336**：`android/GLOSSARY.md` 的「只有当前账号与当前端点能接纳它，其余一律忽略」是绝对声称 | 改为如实分工：准入由 `RemoteNotificationNavigation.admits` 判断，Activity 只传配置端点与 intent 目标、接纳后设置落点；未加 Activity 级测试（票面不要求） |
| 5 | 任务图未登记实际交付文件 | `work/tickets/328/README.md`：02(#330) 补 `src/origin.ts`；05(#333) 补 `backend/memory/src/impression.ts` 与 `backend/bill/README.md`；08(#336) 补 `android/GLOSSARY.md` |

### 1. #333：删除无消费者的 suite 枚举

改后头部（`tests/route-inventory.test.mjs:18-22`）：

> Admission is not a field on these entries: it is what each address's handler does, and the product
> rows prove it over real HTTP in their own suites. This file holds no list of those suites — such a
> list would keep passing after a suite was renamed and could not notice a new address without a test.
> The exact field set below keeps a per-address admission word from coming back.

`backend/http/src/http.ts` 的 `SurfaceEntry` doc 同步为「The product rows prove their admission over
real HTTP in their own suites.」；不再让 doc 指向测试文件里的清单。没写新的全量对账测试（票面要求）。

**灵敏度验证（新断言在负例下红）**：临时在构建产物 `backend/identity/dist/routes.js` 的
`/identity/invite` 条目加 `auth: 'authentication'`（模拟字段回潮），运行：

```
$ node --test tests/route-inventory.test.mjs
✖ the nine rows publish 44 unique addresses, read-only and grouped as declared
  AssertionError [ERR_ASSERTION]: identity's entries carry exactly the surface fields
    actual:   [ 'auth', 'body', 'method', 'path', 'prefix', 'response' ]
    expected: [ 'body', 'method', 'path', 'prefix', 'response' ]
ℹ tests 5  ℹ pass 4  ℹ fail 1
```

还原 `routes.js` 后同命令 **5/5 通过**。构建产物已还原，未入库。

### 2. #335：CI 全文件无副本 + 真实记录执行

`tests/combo-build.test.mjs` 的 CI 用例现在：

- 仍先检查 build step 本身：是 run step、调用 `node scripts/combo.ts build`、位于 dsh checkout 之后、
  `npm test` 之前；
- 再把 `build:lib:host`、`build:lib:client`、`build:native-system`、
  `corepack pnpm@11.28.5 run build`、`for step in` 作为禁止字面量扫描**整个** `check.yml`；
- 最后遍历当前 `combo.json` 记录，任何一条 `requiredBuild` 命令出现在 workflow 任何位置都失败
  （避免组合改命令名后固定字面量过期）。

新增 `the real combination record is executed step by step, in order`：复制本检出的 `combo.json` 到临时
根，按 `requiredBuildSteps()` 解析出的 checkout 建占位 `.git`，用注入 runner（不执行 pnpm）记录
argv，断言 `runRequiredBuild` 执行的命令集合、顺序、cwd 与真实记录逐条一致。测试注释写明「删除/修改记录
一步是权威编辑、按设计改变下一次构建；漂移测试只拒绝第二份副本或 executor 漏调记录」。

`scripts/combo.ts` 头部相应收窄：记录是构建的权威，编辑/删除一步按设计改变下一次 CI 构建；漂移测试
（`tests/combo-build.test.mjs`）拒绝 workflow 里的第二份命令副本和不再调用记录的 executor，不拒绝
被修改的记录。

**灵敏度验证 1（workflow 里复制命令）**：临时在 `check.yml` 顶部加注释
`# negative sensitivity probe: corepack pnpm@11.28.5 run build:lib:host`：

```
$ node --test --test-name-pattern "keeps no copy" tests/combo-build.test.mjs
✖ CI calls the executor and keeps no copy of the commands anywhere in the workflow
  AssertionError [ERR_ASSERTION]: CI must not spell the recorded build out a second time;
  found "build:lib:host" anywhere in check.yml
```

**灵敏度验证 2（executor 漏步）**：临时把 `scripts/combo.ts` 的 `for (const step of steps)` 改成
`steps.slice(0, -1)`：

```
$ node --test --test-name-pattern "the real combination record" tests/combo-build.test.mjs
✖ the real combination record is executed step by step, in order
  AssertionError [ERR_ASSERTION]: every step in the real record must run
```

两处还原后同命令 **2/2 通过**；完整文件 **11/11 通过**。`check.yml` 与 `combo.ts` 均已用 `git checkout` /
备份还原，无负例代码入库。

### 3. #335：doctor 的覆盖声称变成断言

`tests/lifecycle.test.mjs` 的 `doctor reports its checks on a clean isolated home` 新增：

```js
const cliBuild = checks.get('dsh CLI build')
assert.match(cliBuild.detail, /build:lib:host only/u, …)
```

**灵敏度验证（detail 去掉收窄措辞）**：临时把 `scripts/ourfairy-backend.ts` 成功态 detail 的
`; build:lib:host only` 删掉：

```
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node --test \
    --test-name-pattern "doctor reports its checks" tests/lifecycle.test.mjs
✖ doctor reports its checks on a clean isolated home
  AssertionError [ERR_ASSERTION]: doctor's dsh CLI build check must name its narrowed coverage;
  it reported "/home/fatfish/dsh-d80522d2/apps/cli/lib/bin.js (ae2adffd8d67)"
```

还原后该用例 **1/1 通过**（3.0s）；完整 `tests/lifecycle.test.mjs` 在提交钩子中 **6/6 通过**。

### 4. #336：Android 词汇表如实描述

`android/GLOSSARY.md`「通知定位」条目末句由「只有当前账号与当前端点能接纳它，其余一律忽略」改为：

> Activity 只把 `BuildConfig.IDENTITY_ENDPOINT` 与 intent 解出的目标交给这两个入口，接纳后的落点由
> 调用方设置；它不另写一份准入规则。

前半段保留既有事实（`admits` 的端点规范化、账号匹配、未登录拒绝；会话归属检查与打开后二次确认；
技能入口同步且不申请权限）。未加 Activity 级测试：票面 AC 明确准入拒绝可在 module interface 上测，
现有 `RemoteNotificationNavigationTest` 已覆盖；本批只收窄文档声称。

### 5. 任务图登记

`work/tickets/328/README.md` 的 01–08 表补：

- 02(#330)：`backend/skill-creator/src/origin.ts`（fixer A 的交付需要登记，文件不移动）；
- 05(#333)：`backend/memory/src/impression.ts`、`backend/bill/README.md`；
- 08(#336)：`android/GLOSSARY.md`。

## 命令与结果（最终树，提交后）

| 命令 | 结果 |
| --- | --- |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node --test tests/combo-build.test.mjs tests/route-inventory.test.mjs tests/mount-routes.test.mjs` | **21 tests / 21 pass / 0 fail**，1.6s |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/lifecycle.test.mjs tests/precommit.test.mjs` | **exit 0**；**35 tests / 35 pass / 0 fail**，30.5s（含 fresh build） |
| `node --test tests/docs.test.mjs`（`88602d8` 的 docs 钩子） | **2/2 pass**（相对链接与无构建/无 dsh 检出场景） |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node scripts/combo.ts build --print` | exit 0；打印 dsh checkout 与 4 条记录命令 |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run combo:verify` | 三行 ok（ourfairy 基于 `88602d8`、dsh `ae2adffd8d67`、Android 来源一致），`combo: combination verified` |
| 提交钩子：`4608259` | related gate：37 tests / 37 pass（identity-http、mount-routes、route-inventory 等） |
| 提交钩子：`40ba150` | related gate：lifecycle 6/6 pass + combo:verify |
| 提交钩子：`88602d8` | docs gate：2/2 pass + combo:verify |

## 提交门禁：full gate 的负载失败与隔离复跑

`424a75b` 含 `scripts/combo.ts`（`FULL_AUTHORITY`），提交钩子按设计选 full gate。当时本机 load average
约 **5.8–8.9**，多个 worktree（spec-328、331 等）同时在跑真实后台。`npm test` 约 **40 分钟**后失败；
钩子输出经本命令的 `tail` 截断，保留到的失败都在 `tests/skill-learning.test.mjs`：

| 文件:行 | 用例 | 断言 |
| --- | --- | --- |
| `tests/skill-learning.test.mjs:748` | two independent sessions reach the threshold: one claim, one creation child, explicit no improvement | 提示词未含 `/release-notes:publish/` |
| `tests/skill-learning.test.mjs:839` | a failed creation retries only its claim, never the detection watermarks | `TypeError: Cannot read properties of undefined (reading 'status')` |
| `tests/skill-learning.test.mjs:870` | a late correction inside a later interval revokes the earlier success and the old evidence is not rewritten | `1 !== 0` |
| `tests/skill-learning.test.mjs:1053` | the creation prompt carries the user's recently rejected skills as dedupe context | `the reply never returned to ourfairy-user-2-…` |

按 Lead 的 load-flake 口径，`424a75b` 以 `git commit --no-verify` 落盘（失败清单即上表；全量权威绿留给
集成分支收口独占运行）。隔离复跑：

```
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- --test-concurrency=1 \
    tests/skill-learning.test.mjs tests/jobs.test.mjs
exit 1；tests 32 / pass 29 / fail 3
✖ a failure signal never counts toward the two-session creation threshold
✖ an uncertain review is stored as uncertain and never triggers creation
✖ a failed creation retries only its claim, never the detection watermarks
```

`tests/jobs.test.mjs` 全绿。这 3 条正是 Lead 在任务板汇总结论里记录的「`main@25a2b34` 与
`integration@7e3c0d1` 上同样失败 3 条」（本机既有 flake，非本 spec 回归）；本批改动不触及
`backend/skill-creator/**` 或这些套件的运行期代码。**不得把本文件读成全量门禁已过。**

## 未完成 / 风险

- 全量 `npm test` 未取得权威绿：理由与失败清单见上；收口时在集成分支独占运行。
- 未新增「新地址没有准入测试」的自动检查：复审明确不要求新的全量对账测试，只要求删除不可执行的清单声称；
  字段集断言仍是 `auth` 回潮的可执行检查。
- `android/GLOSSARY.md` 为纯文档改动，未跑 Android 门禁（本批不改 `android/` 代码；`^android/` 的 non-md
  路径不在本批 diff 内）。
- 未合入 `integration/spec-328`、未 push、未碰其它 worktree；集成分支合入由 Lead/merger 执行。
