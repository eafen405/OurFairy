# #302 上下文工程：权威人格、提示去重与子代理隔离

日期：2026-11-04。范围是提示词与上下文装配，不含自主上网、Android 或数据库结构变化。

## 落地内容

- `backend/chat/src/persona.ts` 的 `FAIRY_PERSONA` 与 `ticket/249-fairy-persona` tip `e152df7669` 逐字一致，采用用户指定的《绝区零》游戏台词提炼版；`ownerIdentity` 统一主人/代理人称呼，runtime 从身份库读取代理人昵称。未带入 #249 的印象只读、Android 或旧规格变更。
- 主会话不再注册 `ourfairy:memory-policy`；写入规则由主会话和维护子会话共同可见的 `memory_add` 描述承载，维护自身保留区间与材料政策。印象仍按 owner 动态注入，编辑协议只留在工具描述，不再包围每轮正文。
- dsh `AssembledSection` 保留 `complete: true` 元数据；chat 在真实 `system-prompt/assemble` waterfall 拒绝用户主会话被 complete 段替换。内部 ownerless/preset 子代理仍可使用 complete。
- 记忆维护、技能检测/审查/深创的自有提示均为 complete，清除工具限制本来不会清除的 bash/jobs 静态指导。检测与深创恢复只由 durable user 消息携带重试句。深创继续逐字复用完整 Skill Creator，同时明确交互式 `skill_manage`/inspect/review/等待用户由主会话执行，后台四工具合同置于最后。

## 提交与组合

| 仓库 | 提交 |
| --- | --- |
| OurFairy 子代理隔离 | `a719344450ee9663d846797a95029b3e1e49f3a8` |
| dsh complete 元数据 | `a1a66c1e2a2cc9c4063ba8e77dbbefaee0db5213` |
| dsh 集成 | `c41af067cf1d5bb94fa89ca42f4cd4f054db4b17` |
| OurFairy 主会话守卫 | `6867d50bd3` |
| OurFairy 人格与提示去重 | `7c692265515c48a8782f96ac4fc715667a7532ad` |
| OurFairy 最终集成 | `255730e936` |

`combo.json` 的 dsh `productCommit` 已锁到 `c41af067cf1d5bb94fa89ca42f4cd4f054db4b17`。

## 实际验证

| 命令/接缝 | 结果 |
| --- | --- |
| `node --test tests/memory-impression.test.mjs tests/memory-policy.test.mjs`（改动前基线） | 6/6；确认印象本人注入、跨用户隔离与下一轮更新原本就已实现 |
| dsh `system-prompt.spec.ts`（worktree 配置与源码，复用主 checkout Vitest） | 1 file / 58 tests 全过；waterfall 可见 complete，最终仍恢复唯一完整段 |
| dsh `corepack pnpm@11.28.5 run build:lib:host`（集成提交） | 通过 |
| 子代理分支相关测试 | 22/22；加强完整 Skill Creator 正文断言后 skill-learning 16/16；其提交钩子 related gate 156/156 |
| `node --test tests/prompt-guard.test.mjs` | 3/3；普通主会话、complete 拒绝、内部子代理完整提示 |
| 人格/去重分支最终提交钩子 | related gate 214/214，`combo:verify` 三行 ok |
| 最终 OurFairy 合并 `255730e936` 的 pre-merge 钩子 | `npm test` 602/602，`combo:verify` 三行 ok |

一次守卫提交因隔离 HOME 中 corepack 下载 pnpm 超时未完成；使用已有 `COREPACK_HOME=/home/eafen405/.cache/node/corepack` 缓存后，同一改动完整钩子 602/602 通过。该失败不计为代码失败，也不掩盖首次结果。

dsh 票分支提交时相关 Vitest 已通过，但其本地 pre-commit 因 `lefthook` 不在 PATH 未完整执行；没有使用 `--no-verify`。随后 dsh 集成分支的 pre-merge 钩子与 `build:lib:host` 已执行。未运行 dsh 全量测试或覆盖率门禁。

## 未执行与后续边界

- 当前会话 `MINIMAX_CN_API_KEY` 未设置；未运行 `acceptance:memory`，也未运行 #249 的真实 persona 采样。因此本轮只证明装配、工具面与确定性行为，不声称真实模型语义、37 条人格语料或记忆质量已经复验。
- #249 分支已有的真实人格验收是该文本的历史证据，不等于当前组合复验。
- #302 的完整段名/来源包/字符数自动清单、真实风格改善比例仍未交付；本批不关闭整票。
- 深创失败重试上限、原生 bash/jobs 的通用 scope-aware 文案、联网能力和 Android 均不在本批。
