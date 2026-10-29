# OurFairy 仓库环境清扫（本地票集 CLEAN-01～CLEAN-08）

日期：2026-10-29。集成分支 `integration/repo-cleanup`，基线 `main` @ `b812695b08`，
最终 tip `2c84c3b9fd`；代码合并 tip 为 `f46981c580`（29 个提交，38 个文件，+755/−188），其后只有证据与索引提交。票面见
[`work/tickets/repo-cleanup/`](../../../tickets/repo-cleanup/README.md)；本票集是本地草案，
未发布到 GitHub，因此以 `CLEAN-xx` 引用。

这批工作只改「仓库给出的状态、测试选择与文档导航」和两处重复权威，不新增产品行为。

## 共同验证（最终集成状态）

```bash
npm test                                   # 425 pass / 0 fail，232 s
npm run combo:verify                       # 三行 ok
(cd android && ./gradlew test lintDebug)   # BUILD SUCCESSFUL，422 tests / 0 failures
node scripts/evidence-index.ts --check     # evidence index is current
npm run specs:status -- --offline          # 见 §CLEAN-08
```

`npm test` 的 425 是基线 409 加上本批新增的 16 条（选择器 5、票副本 6、工作负载 3、维护策略 2）。

## CLEAN-01 related 门禁读取测试文件内的关联声明

改动：`scripts/precommit.ts`、`tests/precommit.test.mjs`，以及 12 个测试文件头部各一行声明。

选择器此前只扫正文里的包路径、发布包名和脚本名，于是经真实 launcher/HTTP 驱动产品包、
正文却不 import 包路径的套件选不中：`backend/delivery/`、`backend/speech/` 直接退到
`typecheck`，`backend/memory/` 只稳定选中 1 个套件。

现在每个套件在自己文件里写 `@covers backend/<package>`（选择器正则
`/@covers\s+backend\/([a-z0-9-]+)/gu`），选择器读它；直接源码引用仍是第二类信号。仓库里
没有第二份「包→测试」清单。

红证据（实现前，`node --test tests/precommit.test.mjs` → 22 tests / 18 pass / 4 fail）：

```
a delivery source change must select tests/text-delivery.test.mjs; the gate selected tests/precommit.test.mjs
a memory source change must select tests/memory-crud.test.mjs; the gate selected tests/memory-maintenance-recovery.test.mjs, tests/precommit.test.mjs
a groups source change must select tests/groups.test.mjs; the gate selected tests/bundle-only-profile.test.mjs, tests/precommit.test.mjs
```

最终选择（真实仓库根，`relatedTests`）：

| 改动 | 选中 |
| --- | --- |
| `backend/delivery/src/index.ts` | `delivery-row`、`file-delivery`、`text-delivery`（+ `precommit`） |
| `backend/speech/src/service.ts` | `speech`（+ `precommit`） |
| `backend/memory/src/index.ts` | `memory-crud`、`memory-impression`、`memory-maintenance`、`memory-maintenance-recovery`、`memory-policy`（+ `precommit`） |
| `backend/groups/src/index.ts` | `groups`、`groups-row`（+ `bundle-only-profile`、`precommit`） |
| `backend/search/src/index.ts` | `conversation-search`（+ `bundle-packages`、`precommit`） |
| `scripts/real-acceptance.ts` | 无 → `typecheck` |

四模式、`FULL_TEST_LIMIT` 45、`FULL_AUTHORITY`、每档 `combo:verify` 与 Android 命令未改。

范围调整两处，均由当前树决定：
- 票面写的 `backend/delivery/src/tool.ts` 已不存在，delivery 只有 `src/index.ts`，按同一意图验收。
- 「无关联源码」夹具从 `backend/delivery/` 改为 `scripts/real-acceptance.ts`：声明落地后每个
  backend 包都至少有一个直接关联套件，已没有包路径能演示 `typecheck` 回退；该脚本需要真实部署
  凭据，确实没有套件驱动它。

收口评审指出说明句写了不成立的通则（「经启动器驱动某包的套件都会自己声明」），已改为机制事实：
选择器读正文直接引用 + 文件自写的 `@covers` 行，是否写这行由套件自己决定，不声称覆盖完整
（`f4b0f9b862`）。同一次核对发现 `tests/gateway-maintenance-settings.test.mjs` 这类套件是单向
关联（memory 改动会选中它、gateway 改动不会），但补声明超出本票写范围，且实测同类缺口分布在
attachments/groups/gateway/delivery/identity/search/memory 多个包，单点补声明无法让通则成立，
故只修说明并把该缺口记为后续票素材。

## CLEAN-02 specs:status 识别命名票目录

改动：`scripts/specs-status.ts`、`tests/specs-status.test.mjs`（+175/−6）。

新增一条内部规则 `specOfDirectory(name, declarations)`：数字目录名仍是它自己的 spec（不变，且
先短路、不读任何文件）；非数字目录读它自己的父规格声明——`published.json` 的正整数 `parent`，
否则 README 的 `父规格：` 行（`/issues/NNN` 或 `[#NNN](<issue url>)`）；没有声明即 `undefined`，永不当作
任何 spec 的副本。两个消费方共用这条规则：`specsInCheckout` 读工作树，`carriesCopies` 读指定
ref 的树（`git ls-tree -d --name-only <ref>:work/tickets` + `git cat-file -p`），所以 spec 分支
tip 与落地分支都按树/对象判定，不是只看当前工作树。离线模式仍不访问 tracker。

红证据：非数字目录 `fairy-memory` 声明父规格 #915，却被报告为缺失（`false !== true`）。

真实验收：

```
npm run specs:status -- --offline --spec 240
240  landed  integration/spec-240  60b765ea04  ok  ok  ok  ok  0  ok  0  ?     # copies MISSING → ok
```

`main` 一侧另用一个共享 clone 证明（clone 的工作树停在本分支、无本地 `integration/spec-240`，
因此 copies 只能从 `main` 的树读）：`240 landed - <empty columns> copies ok`。

副作用一处，如实记录：`work/tickets/ourfairy-v1/README.md` 声明父规格 #23，规则统一后报告里
多出 `23 planned <empty columns> copies ok` 一行。这是同一条规则的真实结果，不是手工登记。

## CLEAN-03 现行文档入口与证据索引漏项

改动：`work/implementation/CONVENTIONS.md`、`docs/README.md`、`docs/agents/domain.md`、
`work/implementation/evidence/README.md`，以及两个描述文件
`work/implementation/evidence/index/24-spec-250.json`、`25-native-semantic-guards.json`。

- CONVENTIONS §0：首版父规格仍标注为产品总权威，并列登记 #240 记忆规格
  （`docs/specs/fairy-memory.md`）并写明边界（只覆盖长期记忆、印象、上下文压缩与维护设置；
  冲突以父规格为准）。
- `docs/README.md`：术语入口覆盖外部感官与记忆两个局部上下文，并直接指向 `GLOSSARY-MAP.md`；
  写明无状态头文件按所在目录档位读、文件级状态头覆盖目录档位。
- `docs/agents/domain.md`：示例路径换成仓库真实目录（6 条代码路径逐个 `[ -e ]` 通过），删去不存在的
  `src/<context>/...`。
- 证据索引：自行重算「磁盘目录 vs 索引链接」的差集，补登 14 个现存目录（#135 波次、地图 #69 的
  arch-52/53/58/63/68/70 与两轮评审、#250 的 251–254、#255 眼睛高光）。

生成段仍由描述文件派生：改动前后 24 个既有小节逐字未变（`changed=0`），新增 2 节由
`index/24-spec-250.json` 与 `25-native-semantic-guards.json` 渲染。`135-native-semantic-guards/`
这一层没有 README，生成器会拒绝列出没有 README 的目录，因此改为列出它下面 8 个有 README 的
子目录，未给历史波次补 README，也未改生成器。

收口评审指出这两节起初是「按生成器形状手写」、没有描述文件（既不重生成也不被 `--check` 校验，
等于两份权威），已改为描述文件派生（`7844f8e496`）。

与票面 `e.g.` 不同的一处：#255 归入「界面微调」而不是 #250 一节。它的 README 不提会话或 #250，
`work/tickets/250/` 只有 250–254，且它单独合入 `main`；归到 #250 会是虚构分类。

## CLEAN-04 基准工作负载的唯一声明

改动：新增 `scripts/bench-workload.ts`；`scripts/bench-projection.ts`、`scripts/bench-gate.ts`、
`tests/bench-gate.test.mjs`。

`HISTORY_TURN_COUNTS = [40, 160]`、`OBSERVER_COUNTS = [1, 2]` 只在
`scripts/bench-workload.ts` 声明；`BENCHMARK_CELLS` 是两者的笛卡尔积（每项带 `historyTurns`、
`observers`、`key`）。bench-projection 的 `PARAMS` 读这两个数组；bench-gate 从 `BENCHMARK_CELLS`
派生 `CELL_KEYS`/`OBSERVERS`/`HISTORIES`，`historySlope`、`cost160`、`observerRatio` 与逐 cell 的
三项门禁都读派生 cell，不再有 `'160/1'` 字面量键。

`LIMITS`、JSON 输入格式、CLI 输出含义与「缺 cell 即失败」不变：同一组合成文档在改动前后
stdout/stderr/退出码逐字相同（passing 0、缺 cell 1 且 `missing cell(s): 160/2`、回归 1）。

参数模块被 import 时无副作用：模块无 import、无 CLI 入口、只有冻结常量与一次 flatMap；测试在
全新子进程里带敌意参数（`--baseline/--after/--out`）导入它，断言退出 0、无输出、不建文件。

验证：`npm run build` exit 0；`node --test tests/bench-gate.test.mjs` 8/8；
`node --test tests/cli-guard.test.mjs` 5/5（`bench-gate` 既有导出与 CLI 守卫未破）。

## CLEAN-05 记忆维护数值的唯一代码策略

改动：新增 `backend/memory/src/maintenance-policy.ts`（无任何 import）；`backend/memory/src/index.ts`、
`backend/memory/src/maintenance.ts`、`backend/gateway/src/service.ts`、两个 package manifest、
`backend/gateway/tsconfig.json`、`tests/gateway-maintenance-settings.test.mjs`、
`tests/memory-maintenance.test.mjs`、`tests/memory-maintenance-recovery.test.mjs`。

回合数默认 15、区间 5–50；衰减默认 6 小时、区间 3–24。此前这三组数字分别写在记忆行 zod Config、
维护引擎读取期校验、网关读写校验三处；数值一致但无共享来源。现在：

```ts
export const MAINTENANCE_TURNS = Object.freeze({ default: 15, min: 5, max: 50 })
export const MAINTENANCE_DECAY_HOURS = Object.freeze({ default: 6, min: 3, max: 24 })
```

网关经 `@ourfairy/dsh-memory/maintenance-policy` 运行时导入（该模块不 import 任何东西，所以网关
不会因此加载记忆行的运行图），peer 与 tsconfig 引用按现有包边规则补上；线协议字段名
（`triggerTurns`/`decayHours`）、profile 字段名（`maintenanceTurns`/`maintenanceDecayHours`）、
状态码、错误码与 volatile 热读行为不变；`backend/v1-bundle/cordis.patch.yml` 的显式部署配置未改值。

验证：`npm run build` exit 0；
`node --test tests/gateway-maintenance-settings.test.mjs tests/memory-maintenance.test.mjs` 12/12；
`node --test tests/memory-maintenance-recovery.test.mjs` 5/5；
`node --test tests/bundle-packages.test.mjs tests/plugin-compatibility.test.mjs` 15/15；
`npm run combo:verify` 三行 ok。

单向漂移实验（证明消费者真的读策略，而不是恰好相等）：把策略 `min` 改成 6 并同步改测试后，
网关开始拒绝 5、拒绝消息写 `from 6 to 50`；恢复后全绿。实验未提交。

收口评审指出 `maintenance.ts` 原说明「运行期校验与 Config 不会不一致」不可执行：Config 先拒绝，
`memory-maintenance-recovery.test.mjs` 仍用字面量 `'4'`/`'25'`，策略边界改成 6/30 时该用例照样绿。
已改为可执行（`9007a3355a`）：恢复测试的读取期用例从策略取四个边界并拒绝各自 `min-1`/`max+1`
（两个方向都钉住），持久化越界用例的写入值与断言文案也从策略派生；说明文字改为代码事实并指向
该检查。

已知未做：`backend/gateway/tsconfig.json` 的 `../memory` 引用没有做「去掉引用再 fresh build」的
对照实验，因此这里只声称它声明了真实的运行时依赖边，不声称 `tsc -b` 缺它就会失败。

## CLEAN-06 三处 Android 快照残留

改动：删除 `android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairySlantShape.kt`（45 行）、
`android/highlight/src/test/java/me/rerere/highlight/ExampleUnitTest.kt`（16 行），以及
`values/strings.xml` 与 `values-zh/strings.xml` 中 `code_block_collapse`/`code_block_expand` 四条
声明（净删除 65 行，4 个文件）。

删除前的引用检查（git 侧，避开 build 产物，可复跑）：

```bash
git grep -n "FairySlantShape" b812695b08 -- android/ ':(exclude)*/fairy/FairySlantShape.kt'   # 空，exit 1
git grep -n -e code_block_collapse -e code_block_expand b812695b08 -- android/ \
  ':(exclude)*/values/strings.xml' ':(exclude)*/values-zh/strings.xml'                        # 空，exit 1
git grep -n "ExampleUnitTest" b812695b08 -- android/ ':(exclude)*/ExampleUnitTest.kt'          # 空，exit 1
```

保留项核对：`FairyChamferShape` 仍由 `FairyTokens.consoleShape` 使用；`code_block_copy`、
`code_block_preview` 仍由 `HighlightCodeBlock.kt` 使用；highlight 的 4 个真实测试类仍在。

验证：`cd android && ./gradlew test lintDebug` BUILD SUCCESSFUL（另跑过一次
`./gradlew test --rerun-tasks`，77 tasks 全部执行）。测试数 423 → 422，差 1 条正是模板的 `2 + 2`；
lint 三个模块均无错误。`node --test tests/android-source.test.mjs` 6/6（快照来源声明与许可证校验
保持通过）。

## CLEAN-07 本机可再生产物回收

执行前实测（字节）、删除后复测，均记录在本地运行日志；本票没有 tracked diff。

| 目标 | 删除前 | 删除后 |
| --- | --- | --- |
| `android/app/build` | 693,803,285 | 0 |
| `android/ui/build` | 28,261,162 | 0 |
| `android/highlight/build` | 20,081,495 | 0 |
| `android/build` | 14,503,510 | 0 |
| `android/build-logic/build` | 524,444 | 0 |
| `android/.gradle` | 51,425,566 | 0 |
| `android/.kotlin` | 0（空目录） | 0 |
| `work/tmp/retro-logs` | 585,027,136 | 0 |
| `work/tmp/persona-distillation` | 6,031,370 | 0 |
| `work/tmp/ts-build-route` | 275,108 | 0 |
| `work/tmp/ts-boundary` | 138,483 | 0 |
| `work/tmp/ourfairy-ts` | 36,613 | 0 |
| **合计** | **1,400,108,172** | **0** |

- 执行前记录：主检出 `git status --porcelain` 为空；`git worktree list` 只有主检出与本次集成分支
  worktree；目标路径无进程占用（`lsof +D` 三个最大目标均为空）；票面提到的
  `.worktrees/integration-250` 已不存在。
- 删除前后主检出 `git status --porcelain` 均为空，tracked/untracked 状态一致。
- 未停止或删除他人进程、分支、worktree、stash；保留 `.cleanup-logs/`（本机无此目录）、
  `work/tmp/repo-env/`、`.ourfairy/`、`.corepack/`、`.git/lost-found/`、`android/work/`、
  全部 worktree 与 stash。
- 冷重建：`integration/repo-cleanup` worktree 此前没有任何 Android 构建产物，CLEAN-06 的
  `./gradlew test lintDebug` 从空状态跑完（161 个 task、3 分 51 秒），因此本轮的 Android 门禁
  确实覆盖了一次真实重建。

## CLEAN-08 收口

- 六张代码票的增量都可追溯到票面验收项：见上各节，无格式化、升级或范围外删除；`git diff
  b812695b08...f46981c580` 共 38 个文件，其中 `android/` 只有 CLEAN-06 的 4 个删除文件。
- 两轴评审（固定点 `b812695b08`）：
  - Standards 轴报 3 条硬发现，全部回所属票修掉：CLEAN-01 的通则式说明（改为机制事实）、
    CLEAN-05 的不可执行声称（改为从策略取边界的断言）、CLEAN-03 的手写生成段（改为描述文件派生）。
  - Spec 轴：六项逐条核对（选择器、票副本、证据索引差集、工作负载派生、维护策略消费、Android
    删除面）全部 PASS；它明确标注不重复执行门禁、不复核实施前红证据，见下方「未完成」。
- 可执行声称复核：本文件与代码里的每条「由 X 派生」「已检查」都能指到命令或断言；未能指到的
  两处已改成代码事实（见 CLEAN-05 的 tsconfig 引用、CLEAN-01 的覆盖完整）。
- 最终门禁：`npm test` 425/425、`combo:verify` 三行 ok、Android `test lintDebug` 成功
  （422 tests、0 failures）、`evidence-index --check` current。
- `npm run specs:status -- --offline`：`repo-cleanup` 行是批次行（无 spec 编号），
  state `unpushed`、ahead 29、worktree 1；其余行与基线一致（240 copies 已从 MISSING 变 ok，
  另多出 23 一行）。退出码 1 由 `repo-cleanup unpushed` 自身造成——本批按用户决定不推送。

## 未完成

- Spec 轴评审的**运行结果**只在最终树核对，不覆盖历史红证据：评审子代理未执行 `npm test`、
  `combo:verify`、Gradle 与 `npm run build`（按指令不重复跑），也不复核实施前的失败输出与
  CLEAN-07 的字节数；这些以本文件记录的实测为准。它另指出本文件两处口径已改：domain.md 是
  6 条代码路径（不是 9 条），最终 tip 是含证据提交的 `2c84c3b9fd`。
- 未推送、未开 PR、未合入 `main`：按用户决定保持本地集成分支。
- 未跑 CI（仓库协议是收口时跑一次，但本轮没有触发远端流水线）。
- 未做真机验收（本批无设备相关改动）。
- CLEAN-01 的同类缺口（gateway 等包的行为套件没有 `@covers` 声明）未在本票修复，实测缺口分布在
  attachments/groups/gateway/delivery/identity/search/memory 多个包，属后续票素材。
