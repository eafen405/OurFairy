# #347：V4 投递 surface 冷读取修复与组合合入

票面与交付边界见 [05-native-reader](../../../../tickets/342/05-native-reader.md)，版本组合以 [combo.json](../../../../../combo.json) 为准。本记录整理 native 实现者的 `/tmp/ourfairy-347-native-evidence.md`、`/tmp/ourfairy-347-early-delivery-check.md`、`/tmp/ourfairy-347-followup-evidence.md`，并补充 merger 实测。source 的行为回归、类型检查与 merger 的合入/构建分别标注。

## 最终版本与范围

- 产品分支：`integration/spec-342`；本次操作前 HEAD `d0742b1db4fe5596cf476f7165f97bc1323122f1`，工作区干净。本次仅改组合的 `repos.dsh.productCommit` 和本证据，未改集成分支名、localPath、版本、其他组合字段或产品实现。
- Native 主检出：`/home/fatfish/deepseek-harness`，分支 `master`。旧锁为 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`；**最终锁定提交为 `8014fc775a27e7273300a68fcadb7e2980bb93f0`**。
- Source：`/home/fatfish/deepseek-harness/.worktrees/347-delivery-v4-surface`，分支 `ticket/347-delivery-v4-surface`。两个正常提交依次为 `ce848e3aade4b94d0ff02f05c2a69f81d217b210`（delivery span）、`8014fc775a27e7273300a68fcadb7e2980bb93f0`（early delivery / actual system head），未 amend 或重写 master。
- 从旧锁到最终 SHA 的 diff 共 6 files、156 insertions / 19 deletions：V4 `relationships.ts`、既有 `relationships.spec.ts`、既有 Agent `system-prompt-admission.spec.ts`，以及 V4 包双语 README 与 pairing record。
- 生产修改为 V4 `SURFACE_TYPES` 识别既有 `delivery/message`、移除强于 core 的 nonleading-system 前置拒绝、将既有 `protectedHead` 赋值同步到合法 system replacement 成为实际 node 0 的条件，另补 JSDoc。未新增 state/mode/API，未改变 schema、公开类型、事件 payload、required event、格式版本、migration 或其他历史代际；没有 declared persistence-type 变化，不新增 acknowledgement。

## 原始 delivery / clear 缺口（source，ce848 阶段）

#345 在其独立 worktree 的 `tests/session-commands-recovery.test.mjs` 中 `real cross-user delivery` 场景复现：两轮投递与 clear 后在线正常，冷读 `/chat/read` 返回 500。source 实读该 worktree 的 `work/tmp/345/delivery-stderr.log`：`SessionPersistenceCorruptionError` 包裹 `SessionFormatError: compaction/prune shadowedSeqs do not name an exact current surface span`，并出现 `500 !== 200`。

V4 `SURFACE_TYPES` 遗漏 core 已支持的 `delivery/message`，派生 `RELATIONSHIP_TYPES` 因而跳过投递 accept，校验器 current surface 与 Session 实际 surface 不一致。修复保留固定代际包的显式已知 literal，没有引入到 current core helper 的新依赖、过滤真实 shadowedSeqs、改写旧日志或放宽 span 校验。

新增回归复用既有 reopen seam：物理 JSON encode/decode → catalog `validation: 'current'` 严格恢复 → V4 relationship validation → `Session.fromRestore` → surface 与派生消息断言。包含受保护 system head、已完成人类轮、投递、完整 prune span 与立即 user replacement，再执行第二轮投递/prune/replacement。字面量期望位置为首次 `[2, 9]`、第二次 `[2, 12]`；恢复内容只保留 system 与最新 replacement。

以下为 source 在 ce848 阶段的实际命令，不能当作 followup 后重跑的结果。全部在独立 worktree 使用 `corepack pnpm@11.28.5`；安装为 `install --frozen-lockfile --ignore-scripts`，采用 worktree 本地 virtual store/workspace links，安装日志 `/tmp/ourfairy-347-install.log`。表内日志相对 source ignored `.artifacts/347/`。

| source 实际命令 | 观察结果 | 日志 |
| --- | --- | --- |
| `corepack pnpm@11.28.5 exec vitest run packages/session/session-format-v3-to-v4/tests/relationships.spec.ts -t 'restores two delivery and clear'`，修复前 | RED：1 failed、61 skipped；`relationships.ts:261` 同一错误，3.10 s | `red.log` |
| 同一 focused 命令，加入 literal 后 | GREEN：1 passed、61 skipped | `green.log` |
| `corepack pnpm@11.28.5 exec vitest run packages/session/session-format-v3-to-v4/tests/relationships.spec.ts` | 70 passed | `relationships.log` |
| `corepack pnpm@11.28.5 run build:native-system` | PASS，host-only Linux x64 glibc flock addon | `native-addon.log` |
| `corepack pnpm@11.28.5 exec vitest run packages/session/session-format-v3-to-v4/tests packages/session/session-format-catalog/tests packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts packages/session/session-persistence-jsonl/tests/native-developer-admission.spec.ts` | 27 files、474 tests passed，12.01 s | `format-persistence.log` |
| `corepack pnpm@11.28.5 exec vitest run packages/session/session-persistence-jsonl/tests/jsonl.spec.ts -t 'round-trips a delivered message'` | 1 passed、191 skipped | `delivery-persistence.log` |
| `corepack pnpm@11.28.5 exec vitest run packages/core/session/tests/surface.spec.ts` | 68 passed | `core-surface.log` |
| `corepack pnpm@11.28.5 exec vitest run packages/core/session/tests/delivery-message.spec.ts` | 5 passed | `core-delivery.log` |
| `corepack pnpm@11.28.5 run verify-translation-pairing --write packages/session/session-format-v3-to-v4/README.md` | PASS，仅更新所属 pairing | `translation-pairing.log` |
| `corepack pnpm@11.28.5 run typecheck` | PASS，5 gates passed、0 failed、0 skipped，702.29 s | `typecheck.log` |
| `corepack pnpm@11.28.5 run test:docs` | FAILED，17 gates passed、4 failed，基线债见下节 | `test-docs.log` |
| `corepack pnpm@11.28.5 --silent run change-scope --base origin/master` | 仅原始五个预期 package paths | `change-scope.json` |

计数有重叠：70 个 relationships cases 已包含在 474-test run，不相加作为独立测试总数。source 正常提交 `git commit -F .artifacts/347/commit-message.txt` 未绕过 native hooks：translation pair、lint（2 files，0 warnings/errors）、whitespace、vendor-manifest guard 通过，日志 `commit.log`。source 当时 clean，`git diff HEAD^ HEAD --check` 通过，未 push。

## Early delivery 与实际 system head（source，最终 followup）

原始回归从已有 system head 开始，未覆盖首次人类 turn 前收到投递。真实 Agent 可先收到 required `delivery/message`，随后首次 human input；首个模型请求 roles 为 `['assistant', 'system', 'user']`，在线成功，但 ce848 的同一完整 JSON event snapshot 在 current catalog strict restore 时被 `relationships.ts:127` 拒绝：`system/message requires a protected first surface head`。

source 查明既有 writer 行为：`SystemPromptProjection.project()` 无 system 节点时返回 append，Agent 原样提交，core 添加到 surface 尾部；core 仅保护实际 node 0 为 system 的情况，既有 planner 测试允许 nonleading system 被正确引用的 replacement 遮蔽。followup 删除 reader 更强的前置拒绝，把两个原先错误拒绝的合法 fixture 改为正例。为覆盖 user head 被 system 合法替换后的实际头保护，另以导出的 `restoreReleasedV4Artifact` 直接建立红灯，最终只调整既有 `protectedHead` 赋值条件，没有新增状态。

最终正反例覆盖 early delivery→first human 的完整 restored events/surface/messages、实际 system node 0 的 prune/replacement 保护、nonleading system 的合法替换、错误/未开启 turn-step、遗漏 source references，以及原有两轮 delivery/clear、投递端点、遗漏投递、坏 span、陈旧端点与错误 source references。直接 native-restorer 反例避免由后续 common Session admission 掩盖 native validator 的遗漏。

| source 实际命令 | 观察结果 | source `.artifacts/347/` 日志 |
| --- | --- | --- |
| `corepack pnpm@11.28.5 exec vitest run packages/core/agent-loop/tests/system-prompt-admission.spec.ts -t 'cold-restores the first human turn'`，ce848 | RED：1 failed、27 skipped，4.80 s，writer 断言均通过、mandatory V4 restore 拒绝 | `early-delivery-red.log` |
| 同一 real Agent 命令，删除额外前置后 | GREEN：1 passed、27 skipped，4.60 s | `early-delivery-green.log` |
| `corepack pnpm@11.28.5 exec vitest run packages/session/session-format-v3-to-v4/tests/relationships.spec.ts -t 'protects a system message that replaced'`，仅删除前置、尚未同步头保护时 | RED：native restorer 错误接受实际 system head 的 user replacement；1 failed、75 skipped | `promoted-head-red.log` |
| 下方最终七文件命令，在既有头保护赋值调整后 | GREEN：7 files、161 tests passed，7.82 s | `followup-final-tests.log` |
| `corepack pnpm@11.28.5 exec tsc -b packages/session/session-format-v3-to-v4/tsconfig.json` | PASS，exit 0，覆盖最终编辑 | `followup-final-package-types.log` |
| `corepack pnpm@11.28.5 exec node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p tsconfig.host.json` | PASS，exit 0，覆盖最终编辑 | `followup-final-host-check.log` |
| `corepack pnpm@11.28.5 run verify-translation-pairing --write packages/session/session-format-v3-to-v4/README.md` | PASS，仅所属 pairing 更新 | `followup-pairing.log` |

最终行为回归命令：

```sh
corepack pnpm@11.28.5 exec vitest run packages/core/agent-loop/tests/system-prompt-admission.spec.ts packages/core/agent-loop/tests/system-prompt-projection.spec.ts packages/session/session-format-v3-to-v4/tests/relationships.spec.ts packages/session/session-persistence-jsonl/tests/current-event-admission.spec.ts packages/session/session-persistence-jsonl/tests/native-developer-admission.spec.ts packages/session/session-format-v3-to-v4/tests/developer-relationships.spec.ts packages/session/session-format-v3-to-v4/tests/system-message.spec.ts
```

161 的分项为 Agent admission 28、planner 8、V4 relationships 76、developer relationships 7、system messages 2、current-event admission 4、native-developer admission 36。此前中间 111/49 passes 已由最终 run 取代，不与 161 累加。source `git merge --no-edit master` 为 Already up to date，ce848 祖先检查通过；正常 `git commit -F .artifacts/347/followup-commit-message.txt` 的 translation pairing、lint（3 files，0 warnings/errors）、whitespace、vendor guard 均通过，未绕过 hooks（`followup-commit.log`）。最终 source clean，`git diff HEAD^ HEAD --check` 通过，scope 记录在 `followup-change-scope.json`。

## 既有 native 文档债

ce848 阶段的 `test:docs` 完整结束，exit 1、17 pass / 4 fail，不记为完整文档门禁通过。失败为：

1. `verify-type-equiv`：六条 DRIFT，位于 `docs/subsystems/llm-streaming.md:77`（MessageSourceMap）、`docs/subsystems/session.md:20,302,342`（SessionEventMap、SurfaceEventType、SurfaceIntent）、`docs/subsystems/persistence.md:143,195`（SessionHeader、CreateSessionOptions）；既有 fork delivery/owner 声明未同步到摘录。
2. `verify-translation-pairing`：`packages/compaction/compaction-basic/README.i18n.yaml` 的 automatic-triggers-and-overflow-recovery section 不同步。
3. `verify-persistence-formats`：historical-formats 的双语 README 与 pairing record 陈旧。
4. `verify-repository-references`：`python/sdk/uv.lock:113 commit-hash`。

source 运行 `git diff --exit-code ae2adffd8d67773e125b8048120cf9ad2ba7edf3 -- docs/subsystems/llm-streaming.md docs/subsystems/session.md docs/subsystems/persistence.md packages/llm/llm/src/message.ts packages/core/session/src/types.ts`，exit 0、无差异；`.artifacts/347/baseline-inputs.json` 记录上述声明/摘录与其他报错路径的基线 Git blob/worktree hashes 匹配。followup 没有修改或重跑这些宽泛文档债；本次 merger 也不扩修。

## Merger 合入与组合锁

- 两次合入前核对 native target/source clean、精确 SHA 与祖先关系，均 exit 0。native primary 依次执行 `git merge --ff-only ce848e3aade4b94d0ff02f05c2a69f81d217b210`、`git merge --ff-only 8014fc775a27e7273300a68fcadb7e2980bb93f0`，均 exit 0，未产生 merge commit；最终 master/HEAD=`8014fc775a27e7273300a68fcadb7e2980bb93f0`，合入后 clean。
- 两次在 primary 执行 `git fetch origin master` 均 exit 0；`origin/master` 仍为旧锁 ae2，未发现 remote movement。最终 fetch 日志 `work/tmp/347/final-native-fetch.log`。
- 产品组合最终仅将 `repos.dsh.productCommit` 从 ae2 改为 8014，ce848 中间 pin 未提交。
- 开工 `npm run specs:status -- --offline` exit 1，仅 #342 `unpushed`（MISSING，5 ahead）需要注意，符合本次不 push 的安排；日志 `work/tmp/347/specs-status-before.log`。
- ce848 上的四条 requiredBuild、combo/doctor 曾通过，但不作为最终 followup 结果。旧 `build:artifacts` 在邻接红灯确认后取消，job `bash-7f46b5afd0b24a17` 已收集为 killed / SIGTERM（`work/tmp/347/build-artifacts.log`），不记为通过，旧源 `build:check` 未启动。
- 未触碰旧 native worktree `/home/fatfish/dsh-d80522d2`，未删除 source worktree，未修改 hook 源或全局配置；未 push 或关闭 issue。

## Merger 最终构建与验证

构建 cwd 为 native **primary**。内部脚本里的 pnpm 使用产品 ignored `work/tmp/347/bin/pnpm` 临时 PATH shim（`exec corepack pnpm@11.28.5 "$@"`），不使用 Windows pnpm，不改全局配置或 hooks。下方 `PATH` 前缀均为 `/home/fatfish/OurFairy/.worktrees/spec-342/work/tmp/347/bin:$PATH`。原始日志保留在产品 ignored `work/tmp/347/`，不提交。

| 最终 SHA 上的 merger 实际命令 | 结果 | 产品原始日志 |
| --- | --- | --- |
| `PATH="/home/fatfish/OurFairy/.worktrees/spec-342/work/tmp/347/bin:$PATH" OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness node scripts/combo.ts build`（产品 cwd） | PASS，exit 0；完整执行四条 requiredBuild：install（pnpm 11.28.5、366 workspace projects、Already up to date，3.7 s）、build:lib:host、build:lib:client、build:native-system（Linux x64 glibc flock addon） | `work/tmp/347/final-required-build.log` |
| `PATH="/home/fatfish/OurFairy/.worktrees/spec-342/work/tmp/347/bin:$PATH" corepack pnpm@11.28.5 run build:artifacts`（native primary cwd） | PASS，exit 0；7 passed、0 failed、0 skipped，103.53 s；native、Host compiler/bundle、Desktop bundle、Client compiler/bundle、Web 全部完成，记录 325 client artifacts，source `8014fc7`、version `0.2.1-rc.2`、无 dirty marker | `work/tmp/347/final-build-artifacts.log` |
| `PATH="/home/fatfish/OurFairy/.worktrees/spec-342/work/tmp/347/bin:$PATH" corepack pnpm@11.28.5 run build:check`（native primary cwd，在上述 artifacts 完成后） | PASS，exit 0；Host/Client aggregates 共 2 passed、0 failed、0 skipped，45.66 s | `work/tmp/347/final-build-check.log` |
| `OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm run combo:verify`（产品 cwd） | PASS，exit 0；OurFairy 集成 tip、dsh master=`8014fc775a27e7273300a68fcadb7e2980bb93f0`、Android source 三行匹配，无 skipped | `work/tmp/347/final-combo-verify.log` |
| `env -u DEEPSEEK_BASE_URL -u OURFAIRY_MINIMAX_BASE_URL PATH="/home/fatfish/OurFairy/.worktrees/spec-342/work/tmp/347/bin:$PATH" OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm run backend:doctor -- --json`（产品 cwd） | PASS，exit 0；12 checks 全部 ok，primary CLI/HEAD 为最终锁，product build/profile/bundle/compatibility/native capabilities 通过；keyless，未启动后端或调用模型/ASR | `work/tmp/347/final-backend-doctor.log` |

产物记录另由 native 导出的 `readClientBuildRecord` 做实际 digest 校验，exit 0，返回 sourceCommit=`8014fc7`、version=`0.2.1-rc.2`、artifactCount=325、digestVerified=true；日志 `work/tmp/347/final-artifact-record.log`。实际命令（native primary cwd）：

```sh
node --import tsx/esm --input-type=module -e 'import { readClientBuildRecord } from "./scripts/client-build-environment.ts"; const record = readClientBuildRecord(process.cwd()); if (record.environment.DSH_CLIENT_COMMIT_HASH !== "8014fc7" || record.environment.DSH_CLIENT_GIT_DIRTY !== undefined) throw new Error("unexpected client source identity"); console.log(JSON.stringify({sourceCommit: record.environment.DSH_CLIENT_COMMIT_HASH, version: record.environment.DSH_CLIENT_VERSION, artifactCount: record.artifacts.fileCount, digestVerified: true}));'
```

最终证据暂存后的 `node --test --test-name-pattern 'every relative link' tests/docs.test.mjs` 已 exit 0、1 passed；日志 `work/tmp/347/final-product-doc-links.log`。产品 JSON 与 d074 基线比较只差 `repos.dsh.productCommit`，diff paths 仅组合锁和本证据。构建后 `git diff --check`、native `git diff ae2adffd8d67773e125b8048120cf9ad2ba7edf3 HEAD --check` 均 exit 0；native primary/source 的 HEAD 精确为 8014、分支正确、`git status --porcelain=v1` 均为空。

## 未执行项与交接

- Merger 不重复 source-focused 测试、native 全量 tests、coverage 或平台矩阵。source 未跑完整 artifact/build-check，最终产物与随后 aggregate build checks 由 merger 补齐；原始 full typecheck 的 5/5 不替代最终 followup 上的 build check。
- Native full lint、full `doc-sync` 未执行；初始 `test:docs` 失败使其串行 `doc-sync` 未启动，不声称 native 全量文档通过。
- 不运行真实模型、ASR、GUI、模拟器或真机验收。编译与环境检查不作为运行时验收。
- #345 在最终锁定组合重跑原始跨用户投递/clear 冷读回归；产品最终全量 `npm test` 由 #346 负责。本次产品 pin/evidence commit 按 Lead 明确例外使用 `--no-verify`，不修改 hooks。
- #347 保持 OPEN，由 Lead 确认组合 ready 后关闭并解阻 #345；本轮不 push、不关闭 issue、不清理他人 worktree。
