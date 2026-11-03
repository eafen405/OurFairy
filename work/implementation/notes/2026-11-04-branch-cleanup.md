# 分支收尾记录（2026-11-04）

远端分支从 **48 个减到 3 个**。本文记录每个分支的去向与可逆性，供以后复查。

## 一、安全网

**全部 48 个 origin 分支的 tip 都已镜像到本地引用** `refs/backup/cleanup-20261104/origin/<branch>`，
SHA 清单见 `work/tmp/branch-cleanup/backup-refs-20261104.txt`（该目录按 `.gitignore` 不入库）。

即使远端分支删干净、标签也没推，只要本地 `.git` 还在，任何分支都能用
`git update-ref refs/heads/<name> refs/backup/cleanup-20261104/origin/<name>` 复活。

远端保留的痕迹是三个归档标签 `archive/2026-11-04/*`（只覆盖 B 类；A 类不需要，它们的
commit 本来就在 main 的历史里）。

## 二、A 类：已合入 main，直接删除（42 个）

判据：`git merge-base --is-ancestor origin/<branch> origin/main` 全部为真，即 tip 已经是
`origin/main` 的祖先。删除不丢失任何 commit——这些分支的内容本来就在 main 里。

| 前缀 | 数量 | 分支 |
| --- | --- | --- |
| `integration/spec-*` | 25 | 131–137, 182, 205, 223, 229, 233, 240, 250, 256–259, 280, 281, 295 |
| `integration/fixes-*` | 4 | fixes-219-221, fixes-286, fixes-290-291-292, fixes-295-android |
| `ticket/*` | 15 | 219, 220, 221, 224, 230, 231, 232, 234, 235, 236, 239, 251, 252, 253, 254 |
| `fix/*` | 2 | fix/295-adversarial-review, fix/295-android-ux |

完整名单见 `work/tmp/branch-cleanup/a-class-names.txt`。

## 三、B 类：一次性产物，归档后删除（3 个）

删前打了注释标签并推到 origin，标签指向原分支 tip，内容仍可 checkout：

| 原分支 | 归档标签 | tip | 判据 |
| --- | --- | --- | --- |
| `agent/standby-dialog-exit-animation-18434fdb132b` | `archive/2026-11-04/agent-standby-dialog-exit` | `5dd5944` | PR #294 于 2026-11-02 以「superseded by integration/fixes-290-291-292」关闭；main 上 `work/implementation/evidence/291-caption-exit/` 是选定的实现。PR 评论提到「分支留作 superagent 实验记录」——该意图由这个标签承担 |
| `probe/message-ordering-20261025` | `archive/2026-11-04/probe-message-ordering` | `ade0239` | 单文件 100 行诊断探针（`RecoveryOrderingProbe.kt`），从未计划合入，用于复现一次已修复的排序漂移 |
| `prototype/fairy-console-ui` | `archive/2026-11-04/prototype-fairy-console-ui` | `56bc997` | 单次原型探索（589 行 `FairyConsolePrototype.kt`），与 main 的 `FairyConsolePage.kt` 冲突；按 prototype 的性质本就不入库 |

## 四、C 类：需要真正落地（保留）

| 分支 | 状态 |
| --- | --- |
| `integration/spec-225` | 17 commit / +1371 行，落后 main 396。issue #225 已 CLOSED，关闭说明明写「已推送 origin，未合入 main」——真正的孤儿。正在 rebase 落地 |
| `ticket/249-fairy-persona` | 39 文件 / +4127 行，落后 main 288，issue OPEN。与 #302 意图重叠；用户决定 #302 先落地、249 之后在其上重做 |

## 五、本地清理

| 项 | 处理 |
| --- | --- |
| worktree `.worktrees/295-adv-review` | 删除（detached，HEAD `8a54c46` 已合入 main，工作区干净） |
| worktree `.worktrees/295-android-ux` | 删除（HEAD `23ec59c` 已合入 main，工作区干净） |
| worktree `.worktrees/fix-295-review` | 删除（HEAD `ac93251` 已合入 main，工作区干净） |
| worktree `.worktrees/302-persona-final` | **保留**。里面有未提交的 #249 移植尝试（persona.ts 蒸馏稿 + ownerIdentity，且 `tests/chat-append-once.test.mjs` 缩进已乱，说明编辑中断）。已提交为 `07d314a` 保留现场，供 249 重做时参考 |
| 本地分支 `fix/295-adversarial-review`、`fix/295-android-ux` | 删除（两者都已合入 main，且远端分支一并删了） |
| stash `302-wip-local` | 已核对：它加/删的 9 行与当时工作区内容**逐行相同**，是冗余快照，删除 |
| 主工作区未提交产物（2 篇 research、302 与 240 证据目录、`work/tickets/302/`、evidence 索引） | 提交到 `ticket/302-persona-context` 的 `fad0a75`，未丢失 |

## 六、`npm run specs:status` 的变化

清理前：`2 need attention — #225 orphan, #295 stale-worktree`

清理后：`no spec needs attention`（#225 转为 `in-flight`，#295 的遗留 worktree 已清）

## 七、两个原本阻塞的问题已解答

**Q：`combo.json` 的 `localPath` 指向 `/home/eafen405/projects/...`，本机是 `/home/fatfish/...`，
`combo:verify` 报 drift 怎么办？**

A：用环境变量覆盖即可，`scripts/combo.ts:48-51` 支持每仓库一个覆盖变量。本机实测：

```sh
export OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2
npm run combo:verify
```

输出三行全 ok（`ourfairy main ok` / `dsh d80522d276dd5a83 ok` / `android source ok`），
以 `combo: combination verified` 收尾。**不需要** `OURFAIRY_REPO_DIR`——放掉它一样全绿。

同理 `OURFAIRY_DSH_DIR` 也是 `backend:doctor` 与 `npm test` 能跑起来的前提（否则报 checkout missing）。

**Q：#249 声称的 10 类 × 3 次真实模型验收原始 JSON 已不在本机，还能复查吗？**

A：不能。`work/tmp/249-persona/` 在本机不存在，只剩 `work/implementation/evidence/249-fairy-persona/README.md`
里的 SHA-256 摘要与文字描述。这是"不可复查的证据"。重做时必须让原始 JSON 入仓
（`work/implementation/evidence/<票>/` 下），否则 #249 验收第 2 条不成立。

## 八、#249 重做方案

完整方案见 [2026-11-04-249-redo-plan.md](2026-11-04-249-redo-plan.md)（861 行，只读分析产物）。
一页结论：

- 249 的 39 文件：**12 可 cherry-pick、13 必须重写、3 CP+补丁、5 处 249 漏做需要补**
- `scripts/persona-acceptance.ts`（1443 行）+ 测试（618 行）**是 249 最值钱的产物**，改 3 处接口即可复用；
  它补的正是 #302 自己承认补不上的语义验收空缺（302 只 pin `persona.characters === 804`，是字节数不是语义）
- 人格文本：**能力上叠加**（`ownerIdentity()` 302 完全没有，必须加），**文本上替代**（同一常量整体换）
- 与 `spec-225` **会打架**：`chat-read-window.test.mjs` 的 `makeWorld` 被 225 整体搬进
  `tests/helpers/chat-world.mjs`，249 的 `identity` 假件补丁会落在被删除的位置；
  `runtime.ts` 三方各加一行 import，正确解是 `taskAt`(225) + `ownerIdentity`(249) + `installPromptGuard`(302) **三个都留**
- 分 4 批可独立合入；**批 5（人格文本 + 真实模型验收）是唯一会反复的**
