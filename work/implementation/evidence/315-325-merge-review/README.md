# PR #315 / #325 合入审查与集成验证

2026-11-06。目标是评估两个 PR 的合入可行性，并在工程门禁通过后合入 `main`。

## 范围与版本

- 远端基线：`eb1e182404ce7d684b491fe61c8d577305eb4b7a`。
- [PR #315](https://github.com/eafen405/OurFairy/pull/315)：`b81be0a310a324df558ea858b70fdab786104b01`，提示装配、会话事实工具、用户印象只读。
- [PR #325](https://github.com/eafen405/OurFairy/pull/325)：`89ad4e0e2b55316d787379cb7d47323232b40e18`，原生联网与人格／工作规则／身份分段；原基线是 #315 分支。
- dsh：沿用最新 main 的 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`、`master`，不退回 PR 原证据使用的 `c41af067`。
- 集成合并提交依次为 `bc52474`、`77b5cc9`；无文本冲突。合并树与最初 `git merge-tree` 的 `e6b6ffa0450ecfa7b52e520a4ce88076b3ae1371` 相同。

## 本次用户决定

用户明确指出：“具体模型响应的效果并没有证据证明验收标准是可以通过调整提示词达成的。所以并不作为硬阻塞项”。

本次据此把人格效果、检索样本在采样上限内未结束及模型生成的错误承诺列为已知非阻塞风险，不把相同问题换称为证据缺失继续阻塞，也不宣称调整提示词能够保证这些模型响应。历史失败记录保留；合入不表示相关效果问题已经解决或相关 issue 可以关闭。工程正确性、权限隔离和确定性门禁仍是本次合入条件。

## Team 两轴审查及互证

两位审查者使用独立上下文，分别检查 Standards 与 Spec，随后直接交换候选问题、反例和原始样本；Lead 独立复核关键引用与集成组合。

- **Standards：0 项确认的工程硬阻塞。** 印象只读、工具同会话先读后改、Unicode 上限与隔离、waterfall 的 complete 守卫及原生联网接线均有行为检查。未发现值得报告的新增 Fowler 异味。
- **Spec：0 项确认的工程硬阻塞。** #315 的只读印象、统一装配和原生投影事实工具，#325 的独立 section、原生搜索／抓取、缺凭据错误、免 key 抓取及授权用户范围已落实。#312 最新用户范围允许人格重组、取消旧长度限制、不新增预算。
- 非阻塞维护项：[生态边界](../../../../docs/architecture/dsh-ecosystem-boundary.md)仍含历史“44 条”数字，当前路由检查为 43 条；因该文注明前文保留原样，不判为新增硬违规。未把语义研究样本机械等同普通运行日志，也未把 #313 样本认定为已证明的切层实现错误。
- 真实效果风险见 [#315 原证据](../302-249-integration/README.md)及 [#325 原证据](../312-network-persona/README.md)。这些历史真实采样不能被称为本次新引擎组合的真实模型复测。

## 本次验证

使用独立产品 clone 与独立引擎 refs，保护原工作区未提交内容和原分支。引擎源提交与原有构建来源均为 `ae2adffd`，复用该提交的构建产物；没有改动引擎源码或版本锁。

初次在共享 worktree 执行组合检查失败，原因是本机产品 `main` 指向未推送的分叉，且本机引擎 `master` 仍旧；不是 PR 的代码失败。后续使用独立 refs 的精确版本组合完成验证。

| 检查 | 结果 |
| --- | --- |
| 最新 main 与两个 PR 的 9 文件定向检查 | 73/73 通过，0 失败、取消或跳过 |
| 最终集成 `npm test` | **701/701 通过**，44 suites，0 失败、取消、跳过；473.7 秒 |
| 最终集成 `npm run combo:verify` | 三行全部通过：产品基于 main、dsh `ae2adffd8d67773e`、Android 来源声明一致 |
| Android `./gradlew test lintDebug assembleDebug` | **BUILD SUCCESSFUL**（13 分 12 秒，161 tasks） |

Android 使用仓库合成 Google Services fixture，不代表 Firebase、真机或发布包验收。本轮不调用真实模型或外部搜索服务，后端运行测试使用模型／HTTP 替身。

## 首轮失败与归因

第一次全量返回 698 通过 / 3 失败，全部定位为环境而非本次改动：

1. **并与 Android Gradle 构建并发。** 本机 6 核，`skill-learning` 两个用例在资源争用时失败；停掉 Gradle 守护进程后单独重跑该文件与 `lifecycle`，28/28 通过。
2. **本机 dsh `master` 引用陈旧。** `lifecycle` 断言 doctor 应报出 Android 来源提交，实际报 dsh `master` 为 `d743267`。远端 fork 的 `master` 已由 `d743267` 快进到锁定的 `ae2adffd`；本机 `/home/fatfish/deepseek-harness`（与 `dsh-d80522d2` 共享 refs）的 `master` 引用未更新。按已合入 main 的 `eb1e182` 所述做法执行 `git merge --ff-only ae2adffd` 后，该断言通过。

修正引用并串行重跑后，全量为 701/701。此前一次用 `git clone --shared` + `rsync` 复用构建产物的引擎副本报告 `@ourfairy/dsh-bill` 缺失，说明该复用方式不可靠，最终验证改用 HEAD 恰为锁定提交的真实检出。
