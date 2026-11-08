# 01-skill-verdict — 票 #329 证据

票面：GitHub [#329](https://github.com/eafen405/OurFairy/issues/329)，本地副本
[`work/tickets/328/01.md`](../../../../tickets/328/01.md)（父规格 #328）。
范围：让技能批准、后台技能候选结算与审核展示共用同一验证报告解析与 verdict，删除同一判据的多份实现，
同时不削弱事务内复核、增长确认、批准证据与错误码。

分支 `ticket/329-skill-verdict`；基线 `integration/spec-328`。提交前把当时的集成分支 tip `012abdc`
合入（fast-forward）；功能提交 `a8cfce3` 后集成分支又推进到 `9e4a3a3`（#331、#332 已合入，其中 #332
也改 `creation.ts`/README），再按 Lead 口径 `git merge --no-verify integration/spec-328` 合入
（合并提交 `a155113`；git auto-merge 无冲突；跳过合并钩子的原因：合并钩子会跑全量 `npm test`，全量
权威结果留给集成分支收口，且本机有并行重型套件）。合入后复跑纯测试 71/71（含 #332 的 `skill-paths`/
`skill-package`/`skill-creation-store`）与 `npm run typecheck`，见 §6。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/skill-creator/src/verification-report.ts`（新） | 存下来的 `skill_version.verification` 的唯一 reader 与唯一 verdict：`emptyVerificationReport` / `readVerificationReport` / `needsFreshExecution` / `verificationVerdict`（+ `VerificationRefusal`、`VerificationVerdict`）。null、坏 JSON、非对象、字段类型不对一律收敛成 incomplete 空报告（`complete` 只认字面 `true`，列表字段非数组视为空，`ranAt` 回退行创建时间）；固定拒绝顺序 incomplete → no-evidence → unexecuted → failed → reused-only，文案沿用批准闸门原文。父哈希语义由 `needsFreshExecution({candidateManifestHash, parentManifestHash})` 唯一表达：`parentManifestHash === null`（无父）不需新执行，不同才需要。 |
| `backend/skill-creator/src/creation.ts` | 删除 `verificationOf` 与 `verificationReason` 两份实现。`review()` 的批准闸门改成一次 `verificationVerdict`，`parentManifestHash` 取 **DB** 的 `parent.manifest_hash`（`parent?.manifest_hash ?? null`），两次 409 `skills/verification-incomplete` 合并为一处，错误码与文案不变；`inspect()` 改用 `readVerificationReport` + 同一 verdict，`ReviewPackage.verification` 直接用 `VerificationReport` 并新增派生布尔 `freshExecutionMissing`（= verdict refusal `reused-only`），`buildReviewDisplay` 的警告改读该布尔，不再用「差异文件数 × executed=0」代理；`#reusePlan` 的内联 `JSON.parse` 换 `readVerificationReport`；`deferVerification` 手写空报告换 `emptyVerificationReport(Date.now())`；`rollback` 取场景改 `readVerificationReport`。`boundInspectResult` 只透传新布尔（体积裁剪逻辑未动）。 |
| `backend/skill-creator/src/deep-creation.ts` | 删除私有 `verificationSettlesCandidate`；`#settle` 用同一 `readVerificationReport` + `verificationVerdict`，候选有父版本时多一次 `store.version(parentId)` 读 `parent.manifest_hash`（主键读）。claim 状态机、预算重试、信号复读未动。 |
| `backend/skill-creator/src/evolution.ts` | `planVerificationReuse` 的 `contentChanged` 表达式换 `needsFreshExecution`（复用键算法与强制重跑策略未动）。 |
| `backend/skill-creator/README.md` | 复用规则小节补一句：批准闸门、后台 claim 结算与展示共用同一 reader/verdict，父哈希来自 DB 行不是展示差异。 |
| `tests/skill-verification-report.test.mjs`（新） | 18 条 interface 测试，直接 import `dist/verification-report.js`：空/坏/畸形报告收敛、真值表、五个拒绝与文案、固定拒绝顺序、ok 的三种合法形状。 |
| `tests/skill-evolution-display.test.mjs` | fixture 加 `freshExecutionMissing`；两条既有警告用例改为由 verdict 派生；新增一条双向用例钉住「警告来自 verdict，不是展示差异文件数」：父包不可读导致差分成「新技能」时不再误报，差分为空但 verdict 说 reused-only 时照样警告。 |

**明确未改**：`verify.ts` 的产报告逻辑与 `complete` 定义；`#reusePlan` 的复用键算法；
`store.publishDraft` 的事务内 `recheck` + 父版本仍是 current + 失败 rename 回滚；增长确认（110% 规则、
消费唯一性、消息锚点）；批准证据落库（`approval_message_id`，ADR-0004 §5）；错误码
（409 `skills/verification-incomplete`、500 `skills/integrity`）；`tools.ts`/`http.ts`/`notify.ts`；
未新增插件或表。

## 必须保留的约束，逐条对照

- 事务内复核：`creation.ts` 的 `publishDraft({ recheck })` 段无 diff；判据仍在事务外算好。
- 增长确认与批准证据：`review()` 中 verdict 之后到 rename 之前的 growth/approval 分支无 diff。
- 错误码/HTTP 映射：`skills/verification-incomplete` 仍在 `review()` 抛 409；`#readCandidate` 的
  `skills/integrity` 500 未动。
- 后台结算：仍以「系统记录的报告」为唯一事实；失败/缺失报告仍走 `#failed` 预算重试，不落死候选。

## Red / green

### 1. interface test 先红（新模块不存在）

```console
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/skill-verification-report.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/backend/skill-creator/dist/verification-report.js'
✖ tests/skill-verification-report.test.mjs
```

随后按垂直切片逐条实现：reader/empty report → `needsFreshExecution` → `verificationVerdict`，每片先红后绿。

### 2. 纯测试（最终，`npm test` 会先做全量 `--fresh` 构建）

```console
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/skill-verification-report.test.mjs tests/skill-evolution-display.test.mjs
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

### 3. 类型检查

```console
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run typecheck
EXIT:0
```

### 4. 既有整机回归（技能创建 / 进化 / 后台学习）

合并集成分支 tip `012abdc` 后，在票 worktree 用 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`
逐个文件顺序跑（避免自己制造并行负载）：

```console
$ node --test tests/skill-creation.test.mjs      # 16/16 pass, EXIT 0
$ node --test tests/skill-evolution.test.mjs     # 14/15 pass, EXIT 1
$ node --test tests/skill-learning.test.mjs      # 17/22 pass, EXIT 1
```

失败清单（全部是负载敏感型时序断言，不是验证判据/结算断言）：

- `skill-evolution` — `publish crash reconciliation` / `a displaced pending candidate is moved
  back and a content-less one is settled at boot`：`the reply never returned to
  ourfairy-user-2-primary`（30s 聊天回复轮询超时，76.8s 后被断言）。
- `skill-learning` — `an ambiguous signal is resolved by one independent review child …`、
  `a failure signal never counts toward the two-session creation threshold`、
  `an uncertain review is stored as uncertain …`、`the creation prompt carries the user's
  recently rejected skills as dedupe context`、`a detection interval that spends its budget …`：
  均为 mock 模型回复超时或 `seen.creation` 被延迟 tick 干扰的断言（`the reply never returned`、
  `2 !== 0` 等）。

隔离复跑（同一 post-merge 工作树，只按测试名过滤、其余跳过）：

```console
$ node --test --test-name-pattern="displaced pending candidate" tests/skill-evolution.test.mjs
✔ publish crash reconciliation   ℹ tests 1 / pass 1 / fail 0

$ node --test --test-name-pattern="ambiguous signal|failure signal never|uncertain review|recently rejected|spends its budget" tests/skill-learning.test.mjs
✔ background detection   ℹ tests 5 / pass 5 / fail 0
```

同样的 6 条在合并前一次「4 个整机文件并行交给同一个 `node --test`」的运行里也失败过（57 条中 51
通过），隔离复跑全绿。本票改动不触碰检测/信号路径（只改已有候选的批准与结算判据），这些失败是机器
`load average` 16–27（#330/#332/#333 等票的整机测试并行）下的时序 flake。Lead 统一口径：负载敏感型
失败记录清单 + 隔离复跑结果后可跳过本地 commit 门禁，全量 `npm test` 的权威结果留给集成分支收口。

### 5. 本地 commit 门禁（related gate）与跳过决定

功能提交先按要求走正常钩子（`OURFAIRY_DSH_DIR=... git commit`）。related gate 选中 18 个测试文件
（本票改动路径的字符串/`@covers` 关联 + `README.md` 的 docs 检查），一次 `node scripts/test.ts`：
**203 条测试，198 通过，5 失败**，全部集中在 `tests/skill-learning.test.mjs` 的
`background detection` suite：

- `an ambiguous signal is resolved by one independent review child and then counts as success`
- `a failure signal never counts toward the two-session creation threshold`
- `two independent sessions reach the threshold: one claim, one creation child, explicit no improvement`
- `a failed creation retries only its claim, never the detection watermarks`
- `a detection interval that spends its budget is given up and only a newer closed turn releases it`

失败形态与本票改动无关：`the reply never returned` 超时、`seen.creation` / 检测 prompt 被并行套件的
延迟 tick 干扰（日志里 creation prompt 的 task key 与用例不符）、等待 claim 的 `waitFor` 超时。本票
全部直接相关测试在门禁内均通过（`skill-verification-report`、`skill-evolution-display`、
`skill-evolution`、`skill-creation`、`skill-verify`、`skill-creation-store`、`skill-package` 等）。
上述 5 条按测试名隔离复跑全部通过：

```console
$ node --test --test-name-pattern="ambiguous signal|failure signal never|uncertain review|recently rejected|spends its budget" tests/skill-learning.test.mjs
✔ background detection  ℹ tests 5 / pass 5 / fail 0

$ node --test --test-name-pattern="two independent sessions reach the threshold|a failed creation retries only its claim" tests/skill-learning.test.mjs
✔ background detection  ℹ tests 2 / pass 2 / fail 0
```

按 Lead 的统一口径（负载敏感型失败记录清单 + 隔离复跑结果后可跳过本地 commit 门禁，全量权威结果
留给集成分支收口），本次功能提交以 `git commit --no-verify` 落地；全量 `npm test`、`combo:verify`
与 Android 门禁由 Lead 在集成分支独占运行。

## 未完成项

- 全量 `npm test`、`npm run combo:verify`、Android 门禁属集成分支收口门禁，由 Lead/merger 在合并后运行；
  本票只跑相关面（上列命令）。
- 未 push、未自行合入 `integration/spec-328`、未触碰其他 worktree 或主检出。
- 未改 `store.importReviewed`/seed 的验证来源；`#332` 的路径词汇与本票无关。

## 6. 合入 #332 后的跨票复跑

集成分支 tip `9e4a3a3` 含 #332 的 `creation.ts`/README 改动后，与票分支 auto-merge 无冲突；随后在
merge tip 上用 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`：

```console
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run typecheck
EXIT:0
$ OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- \
    tests/skill-verification-report.test.mjs tests/skill-evolution-display.test.mjs \
    tests/skill-paths.test.mjs tests/skill-creation-store.test.mjs tests/skill-package.test.mjs
ℹ tests 71
ℹ pass 71
ℹ fail 0
```

两票在 `creation.ts` 的改动共存：本票的 `readVerificationReport`/`verificationVerdict`/
`freshExecutionMissing` 与 #332 的 `candidatePackagePath`/`versionPackagePath`/
`rehomeCandidatePackage` 均在同一文件中，typecheck 与上述测试通过。

## 7. merge tip 上的整机复跑（含基线对照）

在 merge tip `a155113`（已含 #332/#331，集成分支 tip `9e4a3a3`）上，低负载窗口（`load average` 4.5）
逐文件顺序跑：

```console
$ node --test tests/skill-creation.test.mjs
ℹ tests 16 / pass 16 / fail 0   EXIT:0
$ node --test tests/skill-evolution.test.mjs
ℹ tests 17 / pass 17 / fail 0   EXIT:0
$ node --test tests/skill-learning.test.mjs
ℹ tests 22 / pass 16 / fail 6   EXIT:1
```

learning 失败 6 条（全部是检测/claim 启动时序或 mock 回复超时，不在本票改动的判据路径上）：
`a failure signal never counts …`、`two independent sessions reach the threshold …`、
`a failed creation retries only its claim …`、`a late correction …`、
`the creation prompt carries the user's recently rejected skills …`、
`a detection interval that spends its budget …`。

**基线对照**：同一 worktree `git switch --detach 9e4a3a3`（集成分支 tip，**不含 #329**），
`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/skill-learning.test.mjs`：

```console
ℹ tests 22 / pass 17 / fail 5   BASELINE_EXIT:1
✖ a failure signal never counts toward the two-session creation threshold
✖ two independent sessions reach the threshold: one claim, one creation child, explicit no improvement
✖ a failed creation retries only its claim, never the detection watermarks
✖ a late correction inside a later interval revokes the earlier success and the old evidence is not rewritten
✖ a detection interval that spends its budget is given up and only a newer closed turn releases it
```

基线（无本票改动）同样整文件失败 5 条，与本票的失败集合重叠 5/6（本票多出的 dedupe 一条在更早的
并行运行与相关门禁里也失败过，隔离复跑通过）。结论：`skill-learning` 的全文件执行在本机存在与本票
无关的既有 order/时序 flakiness；本票新增/改动的判据与结算行为由通过的 `skill-creation`（16/16）、
`skill-evolution`（17/17，含 #332 的包路径 / 崩溃回迁新用例）与隔离复跑的 learning 用例覆盖。
切换回票分支后已用 `npm test -- tests/skill-verification-report.test.mjs
tests/skill-evolution-display.test.mjs` 重新构建并复跑（30/30，30 passed / 0 failed），确认工作树
是票分支源码的构建产物。

## 8. 交接时的集成分支状态

功能提交之后，集成分支又合入 #333/#335（tip `75cae52`）。交接前再次
`git merge --no-verify integration/spec-328`（合并提交 `f4e737e`；git auto-merge 无冲突；#333 的
route-admission 删除只改 `backend/skill-creator/src/http.ts`，与本票文件不重叠；跳过合并钩子原因同上，
全量留收口）。合并后复跑：`npm run typecheck` → EXIT:0；`npm test -- tests/skill-verification-report.test.mjs
tests/skill-evolution-display.test.mjs tests/skill-paths.test.mjs tests/skill-creation-store.test.mjs
tests/skill-package.test.mjs` → 71/71 pass。若集成分支在此之后继续前进，由 Lead/merger 在合入本票时
按同样方式处理。
