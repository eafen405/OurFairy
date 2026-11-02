> 2026-11-02 状态：日期化记录。本文记录 2026-11-02 的判断，不描述当前实现。

# 可安装 Skill、创建器与经验提取：四家一手来源的对照（2026-11-02）

日期：2026-11-02。本文只回答一个问题：**在「可安装 skill / skill 创建器 / 从经验提取工作流」这三件事上，成熟项目各自落地了什么机制**，尤其是比「按回合阈值让模型自由创建并启用」更强的门。文中的事实一律带出处；判断一律标【推断】。下文把 Anthropic Agent Skills 规范、Claude Code、dsh、Voyager 合称「这几家」；规范与 Claude Code 同源，§5 的表里并作一列。

## 研究基线

| 对象 | 固定点 | 说明 |
| --- | --- | --- |
| Anthropic skills 仓库 | `anthropics/skills` @ `ca45fc496a3436251f191354091d557da31c15b5`（2026-10-28T19:20:38Z，`Update mcp-builder skill: teach v2 of the MCP TypeScript SDK (#2087)`） | 只读该 commit 的 raw 文件；`skills/skill-creator/SKILL.md` 33,168 字节 / 485 行 |
| Agent Skills 规范 | <https://agentskills.io/specification>，抓取于 2026-11-02 | **页面无版本号、无 commit 锚**，只能按抓取日期引用；视为「未固定」 |
| Claude Code 文档 | `code.claude.com` 的 `skills.md`、`plugins/install.md`、`plugins/security.md`，抓取于 2026-11-02 | 文档站同样无 commit 锚；同样按抓取日期引用 |
| Anthropic 工程文章 | <https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills>，2025-10-16 | 官方对 skill 生命周期与安全边界的自述 |
| dsh | 本机检出 `/home/eafen405/projects/deepseek-harness`，HEAD `d80522d276dd5a839a2b5ea8afcc78af898b6688` | 与 [`combo.json`](../../combo.json) 的 `repos.dsh.productCommit` 一致 |
| Voyager | `MineDojo/Voyager` @ `55e45a880755d0c8c66ca7fb5fe7962ac8974f89`（2023-07-27，仓库最后一个提交） | 唯一一套把「经验→技能库→检索复用」闭环写完的公开实现 |

方法：`curl` 取固定 commit 的 raw 文件与 GitHub API；本地只读 `packages/skill/*`、`docs/subsystems/skills.md`、`.agents/notes` 相关条目、`packages/boot/plugin-manager/README.md`。**没有**安装、运行、评测任何 skill 或插件；文中所有数字是文件字节数、行数与文档原文，不是运行结果。`platform.claude.com`（原 `docs.claude.com` 目标页）在本次网络下返回「App unavailable」区域限制，相关页面未读，见 §7。

## 结论

1. **这几家里没有任何一家是「按回合阈值由模型自由创建并启用」。** Anthropic 公开的实现是人在环的作者工具（`skill-creator`）；Claude Code 与 dsh 都把「技能从哪来」交给文件位置与装配层（§2.1、§3.2）；唯一自动化写库的 Voyager 靠独立 critic 判定任务成功（§4）。
2. **Anthropic 明确把「agent 自己创建、编辑、评估 skill」放在未来。** 工程文章的未来段原文是「we hope to enable agents to create, edit, and evaluate Skills on their own」；2025-10-16 至今已发布的是人触发、人评审的 `skill-creator`（§1.3）。
3. **`skill-creator` 的门槛不是回合数，是「带技能 vs 不带技能」的 A/B 加人评审。** 每个测试用例同时起 with-skill 与 baseline 两个子代理、断言逐条评分、HTML view 让用户逐条留反馈，反馈落到 `feedback.json` 再进入下一轮（§1.3）。
4. **description 被当成可优化对象，而不是随手写的元数据。** `skill-creator` 生成 20 条 should-trigger / should-not-trigger 查询，按 60/40 分训练与留出、每条跑 3 次取触发率、最多 5 轮，并用**留出分**而不是训练分选 `best_description`（§1.3）。
5. **「安装」与「启用」在 Claude Code 和 dsh 里是两步，且都给了装后的显式启用动作。** dsh 的引导安装以 `enabled: false` 落地、完成屏再给 **Enable now**；Claude Code 的插件可声明 `defaultEnabled: false`，技能还有四态可见性（`on`/`name-only`/`user-invocable-only`/`off`）（§2.2、§3.5）。
6. **两家市场都没有签名机制，靠的是「来源分层 + 版本固定 + 完整性校验 + 装前告示」。** Claude Code 保留官方/社区市场名只在 `github.com/anthropics/` 源上生效、社区目录钉 commit、归档源可钉 `sha256`；dsh 用 `engines.dsh` 兼容门在下载前拒绝，安装本身要 `danger-full-access` 或逐次审批，并展示来源（§2.3、§3.5）。
7. **权限声明不是市场格式能解决的问题。** Claude Code 的 `allowed-tools` 是技能**给自己**授权，官方文档直接写「workspace trust 不拦这个字段，仓库里的技能可以给自己开宽权限，先读再跑」；dsh 的插件 manifest 没有任何权限字段，装上的宿主代码在进程内、工作区沙箱之外运行（§2.3、§3.5）。
8. **作用域在两家都是「位置即作用域」，不是使用频率。** dsh 是默认 5 个根（秩 100–500）加一个可选的 bundled 根（600），最近层遮蔽；Claude Code 是六级位置加固定优先级（企业>个人>项目；插件启用 local>project>user）。真正把「复用频次」做成可见信号的只有 Claude Code 的 `/skill-doctor`：报每个技能占多少上下文、被用过几次、哪些从未被调用（§2.4、§3.2）。
9. **dsh 侧可直接复用的是三个已实现的接缝，不是它的市场。** 文件根与秩（`skill-filesystem`）、双向 invocation policy（`modelInvocable`/`userInvocable`，解析 fail-closed）、catalog 的 digest 追加替换消息（`tool-skill`）。这三条不依赖我们目前禁止的运行时插件安装（§3）。
10. **对本仓而言，任何采纳都是新决议，不是接线。** 现行规格把「skill 系统的实现，以及工作流经验的自动学习」列为 Out of Scope（[`docs/specs/fairy-memory.md:217`](../specs/fairy-memory.md)），`skill`/`skill-filesystem`/`tool-skill` 三行在禁止清单（[`tests/baseline-boot.test.mjs:63-65`](../../tests/baseline-boot.test.mjs)），运行时插件安装/启停被生态边界挡在范围外（[`docs/architecture/dsh-ecosystem-boundary.md:188`](../architecture/dsh-ecosystem-boundary.md)）。

## 1 Anthropic Agent Skills 与 skill-creator

### 1.1 格式：两个必填字段，六个规范字段

【事实】Agent Skills 规范的目录结构与 frontmatter 约束（<https://agentskills.io/specification>，2026-11-02）：

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `name` | 是 | ≤64 字符，仅小写字母、数字、连字符；不得以连字符开头/结尾；不得有连续连字符；**必须与父目录同名** |
| `description` | 是 | ≤1024 字符，非空，写清「做什么 + 何时用」 |
| `license` | 否 | 许可证名或指向技能内许可证文件 |
| `compatibility` | 否 | ≤500 字符，环境要求（目标产品、系统包、网络等） |
| `metadata` | 否 | 任意 string→string 映射 |
| `allowed-tools` | 否 | 空格分隔的预授权工具列表，**标注为 Experimental** |

【事实】`name`/`description` 在启动时预载进系统提示；正文是第二级、`scripts/` `references/` `assets/` 是第三级，按需读取（工程文章「The anatomy of a skill」段）。规范把预算写成：metadata ~100 tokens 常驻、正文建议 <5000 tokens、资源按需、`SKILL.md` <500 行（specification「Progressive disclosure」）。

【事实】Claude Code 只接受规范六字段用于**上传/打包路径**，多一个字段就是硬错误：`Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools, compatibility, description, license, metadata, name`（`code.claude.com/docs/en/skills.md`，「Using skill frontmatter outside Claude Code」）。规范之外的键——`disable-model-invocation`、`user-invocable`、`disallowed-tools`、`context: fork`、`paths`、`hooks` 等——都是 **Claude Code 自己的扩展**，只在本机/插件路径生效。

【推断】这条「宿主扩展 vs 规范字段」的分界，正是 dsh 的 `skill-filesystem` 只认 `disable-model-invocation` 与 `user-invocable` 两个键的原因：它们要的是 Claude 兼容表面，而不是 Claude Code 的全部扩展（对照 §3.3）。

### 1.2 触发：description 是唯一路由字段

【事实】Claude Code 把 `description` 与 `when_to_use` 合并后**在技能列表里按 1,536 字符截断**；`description` 缺省时取正文第一非空行（`skills.md`「Frontmatter reference」）。dsh 的对应约束是 `catalogDescriptionMaxLength` 默认 500（`packages/skill/tool-skill/src/index.ts:28,69`）。

【事实】`skill-creator` 解释触发为何难：技能以 name+description 出现在 `available_skills` 列表里，而「Claude 只在任务自己不容易直接完成时才去查技能」，所以「读这个 PDF」这种一步任务再准的描述也不会触发（`SKILL.md:396-400`）。它因此建议把 description 写得「a little bit pushy」，因为模型倾向于 **undertrigger**（`SKILL.md:67`）。

【推断】这解释了为什么「让模型自己判断该不该把经验存成技能」比「让模型判断该不该用技能」更难：前者没有可观察的失败信号，后者至少有用户的下一条消息。

### 1.3 skill-creator：一个有人在环的作者流程

【事实】`skill-creator` 本身就是一个 skill（frontmatter 只有 `name` + `description`，`SKILL.md:1-4`），流程是（`SKILL.md:10-28`）：

1. 定清「技能做什么、大概怎么做」；
2. 写草稿；
3. 造 2–3 条真实测试 prompt，跑「带技能」与「不带技能」；
4. 让用户定性 + 定量评估（后台跑的同时草拟断言；用 `eval-viewer/generate_review.py` 出报告）；
5. 按反馈改技能；
6. 重复，最后扩大测试集；收尾可再跑 description 优化器。

【事实】可核查的落盘约定：

| 产物 | 位置/格式 | 出处 |
| --- | --- | --- |
| 测试用例 | `<skill>/evals/evals.json`：`skill_name` + `evals[]`（`id`/`prompt`/`expected_output`/`files`，断言后加） | `SKILL.md:141-161` |
| 每轮结果 | `<skill>-workspace/iteration-<N>/eval-<ID>/{with_skill,without_skill}/outputs`（改进已有技能时基线目录为 `old_skill`） | `SKILL.md:167,180-186` |
| 基线 | 新建技能时 baseline = 无技能；改进已有技能时先把旧版 `cp -r` 快照，baseline 指快照 | `SKILL.md:186` |
| 评分 | `grading.json`，字段固定为 `text`/`passed`/`evidence`（viewer 依赖） | `SKILL.md:225` |
| 基准 | `python -m scripts.aggregate_benchmark` → `benchmark.json`/`.md`：pass_rate、时间、token 的均值±标准差与增量 | `SKILL.md:227-232` |
| 用户反馈 | viewer 的 `feedback.json`（`reviews[].feedback`，空 = 满意） | `SKILL.md:269-282` |
| 盲测 | 两个版本输出交给不知情的独立 agent 判优劣（可选，需 subagent） | `SKILL.md:325-329` |

【事实】description 优化是独立子流程（`SKILL.md:333-404`）：

- 生成 **20 条**查询，should-trigger 8–10、should-not-trigger 8–10；负例必须是「近失」（共享关键词但实际该用别的），太离谱的负例不算测试；
- 查询先给用户用 HTML 复核、可编辑、导出；
- `python -m scripts.run_loop --max-iterations 5`：**60% 训练 / 40% 留出**，每条查询**跑 3 次**得触发率，按失败项让模型改描述，每版都在训练与留出上重评；**按留出分选 `best_description` 以避免过拟合**；
- 结果以 before/after 加分数回报用户。

【事实】打包：`python -m scripts.package_skill <skill-dir>` 先跑 `validate_skill`，再把目录压成 `<name>.skill`（**zip**），排除 `__pycache__`、`node_modules`、`*.pyc`、`.DS_Store`，根目录的 `evals/` 不打包（`scripts/package_skill.py:15-39,91-101`）。

【事实】「把对话里的经验变成技能」的入口是**用户开口**：`SKILL.md:49` 原文「The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed.」随后仍要问 4 个问题（做什么、何时触发、输出格式、要不要测试用例）并由用户确认后才往下走（`SKILL.md:51-54`）。

【推断】这是与「回合阈值触发」最直接的对照：Anthropic 的自动化程度停在「从历史里**提取候选答案**」，是否成技能、边界在哪，仍由人回答；模型不拥有「这条经验值得长期保留」的判定权。

### 1.4 安全边界：官方只给「读一遍」

【事实】工程文章的安全段原文建议「只从可信来源安装 skill」，从较不可信来源安装时要**通读技能内打包的文件**，尤其注意代码依赖与图片/脚本资源，以及「指示模型连接潜在不可信外部网络」的内容。文章没有任何签名、验签或权限清单机制。

【事实】Claude Code 里 `allowed-tools` 是技能**自我授权**：它给「调用该技能的那一轮」预授权工具，下一条消息即失效；文档同时写明「一个技能可以给自己开很宽的工具访问，所以运行仓库里检入的技能前先审它的 `allowed-tools`」，且「workspace trust 不 gate 这个字段」（`skills.md`「Pre-approve tools for a skill」）。

【推断】把「技能自带权限声明」当作安全机制是错的：声明只能**扩大**授权，不能证明来源。真正的边界必须由宿主在装配层决定（哪些根可写、哪些行可启），这正是 dsh 的 row/patch 模型在做的事。

## 2 Claude Code：安装、作用域与可见性（市场机制的一手材料）

### 2.1 六级位置即作用域

【事实】技能按存放位置决定加载范围（`skills.md`「Choose where skills load」）：

| 位置 | 路径 | 加载于 |
| --- | --- | --- |
| 企业 | 托管设置目录下的 `.claude/skills/<name>/SKILL.md` | 组织部署的所有机器 |
| 个人 | `~/.claude/skills/<name>/SKILL.md` | 本机所有项目，但不含 Cowork/cloud 会话 |
| 项目 | `.claude/skills/<name>/SKILL.md` | 该仓库会话（提交后团队共享） |
| 嵌套 | `<subdir>/.claude/skills/<name>/SKILL.md` | 在 `<subdir>` 或其下启动的会话；在上层会话中首次触碰该目录文件时才加载 |
| 附加目录 | `--add-dir` 所指目录的 `.claude/skills/` | 该会话 |
| 插件 | `<plugin>/skills/<name>/SKILL.md` | 插件启用处，命令名为 `/plugin-name:skill-name` |

【事实】同名解析是明文优先级：企业 > 个人 > 项目；本地技能可覆盖同名 bundled 命令但不覆盖其别名；插件技能带命名空间因而与本地技能并存；两个附加目录同名时先加者胜、另一个用前缀名（`skills.md`「Resolve skills that share a name」）。

【推断】这是「跨会话复用」的另一种实现：**复用的单位是文件位置**，不是被调用次数。要被所有会话用，就放到个人根；要被一个仓库用，就提交进仓库。没有「因为用过 3 次所以升级为全局」这种路径。

### 2.2 可见性四态：安装/存在 ≠ 对模型可用

【事实】`skillOverrides`（写在 `.claude/settings.local.json`）把每个技能置为四态之一（`skills.md`「Override skill visibility from settings」）：

| 值 | 列给 Claude | 出现在 `/` 菜单 |
| --- | --- | --- |
| `"on"`（缺省） | 名称 + 描述 | 是 |
| `"name-only"` | 仅名称 | 是 |
| `"user-invocable-only"`（菜单里叫 `user-only`） | 隐藏 | 是 |
| `"off"` | 隐藏 | 隐藏 |

`skillOverrides` 只对各处**非插件**技能生效；插件技能要用 `/plugin` 管理。文件里没有的技能按 `"on"` 处理。

【推断】四态比「启用/禁用」多出两档，实用点在于：可以先让它「只对我可见」而不进模型视野，再用几次判断值不值得放开——这就是一种**候选态**，只是由设置文件承担，而不是由模型承担。

### 2.3 插件市场：来源分层 + 版本固定 + 完整性校验

【事实】Claude Code 的插件安全模型（`code.claude.com/docs/en/plugins/security.md`）：

- 插件能做的事被逐项列出：hooks（以完整用户权限跑 shell）、monitors（后台常驻）、mods（在 Claude Code 内跑 JS）、MCP/LSP 服务、把 `bin/` 加进 Bash 的 `PATH`、技能/命令/agent 作为指令进入上下文、以及**自动更新会改掉你审过的文件**。
- 市场名分三层：官方、社区（`claude-community`/`claude-plugins-community`/`healthcare`）、第三方。**官方与社区名只对 `github.com/anthropics/` 源生效**；名不副实时 Claude Code 拒绝加载该市场以及从中装过的插件，错误为 `Marketplace is registered from an untrusted source`。
- 社区目录几乎每个条目钉 commit SHA，Claude Code **拒绝安装不同 commit**。
- 归档源可钉 `sha256`，摘要不匹配则拒绝安装（`Plugin archive integrity check failed`）。
- 安装前统一弹信任告示（原文：`Make sure you trust a plugin before installing, updating, or using it. Anthropic does not control what MCP servers, files, or other software are included in plugins...`），组织可用 `pluginTrustMessage` 追加。
- 安装即启用，**除非** manifest 或市场条目设 `defaultEnabled: false`；此时需 `claude plugin enable <name>` 或 `/plugin` 里手动开。
- 启用作用域三级：user（`~/.claude/settings.json` 的 `enabledPlugins`）、project（`.claude/settings.json`，提交后用者仍需各自 `claude plugin install --scope project`）、local（`.claude/settings.local.json`）；优先级 local > project > user。
- 安装前详情面板给 **Will install** 清单（命令/agent/技能/hooks/MCP/LSP）与官方市场的上下文成本估计；本地或自定义市场可能只显示 `Components will be discovered at installation`。
- 卸载后文件仍在 `~/.claude/plugins/cache/` 保留 14 天再由后台清理；卸载最后一个插件后孤儿目录留到下次安装。

【推断】可迁移的是**分层与固定**，不是签名：名分三层解决「冒充官方」，commit/摘要固定解决「装的和审的不是一份」，`defaultEnabled: false` 解决「装了不等于开了」。三者都能在没有 PKI 的前提下实现，与本仓「个人项目、少量受邀用户」的规模相容。

### 2.4 `/skill-doctor`：把复用频次与上下文成本做成可见信号

【事实】`/skill-doctor` 报告每个技能「占多少上下文、被用得有多频繁」，列出**从未被调用**的技能并说明在哪关掉，同时在 `/plugin` 的 **Stats** 标签里显示；报告不含 bundled 与企业技能；`-p` 非交互模式直接打印文本（`skills.md`「Find unused skills」）。它需要 Claude Code v2.1.252+，且在跳过 feature-flag 抓取的会话里不可用。

【事实】对照 dsh：`packages/skill/*/src/index.ts` 里只有 catalog 变更事件（`skills/change`）与目录快照，**没有任何技能调用计数或使用统计**（grep `usage|invocationCount|stats` 仅命中 `skill-filesystem` 里一段与文件监视相关、含 `stats` 一词的注释）。

【推断】「跨会话复用频次」这条门，这几家里只有 Claude Code 真的做了，而且它是**离线诊断**而不是自动升降级：数据只用来劝人关掉没用的技能。把它做成自动晋升（用满 N 次就全局启用）在这几家里都没有先例。

### 2.5 运行中加载与生命周期

【事实】Claude Code 监视 `~/.claude/skills/`、项目 `.claude/skills/`、`--add-dir` 目录下的技能目录，增删改在当前会话内生效、无需重启；若技能根目录在会话启动时不存在，需要 `/reload-skills` 才发现（`skills.md`「Edit a skill during a session」）。已加载的技能正文作为一条消息留在上下文里，后续轮次**不重读文件**；内容相同再次调用时只加一句「已加载」提示，内容不同才追加全文；自动压缩后按「每个技能保前 5,000 tokens、合计 25,000 tokens」的预算重附加，从最近调用者开始填，老的可能被整个丢弃（`skills.md`「Skill content lifecycle」）。

【推断】「加载后不重读」是刻意的：它让技能正文成为历史事实而不是可变配置，代价是改文件对已加载的那一轮无效。dsh 选了相反的一侧（每次 load 重读正文、正文无版本），两者都不允许「静默改写已发生的上下文」。

## 3 dsh 生态：格式与安装面（不重复 A 线的机制讨论）

### 3.1 三个包的职责切分

【事实】`docs/subsystems/skills.md:5` 把技能家族拆成：Service Definition `dsh-skill`（`ctx.skills` 注册表）、本地 Service Provider `dsh-skill-filesystem`、可选打包 Provider（`dsh-skill-badge`、`dsh-skill-office`、Windows ACL 诊断）、Consumer `dsh-tool-skill`（会话 catalog + `skill` 工具 + `/name` 手势）。注册表按 host+per-scope 分层，读时合并全局层与查看作用域链，**最近层整体遮蔽同名**，同层内按 rank、provider 注册序、provider 内序去重（`docs/subsystems/skills.md:11-13`）。

【事实】注册表没有 TTL：只有 provider 自己调 `invalidate()`、或 runtime 注册/释放才清缓存（`packages/skill/skill/README.md:102`）。Completed catalog 按 cwd/作用域链/revision 缓存，上限 `collectCacheMaxEntries` 默认 128（`packages/skill/skill/src/index.ts:22,358`）。

### 3.2 文件格式与根秩

【事实】一个技能是 `<name>/SKILL.md` 或根下平铺的 `<name>.md`，**不递归**发现嵌套 `**/SKILL.md`；frontmatter 必填 `name`、`description`，可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`（`packages/skill/skill-filesystem/README.md:36`）。

【事实】根按秩扫描（`packages/skill/skill-filesystem/README.md:46-56`）：

| 秩 | 来源 | 路径 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir`（配置时） |

project root 是最近的含 `.git` 祖先；`user-dsh` 跳过 `.system` 子目录。监视只到 depth 1：bundle/平铺 `.md` 的增删与直接 `SKILL.md` 变更会触发一次 provider 失效，`references`/`scripts`/`assets` 下的改动不算 catalog 变更（`:81,113`）。

### 3.3 invocation policy：解析 fail-closed

【事实】`SkillInvocationPolicy` 是两个独立正向布尔（`packages/skill/skill/src/index.ts:49`），四种组合都保留（`README.md:57-62`）。dsh 只认 kebab-case 的 `disable-model-invocation` 与 `user-invocable`；接受 YAML 布尔及大小写不敏感的 `true/false`、`yes/no`、`on/off`、`1/0`；**拼错的键或非布尔值会把整条技能丢弃并告警**，而不是静默按「允许」处理（`skill-filesystem/src/index.ts:1008-1015`，理由见 `.agents/notes/archived/feature/2026-07-28-skill-invocation-policy.md`：「Invocation data fails closed because ignoring it would default to permission」）。

【事实】策略在 consumer 边界执行：`list()` 返回全部胜出摘要而不按表面过滤；`get()` 保持策略中立，供可信内部调用者取任意正文；模型工具与 TUI 各自在 `get()` 前检查、加载后再查一次已加载定义，避免发现与加载之间的策略变更泄漏正文（同上 note）。

【推断】这套「注册表中立 + consumer 各自执行」的分法，正好是「候选与启用分离」需要的地基：同一个技能可以只对人可见、只对模型可见、或两者皆否，而存储层不必知道谁在看。

### 3.4 catalog 生命周期与 body 版本

【事实】`dsh-tool-skill` 在每个 `agent/pre-step` 取当前 catalog，按条目 digest（不是渲染文本）与新近 `skill-catalog` 消息比较；变了就追加一条**完整替换**的用户消息，清空时追加空 catalog 显式退役旧名；provider 观察不完整时**什么都不发**，保留上一份好视图（`packages/skill/tool-skill/README.md:85,114`）。加载正文是普通 tool 结果，正文**不缓存、每次重读**；正文改动不改 catalog digest，也不通知模型，旧结果作为历史事实留下（`skill-filesystem/README.md:42,151`；`tool-skill/README.md:249`）。

【事实】catalog 只渲染 name 与被截断的 description，不含 `whenToUse`、来源、provider 元数据；正文没有大小上限（`tool-skill/README.md:244-245`）。

### 3.5 安装面：市场索引、兼容门、装后再启用

【事实】dsh 的插件市场是**索引文件 + 只读 Host 服务 + 客户端 Discover 页**：索引是静态 JSON，每项带本地化标题/描述、图标、作者、可用版本、兼容性、发布时间；`pluginMarket` 只做读取，永不写 profile（`.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md`；`.../2026-10-02-plugin-market-discover.md`）。

【事实】安装路径的关键约束：

- 索引里的每个条目带 profile 安装状态、由 `evaluatePluginCompatibility` 算出的兼容性与 `install` 参数；Discover **逐条确认来源并给信任告示**，添加索引源（=引入新代码来源）单独一个对话框、单独信任告示；`plugin_market` 工具只读、无需审批，**安装保留 `plugin_manager` 的审批**（同上 Discover note）。
- 引导安装先 `inspect` 再看再装：读 spec、拒掉 pnpm/registry 会拒的写法、拒掉没有 bundle patch 的包，失败/取消把 `package.json` 与 `pnpm-lock.yaml` 还原；**安装以 `enabled: false` 落地，完成屏才给 Enable now**（`.agents/notes/implemented/architecture/2026-09-15-guided-plugin-installation.md`）。
- 每个 `plugin_manager` 工具动作要 `danger-full-access` 或逐次审批；装上的宿主代码**在进程内、工作区沙箱之外**运行；pnpm 构建脚本另有按包名的持久批准（`packages/boot/plugin-manager/README.md:31,64`）。
- `engines.dsh` 不满足时在 pnpm 之前就拒，什么都不下载；git/tarball spec 只能装后判定并回滚。豁免走 `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <v> --accept-risk`，打印风险警告后保存（`README.md:69,75`）。
- 没有升级动作：文档把「升级」定义为「先卸载再安装」，Discover 只把 `update-available` 显示成状态（Discover note「Alternatives considered」）。
- manifest 类型里**没有权限字段**：`DshManifest` 只有 `manifestVersion`/`bundle`/`profile`/`client`（`packages/util/package-manifest/src/types.ts:30-39`），grep `permission` 在该文件无命中；市场索引格式同样无签名/权限字段（grep `signature|permission|trust|provenance` 于索引格式 note 无命中）。

【事实】技能本身没有独立的安装通道：要么是磁盘上的文件（§3.2），要么随插件作为打包资产出现（如 `dsh-skill-badge` 注册一条 `bundled` 候选，CLI 默认把该行声明为 disabled，启用是显式 opt-in，`docs/subsystems/skills.md:79`）。

【推断】dsh 侧真正可用的「安装」语义只有两种：往磁盘根里放文件，或往 bundle 里加行。前者零审批、无来源，后者要过审批与兼容门。对少量受邀用户的产品，前者更现实，但也意味着**来源不可声明**——技能从哪来只能靠我们自己的作用域与审计。

## 4 Voyager：唯一闭环的「经验→技能库」

【事实】Voyager 的技能库是**可执行代码**，不是 Markdown：`SkillManager` 维护 `skills.json`（name → {code, description}）、`skill/code/*.js`、`skill/description/*.txt`，外加 Chroma 向量库，启动时断言向量库条数与 `skills.json` 一致（`voyager/agents/skill.py:28-50`）。

【事实】写入有硬门槛：一轮任务跑完后**只有 `info["success"]` 为真才调用 `add_new_skill`**（`voyager/voyager.py:353-354`）；`success` 来自 `critic_agent.check_task_success`（`:221`），而 critic 支持 `auto`（模型结合环境事件判定）与 `manual`（人判定）两种模式（`voyager/agents/critic.py:116-138`）。

【事实】写入时的去重与覆盖：同名技能**先删向量库条目再覆盖**，只会把新代码另存成 `nameV2.js`、`nameV3.js`，注册表里始终只有一版（`skill.py:71-79`）。写入的 description 是模型对代码再生成的一段注释（`skill.py:102-112`）。

【事实】复用是检索式：按任务查询做 `similarity_search_with_score`，取 `retrieval_top_k`（默认 5）条技能的**代码**拼进 `programs` 提示（`skill.py:52-59,114-127`；`voyager.py:46`）。技能库目录可移植到新世界：`skill_library_dir` 直接加载已有库（`README.md:120-146`）。许可 MIT。

【推断】Voyager 是最接近「自动经验学习」的公开实现，但它的成立条件我们都不具备：单一可判定任务域（Minecraft）、独立 critic 有环境事件可查、技能是代码因而「跑通=对」近似成立、没有多用户与来源问题。它的名字覆盖也说明：**没有人工确认时，重写历史是默认行为**——这正是我们最该避免的一侧。

## 5 机制对照

| 机制 | Anthropic（规范 + Claude Code） | dsh | Voyager | 对本仓的意义【推断】 |
| --- | --- | --- | --- | --- |
| 候选/草稿与启用分离 | `skillOverrides` 四态；插件 `defaultEnabled: false`；安装 ≠ 启用 | invocation policy 双向布尔；插件 install 以 `enabled: false` 落地再 Enable now；打包技能默认 disabled | 无（写库即启用） | 两家都把「存在」与「对模型可见」拆开，且都不交给模型决定 |
| 证据门槛 | A/B + 断言 + 人评审；description 触发率 60/40 留出选优 | 无（只有解析校验） | critic 判定任务成功（auto/manual） | 「成功」必须有独立判定者；回合数不是证据 |
| 跨会话复用频次 | `/skill-doctor` 报使用次数与上下文成本，标从未调用 | 无使用计数（grep 未发现） | 向量检索命中即用，无计数 | 频次在本仓若要成为信号，需要我们自己记 |
| 显式用户触发 | `/name`；`disable-model-invocation` 后可只由人启动；`skill-creator` 由人开口「turn this into a skill」 | `/name` 手势只扫直接用户输入；`user-invocable` 单开一扇门 | 无（全自动） | 「人开口」是两家共同的提取入口 |
| 安装信任 | 市场名分层 + commit pin + sha256 + 信任告示 + Will install 清单；无签名 | 来源展示 + 安装审批 + engines 门 + `--accept-risk` 豁免；无签名、无权限字段 | 无（本地代码） | 无 PKI 也能做的三件事：分层、固定、装后再启用 |
| 权限声明 | `allowed-tools` 是自我授权，文档明说信任门不拦 | manifest 无权限字段，宿主代码进程内运行 | 无 | 不能把权限声明当安全边界；边界在装配层 |
| 作用域与更新回滚 | 六级位置 + 固定优先级；卸载留缓存 14 天；auto-update 会改已审文件 | 5 根 + 秩 + 最近层遮蔽；无升级（卸载再装）；版本豁免需显式 accept-risk | 库目录可整体移植 | 回滚的最小实现是「保留旧文件/旧版本」，不是「运行时撤销」 |
| 运行中加载与渐进披露 | 目录监视 + 已加载正文不重读 + 压缩后按 5k/25k 预算重附加 | 监视 depth 1 + digest 追加替换 + 正文每次重读、无版本 | 无（提示拼接） | 披露分层是共识；「正文是否可热改」必须二选一并写清 |

## 6 对本仓的含义

### 6.1 为什么「回合阈值」是这几家里最弱的一种门

【推断】按回合数触发自动创建，缺的是三样别处都有的东西：

1. **判定者**：Voyager 要 critic、skill-creator 要 baseline + 人评审。回合数只说明聊得久，不说明这一段里有可复用的成功路径。
2. **候选态**：Claude Code 与 dsh 都先把东西放成「存在但对模型不可见」，再看要不要放开。自动创建并直接启用跳过了这一步，等于让模型同时当作者与审批者。
3. **回收**：这几家里只有 Claude Code 有「这个技能从没被用过」的可见信号，而它也只用来劝人关掉。没有回收机制的自动创建，会让 catalog 单调变长，而 catalog 是**每轮都在付 token** 的（`tool-skill/README.md:133`）。

### 6.2 三种可选形状

【推断】按证据强度排序：

- **A. 不做自动创建，只做显式捕获。** 用户说「把这个流程记下来」时，模型把本轮的工具序列、纠正点、输入输出格式整理成草稿文件（`disable-model-invocation: true` 起步），人改名/删减后才放开。对应 Anthropic 的 Capture Intent 与 dsh 的 policy 默认值。证据来源：用户明确要求 + 一次真实成功。
- **B. 自动草稿、人工启用。** 达到某个门槛（回合数、显式纠错次数、工具序列重复出现）后只**写草稿文件**，不进入 catalog；人在设置里看到待审草稿并启用。这需要我们自己补三样 dsh 没有的东西：草稿区、待审列表、使用计数。
- **C. 自动创建并启用。** 这几家里无先例；最接近的 Voyager 靠独立 critic 与单域可判定性成立，且重名直接覆盖。若要走这条，至少要有独立于生成者的成功判定与可回滚的旧版本，这两样都不便宜。

### 6.3 可直接借的三条接缝与一条不能借

【推断】不新增机制、只借 dsh 已有实现：

1. **文件根与秩**（§3.2）：作用域直接映射到「个人 / 项目」两个根，不需要新表。若技能将来要跨会话复用，把文件放进用户根即可。
2. **双向 invocation policy**（§3.3）：草稿态 = `disable-model-invocation: true`，即「存在但只有人能启动」，无需新字段、无需新状态机。
3. **catalog digest 追加替换**（§3.4）：启用/停用技能的可见效果是下一轮 catalog 的一次完整替换，天然可审计，且不动历史 token 前缀。

**不能借**的是 `allowed-tools` 式的自我授权（§1.4）：我们的技能若带脚本，权限必须来自我们的 row 装配与审批，不能由技能自己声明。

### 6.4 与现行规格的边界

【事实】现行规格把 skill 系统实现与工作流经验自动学习列为 Out of Scope（`docs/specs/fairy-memory.md:217`），同时把「可复用工作流程进入 skill」写成记忆归属的一条规则（`:17,144`）——即规格已经假设技能存在，但把实现推后。

【推断】这意味着本文的产出不是「改一行接线」，而是为一次独立决议准备材料：技能归属规则已定，机制未定，且三行技能包当前被禁止（`tests/baseline-boot.test.mjs:63-65`）。任何形状都要先解禁这些行，或另走不经 dsh 技能包的自建路径。

## 7 未核实

1. **`platform.claude.com` 的 Agent Skills 文档页未读**：该域在本次网络下返回「Claude is only available in certain regions」。Claude API 的 `/v1/skills` 版本语义、技能上传的校验规则因此**未核实**，本文凡涉及 API 侧的说法都只引用了 Claude Code 文档里对它的转述。
2. **agentskills.io 与 code.claude.com 无版本锚**：两处都无法固定 commit，只能按 2026-11-02 的抓取内容引用；页面后续变更不会反映在本文。
3. **`skill-creator` 只读了 `SKILL.md` 与 `package_skill.py`**：`scripts/run_loop.py`、`scripts/aggregate_benchmark.py`、`eval-viewer/generate_review.py`、`agents/grader.md` 未读，因此「60/40 切分」「3 次重复」等数字来自 `SKILL.md` 的转述而非实现代码。
4. **没有运行任何评测**：本文不含任何 skill 的实测触发率或收益数字。
5. **dsh 本机 npm 包（`@deepseek-ai/dsh@0.2.1-rc.5`）与 fork HEAD 未逐条比对**：本文的 dsh 事实全部来自 fork 检出 `d80522d2`，不是已发布的 rc.5。
6. **Claude Code 的「同步技能」与 Cowork/cloud 路径只读了文档**：`~/.claude/skills/synced/` 的下载与命名空间规则未在代码层核实（客户端不开源）。
7. **未查 Anthropic 之外的市场实现**（如第三方 skill 注册站）：本文按「不堆砌项目」的要求只取一手的三家上游（Anthropic 系、dsh、Voyager）。

## 8 需要用户决策的问题

1. **门用什么**：接受「显式用户触发」作为唯一入口（A 形），还是允许系统在某个可观测信号（纠错次数、重复工具序列）后只写草稿（B 形）？两者的差别是「要不要新增草稿区与待审列表」。
2. **谁判定成功**：用户确认、还是另起一个判定者（critic 式子会话）？后者要写清判定输入（工具序列 + 用户纠正）与失败时的处理，且比 A 形贵。
3. **草稿放哪**：放进 dsh 技能根（`~/.dsh/skills` 或项目 `.dsh/skills`，零新增机制但草稿会出现在 catalog 里除非设 `disable-model-invocation`），还是我们自己的存储（需要新表、新 API、新 UI）？
4. **启用面**：技能默认对模型可见还是默认只对人可见？这决定「自动产生的东西能不能不经人就被模型调用」。
5. **来源与信任**：既然 dsh 与 Anthropic 都没有签名，我们是否接受「技能只能由本机产生或人工放入」这一边界，并因此不提供任何导入/分享入口？
6. **回滚**：技能改动是否保留旧版本（Claude Code 的 cache 14 天、Voyager 的 V2 文件都是弱形式），还是维持 dsh 的「正文无版本、改了就是改了」？
7. **与记忆的分界**：规格已把「可复用工作流程」划给 skill（`docs/specs/fairy-memory.md:17`），那么「这次学到的偏好」进长期记忆、「这套步骤」进 skill 的判定由谁做——模型的分类、还是写入前的规则校验？这直接决定两条线会不会双写。
