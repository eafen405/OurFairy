# 302 · 基线复测与 `complete` 核弹复现

2026-11-03。本文件是 [#302](https://github.com/eafen405/OurFairy/issues/302) 动工前的**基线刷新**：
`work/implementation/evidence/302-persona-context-review/` 下的四份调查基于更早的代码，
本文件把基线对齐到实际动工的分支，并补上原文没有的一项实测。

## 0. 为什么重测

原调查（01/02/03/04 与 HANDOFF）基于本地 `main = 5a1d481`。动工时 `main` 已快进到
`origin/main = 795fb4f`，其间 50 个提交改变了本票要重构的对象本身：

| 变化 | 影响 |
| --- | --- |
| 新增 `ourfairy:skill-trust`（order 4） | system prompt 的第 6 段产品文本；原文「memory-policy 之后直接是英文工具行」的缓冲带结论失效 |
| `MEMORY_POLICY` 456 → **512** 字符 | 新增「可复用的工作流属于技能，由 skill_manage 保存」一句，正是本票要清理的「同一规则两份权威」 |
| 新增 `skill_manage` 工具 | 单条描述 **4 311 字符**，此前最大的是 `memory_add` 940 |

**口径：本节所有数字都在 `795fb4f` 上重新测得，不沿用旧数字。**

## 1. 真实装配（不是读源码推算，是 model double 捕获的实际请求）

做法：真实 profile + 真实 Loader + 产品 launcher，模型端换成记录请求的 double，
分别让主人（shortId=1，即 Phaethon）与代理人（shortId=2）各跑一个真实回合。

### 主人会话

**system prompt = 2 494 字符 / 11 个块**（块 = `renderPrompt` 用 `\n\n` 拼接的产物；
其中第 0–2 块是人设自己的内部空行，故 11 块对应 9 个 section）：

| # | 字符 | section | 来源包 | 语言 |
| --- | --- | --- | --- | --- |
| 0–2 | 47 + 674 + 79 = **804** | `ourfairy:persona` | chat | 中 |
| 3 | 71 | `ourfairy:identity`（短号 1 变体） | chat | 中 |
| 4 | **512** | `ourfairy:memory-policy` | memory | 中 |
| 5 | **219** | `ourfairy:skill-trust` | skill-creator | 中 |
| 6 | 92 | `tool:bash` | dsh | 英 |
| 7 | 126 | `tool:read` | dsh | 英 |
| 8 | 140 | `tool:write` | dsh | 英 |
| 9 | 132 | `tool:edit` | dsh | 英 |
| 10 | 382 | `tool:jobs` | dsh | 英 |

代理人会话 **2 498 字符**，差异仅在 `ourfairy:identity` 为 75 字符变体。

### 与原票的差异（必须替换旧数字）

| 口径 | 旧（`5a1d481`） | 新（`795fb4f`） |
| --- | --- | --- |
| system prompt 段数 | 9 | **11 块 / 9 section**（多了 skill-trust；人设内部 3 块） |
| system prompt 字符 | 2 305 | **2 494**（主人）/ **2 498**（代理人） |
| `memory-policy` | 456 | **512** |
| 产品中文段合计 | 1 335 | **1 606** |
| 「最后一截中文缓冲带」 | memory-policy | **skill-trust** |

### 比票面更严重的一件事：工具描述压过 system prompt

同一请求里声明了 **27 个工具**，描述合计 **10 605 字符**，是 system prompt 的 **4.2 倍**。

| 工具 | 描述字符 | 占工具文本 |
| --- | --- | --- |
| `skill_manage` | **4 311** | 40.7% |
| `memory_add` | 940 | 8.9% |
| `bash` | 795 | 7.5% |
| `memory_search` | 409 | 3.9% |
| `conversation_read` | 393 | 3.7% |
| `memory_edit` | 381 | 3.6% |
| 其余 21 条 | 3 376 | 31.8% |

票面第 1 条说「英文工具段比人设本体还多 68 字符」——那只算了 dsh 的 5 条 **prompt section**（872）。
把**工具描述**算进来，她每一轮读到的指令性文本是人设的 13 倍（10 605 vs 804）。
这不是本票新引入的问题，但它是「被提示词填满」这一动机的真正主项，且票面从未点名。

## 2. `complete` 核弹：真实组合复现

票面第 4 条说「任何插件注册一条 `complete: true` 的 section，`ourfairy:persona` 连同 5 条工具用法会无声消失而 tool schema 仍在」。
原文只有源码级推断，本次做成**实测**。

做法：`backend/chat/test-support/complete-section.ts` 是一个只做一件事的插件 fixture——
注册一条 `complete: true` 的 section；用 `writeOverlay` 把它挂在产品 profile 之上，
跑一个真实主人回合，读 double 捕获的请求。

结果：

```
system prompt = "You are a generic assistant. Answer politely."
chars: 45
persona present:              false
tool-usage sections present:  false
memory policy present:        false
skill trust present:          false
tool schemas still declared:  27
```

**2 494 字符 → 45 字符，四条产品 section 与五条英文工具用法全部消失，27 个工具照旧声明。**
这正是「有工具但不知道怎么用」的最坏组合：模型会调用工具，但没有任何用法说明，
表现为调错而不是报错。产品今天零个 `complete` 是**约定**，不是**机制**。

## 3. 语料基线复算（`results.json`，37 条回复 / 8 298 字符）

可精确复现的：

| 指标 | 值 |
| --- | --- |
| 口癖任意位置命中 | 30/37 |
| 口癖作**首词** | **19/37** |
| 感叹号 | 0/37 |
| `数据显示` / `数据表明` | 20 条 |
| 其中落在零工具调用案例 | **13 条**（chit-chat-no-write 2 / volatile-observation 3 / passing-preference 2 / maintenance-no-rewrite 4 / cross-user-discretion 2） |
| 人设 `主人` / `电费` | 9 / 3 |
| 人设字符数 | **804** |

**复现不出来、必须重定口径的两项**：

1. **助手腔「14/37」**。原文 02 列出的六个 token 是其**出现次数**之和（5+5+2+1+1+1 = 15），
   按回复条数取并集只有 **12/37**；要凑到 14 需额外并入 `已切换`/`已更新` 两个记忆操作词。
   → 本票后续一律使用**可复现定义**：`已记录`/`需要我`/`我可以`/`需要提醒的是`/`我认可`/`建议`
   六词，按回复条数取并集 = **12/37**。
2. **电费「21/37」（票面）/「22/37」（证词）**。`电费` 命中 17 条、`电费|能耗` 18 条；
   只有匹配单字 `电` 才得 22。→ 本票采用 `电费|能耗` = **18/37**。

这两项是**原调查的口径缺陷**，不是产品问题；验收第 6 条若沿用旧数字将无法判定。

## 4. 复现方式

```bash
# 真实装配与工具描述（任意一个 code worktree）
OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node work/tmp/302/measure-prompt.mjs

# complete 核弹
OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node work/tmp/302/nuke-test.mjs
```

两者都依赖 `tests/helpers/` 的 launcher helper，使用 model double，不消耗真实 token。
