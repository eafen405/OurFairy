# 整体架构优化：收敛共享不变式与模块接缝（spec #328）

本目录是 spec #328 的实施证据入口。GitHub 是发布权威：
[#328](https://github.com/eafen405/OurFairy/issues/328) 与 8 张子票
[#329](https://github.com/eafen405/OurFairy/issues/329)–[#336](https://github.com/eafen405/OurFairy/issues/336)。
本地票面副本与任务图在 [`work/tickets/328/`](../../../tickets/328/README.md)。

- 基线：`main` @ `25a2b34`
- 集成分支：`integration/spec-328`
- 集成分支 tip / 合入后的完整验证结果见 §验收（本文随收口提交更新）

8 张子票间没有原生阻塞边。实施时按文件重叠分批：skill-creator 三票（#329/#330/#332）串行合入
（#332 → #329 → #330，`creation.ts` 有行级重叠）；#333/#334/#335 与 Android 两票（#331/#336）与
它们无文件交集，并行完成。每票在独立 worktree、`ticket/<NN>-<slug>` 分支上 TDD 实现，合并前把集成分支
tip 合进票分支。所有票完成后跑三轴 code-review（Standards / Spec / 可执行声称），发现回到所属模块修
（见 [09-review-fixes](09-review-fixes/README.md)）。

## 逐票证据

| 票 | issue | 交付 | 证据 |
| --- | --- | --- | --- |
| 01 技能验证报告判据 | [#329](https://github.com/eafen405/OurFairy/issues/329) | 新增 `verification-report.ts`：唯一的存储报告解析与 verdict；批准、后台结算、审核展示、回滚共用；`parentManifestHash` 取 DB 行；展示警告按变化内容+零执行独立派生 | [01-skill-verdict](01-skill-verdict/README.md) |
| 02 修订来源互斥 | [#330](https://github.com/eafen405/OurFairy/issues/330) | 新增 `origin.ts`：显式/安装/后台/修订四来源唯一解析，5 条冲突在 staging 前拒；provenance 按来源分支写 | [02-skill-source-contract](02-skill-source-contract/README.md) |
| 03 Android 远程资源状态机 | [#331](https://github.com/eafen405/OurFairy/issues/331) | 新增 `RemoteResource.kt`：串行 lane、写后重读、失败保留旧快照、传输失败映射；技能审核入口 `perform` 写一次不重读；网关接受即回调；印象只读接入 | [03-android-remote-state](03-android-remote-state/README.md) |
| 04 候选包路径与崩溃回迁 | [#332](https://github.com/eafen405/OurFairy/issues/332) | 新增 `paths.ts`：路径词汇/校验/目录解析/候选回迁唯一实现；`unsafe` 与 `missing` 分开，启动对账都结案并留 note；publish/seed 事务顺序原样 | [04-skill-package-paths](04-skill-package-paths/README.md) |
| 05 路由准入声明 | [#333](https://github.com/eafen405/OurFairy/issues/333) | 删除零生产消费者的 `SurfaceEntry.auth` 与 44 条声明；字段集精确断言阻止回潮；fence/认证/角色/归属一行未动 | [05-route-admission](05-route-admission/README.md) |
| 06 文档门禁解耦 | [#334](https://github.com/eafen405/OurFairy/issues/334) | `tests/docs.test.mjs` 唯一生产改动：不再经后端 helper 取 repoRoot；新增无构建/无 dsh 副本的 fixture 回归（清 GIT_* 防 index 污染） | [06-docs-gate](06-docs-gate/README.md) |
| 07 requiredBuild 驱动 CI | [#335](https://github.com/eafen405/OurFairy/issues/335) | `scripts/combo.ts build` 遍历组合记录执行；CI 改为调用它；doctor/README 声称收窄到实际覆盖；新增整文件无副本 + 真实记录逐条执行的漂移测试 | [07-required-build](07-required-build/README.md) |
| 08 Android 通知定位 | [#336](https://github.com/eafen405/OurFairy/issues/336) | `RemoteNotificationNavigation.admits` 成为两类通知唯一的端点规范化+账号准入；Activity 只排队/调用/落点；会话归属与二次确认保留 | [08-android-notification-target](08-android-notification-target/README.md) |

## 收口评审

[09-review-fixes](09-review-fixes/README.md)：三轴 code-review 的发现、处置与可失败检查（含修复批 A 的
行为回归修复与修复批 B 的声称收窄）；[gates.md](09-review-fixes/gates.md) 是修复批 B 的逐条记录。

## 验收

收口时在最终集成状态独占运行（无并行实现者）：

- `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test`：结果与 `main` 基线的既有 flake 对照见
  [09-review-fixes/README.md §10](09-review-fixes/README.md)。本机 `tests/skill-learning.test.mjs` 存在
  与 `main@25a2b34` **完全相同的** 3 条时序 flake（同一文件同一用例，基线也失败）；CI 的 clean-runner
  `full-gate` 通过，作为全量权威证据。
- `npm run combo:verify`：三行 ok（产品基于集成分支、dsh 锁定 `ae2adffd8d67`、Android 来源一致）。
- Android `cd android && ./gradlew test lintDebug`：见收口提交时的运行记录（`RemoteAttachmentPreviewTest`
  在本机为既有 Compose 超时 flake：同一类曾在 CI 两次失败、重跑通过；本 spec 未改附件预览）。
- CI：`integration/spec-328` 推送后的 `full-gate` 与 `android` job 均通过（android 首次因上述既有 flake 失败，
  重跑通过；`full-gate` 首次即通过，且其构建步骤已由 `node scripts/combo.ts build` 执行）。

原始运行输出不入库；上表目录的 README 记录命令、结果与未完成项。
