## Parent

[#124 文档收口：以「两个仓库」为准的事实纠偏与减法整理](https://github.com/eafen405/OurFairy/issues/124)

## What to build

`work/implementation/CONVENTIONS.md` 自称"唯一入口"，但混了大量 2026-10-14 时期的内容：worktree 命令、Android 构建踩坑、Gradle 缓存大小、"22 张票"编号、固定 SHA、检查点 A–D。其中多项已经和现状不符，且它同时充当了第二份权威。

同时，`work/implementation/notes/` 里多篇过程记录仍在冒充"现行指令"——最典型的是 `73-execution.md` 开头写"实现者开工先读本文"，而该 spec 早已收口、里面的测试数与模块路径都是旧的。

### 1. `CONVENTIONS.md` 瘦身

保留职责，删掉会腐烂的副本：

| 段落 | 处理 |
| --- | --- |
| §0 权威来源 | 删掉"22 张实施票 #24–#45"的固定清单，改为"票在 GitHub，本地副本在 `work/tickets/<票号>/`"，并指向 `docs/agents/issue-tracker.md` |
| §1 仓库拓扑 | 拓扑不在本文件写第二份：改为一段说明 + 指向根 `README.md`；仓库表删除（本地路径/分支/远端已在 `combo.json`），只保留"组合以 `combo.json` 为准" |
| §1 研究基线 | 删除，指向 `docs/research/README.md`（由 #128 建立） |
| §2 worktree 协议 | 保留命令，删掉"票序号 1–22"与已不存在的分支示例 |
| §3 工具链 | 保留必需命令；删掉会腐烂的实测细节（缓存大小、Gradle 版本号等），Android 构建踩坑若仍有效则移入 `android/` 或删除 |
| §5 证据协议 | 保留（这是有价值的规则），但确认没有与 `work/implementation/evidence/README.md` 重复 |
| §8 检查点 A–D | 删除固定票号表，改为"每个 spec 收口时跑一次两轴评审"的规则 |

目标：读完能知道"该读什么、怎么开 worktree、证据怎么留"，**不再包含任何可推导的数字与固定票号**。

### 2. `notes/` 里的失效协调文档

按"work 是临时的、证据才是记录"处理：**删除**已被证据覆盖的协调文档，让 `notes/` 只剩真正还需要的东西。

已识别的过期项（各自都有 evidence 覆盖）：

- `73-execution.md`（自称开工入口、旧测试数、失效模块路径）、`73-boundary.md`（失效路径 `backend/bundle`、已删的 `projection/history/activity.mjs`）、`73-row-plan.md`（已完成的行拆分计划，指向已删除的对象）、`73-review-findings.md`（旧拓扑 + 旧数字）
- `spec71-boundary.md`（旧组合 `rikkahub 2d97ed14`，且工作树里已有一份内容不同的副本）
- `stage-24-27-handoff.md`、`stage-t5-t6-handoff.md`、`stage-t7-t9-{handoff,plan}.md`、`stage-t10-t12-handoff.md`、`stage-t13-t15-{handoff,plan}.md`、`stage-t16-t19-handoff.md`、`t15-notifications-handoff.md`

两份调研性质的（`client-access-seams.md`、`dsh-ownership-seams.md`）不是协调文档，是 2026-10-14 的调查记录：移入 `docs/research/` 并加日期化状态头（与 #128 一致），不要留在 `notes/`。

**注意**：`notes/` 属冻结档，"删除"是把仍在冒充现行指令的文件移出视野；如果某个文件确有独立价值，保留并加"已过期，现行见 X"状态头，但不得再被任何现行文档当作入口引用。

### 3. 去掉对 `notes/` 的入口指引

`CONVENTIONS.md` 目前让人"上下文压缩后读 `work/implementation/notes/*-handoff.md`"。改为读 `work/implementation/evidence/README.md`（索引）与当前票面。

## Acceptance criteria

- [ ] `CONVENTIONS.md` 不再包含固定票号区间、固定 SHA、缓存大小、已不存在的分支名
- [ ] `CONVENTIONS.md` 的拓扑与来源不再重复 `README.md` / `combo.json` / `docs/research/README.md`
- [ ] `CONVENTIONS.md` 不再指引读者去读 `notes/*-handoff.md`
- [ ] 上述过期协调文档已删除，或已加状态头且不再被任何现行文档引用
- [ ] `client-access-seams.md`、`dsh-ownership-seams.md` 已移入 `docs/research/` 并有日期化状态头
- [ ] `work/implementation/evidence/**` 与 `work/tickets/**` 正文零改动
- [ ] `npm test` 全绿
- [ ] 交付"删除清单 + 保留理由"

## Blocked by

无。#128 建立 `docs/research/README.md` 后，本票的研究基线指针才能落地；两者并行时先写指针、等 #127 合并后确认链接可解析。
