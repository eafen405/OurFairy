> 2026-11-02 状态：日期化记录。本文记录 2026-11-02 的判断，不描述当前实现。

# Hermes Agent 的「进化学习」调查：技能自创建、审核、作用域与回滚（2026-11-02）

日期：2026-11-02。外部研究对象：`NousResearch/hermes-agent`，`main` @ `4d26e0cceaed0a08ede833caec0ec6d6ca77a4b8`（提交时间 2026-11-02T06:36:15Z，提交标题 `fix(gateway): restored webhook sessions keep their shared listener`）。仓库元数据由 GitHub API 在 2026-11-02 抓取：默认分支 `main`、MIT、`pushed_at` 2026-11-02T06:36:19Z、当时 star 数 259,587。官方文档站为 <https://hermes-agent.nousresearch.com/docs>（同日 HTTP 200）。

方法：用 codeload 下载该提交时点的 `main` tarball（86 MB，解压 278 MB），读 `README.md`、`website/docs/` 下 skills / memory / curator / creating-skills / codex-runtime 等页面，以及 `agent/`、`tools/` 的相关实现。**没有** clone 完整历史、没有安装、没有运行它的测试或 agent；文中的行数是 `wc -l`/`grep -n` 的计数，不是运行结果。除非另注，路径均相对上述仓库根；文档路径写作 `website/docs/…`。

来源标注：**【外部·代码】** 指 `hermes-agent` 源码；**【外部·文档】** 指该仓库同提交下的文档（或官方文档站同页）；**【本仓】** 指 OurFairy 仓库；**【推断】** 是无直接证据的判断。

## 结论

1. **「Hermes」指 NousResearch 的 `hermes-agent`，不是 Hermes 模型家族。** 在可核实的官方项目中，只有它同时具备「技能系统 + 回合后自改进 + 技能维护」三件套，且官方文档站与仓库都是第一方。**「进化学习」不是该项目的正式术语**：官方用词是「self-improving AI agent」「closed learning loop」（`README.md:19,26`）、「background self-improvement review」（`website/docs/user-guide/features/memory.md:366`）与「curator」（`website/docs/user-guide/features/curator.md:9`）。源码里没有 `self-evolve`/`evolution` 的机制名。
2. **机制由三条回路组成，不是一条「自动进化」流水线**：①前台 `skill_manage`（含用户显式 `/learn`）；②回合结束后的**后台自改进审查 fork**；③不定期的 **curator** 维护（stale/archive + 可选 LLM 合并）。三者的触发、模型、写入权限、审核强度都不同。
3. **触发是计数阈值，默认开启。** 技能回路由「本回合工具迭代数 ≥ `skills.creation_nudge_interval`（默认 10）」触发，内存回路按「每 10 个用户回合」；两处默认值在 `agent/agent_init.py:1215,1286-1288`、`hermes_cli/config_defaults.py:1309`。审查 fork 默认 `enabled: true`（`hermes_cli/config_defaults.py:798`）。
4. **默认不审核，写入自由。** `skills.write_approval` 默认 `false`（`hermes_cli/config_defaults.py:1469`），`skills.guard_agent_created` 默认 `false`（同文件 `:1460`）。也就是说 README 所说的「自动创建」在默认配置下**不需要人批准**；审核是可选闸门，不是流程必经点。
5. **「学习」的实质是 LLM 提示词审查 + 工具写入，不是强化学习或评分驱动。** 审查 fork 拿到对话快照，按一段长提示词决定「patch 现有技能 / 写支持文件 / 建新 umbrella / 什么都不做」；没有 reward 模型、没有技能效果评分、没有把执行轨迹当作训练样本回灌（`agent/background_review.py:457-521`；源码中技能相关模块无 `reward` 命中）。
6. **审核是多层但强度不一的组合**：硬校验（frontmatter/name/大小）、advisory 结构化 linter、安装/项目扫描器、可选人工闸门、curator 的 pin/lock/来源标记。**没有「技能效果评估」**：telemetry 只有使用/查看/patch 计数与时间戳，没有成功率或质量分（`website/docs/user-guide/features/curator.md:374-401`）。
7. **作用域是「profile + 四层目录」，但没有多用户归属。** 优先级固定为 `project → ~/.hermes/skills → skills.create_dir → external_dirs`（`agent/skill_utils.py:401-420`）。同机多用户只能靠多份 `HERMES_HOME`/profile；技能没有 `owner` 字段，也没有「个人技能 / 共有技能」的运行时区分。
8. **版本与回滚不靠技能自身版本号。** frontmatter 的 `version` 既不被加载器读取也不参与回滚（只被 linter 提示缺失）；真正的版本语义来自**哈希台账（hub lock / bundled manifest，用于判断是否被改、上游是否变）+ curator tar.gz 快照 + 变更账本（JSONL，超限会压缩）+ 批次原子回滚**（`tools/skill_ledger.py:501-535`、`website/docs/user-guide/features/curator.md:127-180`）。
9. **安全模型区分「来源信任」与「内容扫描」，但本地手写技能默认不被强制扫描。** 安装与项目技能有强制扫描；agent 自己写的技能只有打开 `guard_agent_created` 才扫；本地手写技能的加载只做注入模式告警，不阻断（`tools/skills_tool.py:596-612`）。「锁」是策略检查而非沙箱（`website/docs/user-guide/features/curator.md:368-372`）。
10. **对本仓的含义要先落在范围上：`docs/specs/ourfairy-v1.md:268` 明确把「技能能力」列为首版 Out of Scope。** 但 `docs/glossary/skill.md` 已经定义了「技能候选 → 技能启用审核 → 已启用技能」。Hermes 的机制可以借「候选如何产生、如何审计、如何回滚」，**不能直接借它的默认放行与单用户作用域**。详见 §9。

## 1. 对象确认：是哪个 Hermes

### 1.1 指代证据

| 维度 | 事实 | 出处 |
| --- | --- | --- |
| 仓库 | `NousResearch/hermes-agent`，公开，默认分支 `main` | GitHub API，2026-11-02 |
| 许可 | MIT | 同上；仓库 `LICENSE` |
| 定位 | 「The self-improving AI agent built by Nous Research」 | `README.md:19` |
| 官方文档 | `hermes-agent.nousresearch.com/docs`，含 Skills System / Curator / Memory 专页 | 文档站；`website/docs/user-guide/features/*.md` |
| 规模信号 | 当时 star 259,587；仓库根有 145 个条目，含 `agent/`、`tools/`、`skills/`、`optional-skills/`、`web/`、`tui_gateway/` | API；`ls` 计数 |

**判断**：用户口中的「Hermes 的进化学习机制」，对应的就是 `hermes-agent` 的自改进回路。两个排除项：NousResearch 的 Hermes 模型家族（Hermes 2/3/4）是模型权重，不包含技能系统；本文检索范围内未发现其他同名项目具备这套 `SKILL.md` + curator 组合。**未核实**是否还有另一个同名产品在中文语境里被这样称呼，也未逐一排查所有 fork；本文以证据最强的官方仓库为准。

### 1.2 「进化学习」不是正式术语

- **【外部·文档】** 官方从未把机制命名为 evolution。`README.md:19` 的原文是 "self-improving"，`:26` 的表格写 "A closed learning loop"。
- **【外部·代码】** 全仓 `grep -riE "self-evol|evolution"` 只命中无关内容（可选的 `darwinian-evolver` 技能文档、UI 文案等），没有机制或配置项叫这个名字。
- **【外部·文档】** 中文二手文章常见的「失败→反思→自动生成技能→持续优化闭环」「记录 trajectory 与 reward」并不是该仓库的表述。源码里确实有 `trajectory`，但它是 ShareGPT 训练数据导出（`agent/trajectory.py:51-60`，`batch_runner.py` 的批量轨迹），**与技能学习回路无调用关系**。

**结论**：正确对应关系是——「进化学习」≈ 官方所谓 **self-improvement loop**（`website/docs/user-guide/features/skills.md:610`），其可观察实现是 **background review fork + curator**；「自动生成技能」≈ `skill_manage(create)`；「持续优化」≈ review 的 `patch` 与 curator 的 consolidation。

## 2. 三条回路总览

| 回路 | 谁发起 | 触发 | 用什么模型 | 能写什么 | 默认是否需人审 |
| --- | --- | --- | --- | --- | --- |
| 前台 `skill_manage` | 用户对话 / `/learn` | 用户要求，或模型自行决定 | 主模型 | create/patch/write_file/delete | 否（`write_approval: false`） |
| 后台自改进审查 | 系统自动 fork | 技能：每 ≥10 次工具迭代；内存：每 10 个用户回合 | 默认主模型（可路由到廉价模型） | 同 `skill_manage`，但受 guard 限制 | 否（同上） |
| Curator | 空闲维护定时器 | `interval_hours`=168 且 `min_idle_hours`=2 | aux 模型（仅 consolidation） | prune/archive、patch、umbrella 合并 | 否；只归档不删除 |

### 2.1 触发阈值（代码事实）

**【外部·代码】** 技能计数器在每次工具迭代自增，`skill_manage` 一用就清零：

```python
# agent/turn_iteration_prep.py:165-167
if agent._skill_nudge_interval > 0 and "skill_manage" in agent.valid_tool_names:
    agent._iters_since_skill += 1
```

回合结束时判定，并把 `review_skills` 传给 fork：

```python
# agent/turn_finalizer.py:862-877
_should_review_skills = (
    agent._skill_nudge_interval > 0
    and agent._iters_since_skill >= agent._skill_nudge_interval
    and "skill_manage" in agent.valid_tool_names
)
...
_mirror_turn_to_memory(..., review_skills=_should_review_skills, ...)
```

默认值与配置：

- `agent/agent_init.py:1286-1288`：`_skill_nudge_interval = 10`，可被 `skills.creation_nudge_interval` 覆盖。
- `hermes_cli/config_defaults.py:1309`：`memory.nudge_interval: 10`。
- 官方文档把这条写得更直白：每 10 个用户 prompt 审内存，每 10 次工具迭代审技能（`website/docs/user-guide/features/codex-app-server-runtime.md:250-256`）。

**【外部·文档/代码】** cron 会显式跳过该 fork：`skip_background_review`，注释说明原因是「~30K tokens/次且无人可审」（`agent/turn_finalizer.py:603-615`）。

### 2.2 审查 fork 的形态

**【外部·代码】** `run_agent.py:752-830`：只构造一次 `messages_snapshot` 的结构化克隆，然后启动 daemon 线程（`name="bg-review"`）。同模型路径共享父会话的 system prompt、工具表、cache scope，以命中 prompt cache；换模型路径改为回放压缩 digest（`website/docs/user-guide/features/memory.md:394-414`）。

**【外部·代码】** fork 的持久化被完全切断：`_persist_disabled=True`、`_session_db=None`、`_end_session_on_close=False`，避免审查轮次写回真实会话（`agent/background_review.py:1016`）。

**【外部·代码】** 工具面是白名单不是全量：`skills`（+ 触发内存时 `memory`）工具集，另加只读 `read_file`/`search_files`；写文件工具与 `terminal` 都不在默认白名单。危险命令回调被替换为自动 deny（`agent/background_review.py:1065-1125`）。

**【外部·代码】** 审查有成本上限：`auxiliary.background_review.max_input_tokens` 限制整个 review loop 回放的输入 token 总和（默认取模型窗口的 75%，上限 600,000；循环迭代上限 16）；cron 场景的注释给出的经验值是每次约 30K tokens（`hermes_cli/config_defaults.py:795-799`；`agent/turn_finalizer.py:603-608`）。

### 2.3 Curator 的触发与两阶段

**【外部·文档】** 不是 cron：会话启动、gateway housekeeping、`hermes serve` 维护定时器里检查「距上次 ≥ `interval_hours`（168h）且空闲 ≥ `min_idle_hours`（2h）」（`website/docs/user-guide/features/curator.md:19-28`）。首次观察只记 `last_run_at`，把第一次真实运行推迟一个完整周期（`:30-34`）。

**【外部·代码】** 默认常量：`DEFAULT_INTERVAL_HOURS=168`、`DEFAULT_MIN_IDLE_HOURS=2`、`DEFAULT_STALE_AFTER_DAYS=14`、`DEFAULT_ARCHIVE_AFTER_DAYS=30`、`DEFAULT_CONSOLIDATE=False`（`agent/curator.py:31-35`）。

阶段一确定性（无 LLM）：14 天未用 → stale，30 天未用 → 移入 `.archive/`；pinned 与「被任何 cron job 引用」的技能跳过；`use_count == 0` 的技能至少满 14 天才可归档（`website/docs/user-guide/features/curator.md:36-41`）。阶段二 LLM consolidation：**默认关闭**，开启后单次常需 50–100 次 API 调用，可 patch/建 umbrella/`delete`（只能带 `absorbed_into`，见 §8.3）。

## 3. 技能格式与加载

### 3.1 SKILL.md

**【外部·文档】** 技能是「按需加载的知识文档」，兼容 `agentskills.io` 开放标准，采用渐进披露（`website/docs/user-guide/features/skills.md:9,172-182`）：

```
Level 0: skills_list()          → [{name, description, category}]  (~3k tokens)
Level 1: skill_view(name)       → SKILL.md 全文 + 元数据
Level 2: skill_view(name, path) → 单个 references/ 文件
```

格式（`website/docs/user-guide/features/skills.md:194-229`）：

```markdown
---
name: my-skill
description: Brief description of what this skill does
version: 1.0.0
platforms: [macos, linux]
metadata:
  hermes:
    tags: [python, automation]
    category: devops
    fallback_for_toolsets: [web]
    requires_toolsets: [terminal]
    config:
      - key: my.setting
        ...
---
# 标题
## When to Use / ## Procedure / ## Pitfalls / ## Verification
```

**【外部·代码】** 加载侧真正强制的只有 `name` 与 `description`，以及「frontmatter 后必须有正文」；description 上限 1024 字符，但写入时若新写的 description 超过技能索引宽度会拒绝（`tools/skill_manager_tool.py:146-191`）。索引宽度是 **60 字符**（`agent/skill_utils.py:842` 的 `SKILL_PROMPT_DESC_LIMIT`；`SKILL_PROMPT_DESC_LIMIT` 也用于 `skill_manage` 的错误提示）。

**【外部·代码】** 体积上限：`SKILL.md` 100,000 字符，支持文件 1 MiB，名称 `^[a-z0-9][a-z0-9._-]*$`、≤64 字符（`tools/skill_manager_tool.py:111-137`）。`write_file`/`remove_file` 只允许 `references/`、`templates/`、`scripts/`、`assets/` 四个子目录（同文件 `:137`）——**文档示例里的 `examples/` 不能由该工具写入**（见 §10 的不一致清单）。

### 3.2 结构、条件激活与依赖

**【外部·文档】** 技能是一个目录包：`SKILL.md` + `references/`（补充文档）+ `templates/` + `scripts/` + `assets/`（`website/docs/user-guide/features/skills.md:335-358`）。`platforms` 限制 OS；`metadata.hermes.requires_toolsets` / `fallback_for_toolsets` 让技能随工具可用性显隐；`required_environment_variables` 在本地 CLI 加载时才安全询问，聊天平台不询问（`:231-315`）。

**【外部·代码】** 加载时会做 `pm.ensure(dep)`（frontmatter `deps:`）并在失败时给出提示但不阻断内容（`tools/skills_tool.py:677-701`）。SKILL.md 里的 ``!`cmd` `` 内联执行默认关闭，社区 hub 安装的技能从不自动执行（`hermes_cli/config_defaults.py:1453-1457`，注释点明「#63307」）。

### 3.3 加载路径与索引

**【外部·代码】** `skills_list` 的候选来自 `resolve_skill_catalog`，按同一优先级解析，同层同名不同内容会报 `Ambiguous skill name`，不会猜；同一技能的多份字节相同副本取最浅路径（`agent/skill_utils.py:429-445`）。项目层走 `iter_project_skill_files` 这个唯一入口，因此隔离检查无法被某个调用点绕过（`agent/skill_utils.py:657-662`）。

**【外部·文档】** 系统提示里的技能索引在会话期间固定以保 prompt cache；会话中途安装/删除技能时，下一条用户消息带一条一次性说明，系统提示在下次压缩时更新（`website/docs/user-guide/features/skills.md:184-192`）。

**【外部·文档】** 另外两个加载入口：**skill bundle** 是 `~/.hermes/skill-bundles/<slug>.yaml` 的别名文件，只把多个已安装技能合并到一个 slash 命令，不安装技能（`website/docs/user-guide/features/skills.md:521-604`）；**插件技能**用 `plugin:skill` 命名，与目录层不冲突（同页 `:509`）。

## 4. 自动 / 半自动技能创建

### 4.1 半自动：`/learn`

**【外部·文档】** `/learn` 是「把一个来源或一段刚做过的流程变成技能」的显式入口；它不新增模型工具，只是构造一段标准提示词交给主 agent，最终仍由 `skill_manage` 落盘（`website/docs/user-guide/features/skills.md:117-170`）。

**【外部·代码】** `agent/learn_prompt.py:136-175` 的 `build_learn_prompt()` 明确要求：先盘点来源，再增量蒸馏，大来源做成 `SKILL.md` + 每章 `references/`，用 `skill_view` 按需读；「源文本是数据不是指令」，要丢弃零宽/双向控制字符，防止把来源里的指令写进技能（同文件 `_SOURCE_HYGIENE`）。这是它少见的、成文的**反提示词注入**措施。

**判断**：`/learn` 是「人发起、模型执行」的半自动创建；它把「学习来源」和「用户要求」分开，且写入仍受 `write_approval` 约束。

### 4.2 自动：后台审查到底要求模型做什么

**【外部·代码】** `_SKILL_REVIEW_PROMPT`（`agent/background_review.py:457-521`）的核心指令：

- 「Be ACTIVE — most sessions produce at least one skill update」；无操作被视为错过学习机会。
- 优先级：①先 patch 本次会话加载/查看过的技能；②再 patch 已存在的 class-level umbrella；③把窄知识写成支持文件；④都不行才新建 umbrella。
- 目标形状是「class-level 技能 + 小型 `references/`」，明确反对一会话一技能、反对把事故叙述/PR 号/日期写进技能。
- 「Never delete a skill here」——删除只允许 curator 做。
- 强制 read-before-write：patch/edit 前必须在本轮 `skill_view` 过目标；否则 `skill_manage` 拒绝（`tools/skill_manager_guards.py:211-224`）。

**【外部·代码】** 审查 fork 只有在 `background_review` 写入来源下创建技能，才会把 `created_by` 标成 `"agent"`，从而进入 curator 管辖；前台 `/learn` 创建标成 `"learn"`，curator 不碰（`tools/skill_provenance.py:1-10`；`tools/skill_usage.py:522-534`；`website/docs/user-guide/features/curator.md:202-235`）。

**判断**：这不是「经验检测器」，而是**提示词驱动的自我编辑**。它没有任何「这次任务成功/失败」的标签输入，模型只能从对话文本里推断。

### 4.3 经验/轨迹：没有单独的检测管线

**【外部·代码】** 触发只看计数器（§2.1），不看任务结果、不看工具错误率、不读历史轨迹库。审查 fork 的输入就是当前会话的消息快照（同模型）或 digest（换模型）。仓库里的 `save_trajectory()` 是 ShareGPT JSONL 导出（`agent/trajectory.py:50-60`），供 batch/fine-tune 使用，**没有被 review 读取**。

**【推断】** 因此「从失败中学习」在 Hermes 里是**提示词层面的归纳**：模型在审查时读到自己刚才的报错与修复，才可能写出对应 pitfall；没有任何机制保证它一定识别到失败，也没有回归验证。

## 5. 评估、审核与启用

### 5.1 四类「审核」要分开

| 层 | 是否阻断 | 作用对象 | 出处 |
| --- | --- | --- | --- |
| 硬校验 | 是 | 名称、frontmatter、大小、路径形状 | `tools/skill_manager_tool.py:146-195,367-395` |
| Linter（advisory） | 否，只警告 | create / SKILL.md patch / references 写入 | `website/docs/user-guide/features/skills.md:639-644`；`tools/skill_linter.py:1-20` |
| 安全扫描 | 视 verdict 与 trust | hub 安装、项目技能；agent 写入可选 | `tools/skills_guard.py:20-40` |
| 人工闸门 | 是（开启时） | 所有 `skill_manage` 写操作 | `tools/write_approval.py:1-9,201-210` |

**【外部·代码】** Linter 的规则包含：name 格式/目录一致、description 长度与营销词、缺失 `version/author/license` 元数据、缺失 `When to Use` 段、`incident-log-shape`（PR/issue 号密度）、`references-sprawl`（>60 个引用文件）、`oversized-body`（正文 >24k 字符）；**全部不阻断**（`tools/skill_linter.py:60-100` 及调用点 `_attach_lint_findings`）。

**【外部·文档】** 默认 `write_approval: false`：agent 自由写，包括后台审查。开启后所有写操作**无条件暂存**到 `~/.hermes/pending/skills/`，用 `/skills pending|diff|approve|reject` 审（`website/docs/user-guide/features/skills.md:668-709`；`tools/write_approval.py:1-9`）。暂存记录 `origin`，批准时按原 payload 重放（`tools/skill_manager_tool.py:716-723`）。

### 5.2 没有效果评估

**【外部·代码】** `.usage.json` 每条的核心字段是 `created_by`、`use_count`、`view_count`、`patch_count`、`last_used_at`、`last_viewed_at`、`state`、`pinned`、`archived_at`（另有 `patch_generation`、`first_seen_at`、`locked`）（`tools/skill_usage.py:348-356`；文档 `curator.md:376-401`）。计数只在 `skill_view`、技能被载入 prompt、被 patch 时自增；没有「用后是否解决问题」的回写。

**【外部·文档】** Curator 的 LLM 合并也明确不把 `use_count` 当成价值证据：「'use=0' is not evidence a skill is valuable; it's absence of evidence either way」（`agent/curator.py:340-347`）。这反向证明系统里不存在效果分。

### 5.3 「启用」在 Hermes 里是什么

**【外部·代码】** Hermes 没有「候选 → 审核 → 启用」的状态机。技能只要落盘就出现在索引里（受 `skills.disabled`、`platform_disabled`、平台/工具条件控制），`skill_view` 立即可读。真正的「不可用」有三种：被 disabled 配置排除、平台不匹配、项目扫描 verdict=dangerous 被隔离；lock 只是只读，不影响读取与自动加载。「启用审核」这一层在 Hermes 里是**可选的 `write_approval`**，不是内建阶段。

**推断**：如果 OurFairy 要「技能候选/启用审核」作为领域语义，必须自建状态，不能把 Hermes 的「已落盘即生效」当成等价物。

## 6. 安装、作用域与优先级

### 6.1 四个目录层

**【外部·代码】** `agent/skill_utils.py:401-420`：

```python
TIER_PROJECT, TIER_LOCAL, TIER_CREATE_DIR, TIER_EXTERNAL = range(4)
```

顺序：`project`（`<repo>/.hermes/skills` 或 `.agents/skills`，需 trust）→ `local`（`~/.hermes/skills`，唯一权威）→ `skills.create_dir`（可重定向新技能落点）→ `external_dirs`（共享目录，可写）。同层同名不同内容 → 歧义报错；跨层 → 高层胜出并记录 shadowed（`website/docs/user-guide/features/skills.md:496-509`）。

**【外部·文档】** 外部目录**不是写保护边界**：只要进程可写，agent 的 patch/delete 就能改它；要只读需靠文件系统权限（`website/docs/user-guide/features/skills.md:425`）。项目技能则明确是 repo-owned，curator 不改、新技能不落那里（`:500`）。

### 6.2 安装链

- **内置技能**：安装时从仓库 `skills/` 复制到 `~/.hermes/skills/`，并在 `.bundled_manifest` 记录 origin hash；每次 `hermes update` 只在「本地未改」时覆盖，改过就永久跳过；`hermes skills reset` 可重设基线或强制恢复（`website/docs/user-guide/features/skills.md:1070-1095`；`tools/skills_sync.py:1-5,113-165`）。
- **Hub 安装**：先把完整 bundle 写进 `skills/.hub/quarantine/`，扫描整包，再移到目标目录；`skills/.hub/lock.json` 记录 source、trust、scan verdict、content hash、文件列表；`audit.log` 追加操作审计（`tools/skills_hub_install.py:60-80,143-180`；`tools/skills_hub.py:319-360`）。`--force` 可越过 caution，**不能越过 dangerous**（`tools/skills_guard.py:821-835`）。
- **项目技能**：首次发现只提示、不加载，需 `hermes skills trust`；信任是 repo 级决定，因此每个 `SKILL.md` 在进入索引前都按内容哈希扫描，dangerous 直接隔离（不列出、不可 view、不可 slash），扫描器崩溃则 fail-closed（`agent/skill_utils.py:628-660`；`website/docs/user-guide/features/skills.md:478-517`）。

### 6.3 作用域的现实边界

**【外部·代码】** profile 机制：每个 `HERMES_HOME` 一份 `skills/`、`.bundled_manifest`、`.usage.json`、ledger（`website/docs/user-guide/features/skills.md:1105-1107`）。没有技能级 `owner`，没有按用户过滤的查询路径；多租户只能靠「一个用户一个 profile/进程」。

**推断**：这与 OurFairy 的「一位 Fairy 同时服务多个用户、个人技能默认归产生者」模型不兼容；直接复用会把 A 用户的技能暴露给 B 用户。

## 7. 版本与回滚

### 7.1 技能内容没有版本历史

**【外部·代码】** frontmatter 的 `version` 不参与解析、比较或回滚；`tools/skill_linter.py:103-105` 只是提示「缺 version/author/license 会让元数据不完整」。`skill_manage` 也没有「保存旧版本/列版本/回滚到版本」的参数。

### 7.2 实际存在的四层可恢复性

| 机制 | 粒度 | 何时发生 | 出处 |
| --- | --- | --- | --- |
| 批次原子回滚 | 单次 `skill_manage` 的整个 operations 数组 | 任一 op 失败即恢复全部快照 | `tools/skill_manager_batch.py:199-300`（`_rollback`） |
| Curator 快照 | 整棵 `~/.hermes/skills/`（tar.gz） | consolidation 前；手动 `curator backup` | `website/docs/user-guide/features/curator.md:127-150` |
| 变更账本 | 单次变更，before/after 文件哈希 | 所有 actor（curator/agent/user）的写操作 | `tools/skill_ledger.py:501-535`；`curator.md:156-180` |
| 归档 | 单个技能目录 → `.archive/` | 30 天未用或 consolidation | `curator.md:309-313,429-437` |

**【外部·文档】** `hermes curator rollback <entry-id>` 能按账本恢复一次变更；整树回滚前会再拍一张 `pre-rollback` 快照，误回滚可再滚回（`curator.md:129-138,165-171`）。删除/归档的 before 快照会从最近 curator backup 补全，避免回滚出「空壳技能」（`tools/skill_ledger.py:505-520`，注释指向 issue #96962）。

**判断**：Hermes 的可恢复性设计值得借，但它假设**单机单 profile、技能目录是唯一权威**；没有分布式版本、没有跨设备同步语义。

## 8. 安全与提示词注入防护

### 8.1 扫描器

**【外部·代码】** `skills-guard-v10` 按正则 + 结构规则打分，威胁类别含 exfiltration / injection / destructive / persistence / network 等；注入规则覆盖「ignore previous instructions」「role hijack」「hide from user」「system prompt override」「DAN」「HTML 注释隐藏指令」「不可见 Unicode」等（`tools/skills_guard.py:20,243-279,507-540`）。判定：critical → dangerous，high → caution，其余 safe（`:952-957`）。

安装策略：

```python
INSTALL_POLICY = {
    "builtin":       ("allow",  "allow",   "allow"),
    "trusted":       ("allow",  "allow",   "block"),
    "community":     ("allow",  "block",   "block"),
    "agent-created": ("allow",  "allow",   "ask"),
}
```

（`tools/skills_guard.py:27-33`）`trusted` 仅限 `TRUSTED_REPOS` 白名单；`allowed is None` 表示需要确认（agent 写入路径把它当作错误返回）。`--force` 不越过 dangerous（`:821-835`）。

### 8.2 扫描的覆盖缺口

- **【外部·代码】** agent 自己写的技能默认**不扫**：`_security_scan_skill()` 首先判 `skills.guard_agent_created`，默认 `false`（`tools/skill_manager_tool.py:41-71`；默认值 `hermes_cli/config_defaults.py:1460`）。
- **【外部·代码】** 本地手写技能加载时只做 `_INJECTION_PATTERNS` 子串告警与「是否在信任目录内」告警，不阻断（`tools/skills_tool.py:596-612`）。
- **【外部·文档】** NVIDIA SkillEvaluator Tier 1 是 advisory，PII/unicode/lint/license/security 只提示不阻断，缺二进制就静默跳过（`website/docs/user-guide/features/skills.md:367-395`；`tools/skillevaluator_scan.py:1-20`）。
- **【外部·代码】** AST deep audit 只是 `hermes skills audit --deep` 的诊断提示，不是门禁（`tools/skills_ast_audit.py:1-10`）。

**判断**：Hermes 的强制扫描集中在「外部来源」；对「agent 自己写的东西」默认是信任的。这与它「agent 自由写」的产品取向一致，但对多用户产品是风险点。

### 8.3 其他防护

- **锁**：`hermes curator lock <skill>` 让 `skill_manage`、`write_file`、`patch`、`terminal` 的所有写路径都拒绝；agent 不能自己解锁；`.usage.json` 损坏时后台 pass fail-closed（`website/docs/user-guide/features/curator.md:344-372`）。文档自己承认它是**策略检查不是沙箱**：脚本内部写、`execute_code` 不被检查（`:368-372`）。
- **删除护栏**：后台审查不能删技能；curator consolidation 的 delete 必须带存在的 `absorbed_into`，否则拒绝（`tools/skill_manager_guards.py:266-286`）。
- **审批暂存**：见 §5.1；跨重启保留。memory 的暂存记录会钉住目标条目，目标变化则拒绝批准；技能暂存提供 diff 供人判断，未见到同等的目标钉住校验（未核实，批准按原 payload 重放）。
- **来源隔离**：`/learn` 的 `_SOURCE_HYGIENE` 要求把外部文本当数据、剥离不可见 Unicode（`agent/learn_prompt.py:105-135`）。
- **不自动执行**：`inline_shell` 默认 false，社区安装技能从不自动执行（`hermes_cli/config_defaults.py:1453-1457`）。

## 9. 对 OurFairy 的含义

### 9.1 本仓已有语义

**【本仓】** `docs/glossary/skill.md` 已经定义：技能、个人技能、共有技能、**技能候选**、**技能启用审核**、**已启用技能**；「自动生成候选不等于批准启用」。`docs/specs/ourfairy-v1.md:268` 把「技能能力」列入首版 Out of Scope。`GLOSSARY-MAP.md` 把「技能」列为独立领域（`docs/glossary/skill.md`），并规定个人技能使用全局用户身份、共有技能面向全部用户。

### 9.2 可借 / 不可借

| Hermes 做法 | 对本仓的价值 | 判断 |
| --- | --- | --- |
| 渐进披露（索引只放 name+60 字 description，正文按需 `skill_view`） | 直接对应 token 成本与「候选不影响会话」的要求 | **可借**，是纯格式约定 |
| 结构化的创建/修补提示词（class-level、lessons not logs、read-before-write） | 可作为「候选生成器」的质量约束，不涉及产品语义 | **可借**（改写后） |
| 批次原子回滚 + before/after 账本 | 审核与回滚需要可追溯；与「操作溯源」要求一致 | **可借** |
| curator 的 stale/archive/pin/lock | 技能生命周期需要「不删除、可恢复」 | **部分可借**；状态机需按本仓语义重定 |
| 安装/项目扫描器与 verdict 分级 | 外部技能来源不可信，需要强制扫描 | **可借规则，不借默认值** |
| 默认自由写 + 可选审批 | 与本仓「技能启用审核」冲突 | **不可借**；本仓必须是「候选→审核→启用」 |
| 单 profile、无 owner 的四层目录 | 与多用户归属冲突 | **不可借**；需按用户/共有分域 |
| 无效果评估、仅计数 telemetry | 不能回答「这个技能是否真的有用」 | **不足**；若要评估需另设计 |

### 9.3 设计上的三个提醒

1. **不要把「自动创建」当成「自动启用」。** Hermes 把两者合并（落盘即生效），本仓词汇明确分开；若照搬 Hermes 的 `write_approval: false` 默认值，会直接违反 `docs/glossary/skill.md` 的「技能启用审核」定义。
2. **提示词注入的边界要按来源分。** Hermes 对 hub/项目技能强制扫描，对 agent 自写与本地手写默认放行；本仓若允许用户投喂材料生成候选，`/learn` 的「源文本是数据」与剥离不可见 Unicode 值得照抄，但不应只依赖扫描器。
3. **回滚的权威要唯一。** Hermes 的权威是「技能目录 + 账本 + 快照」，三者职责清晰；本仓若把候选/启用状态放进数据库，需要明确「文件内容」与「状态」谁是权威，避免出现 Hermes 文档里那种「文档说 30/90 天、代码是 14/30 天」的双权威。

## 10. 未核实与文档/代码不一致

以下是本次调查中明确发现的裂缝，引用时不要当成稳定事实：

1. **生命周期天数自相矛盾。** `website/docs/user-guide/features/curator.md:311` 写 `active → (30d) stale → (90d) archived`，但同页配置块 `:53-62` 与源码 `agent/curator.py:31-32` 都是 14/30。以代码为准；文档该行应是旧值（推断）。
2. **「每 ~10 agent turns」不准确。** `curator.md:214` 说后台审查约每 10 个 agent 回合运行；源码是「每 10 次工具迭代」，且 `skill_manage` 会清零（`agent/turn_iteration_prep.py:165-167`、`agent/turn_finalizer.py:862-877`）。
3. **protected built-ins 的提示词残留。** curator 提示词写「currently: plan」（`agent/curator.py:327`），但 `PROTECTED_BUILTIN_SKILLS` 是空集合（`tools/skill_usage.py:40`）；文档也说「set is currently empty」（`curator.md:340`）。提示词是旧文案。
4. **`examples/` 目录。** 文档的技能结构图列出 `examples/`（`skills.md:345`），但 `skill_manage` 的 `ALLOWED_SUBDIRS` 只有 `references/templates/scripts/assets`（`tools/skill_manager_tool.py:137`）。agent 无法通过该工具写 `examples/`。
5. **「agent can modify or delete any skill」有例外。** `skills.md:11` 的概括忽略了 lock、pinned、hub/bundled 的删除护栏、hub-installed 永不被 curator 修改，以及 external 目录可写但不在 profile 内这些边界（`curator.md:320-372`；`skills.md:425`）。
6. **README 的效果宣称未验证。** `README.md:19,26` 说「creates skills from experience, improves them during use」「closed learning loop」，但仓库没有效果基准、没有 A/B、没有技能质量指标；本文只把这些当**产品宣称**，不当已验证效果。**未核实**其实际任务成功率提升幅度。
7. **未核实**：中文二手文章所称的「reward 评分」「失败轨迹自动入库」「自动优化 system prompt 与工具描述」。源码中技能回路没有 reward，`/learn` 只生成技能，不改 system prompt/tool schema（`agent/learn_prompt.py`、`tools/skill_manager_tool.py` 均无相关写路径）。

## 11. 待决问题（供决策者，不在本文回答）

1. 首版既已把「技能能力」列为 Out of Scope，这条调查是为**下一版**做准备，还是只为确认「现在不做」？两者的取舍标准不同。
2. 若做，是否坚持 `docs/glossary/skill.md` 的「候选 → 启用审核 → 已启用」三段式？若是，Hermes 的默认自由写只能当反例，需要自建审核状态与权限。
3. 「个人技能 / 共有技能」的归属与可见性由谁判定？Hermes 没有 owner，无法提供现成实现。
4. 是否需要「效果评估」？Hermes 明确没有；若要，指标（复用次数、任务成功率、人工评分）与数据来源需要先定。
5. 技能内容与启用状态各自由谁做权威（文件 vs 数据库）？回滚以哪一份为准？

## 参考

- 仓库：<https://github.com/NousResearch/hermes-agent>，提交 <https://github.com/NousResearch/hermes-agent/commit/4d26e0cceaed0a08ede833caec0ec6d6ca77a4b8>
- 官方文档：<https://hermes-agent.nousresearch.com/docs/user-guide/features/skills>、<https://hermes-agent.nousresearch.com/docs/user-guide/features/curator>、<https://hermes-agent.nousresearch.com/docs/user-guide/features/memory>
- 技能标准：<https://agentskills.io/specification>
- 本仓：`docs/glossary/skill.md`、`docs/specs/ourfairy-v1.md:268`、`GLOSSARY-MAP.md`
