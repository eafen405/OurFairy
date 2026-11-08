# #328 整体架构优化：收敛共享不变式与模块接缝

父规格：[#328 整体架构优化：收敛共享不变式与模块接缝](https://github.com/eafen405/OurFairy/issues/328)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `25a2b34`。集成分支 `integration/spec-328`。

## 目标

把本轮整体架构审查收敛为 8 个可独立交付的优化，提升 module 的 depth、调用方 leverage、维护 locality 与经 interface 的可测试性；
保留现有权限、事务、幂等、崩溃恢复与操作溯源保障，不为整洁削弱它们；不默认改变 ADR。

## 任务图

8 个子票**没有原生阻塞边**，frontier 一开始就是全部 8 票。并发度只受写范围重叠与本地构建/测试资源限制；
票与票之间需要对齐的只有共享文件与合并顺序（见下）。

| 票 | issue | 主题 | 主要写范围 |
| --- | --- | --- | --- |
| 01 技能验证报告判据 | [#329](https://github.com/eafen405/OurFairy/issues/329) | 批准 / 后台结算 / 审核展示消费同一验证事实与 verdict | `backend/skill-creator/src/`（verify、creation、learning、展示路径）及其测试 |
| 02 修订来源互斥 | [#330](https://github.com/eafen405/OurFairy/issues/330) | `SkillCreation` 自身拒绝「修订 + 地址安装来源」组合 | `backend/skill-creator/src/creation.ts`、`tools.ts`、`origin.ts`、domain 测试 |
| 03 Android 远程资源状态机 | [#331](https://github.com/eafen405/OurFairy/issues/331) | 技能池 / 印象 / 网关共享串行读写、写后重读、失败保留旧快照与传输失败映射 | `android/app/src/main/java/me/rerere/rikkahub/`（remote + fairy 页面）及其测试 |
| 04 候选包路径与崩溃回迁 | [#332](https://github.com/eafen405/OurFairy/issues/332) | 路径校验、目录解析、候选回迁只有一份权威实现 | `backend/skill-creator/src/`（install、package、store、service、creation）及其测试 |
| 05 路由准入声明 | [#333](https://github.com/eafen405/OurFairy/issues/333) | 删除或行为对账「看似强制、实际无消费者」的准入声明 | `backend/*/src/http.ts` 与 `backend/memory/src/impression.ts` 的 SURFACE 声明、`backend/http`、`backend/bill/README.md`、路由清单测试 |
| 06 文档门禁解耦 | [#334](https://github.com/eafen405/OurFairy/issues/334) | tracked Markdown 链接检查不再依赖后端构建或 dsh 检出 | `tests/docs.test.mjs`、`tests/helpers/*`、`tests/precommit.test.mjs`、`scripts/precommit.ts` |
| 07 requiredBuild 驱动 CI | [#335](https://github.com/eafen405/OurFairy/issues/335) | CI 遍历组合记录构建；doctor / README 声称与实际覆盖一致 | `.github/workflows/check.yml`、`scripts/combo.ts`、doctor、README |
| 08 Android 通知定位 | [#336](https://github.com/eafen405/OurFairy/issues/336) | 会话通知与技能提醒共享端点规范化与账号准入 | Android 通知 / 路由 Activity / fairy 落点代码及其测试、`android/GLOSSARY.md` |

## 实施与合并

每票一个实现者、一个 worktree、一条 `ticket/<NN>-<slug>` 分支，从集成分支 tip 开出；
实现完成前先把集成分支最新 tip 合进票分支，再由 Lead 或 merger 合入 `integration/spec-328`。

并发批次与文件重叠由 Lead 在认领前写进团队任务板；共享文件（例如 `backend/skill-creator/src/creation.ts`、
`tests/precommit.test.mjs`）的改动以「先合入者的版本 + 后来者 rebase」处理，冲突由票分支自己解决，不留给集成分支。

### 实际批次与合入顺序

8 票并行度只受写范围与本地构建资源限制，全部按 frontier 并发完成：

- **批次 1（5 个 worktree 并行）**：#332（skill 路径）、#333（路由声明）、#334（文档门禁）、#331（Android 状态机）、
  #335（requiredBuild/CI）。
- **批次 2**：#329（验证判据）∥ #336（Android 通知）；#330（来源契约）等 #332 合入后开出。
- **合入顺序**：#334 → #331 → #332 → #333 → #335 → #329 → #336 → #330。skill-creator 三票
  （#332 → #329 → #330）串行合入，因为 `creation.ts` 有行级重叠；其余票文件不相交。
- 每票合入前在自己的 worktree 合并集成分支 tip 并复跑相关测试；Lead 合入后补跑该票相关测试与 typecheck。

并发执行者共享一台 6 核机器时，合并提交与跨包提交的本地 full 门禁会触发既有的时序敏感 flake。处理口径
（记录在证据里）：本地提交/合并可用 `--no-verify` 跳过**本次**全量，但相关测试必须在票 worktree 真实跑绿；
权威全量由 CI 与收口时独占运行产出（`AGENTS.md`「验证节奏」）。

### 收口评审

三轴 code-review（Standards / Spec / 可执行声称）在集成分支上对 `25a2b34...HEAD` 运行，发现回到所属模块由
两个互不相交的修复批次处理：修复 A（skill-creator + Android 状态机）与修复 B（路由清单、CI 漂移测试、
doctor 声称、客户端词汇表）。两处行为回归（#329 展示警告、#332 启动收敛）已恢复；没有可失败检查的绝对声称
已收窄或补测试。逐条记录见 [`09-review-fixes`](../../implementation/evidence/328-architecture/09-review-fixes/README.md)。

### 验证

每票在 worktree 内跑相关测试（`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/<file> ...`，
Android 用 `./gradlew :app:testDebugUnitTest --tests ...`）；spec 收口在集成分支独占跑全量 `npm test`、
`npm run combo:verify` 与 Android `./gradlew test lintDebug`。完整结果（含本机既有 flake 与 `main` 基线的
对照、CI run 结论）见 [`328-architecture/README.md`](../../implementation/evidence/328-architecture/README.md) §验收。

证据：`work/implementation/evidence/328-architecture/`（9 个目录：8 票 + 收口评审），按
[证据索引](../../implementation/evidence/README.md) 的约定记录命令与结果；规格小节由
`evidence/index/36-spec-328.json` 生成。
