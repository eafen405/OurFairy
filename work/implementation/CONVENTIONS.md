# OurFairy 实施协作与证据约定

本文件是实施与交付阶段的协作入口：开工前读什么、怎么开 worktree、证据怎么留、收口怎么评审。
版本组合、仓库拓扑、怎么跑与怎么构建不在这里——见根 [`README.md`](../../README.md) 与
[`combo.json`](../../combo.json)。

## 0. 权威来源（按优先级）

1. 父规格：<https://github.com/eafen405/OurFairy/issues/23>（本地副本 [`docs/specs/ourfairy-v1.md`](../../docs/specs/ourfairy-v1.md)）是产品总权威。
   与它并列登记的是记忆与上下文治理的现行规格：[#240 Fairy 记忆与上下文治理](https://github.com/eafen405/OurFairy/issues/240)
   （本地副本 [`docs/specs/fairy-memory.md`](../../docs/specs/fairy-memory.md)）。#240 的边界是长期记忆、印象、上下文压缩与维护设置
   这一增量：它不重述也不覆盖父规格的用户、会话与权限语义，两者冲突时以父规格为准。
2. 实施路线最终决议：<https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227>（本地副本 [`docs/decisions/v1-implementation-route.md`](../../docs/decisions/v1-implementation-route.md)）
3. 实施票：GitHub issue 为准；单票副本位于 `work/tickets/<票号>/`，首版 #24–#45 的票集见 [`work/tickets/ourfairy-v1/README.md`](../../work/tickets/ourfairy-v1/README.md)，票的读写方式见 [`docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md)
4. 研究：目录索引与研究基线说明见 [`docs/research/README.md`](../../docs/research/README.md)
5. 术语：各上下文的词汇表地图见 [`GLOSSARY-MAP.md`](../../GLOSSARY-MAP.md)

票的依赖图以 GitHub 原生 blocked-by 为准（最小字段查询见 `docs/agents/issue-tracker.md`）。**票未解除阻塞前不要开始实现该票。**

- **本地副本是工作副本，默认先读。** `docs/specs/`、`docs/decisions/`、`work/tickets/` 下的副本是实施时读取的版本；GitHub issue 是**发布权威**，票的**原生 blocked-by 是实时状态权威**，两者冲突时以 GitHub 为准并刷新副本。
- **只取需要的字段。** 需要权威数据时只查票号、状态与阻塞摘要（命令形式见 `docs/agents/issue-tracker.md`），需要时再取阻塞清单。不要默认拉全部票面正文与评论。
- **按需刷新副本。** issue 上出现更晚的明确决定时，或用户要求同步时，才刷新对应的本地副本。
- **上下文压缩后恢复**：读[证据索引](evidence/README.md)与当前任务的票面，不重读全部文档。

## 1. 仓库拓扑与版本组合

版本组合以 [`combo.json`](../../combo.json) 为唯一权威；仓库拓扑、入口、许可证与取上游修复的步骤见根
[`README.md`](../../README.md) 的「版本组合」「来源与许可证」「历史证据与旧路径」三节。
研究用的上游 SHA 不是产品提交；研究基线说明见 [`docs/research/README.md`](../../docs/research/README.md)。

## 2. 分支与 worktree 协议

每票在**自己仓库**的独立 worktree 中工作，分支名 `ticket/<NN>-<slug>`（NN 为票号）。
客户端票也在这里开 worktree（客户端已在本仓库内，拓扑见根 [`README.md`](../../README.md)）。

```bash
# OurFairy 侧（本仓库，含 android/ 客户端）
git -C /home/eafen405/projects/OurFairy worktree add \
  /home/eafen405/projects/OurFairy/.worktrees/<NN>-<slug> -b ticket/<NN>-<slug> main

# dsh 侧（仅当该票要改 dsh）
git -C /home/eafen405/projects/deepseek-harness worktree add \
  /home/eafen405/projects/deepseek-harness/.worktrees/<NN>-<slug> -b ticket/<NN>-<slug> product/ourfairy-v1
```

规则：

- 开工前先跑 `npm run specs:status`：一次给出每个 spec 与小修 integration 批次的分支 tip、推送、
  祖先合并、内容落地、遗留 worktree，以及落地分支本身有没有未推送提交。开工与收口都以这份输出为准，
  不用 `git log --all` 逐个分支反推。
- 开工前确认 worktree 基线是目标集成分支的最新提交；不是则先 `git merge` 集成分支最新提交再开始。
- **合并前**再把集成分支 tip 合进自己的票分支，解决冲突后报告，不要等 Lead 替你解冲突。
- 每张票只写自己声明过的写范围；跨票公共文件由 Lead 协调。
- 完成后由 Lead 指定的 merger 把票分支合入对应集成分支，并更新 `combo.json`。
- **收尾即清场。** 任务结束或交接前，本轮执行者清理自己创建的临时 worktree、已合入本地分支、临时产物和后台任务；交付前确认 `git status --porcelain` 为空、`git worktree list` 无本轮遗留。未提交或未合入内容用 stash 或分支明确保留，不为清场硬合并或丢弃。不要动其他人的 worktree。

## 3. 工具链

- **pnpm 必须用 corepack 固定版本**：`corepack pnpm@11.28.5 <cmd>`（`PATH` 上的 pnpm 来自 Windows，勿用）。
- **Node、JDK 与 Android SDK 的版本要求**见根 [`README.md`](../../README.md) 的「先决条件」；构建客户端还要准备 `android/local.properties` 与 `android/app/google-services.json`（同节）。
- **Gradle 走 `android/` 里的 wrapper**，不另装；改过 `android/` 源码后重新构建即可。
- **gh CLI** 已登录；`origin` 的 fetch 走 HTTPS、push 走 SSH（`git@github.com:`）。ssh 必须非交互：
  `~/.ssh/config` 里 `Host github.com` 已设 `BatchMode yes`；若在别的机器上仍会挂起，用
  `GIT_SSH_COMMAND='ssh -o BatchMode=yes' git push`。

### 3.1 Android 构建实测结论

以下每条都是**实测结论**，不是推测：

- **Gradle 下载发行版超时 ≠ 代理没配**：Java/Gradle 不读 `http_proxy`/`https_proxy` 环境变量，`curl` 能下不代表 Gradle 能下。
- **依赖解析期间日志长时间无输出是正常推进，不是卡死**：Gradle 只在任务完成时打印 `> Task`。
- **长构建使用托管后台任务**：用支持任务句柄的后台执行工具（本环境为 `bash` 的 `run_in_background` 与 `job_output`），保留任务 id，交付前收集或取消相关任务。原始运行日志放在 `work/tmp/<票号>/`；交付 README 记录实际命令与结果，日志本身不作为提交物。

## 4. 常用命令

```bash
# dsh：安装（已装，勿重复全量装）
cd /home/eafen405/projects/deepseek-harness && corepack pnpm@11.28.5 install
# dsh：构建宿主库（改动 src 后必须重建，否则测试跑的是旧产物）
corepack pnpm@11.28.5 run build:lib:host
# dsh：跑相关测试（示例）
corepack pnpm@11.28.5 exec vitest run <path>
```

dsh 的完整构建清单见 [`combo.json`](../../combo.json) 的 `repos.dsh.requiredBuild`——少跑一条会在运行期以缺模块的形式失败。
OurFairy 侧怎么跑测试、怎么起后端，见根 [`README.md`](../../README.md) 的「跑测试」与「跑后端」。

## 5. 证据协议

每张票的交付必须留下**可复查的证据**，写在 `work/implementation/evidence/` 下；
目录入口、每份 README 该写什么、哪些原始输出不入库，都在[证据索引](evidence/README.md)中，本文不重复。

本文只补一条：结论必须区分**替身测试**（模型/网络/平台替身）与**真实服务**（当前组合的云模型与 ASR）
证据，也必须区分**模拟器/构建成功**与**真机**证据；「编译通过」不等于验收通过（用词纪律见
`CODING_STANDARDS.md`）。

## 6. 工作纪律

- **只做本票范围。** 发现范围外问题时不要顺手扩散改动：记到 issue tracker（建票方式见
  `docs/agents/issue-tracker.md`）或本票证据目录的未完成项里，并通知 Lead。

`work/tmp/` 只放可丢弃的运行日志与临时输出；带结论、下次还要读的分析进 `docs/decisions/` 或
`work/implementation/notes/` 并提交，否则会随清理一起消失。

编码与验证规则见 `CODING_STANDARDS.md`。

## 7. 沟通

- 与 Lead 的通信保持稀疏，用**指针**（票号、提交 SHA、文件路径、命令），不要复述文档。
- 阻塞时立即上报：说清「卡在哪一步、试过什么、需要什么决定或权限」。
- 完成后向 Lead 报告：票号、分支、提交 SHA、变更仓库、证据目录、未完成项。

## 8. 收口评审

每个 spec 收口时跑**一次**两轴 code-review（Standards + Spec），范围是该 spec 的增量 diff。用
`code-review` skill；Spec 轴引用**本地票面副本**（路径见上方实施票说明）与**本地父规格副本**
（[`docs/specs/ourfairy-v1.md`](../../docs/specs/ourfairy-v1.md)），仅在票面与规格冲突、或 issue 上出现
更晚的明确决定时，才 `gh issue view <n> --comments` 核对。发现的问题**回到所属模块修**，不由 Lead 在集成分支上
直接打补丁掩盖。

两轴之外，固定增加一项**可执行声称检查**（`CODING_STANDARDS.md`「声称须可执行」）：本次增量里每一条
「A 与 B 不能不一致」「X 已被检查/保证」「清单由 Y 派生」的声称，都要能指出在它失效时会失败的**具体命令或测试**，
并核对它断言的是同一事实；答不出就删除该声称，不为它补断言。
