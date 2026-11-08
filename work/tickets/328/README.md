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
| 02 修订来源互斥 | [#330](https://github.com/eafen405/OurFairy/issues/330) | `SkillCreation` 自身拒绝「修订 + 地址安装来源」组合 | `backend/skill-creator/src/creation.ts`、`tools.ts`、domain 测试 |
| 03 Android 远程资源状态机 | [#331](https://github.com/eafen405/OurFairy/issues/331) | 技能池 / 印象 / 网关共享串行读写、写后重读、失败保留旧快照与传输失败映射 | `android/app/src/main/java/me/rerere/rikkahub/`（remote + fairy 页面）及其测试 |
| 04 候选包路径与崩溃回迁 | [#332](https://github.com/eafen405/OurFairy/issues/332) | 路径校验、目录解析、候选回迁只有一份权威实现 | `backend/skill-creator/src/`（install、package、store、service、creation）及其测试 |
| 05 路由准入声明 | [#333](https://github.com/eafen405/OurFairy/issues/333) | 删除或行为对账「看似强制、实际无消费者」的准入声明 | `backend/*/src/http.ts` 的 SURFACE 声明、`backend/http`、路由清单测试 |
| 06 文档门禁解耦 | [#334](https://github.com/eafen405/OurFairy/issues/334) | tracked Markdown 链接检查不再依赖后端构建或 dsh 检出 | `tests/docs.test.mjs`、`tests/helpers/*`、`tests/precommit.test.mjs`、`scripts/precommit.ts` |
| 07 requiredBuild 驱动 CI | [#335](https://github.com/eafen405/OurFairy/issues/335) | CI 遍历组合记录构建；doctor / README 声称与实际覆盖一致 | `.github/workflows/check.yml`、`scripts/combo.ts`、doctor、README |
| 08 Android 通知定位 | [#336](https://github.com/eafen405/OurFairy/issues/336) | 会话通知与技能提醒共享端点规范化与账号准入 | Android 通知 / 路由 Activity / fairy 落点代码及其测试 |

## 实施与合并

每票一个实现者、一个 worktree、一条 `ticket/<NN>-<slug>` 分支，从集成分支 tip 开出；
实现完成前先把集成分支最新 tip 合进票分支，再由 Lead 或 merger 合入 `integration/spec-328`。

并发批次与文件重叠由 Lead 在认领前写进团队任务板；共享文件（例如 `backend/skill-creator/src/creation.ts`、
`tests/precommit.test.mjs`）的改动以「先合入者的版本 + 后来者 rebase」处理，冲突由票分支自己解决，不留给集成分支。

验证：每票先跑相关测试（`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/<file> ...`，Android 用
`cd android && ./gradlew test lintDebug` 的相关子集）；spec 收口时在集成分支跑全量 `npm test`、`npm run combo:verify`
与 Android `./gradlew test lintDebug`。

证据：本轮证据目录 `work/implementation/evidence/328-architecture/`（收口时建立），按
[证据索引](../../implementation/evidence/README.md) 的约定记录命令与结果。
