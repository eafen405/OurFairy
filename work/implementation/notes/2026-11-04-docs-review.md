# 文档维护者视角审查（2026-11-04）

审查对象：全仓 Markdown（`git ls-files '*.md'` = 723 个，HEAD = `aa7b0e8`）。
方法论：`writing-for-agents`（context pointer / two loads / information hierarchy / leading words / pruning：negation 是失败模式、sediment）。
用户三条禁令按优先级：**内容漂移 > 无效否定句 > 易过期信息 > 只是复述代码**。

**本文件是一份清单。** 经 Lead 授权，本轮已落地「批次 A」中的 4 项（见 §9），其余待分批；改动范围严格限定在被指派的文件内，未 commit、未 add。

---

## 0. 全仓分层与统计（先给分母，避免把「记录」当「文档」改）

| 层 | 文件数 | 说明 | 本审查的处理 |
| --- | --- | --- | --- |
| `android/.agents/` | 81 | 从 rikkahub 快照原样带入的上游 skill 包（`claude-api`、`gemini-api-dev` 等），`git log -1` = `e151e73 android: import the client snapshot` | **不改**。是 vendored 上游物，英文是其原貌 |
| `work/` | 545 | 其中 `work/tickets/` 203 票面副本、`work/implementation/evidence/` 322 交付证据、`work/wayfinder/` 11 | 不改（历史工作副本与证据） |
| `docs/research/` | 38 | 日期化调查 | 只查漂移，不改（档位规则见 `docs/README.md:16-19`） |
| **durable 文档** | **56** | 根 5 篇 + `docs/`（除 research、archive）20 篇 + `backend/` 的 16 篇 README（含 `attachments/pdf/README.md`；bundled `SKILL.md` 是要注入模型的产品内容，单列在 §1 P2） + `android/`（除 `.agents`）13 篇 + `work/implementation/CONVENTIONS.md` + `work/implementation/evidence/README.md` | **本节全部审查项只针对这 56 篇** |

723 = 81（vendored）+ 545（work）+ 38（research）+ 56（durable）+ 2（`docs/archive/` 历史提案）+ 1（`.github/pull_request_template.md`）。后 3 项不改。
复现口径见 §8。

英文占比实测（CJK 字符 vs 英文词，按目录聚合；脚本见 §8）：

| 桶 | 文件 | CJK | 英文词 | 英文占比 |
| --- | --- | --- | --- | --- |
| `android/.agents` | 81 | 189 | 218,412 | 100% |
| `backend/` 全部 17 篇 md（16 README + bundled `SKILL.md`） | 17 | 7,124 | 16,186 | **69%（durable 层最高）** |
| `work/evidence` | 322 | 275,765 | 146,260 | 35% |
| `work/other` | 20 | 26,476 | 9,014 | 25% |
| `docs/research` | 38 | 132,412 | 45,875 | 26% |
| `android`（除 `.agents`） | 13 | 5,550 | 1,642 | 23% |
| 根（5 篇文档 + PR 模板 + pdf fixture） | 7 | 5,613 | 1,610 | 22% |
| `work/tickets` | 203 | 99,107 | 14,621 | 13% |
| `docs`（除 research/archive） | 20 | 54,604 | 6,303 | 10% |
| `docs/archive` | 2 | 7,023 | 395 | 5% |

**结论先说**：文档层的中文覆盖已经很好（根 22%、`docs` 10%）。真正的语言不统一集中在 **`backend/` 的 17 篇：69% 英文，是 durable 层唯一成片英文的角落**，而它正是实现者与维护者最常读的那一层。

---

## 1. 该译成中文的清单（可执行）

判断口径：**面向本仓库维护者、解释产品决策与接缝的散文**译；**代码标识符、命令、API 名、许可证文本、外部上游材料**不译（`writing-for-agents` 的 pruning：环境是权威，标识符是环境的一部分）。

### P0：整篇英文、且是产品决策载体

| 文件 | 行数 | cjk | 为什么该译 |
| --- | --- | --- | --- |
| `docs/decisions/native-capability-dependencies.md` | 214 | 27 | 这是 `docs/decisions/` 里**唯一一篇英文**。同目录另外 4 篇（`2026-10-22-agent-environment.md`、`frontend-v1-boundary.md`、`upstream-compatibility-calibration.md`、`v1-implementation-route.md`）全是中文，且都带 `> 状态：日期化记录` 头。同一目录两种语言是纯维护成本：读者按目录读会突然换语言，翻译者要判断哪篇是权威 |
| `backend/v1-bundle/README.md` | 110 | 0 | 描述「模型路由从 bundle 初始选择开始，此后归法厄同」这类**产品决策**，不是 API 参考。这条决策的权威表述在 `docs/specs/ourfairy-v1.md:143`（「组合中的初始模型声明与运行时已保存的选择职责不同」）与 `backend/gateway/README.md:28,19`（`selectionApplies` / `applies:"next-turn"`）里，中文语境已有完整表述，英文这份成了第二份权威 |
| `backend/skill-creator/README.md` | 526 | 83 | 全仓最长的包 README，描述创建/审核/验证/学习四层语义。`docs/specs/fairy-skills.md`（391 行中文）讲同一件事。两份权威、两种语言 |

### P1：整篇英文、内容偏「这个 row 是什么」

这些是 40 行以内的短文，改写成本低，收益是让 `backend/` 与 `android/`、`docs/` 语言一致：

- `backend/attachments/README.md`（54 行 / cjk 0）
- `backend/attachments/pdf/README.md`（94 行 / cjk 0）
- `backend/delivery/README.md`（57 行 / cjk 0）
- `backend/groups/README.md`（40 行 / cjk 0）
- `backend/identity/README.md`（59 行 / cjk 0）
- `backend/probe/README.md`（32 行 / cjk 0）
- `backend/search/README.md`（29 行 / cjk 0）
- `backend/sessions/README.md`（101 行 / cjk 0）
- `backend/spaces/README.md`（36 行 / cjk 0）
- `backend/speech/README.md`（35 行 / cjk 0）
- `backend/http/README.md`（70 行 / cjk 0）

### P2：英文但**不建议**整篇译

| 文件 | 理由 |
| --- | --- |
| `backend/memory/README.md`（336 行 / cjk 4） | 长度大、内容为工具契约与维护引擎机制，机翻风险高。建议**只译人类可读的解释段**（"What the row contributes"、"What the Fairy writes" 这类散文），工具表与 schema 描述保留英文——它们与 `backend/memory/src/tools.ts:39-75` 的 `description` 字段逐字对应，改了反而制造不一致 |
| `backend/skill-creator/bundled/skill-creator/SKILL.md`（170 行 / cjk 4） | 这是**产品要注入给模型的技能正文**，其语言由使用场景决定，不是维护者文档。译成中文会改变产品行为 |
| `backend/chat/README.md`（342 行 / cjk 4,810） | 已是中文为主，无需处理 |

### 英文标题但正文中文（低优先，风格统一）

- `GLOSSARY-MAP.md:1,6,14,24`：`# Glossary Map` / `## Contexts` / `## Relationships` / `## Adding a context`。全文中文，只有标题英文。
- `AGENTS.md:32,34,38`：`## Agent skills` / `### Issue tracker` / `### Domain docs`。这是**每轮都进上下文的常驻区**，换中文的收益最直接。
- `backend/memory/README.md:11,45,121,143,166,178,226,241,258,281,307,330` 全部英文小节标题。
- `android/locale-tui/CLAUDE.md`（71 行 / cjk 0）：这是被快照带入的**第三方工具自带**说明（locale-tui 工具的 CLAUDE.md），不是本仓产品文档。建议保留，但在 `android/README.md` 或 `android/AGENTS.md` 里加一句指向，说明它是工具自带。

---

## 2. 无效否定句清单（改写成正面目标）

`writing-for-agents` 的判据：**靠禁止来 steer 会把被禁行为拉进上下文**，且否定是弱修饰、强激活的概念会盖过它。只有「无法正面表述的硬护栏」才配留否定，且必须**同时给出正面目标**。

全量测量（56 篇 durable，5,847 行）：否定 token 共 **238** 处（`grep -oE '(不要|禁止|不得|不能|切勿|避免|不准|不应|绝不|严禁|勿|无需|不必)' | wc -l` 求和）。分布极不均衡——**3 篇 spec 占 123 处（52%）**，`docs/decisions/` 的 5 篇再占 51 处；其余 48 篇合计 64 处。

| 文件 | 否定数 / 行数 |
| --- | --- |
| `docs/specs/fairy-skills.md` | 48 / 391 |
| `docs/specs/ourfairy-v1.md` | 44 / 306 |
| `docs/specs/fairy-memory.md` | 31 / 231 |
| `docs/decisions/frontend-v1-boundary.md` | 28 / 127 |
| `docs/decisions/v1-implementation-route.md` | 15 / 120 |
| `work/implementation/CONVENTIONS.md` | 9 / 125 |
| `backend/chat/README.md` | 7 / 342 |

即：**否定句集中在「规格 + 已废弃的日期化决定」**（123 + 51 = 174 / 238 = 73%），而这两类恰恰是 §2.2 判定「不该动」的部分——规格措辞与验收矩阵、证据引用绑定，日期化决定正文按 `docs/README.md:16-17` 保留原貌。真正进了常驻上下文、又该改的只有 11 处（下表）。

### 2.1 该改的（P0：常驻上下文里的空转否定）

| 位置 | 原文 | 问题 | 改写建议 |
| --- | --- | --- | --- |
| `AGENTS.md:8` | 「新增入口或角色**不默认**另建流程」 | 「不默认 X」需要读者先算出默认值再取反；且真正的目标（复用）在句首已经说了，这半句是 no-op | 删掉尾巴，让「先查现有实现，明确能力、缺口和最小改动」独自承担 |
| `AGENTS.md:11` | 「**避免**重复逻辑和多份权威状态」 | 目标「一份权威」是同条标题「权威唯一」本身；`避免 X` 是 `唯一` 的重复表述 | 保留「复用规则与数据，同一规则只有一份权威；快照及派生数据须明确来源与失效规则」 |
| `AGENTS.md:12` | 「**不默认**改造全局……**不静默**扩展」 | 三连否定，且「静默」是另一个需要定义的词 | 「局部需求改局部；超出原方案时先说明必要性和更小替代方案再动手」 |
| `AGENTS.md:29` | 「**不**每步跑」「**不能**省」 | 前半否定、后半否定夹一个正面要求，读起来像自我辩解 | 「按改动面选测试；全量入口留到收口、合并与交付前跑。最终集成状态覆盖本次涉及的产品面」 |
| `docs/README.md:23` | 「**不要只读** `glossary/`」 | 该行**上一句**已经说了「术语按所在上下文读」，这句是重复 | 删除整句；若怕漏读，把正面指令并入上一句：「术语按所在上下文读，含 `GLOSSARY.md`、`android/GLOSSARY.md` 与 `docs/glossary/`」 |
| `GLOSSARY-MAP.md:4` | 「**避免**把模块内部概念塞进产品词汇表」 | 同文 `:26` 已写「新的独立模块应当新建自己的词汇表并在此登记」——**同一规则写了两遍**，其中一遍是否定式 | 删除 `:4` 的否定句，`:26` 的正面版已足够；两处并存是 `pruning` 意义上的重复权威 |
| `README.md:201` | 「**不要**在本仓库找第二个客户端目录」 | 目标（客户端在 `android/`）在同段已说清；这句是给「曾经有过第二个目录」的读者的补丁 | 删除；保留「客户端在 `android/`，2026-10-20 之前的历史只在归档仓库」 |
| `work/implementation/CONVENTIONS.md:61` | 「`PATH` 上的 pnpm 来自 Windows，**勿用**」 | 已给出正面命令 `corepack pnpm@11.28.5`，否定是补充说明，但它把「Windows pnpm」拉进上下文 | 改为「一律用 `corepack pnpm@11.28.5 <cmd>`；`PATH` 上的 pnpm 是另一套环境」 |
| `work/implementation/CONVENTIONS.md:79` | 「dsh：安装（已装，**勿重复**全量装）」 | 同上 | 「dsh 已装；需要重装时跑这一条」 |
| `work/implementation/CONVENTIONS.md:111` | 「保持稀疏，用**指针**……**不要复述**文档」 | 正面目标（用指针）已经足够；后半是它的重复 | 删除「，不要复述文档」 |
| `android/AGENTS.md:15` | 「**不得**用 `signal` 替换本体动画色」 | 前半句已给正面分工（本体用 `fairyBlue` 家族、仪器用 `signal`）；这条禁令是本条最长的分句 | 「本体动画用 `fairyBlue`/`fairyGlow`/`fairyLink`；`signal` 留给仪器焦点、主按钮与实时状态」 |

### 2.2 不该改的（否定是唯一正解，别动）

- `README.md:169`「任何报告**不得**把研究 SHA 当作已含产品改动」——这是硬护栏（防止虚假交付声明），且无法正面枚举所有报告写法。
- `docs/specs/*` 里的否定绝大多数是**规格约束**（「不能未经审核就影响后续会话」「不能静默截断」），属于产品需求的原文，符合「硬护栏」标准。**建议整批不动**：改规格措辞会和已交付证据、验收矩阵的引用脱节。
- `work/implementation/CONVENTIONS.md:20`「**票未解除阻塞前不要开始实现该票**」——这是流程护栏，正面写法（「等 blocked-by 清零后开始」）等价但更绕；可保留。
- `docs/decisions/` 的 5 篇里 51 处否定（`frontend-v1-boundary.md` 28、`v1-implementation-route.md` 15、`upstream-compatibility-calibration.md` 8）：这些是**日期化记录的正文**，按 `docs/README.md:16-17`「记录某个日期的判断，正文保留原貌」**必须原样保留**。改了就是篡改记录。

### 2.3 一个可复用的判断口径（建议写进 `CONVENTIONS.md` §8 或 `CODING_STANDARDS.md`）

> 文档里出现「不要/不得/不能」时，先写出对应的正面目标。写得出 → 换成正面；写不出 → 它是硬护栏，保留并**在同一句给出正面目标**。

---

## 3. 易过期信息清单（实证）

### 3.1 P0：指向别台机器的绝对路径（**已实测导致命令失败**）

`combo.json` 的 `localPath` 指向本机不存在的路径，这是全仓**最贵**的一条易过期信息：

```console
$ ls -d /home/eafen405
ls: cannot access '/home/eafen405': No such file or directory

$ node scripts/combo.ts verify           # 不加 OURFAIRY_DSH_DIR
row             branch               expected          actual            result
ourfairy        main                 based on main     aa7b0e8e0b5b4f3a  ok
dsh             product/ourfairy-v1  c41af067cf1d5bb9  MISSING           MISMATCH
android source  -                    460109d1b89b824a  460109d1b89b824a  ok
combo: dsh: checkout missing at /home/eafen405/projects/deepseek-harness (override OURFAIRY_DSH_DIR)
combo: 1 drift/missing entry
exit code = 1
```

代码事实（`scripts/combo.ts:105-115`）：`repoPath()` 先读 `OURFAIRY_DSH_DIR` / `OURFAIRY_REPO_DIR`，**两个都没设时才回落到 `combo.json` 的 `localPath`**。所以：

- `repos.dsh.localPath` = `/home/eafen405/projects/deepseek-harness`：`combo.json:14`，**在本机必然 MISSING**，只能靠 env 覆盖。
- `repos.ourfairy.localPath` = `/home/eafen405/projects/OurFairy`：`combo.json:8`，因为 `lock: "integration-branch"` 命中 `isSelfEntry()`（`scripts/combo.ts:101-103`），**实际从不被读**。它是一条纯粹的过期残留，删掉不影响任何行为。

**建议**（二选一，属架构决定，交 Lead / arch-review 定）：

1. 把 `localPath` 从 `combo.json` 移除，改成「路径由 `OURFAIRY_DSH_DIR`/`OURFAIRY_REPO_DIR` 提供，缺省用 `<repo>/../deepseek-harness`」并写进 `README.md`「先决条件」——让环境（env）当唯一权威。
2. 保留字段但改成**相对/可推导**的占位（例如 `../deepseek-harness`），并让 `combo:verify` 的失败信息直接说「设 `OURFAIRY_DSH_DIR`」而不是报一个别人机器上的路径。

顺带：`README.md`「先决条件」表目前只说「路径与锁定提交见 combo.json 的 `repos.dsh`」，**没有提 `OURFAIRY_DSH_DIR` 这个必需的覆盖**。而 `OURFAIRY_DSH_DIR` 在 durable 文档里**一次都没出现**（只有 `docs/research/2026-10-23-*.md` 和 `work/` 下出现过）。这是「查环境查不到的约定」——按 `writing-for-agents`，这正是**该缓存的东西**，建议补进 `README.md` 一行。

### 3.2 P0：写死绝对路径的**常驻**文档

| 位置 | 原文 | 建议 |
| --- | --- | --- |
| `android/AGENTS.md:22-23` | `ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug assembleDebug` | 这是**每一轮 android 工作都会进上下文**的文档，却写死了别台机器路径。改成 `ANDROID_HOME=/path/to/Android/Sdk`（与 `README.md:150` 的 `sdk.dir=/path/to/Android/Sdk` 一致） |
| `work/implementation/CONVENTIONS.md:40-41,44-45,80` | `:40-41` `git -C /home/eafen405/projects/OurFairy worktree add ...`；`:44-45` `git -C /home/eafen405/projects/deepseek-harness worktree add ...`；`:80` `cd /home/eafen405/projects/deepseek-harness && corepack pnpm@11.28.5 install` | 六处绝对路径全改成 `<repo>` / `$OURFAIRY_DSH_DIR`（与 `README.md:150` 用 `/path/to/Android/Sdk` 占位的做法一致）。`:43` 的「# dsh 侧（仅当该票要改 dsh）」措辞仍是**三仓时代**口吻——客户端已并入本仓（`:36` 已写明），建议改成「# dsh 侧（该检出由 `OURFAIRY_DSH_DIR` 或 `combo.json` 的 `repos.dsh` 定位）」 |

`README.md:198` 的 `/home/eafen405/projects/rikkahub` 是**合规的历史引用**（`README.md:197-204` 明确声明「这些记录按原样保留」），且有 `tests/docs.test.mjs:33-35` 的绝对路径豁免兜底。**别动它。**

### 3.3 P1：会随代码漂移的具体数字

| 位置 | 文档声称 | 代码事实 | 状态 |
| --- | --- | --- | --- |
| `docs/architecture/agent-capabilities.md:58-59` | 「用户主会话的模型工具目录仍是 **26** 个工具（含 #297 的 `skill_manage`）」 | `tests/model-double.test.mjs:64-92` 的 `deepEqual` 列表实测 **27** 项 | **已漂**（详见 §5.1） |
| `android/docs/references/fairy-client-runtime.md:35` | 「`app/src/main/java` **86** 个 Kotlin 文件」 | `find android/app/src/main/java -name '*.kt' \| wc -l` = **115** | 有「2026-10-19 的核验数字（日期化记录）」标题保护，**不算漂移**，但它是「数字会腐」的典型样本 |
| `README.md:155-156` | 「构建还使用 build-tools `37.0.0` 与 NDK `28.2.13676358`」 | `android/app/build.gradle.kts` **没有** `ndkVersion`、没有 `buildToolsVersion`、没有 `externalNativeBuild`；`ndk { abiFilters }` 只是 ABI 过滤 | **是别台机器的实测副产物**。这两个版本号会随 AGP 默认值变化而失效，且 NDK 根本没参与构建。建议删掉 NDK/build-tools 的具体版本，只留「`compileSdk` 解析到 `android-37.2`，取值见 `android/app/build.gradle.kts`」 |
| `docs/architecture/dsh-ecosystem-boundary.md:20,72` | 「44 条」 | `tests/route-inventory.test.mjs:99-101` 断言 `ALL.length === 44`，实测通过 | **不漂**（被测试固定）。但同文件 `:3` 的叙述句「`/api` 之外的 44」若将来加路由，测试会先红——这是**好的**易过期信息，保留 |

**已清掉的旧账（供参考，别重新引入）**：`work/tickets/124/README.md:180` 记着「勿误删」三项——`upstream-compatibility-calibration.md:59` 的 `6/6`、`fairy-client-runtime.md` 的 `275`、同文件的 `86/10` 文件数。这些已按「日期化记录」处理，**本次审查确认它们仍在保护之下，不需要动**。

### 3.4 P2：时间敏感的「当前」

- `android/README.md:27`「**当前**没有独立版本清单」、`:37`「**当前**发布通道只提供 arm64 APK」——这两条描述的是产品现状，加了「当前」还算诚实，但会腐。建议改成「本版本没有独立版本清单」「发布通道提供 arm64 APK」，去掉时间副词，让句子只陈述这一版的事实。
- `GLOSSARY.md:89`「（具体功能待开发）」——词汇表里挂 TODO 是 sediment 的经典形态。建议删掉括号内容；`wandering` 的定义本身不依赖它。

---

## 4. 「只是把代码逻辑解释一遍」的段落

判据（`writing-for-agents` pruning）：**环境是权威，读一眼就看得到的不该抄进文档**。要缓存的是「读代码看不出来的：为什么这样选、坑在哪、哪条约定不成文」。

| 位置 | 规模 | 为什么是复述 | 建议 |
| --- | --- | --- | --- |
| `android/README.md:41`（「会话附件」节 = 第 39–47 行，正文 2 段共约 1,660 字，占全篇 60 行的 1/5） | 该节 9 行，其中 `:41` 373 字、`:45` 624 字 | 逐条复述 `RemoteAttachmentDestination.kt` 的分支顺序、`TEXT_PREVIEW_MAX_BYTES`、缓存目录命名、`DeleteCachedPreviewOnDispose`、FileProvider 暴露的子目录。这些代码里都在，且文末自己说「由 6 个测试文件固定」 | 删掉实现分支的枚举，保留三条**读代码看不出**的决定：(1) 为什么外派不套 `createChooser`（chooser 对零目标也解析，「没有接收方」识别不出来，回落另存为就不会发生）；(2) 为什么外派文件交接后不立即删（接收方可能仍在读），以及清扫时机；(3) 为什么普通另存为不读预览缓存（避免二次下载之外的另一种耦合）。其余指向代码与测试 |
| `backend/http/README.md:29-42` | 14 行 | 「Mounting a row's surface」逐句复述 `mountRoutes` 的双向配对检查（重复 path / 有 path 无 handler / 有 handler 无 path 都让 row 加载失败）与 `ctx.effect` 生命周期 | 保留结论一句（「surface 是已挂载集合，先配对再注册，禁用 row 不挂任何东西」）并指向 `src/http.ts`；删掉三条失败情形的逐条复述 |
| `backend/http/README.md:63-70` | 8 行 | 「Where the code lives」复述 `manifest.files` 的取值（`dist/**/*.js`、`dist/**/*.d.ts`）与 subpath 解析 | 这是 `package.json` 一眼可见的事实。保留「源码 `src/`，发布物 `dist/`，profile 装的是编译产物」一句，删具体 glob |
| `backend/memory/README.md:30-38` | 9 行表格 | 七个工具 × 入参 × 成功返回，与 `backend/memory/src/tools.ts:39-75` 的 `description`/schema 同义 | 表格本身有「一眼看全工具面」的价值，**建议保留**，但删掉 `is_private (default normal)` 这类 schema 细节，改为一句「五个记忆工具 + 两个印象工具，入参见 `src/tools.ts`」 |
| `docs/architecture/agent-capabilities.md:34-45` | 12 行 | 「三类判断不能混用」把 `isUserSession(header)`、`shortIdOf(header.owner)`、`MAINTENANCE_PRESET` 三处的调用逐条复述 | **建议保留**——它讲的是「为什么同一个 header 在三个地方问三个不同问题」，这是读代码看不出的设计意图。但它引用的行号（`backend/identity/src/session.ts:28-33`）已随代码变化，见 §5.2 |
| `android/app/src/main/java/me/rerere/rikkahub/ui/fairy/README.md`（12 行 / 英文） | 整篇 | 列 `ui/components/`、`ui/theme/`、`model/FairyPresence` 里有哪些文件——目录列表，`ls` 即可得 | 保留两件有价值的事实：(1) 这是从 Fairybot `095efdd8` 复制并仅改 package/import；(2) 旧对话/状态聚合**刻意不导入**，改由既有共享活动与连接事实供给。删掉文件清单，或改为「复制范围见提交 `e151e73` 的 diff」 |

**反向提醒（防止过度删减）**：`docs/architecture/dsh-ecosystem-boundary.md` 全文 204 行**不可精简**——它每一条都附带「失效即失败的检查」，且 `tests/ecosystem-boundary.test.mjs` 会对账。这是本仓文档的黄金标准，`arch-review` 若提出压缩这篇，应驳回。

---

## 5. 漂移实证（每条都有命令）

### 5.1 【已漂】模型工具数 26 vs 实际 27

```
文档：docs/architecture/agent-capabilities.md:58-59
      "「tests/model-double.test.mjs」：用户主会话的模型工具
       目录仍是 26 个工具（含 #297 的 skill_manage）。"

代码：tests/model-double.test.mjs:64-92 的 assert.deepEqual([...toolNames].sort(), [...])
      实测条目数 = 27
      实际列表 = bash, conversation_read, conversation_search, deliver_message, edit,
                 group_create, groups, impression_edit, impression_read, job_kill,
                 job_list, job_output, memory_add, memory_delete, memory_edit,
                 memory_search, memory_switch, pdf_info, pdf_read_pages, pdf_render_pages,
                 read, read_image, skill, skill_manage, todo_write, working_directory, write
```

**漂移时间线**（`git show <commit>:tests/model-double.test.mjs` 逐版点数）：

| commit | 测试里的工具数 | 文档里的数字 | 关系 |
| --- | --- | --- | --- |
| `71cf1bd`（#279） | 25 | 25 | 一致 |
| `72155e2^`（#297 前） | 26 | 25 | 已脱节（#296 加了 `skill`） |
| `72155e2`（#297） | 27 | 25 | 差 2 |
| `695541c`（同 #297 的后续提交） | 27 | **26**（本行被改） | 差 1 |
| `HEAD` | 27 | 26 | **差 1** |

**根因**：文档在 #297 里**只把 25 抄成 26**（`git log -S "26 个工具"` 唯一命中 `695541c`），而测试在同一批次里从 26 变成 27（`#296` 加 `skill`、`#297` 加 `skill_manage`）。抄写时数错了当前值，且**没有任何检查固定这个数字**（`grep -rn "26" tests/*.test.mjs` 无工具相关命中）。

**修复（推荐）**：删掉「26 个工具」这个数字，改成指向断言本身——
> `tests/model-double.test.mjs` 用一份手写清单固定用户主会话的模型工具目录（新增或误暴露工具即失败）。

理由：数字是 `pruning` 意义上的**缓存**，而它缓存的是一个**一条命令就能查到**的量（列表就在测试里），成本收益不成立。同理，若坚持保留数字，`CODING_STANDARDS.md:7`「声称须可执行」要求给一个会因该数字失效而失败的检查——用 `assert.equal(toolNames.length, 27)` 就能做到，但那又与「清单变化即失败」的 `deepEqual` 重复。**删数字是最省的解法。**

### 5.2 【已漂】`docs/agents/domain.md` 的文件树停在 2 个 ADR、2 个 glossary

```
文档：docs/agents/domain.md:28-44 的目录树（`:38-42` 是过期的文件列举）
      docs/adr/0001-upstream-extension-policy.md
             0002-physical-memory-deletion.md
      docs/glossary/external-senses.md
                    memory.md

实际：ls docs/adr/   → 0001, 0002, 0003-skill-runtime-and-creation-seam,
                        0004-source-tiered-skill-approval   （4 个）
      ls docs/glossary/ → external-senses.md, memory.md, skill.md  （3 个）
```

同一文件的 `:7-9`（「Before exploring, read these」）也只列了两个 glossary，同样漏 `docs/glossary/skill.md`。

**为什么是 P0**：`docs/agents/domain.md` 是 `AGENTS.md:40` 直接指到的**常驻指针**（「See `docs/agents/domain.md`」）。它的正文让 agent「读相关的 glossary」，而清单本身不全 —— 结果是**指针存在但目标集合是残的**，这比没有指针更糟。

**修复**：文件树只保留「单上下文 vs 多上下文的形状」这个**教学用途**，把具体文件名换成占位：
```
├── GLOSSARY-MAP.md          ← one entry per context
├── GLOSSARY.md              ← product-wide vocabulary
├── android/GLOSSARY.md
├── docs/adr/                ← 决策，编号递增
└── docs/glossary/           ← 各上下文的局部词汇
```
具体有哪些文件由 `ls` 回答（环境是权威）。`:7-9` 那句改成「以 `GLOSSARY-MAP.md` 为准，它列出当前的上下文清单」。

### 5.3 【已漂】`docs/README.md` 的 glossary 定位描述缺技能

```
文档：docs/README.md:11
      | `glossary/` | 局部上下文的领域词汇：外部感官与记忆 | 现行 |

实际：docs/glossary/ 有 3 篇 —— external-senses.md、memory.md、skill.md
      （skill.md 由 #295 新增，GLOSSARY-MAP.md:12 已经登记）
```

**修复**：改成「局部上下文的领域词汇（见 `GLOSSARY-MAP.md` 的 Contexts 一节）」，**不列举**。列举在这里是第二份权威，而 `GLOSSARY-MAP.md` 已经是权威。

### 5.4 【已漂】`agent-capabilities.md` 说「除上面两种外还没有第二种 agent 落地」，实际已有第三种

```
文档：docs/architecture/agent-capabilities.md:31-32
      "本文件不列「agent 种类 × 具体工具名」：除上面两种外还没有第二种 agent 落地"

代码：backend/memory/src/maintenance.ts:444
        agentPreset: MAINTENANCE_PRESET           ← 第 1 种（记忆维护子）
      backend/skill-creator/src/deep-creation.ts:389
        agentPreset: SKILL_LEARNING_PRESET        ← 第 3 种（深度创建子）
      backend/skill-creator/src/learning.ts:735,816
        agentPreset: SKILL_LEARNING_PRESET        ← 同名，检测与创建两条路径
```

`SKILL_LEARNING_PRESET = 'ourfairy:skill-learning'`（`backend/skill-creator/src/learning-policy.ts:23`），由 #300 引入（`git log -S "SKILL_LEARNING_PRESET"` 最早命中 `95d6214 feat(#300)`）。文档最后一次改动是 `695541c`（#297），**比 #300 早**，因此这句成了过期断言。

更严重的是 `:25-29` 的表格：「记忆维护子」一行给了具体工具面，「将来的非用户 agent」一行写「空」，而**实际存在的技能学习子有自己的注册面**（`learningChildSetup` 在 `backend/skill-creator/src/learning-child.ts:53-58` 里 `restrict({ allow: [] })` 后自己注册）。表格的二分法已经不成立。

**修复**：把「三种」写实，并让工具面继续指向注册代码（不要抄工具名）：
```
| agent 种类 | 有 owner | 有 parent | 默认工具面 | 谁授权 |
| 用户自己的会话 | 有 | 无 | 产品工具面 | 各产品 row 在 agent 创建时注册 |
| 记忆维护子 | 无 | 有 | memory 注册的记忆工具 | memory |
| 技能学习子 | 无 | 有 | skill-creator 注册的学习工具 | skill-creator |
| 其它非用户 agent | — | — | 空 | 创建者显式授予 |
```
并在正文说明：新增子 agent 时在这里加一行，工具名始终指向各自的 `register`。

### 5.5 【矛盾】JDK 21 vs JDK 17，两篇都在 root 可达路径上

```
README.md:84          「独立的 `android` job 用 JDK 17 在 `android/` 运行 `./gradlew test lintDebug`」
android/README.md:9   「使用 JDK 21 和 Android SDK」
```

**核实**：
- CI 确实是 17：`.github/workflows/check.yml:105` `java-version: '17'`。
- 本地实测用的是 21：`work/implementation/evidence/295-fix-round/README.md:76` 记 Temurin JDK 21.0.13+9，`android/.github/workflows/daily-build.yml:51`（嵌套目录，**GitHub 不读，不生效**）也是 21。
- `android/app/build.gradle.kts` 里**没有 `jvmToolchain`**，只有 `sourceCompatibility/targetCompatibility = VERSION_17`（`:145-146`）与 `jvmTarget = JVM_17`（`:185`）。也就是说 **17 与 21 都能构建**，没有单点权威。

**修复**：两处都改成「**JDK 17 或更高**（CI 用 17，`compileOptions` 目标为 17）」，并把权威指向 `.github/workflows/check.yml` 与 `android/app/build.gradle.kts` 的 `compileOptions`。这是「读代码能查到、但现在两份文档各说一半」的典型 —— 补一句指针就够。

### 5.6 【残留】`CONVENTIONS.md` 仍是三仓写法

```
文档：work/implementation/CONVENTIONS.md:43-46
      "# dsh 侧（仅当该票要改 dsh）
       git -C /home/eafen405/projects/deepseek-harness worktree add ..."

权威：README.md:162  「combo.json 记录当前产品组合：本仓库锁集成分支，dsh 锁提交，客户端记来源提交」
      combo.json    只有 repos.ourfairy、repos.dsh、androidSource（客户端已并入 android/）
```

`:36` 已经写了「客户端已在本仓库内」，但 `:43` 的「# dsh 侧（仅当该票要改 dsh）」仍是三仓时代的口吻。**不是错误**（dsh 确实是外部检出），但和 `:36` 的「两仓」表述并置时读起来像三仓。修法见 §3.2 的同一行（绝对路径与措辞一起改）。

### 5.7 【孤儿】`work/implementation/evidence/293-precommit-merge-index/` 不在证据索引里

```
ls work/implementation/evidence/                 → 196 个目录
work/implementation/evidence/README.md 链接到的   → 194 个
未被索引的                                       → 293-precommit-merge-index、index（index 是生成器的数据目录，正常）
```

`293-precommit-merge-index` 有 README，且被 `290-swipe-nav/README.md:8` 与 `292-tool-collapse/README.md:100` 引用，但**索引里没有**。而 `node scripts/evidence-index.ts --check` 返回 `evidence index is current`（exit 0）——因为生成器**只管 spec 小节**，手写的「Triage 修复」「阶段整合与评审」等表是「byte-for-byte 原样保留」的（`scripts/evidence-index.ts:17-20`）。

**结论**：这不是 bug，是**手写表与生成表的接缝**。建议要么把它补进手写表，要么在 `README.md` 里写明「手写表由人维护，`--check` 只覆盖生成小节」。

---

## 6. 文档入口与指针

### 6.1 指向真实内容（已核）

- 全仓相对链接：**只剩 1 条断裂**，且不在文档里（见下「一个会咬人的接缝」）。
- 56 篇 durable 文档引用的 `tests/*.test.mjs`：**0 条不存在**（全仓含 `work/` 时有 13 个失效测试指针，都在历史票面/证据里，属记录范畴）。
- `docs/research/README.md` 的索引**完整**（38 篇全在表内，含新增的 `2026-11-04-autonomous-web-intake.md`）。
- `android/AGENTS.md`、`android/README.md` 里点名的 Kotlin 文件**全部存在**。

#### 一个会咬人的接缝：`docs.test.mjs` 会扫 gitignored 的 `work/tmp/`

实测（本轮）`node --test tests/docs.test.mjs` **失败**：

```
actual: [ 'work/tmp/303/README.md -> ../../docs/research/2026-11-04-autonomous-web-intake.md' ]
```

两个因素叠加：

1. `tests/docs.test.mjs:18-25` 的 `markdownFiles()` **只跳过点目录与 `node_modules`**，不读 `.gitignore`，因此会扫进 `work/tmp/`。
2. `work/tmp/303/README.md` 是未跟踪草稿（`.gitignore:9` 的 `/work/tmp/` 已忽略它），其中一条相对链接少写了一层：从 `work/tmp/303/` 到仓根需要 `../../../docs/`，它写的是 `../../docs/`。

**为什么这是文档维护问题而不是测试问题**：`CONVENTIONS.md:104` 承诺「`work/tmp/` 只放可丢弃的运行日志与临时输出」。但门禁对它的相对链接有硬要求——**「可丢弃」与「必须格式正确」互相矛盾**。任何人往那里丢一份带相对链接的草稿，全量 `npm test` 就红，且失败信息指向一个不该入库的文件。

**建议**：收口时 `rm -rf work/tmp/*`（`CONVENTIONS.md:57`「收尾即清场」已要求）；根因修复（`markdownFiles()` 排除 gitignored 路径，或至少排除 `work/tmp`）另开一票，不塞进本轮文档批次。

**顺带一条更重要的**：`tests/docs.test.mjs:3-7` 自己声明它「asserts that a referenced file exists — not that the prose around it is still true」。也就是说 **文档内容漂移完全没有机械网**，只有链接可达性。这正是本清单存在的理由，也是为什么 §5 的每条漂移都必须人工核。

### 6.2 重复权威（`pruning` 的 single source of truth 违规）

| 事实 | 有几份 | 建议 |
| --- | --- | --- |
| 路由条数「44」 | `docs/architecture/dsh-ecosystem-boundary.md:20,72` + `tests/route-inventory.test.mjs:100-101` | 已被测试固定，文档只是缓存。**可留**，因为边界文档的价值在于「44 条都在 `/api` 之外」这个判断，数字是它的锚 |
| Android 来源提交 | `combo.json:androidSource.commit` + `android/ourfairy-source.json` | 有意为之（`README.md:166-167` 明确说「这两个文件是唯一的两处来源记录」，且有 `combo:verify` 比对）。**不动** |
| 研究基线 SHA | `docs/research/README.md:15-17` | 单一权威，`README.md:169` 与 `CONVENTIONS.md:31` 都只是**指向**它。**这是范例，应推广** |
| glossary 清单 | `GLOSSARY-MAP.md:8-12`（权威） + `docs/README.md:11`（列举，已漂） + `docs/agents/domain.md:7-9`（列举，已漂）+ 同文件 `:28-44` 的目录树（`:38-42` 已漂） | **3 份列举**，2 份已漂。见 §5.2、§5.3 |
| 模型路由的「初始选择归 bundle，此后归法厄同」 | `backend/v1-bundle/README.md:65-71`（英文） + `docs/specs/ourfairy-v1.md:143` + `backend/gateway/README.md` | 规格那份是权威；`v1-bundle/README.md` 那段在译成中文时应改成**指向**规格，不重述 |
| pnpm 版本 `11.28.5` | `combo.json:backend.pnpmPin` + `README.md:28` + `CONVENTIONS.md:61` + `android/README.md` | 三分文档 + 一份配置。建议 `README.md` 与 `CONVENTIONS.md` 只说「用 corepack 固定的版本（见 `combo.json` 的 `backend.pnpmPin`）」，命令里保留 `corepack pnpm@11.28.5` 这个可复制的字面量（那是**命令**不是**事实**） |

### 6.2b 交叉验证补充（来自 arch-review 与 test-quality）

三处新漂移，均已独立核实：

| 位置 | 文档声称 | 实测 | 备注 |
| --- | --- | --- | --- |
| `docs/architecture/agent-capabilities.md:38-39` | 「search、groups、delivery 在注册工具前调用 `isUserSession`」 | **6 个包 9 个文件**：`chat/prompt-guard.ts`、`delivery/index.ts`、`groups/index.ts`、`memory/index.ts`+`maintenance.ts`、`search/index.ts`、`skill-creator/learning.ts`+`provider.ts`+`tools.ts` | 少列 `chat`、`memory`、`skill-creator`。与工具数 26、agent 种类**同一根因**（#300 后文档未跟上） |
| `tests/route-inventory.test.mjs:146` | 失败信息写「**35** addresses read a JSON object」 | 同一行 `:145` 断言 `json: 41`（另 `binary: 2`、`none: 1`） | 数字写死在失败信息里，与同行的 `41/2/1` 无派生关系。**`assert` 永远抓不到**，且误导发生在最需要看清事实的时刻。修法：失败信息不写数字，只写来源 |
| `docs/architecture/agent-capabilities.md` 整体 | —— | `grep -rn "agent-capabilities" tests/` **零命中**：该文档**没有任何机器校验** | 对比 `dsh-ecosystem-boundary.md` 有两个守卫（`tests/ecosystem-boundary.test.mjs:29-142`、`tests/route-inventory.test.mjs:175-183`）。**守卫强度差一个量级，这正是它能同时漂三处而边界文档一处不漂的原因**——Lead 已决定把它连同守卫做成下一轮的独立票 |

**一条被驳回的候选**（避免下轮重复调查）：`tests/precommit.test.mjs:22-25` 注释「命令不跑」看似与 `:313` 的 `execFileSync` 矛盾，**实际不矛盾**——`:313` 带 `--print`，`scripts/precommit.ts:310,316-318` 打印决策后直接 `return`，一条门禁命令都不执行。同理 `README.md:105,118` 已两处写明 `acceptance:*` 不属于 `npm test` 或 CI；真正的缺口是 **`acceptance:skill` 完全未记**（见下表）。

### 6.3 孤儿与缺口

| 项 | 状态 | 建议 |
| --- | --- | --- |
| `android/README_ZH_CN.md` / `README_ZH_TW.md`（各 3 行） | 内容只有一句「客户端介绍、构建方式與授權條款見 README」，**没有任何文档链接到它们** | 删掉；或让 `android/README.md` 顶部指向它们。三个文件互相指、正文只有一句，是 sediment |
| `android/.github/workflows/daily-build.yml`、`close-blank-issues.yml` | 快照带入，GitHub **不读嵌套 `.github/`**，从未生效（`work/implementation/evidence/123-client-merge/README.md:176` 有记录） | 它们是**能跑的误导**（有人会以为 CI 每天在构建）。建议在 `android/README.md` 加一句「`android/.github/` 是快照带入，平台只读仓库根，不生效」，或直接删除 |
| `android/locale-tui/CLAUDE.md` + `README.md`（71/20 行，全英文） | 第三方工具自带说明，被快照带入 | 保留（工具自带），在 `android/AGENTS.md:30` 已提到 `locale-tui` skill，可补一句「工具自带英文说明在 `android/locale-tui/`」 |
| `android/app/src/perf/assets/presentation/workload.md`（120 行，**虚构的业务文本**） | 是性能基线测试的**夹具**（`RemotePresentationBaselineTest.kt:11` 读它），里面有「责任人周敏（合成人物）」这类合成内容 | **不要当文档改**。建议在文件头加一行「性能夹具，非文档」，防止下一个文档审查者误改 |
| `docs/architecture/agent-capabilities.md` | 只被 `docs/research/2026-11-01-*.md` 引用，**`README.md`/`docs/README.md`/`AGENTS.md` 都不指向它** | 它是「谁默认拿到什么工具面」的唯一权威，应挂进 `AGENTS.md` 的 `### Domain docs` 或 `docs/README.md` 的架构行。见 §6.4 |
| `acceptance:skill` | `package.json` 有（`skill-acceptance.ts`），`README.md`「真实服务验收」只写了 `acceptance:real` 与 `acceptance:memory`，**没有它** | 补一行，或说明「skill 验收见证据 300」。现状是**环境里有、文档查不到**（可执行 acceptance 的门槛没写清） |

### 6.4 一个入口缺口：`AGENTS.md` 的 pointer 缺一条分支

`AGENTS.md:36,40` 目前只有两个 pointer：`docs/agents/issue-tracker.md`、`docs/agents/domain.md`。但仓库里有三个「动手前必须知道」的现行文档：

- `docs/architecture/dsh-ecosystem-boundary.md`（哪个原生接缝**不用**、为什么、什么条件下重估）
- `docs/architecture/agent-capabilities.md`（谁默认拿到什么工具面）
- `CODING_STANDARDS.md`（已在 `:25` 有 pointer）

前两篇现在是**孤儿权威**：写了、被测试对账、但入口不指。按 `writing-for-agents` 的 context pointer，缺这一条是 **variance bug**——某些轮次会遇到、某些轮次不会，取决于模型自己有没有 `ls docs/architecture/`。

**建议**（在 `AGENTS.md` 的 `## Agent skills` 下加一节，或并入 `### Domain docs`）：

```markdown
### 架构边界

改产品路由、原生接缝、工具面或权限判定时读 `docs/architecture/`：
`dsh-ecosystem-boundary.md`（刻意不接的原生接缝与重估条件）、
`agent-capabilities.md`（默认工具面由 header 的三个字段决定）。
两篇都附「失效即失败」的检查清单，改动前先看哪条会因你而红。
```

要点：**先给 leading word（「架构边界」）、再给分支触发条件（改路由/接缝/工具面/权限）、最后给后果（检查会红）**。

---

## 7. 建议的执行顺序（给 Lead 分配写范围用）

按「收益 ÷ 风险」排序，前四项互不冲突可并行：

| 批 | 内容 | 涉及文件 | 风险 |
| --- | --- | --- | --- |
| **A** | 修 4 处已漂 + 1 处矛盾（§5.1–§5.5） | `docs/architecture/agent-capabilities.md`（工具数 26→删数字；第三种 agent）、`docs/agents/domain.md`（文件树去列举）、`docs/README.md`（glossary 不列举）、`README.md:155-156`（删 build-tools/NDK 版本）、`android/README.md:9` + `README.md:84`（JDK 口径） | 低。五处独立小改，**全部不碰测试文件** |
| **B** | 清绝对路径（§3.2） | `android/AGENTS.md`、`work/implementation/CONVENTIONS.md`、`README.md`（补 `OURFAIRY_DSH_DIR` 说明） | 低。但 `combo.json` 的 `localPath` 改动**属架构决定**，建议留给 Lead / arch-review，不要和本文档批次混 |
| **C** | 否定句改写（§2.1，11 处） | `AGENTS.md`、`docs/README.md`、`GLOSSARY-MAP.md`、`README.md`、`CONVENTIONS.md`、`android/AGENTS.md` | 低。逐句替换，改完通读一遍语气 |
| **D** | 删复述代码段落（§4） | `android/README.md:39-47`、`backend/http/README.md:29-42` 与 `:63-70`、`android/app/src/main/java/me/rerere/rikkahub/ui/fairy/README.md` | 中。删减要保住「读代码看不出的决定」 |
| **E** | 英文译中文（§1） | `docs/decisions/native-capability-dependencies.md`（P0）、`backend/{v1-bundle,skill-creator}/README.md`（P0）、11 篇 P1 短 README、`GLOSSARY-MAP.md`+`AGENTS.md` 的英文标题 | 中-高。**建议逐篇译、逐篇提交**，不要一次全译；`backend/skill-creator/README.md`（526 行）单独一批 |
| **F** | 入口与孤儿（§6.3、§6.4） | `AGENTS.md`（加架构边界 pointer）、`android/README.md`、`android/README_ZH_*.md` 删除、`README.md`（补 `acceptance:skill`） | 低 |

**不建议本轮做的**：
- `docs/specs/*` 的否定句（§2.2）：规格措辞与验收矩阵、证据引用绑定，改动收益低、脱节风险高。
- `work/tickets/`、`work/implementation/evidence/`、`docs/research/` 里的旧路径与旧数字：已有「按原样保留」的明确规则，改了反而破坏证据。

---

## 8. 附：本次用到的核查命令（可复现）

```bash
# —— 分母：分桶计数 ——
git ls-files '*.md' | wc -l                                            # 723
git ls-files '*.md' | grep -c '^android/\.agents/'                     # 81
git ls-files '*.md' | grep -c '^work/'                                 # 545
git ls-files '*.md' | grep -c '^docs/research/'                        # 38
git ls-files '*.md' | grep -vE '^(android/\.agents/|work/|docs/research/)' | wc -l   # 59（含 archive 2 + PR 模板 1）

# —— 语言分布：CJK 字符 vs 英文词（python3，按目录聚合）——
python3 - <<'EOF'
import subprocess, re
files = subprocess.run(['git','ls-files','*.md'],capture_output=True,text=True).stdout.split()
cjk = re.compile(r'[\u4e00-\u9fff]')
from collections import defaultdict
b = defaultdict(lambda: [0,0,0])
def bucket(f):
    if f.startswith('android/.agents/'): return 'android/.agents'
    if f.startswith('work/tickets/'): return 'work/tickets'
    if f.startswith('work/implementation/evidence/'): return 'work/evidence'
    if f.startswith('work/'): return 'work/other'
    if f.startswith('docs/research/'): return 'docs/research'
    if f.startswith('docs/archive/'): return 'docs/archive'
    if f.startswith('backend/'): return 'backend'
    if f.startswith('android/'): return 'android (no .agents)'
    if f.startswith('docs/'): return 'docs (no research/archive)'
    return 'root'
for f in files:
    t = open(f, encoding='utf-8').read()
    x = b[bucket(f)]; x[0] += 1; x[1] += len(cjk.findall(t))
    x[2] += len(re.findall(r"[A-Za-z][A-Za-z'-]+", t))
for k, v in sorted(b.items(), key=lambda x: -x[1][2]):
    share = v[2] / (v[1] + v[2]) if v[1] + v[2] else 0
    print(f'{k:28s} {v[0]:5d} {v[1]:8d} {v[2]:8d} {share:7.0%}')
EOF

# —— 链接与测试指针（应全部通过）——
# 305 条相对链接、85 篇 durable 文档，0 断裂（正则 ]\(([^)\s]+)\) 逐个 resolve）
git grep -ohE "tests/[a-z0-9-]+\.test\.mjs" -- '*.md' | sort -u \
  | while read -r t; do [ -f "$t" ] || echo "MISSING $t"; done        # durable 集合内 0 命中

# —— 漂移 5.1：工具数 26 vs 27 ——
node -e '
const l=require("fs").readFileSync("tests/model-double.test.mjs","utf8").split("\n");
const i=l.findIndex(x=>x.includes("assert.deepEqual([...toolNames].sort()"));
let n=0; for(let k=i;k<l.length;k++){ if(/^\s+.\x27[a-z_0-9]+.\x27,\s*$/.test(l[k])) n++; if(l[k].includes("],")) break }
console.log("actual model tools =", n)'                                    # 27
grep -n "26 个工具" docs/architecture/agent-capabilities.md               # :59
git log -S "26 个工具" -- docs/architecture/agent-capabilities.md         # 唯一命中 695541c
# 逐版对比（文档数 vs 测试数）
for c in 71cf1bd 72155e2^ 72155e2 695541c HEAD; do
  echo "$c doc=$(git show $c:docs/architecture/agent-capabilities.md | grep -oE '[0-9]+ 个工具' | head -1)"
done

# —— 漂移 5.2 / 5.3：文件树与 glossary 列举 ——
ls docs/adr/          # 4 篇
ls docs/glossary/     # 3 篇（skill.md 未被 domain.md / docs/README.md 列出）
awk 'NR>=28 && NR<=44' docs/agents/domain.md        # 只列 0001/0002 与 2 个 glossary

# —— 漂移 5.4：第三种 agent 已落地 ——
grep -rn "agentPreset: " backend/*/src/*.ts | grep -v dist
#   backend/memory/src/maintenance.ts:444        MAINTENANCE_PRESET
#   backend/skill-creator/src/deep-creation.ts:389 SKILL_LEARNING_PRESET
#   backend/skill-creator/src/learning.ts:735,816  SKILL_LEARNING_PRESET
grep -n "SKILL_LEARNING_PRESET" backend/skill-creator/src/learning-policy.ts   # :23
git log --oneline -3 -S "SKILL_LEARNING_PRESET" -- backend/skill-creator/src/  # #300 引入

# —— 漂移 5.5：JDK 矛盾 ——
grep -n "java-version" .github/workflows/check.yml     # 17
grep -n "JDK" README.md android/README.md              # 17 vs 21
grep -rn "jvmToolchain\|ndkVersion\|buildToolsVersion" android/*.kts android/*/*.kts   # 全空

# —— 3.1 绝对路径实证（关键）——
ls -d /home/eafen405                                   # No such file or directory
node scripts/combo.ts verify                           # exit 1：dsh MISSING，提示 override OURFAIRY_DSH_DIR
grep -n "OURFAIRY_DSH_DIR" scripts/combo.ts            # :49 PATH_OVERRIDES
sed -n '101,115p' scripts/combo.ts                     # isSelfEntry() → ourfairy 行从不读 localPath

# —— android 工具链实测 ——
sed -n '43,53p' android/app/build.gradle.kts           # compileSdk release(37) minorApiLevel=2
grep -n "sourceCompatibility\|jvmTarget" android/app/build.gradle.kts   # 17 / JVM_17
find android/app/src/main/java -name '*.kt' | wc -l                    # 115

# —— 6.3 证据索引 ——
node scripts/evidence-index.ts --check                                 # evidence index is current
ls work/implementation/evidence/ | wc -l                               # 196 目录
# 被 README 链接的 194 个；未索引：293-precommit-merge-index（index/ 是生成器数据目录）

# —— 6.3 孤儿核验 ——
grep -rn "README_ZH" --include=*.md . | grep -v node_modules | wc -l   # 0 处引用
ls android/.github/workflows/                                          # 嵌套目录，GitHub 不读
grep -n "acceptance:skill" README.md                                   # 无（package.json 有）
```

---

**一句话总结**：仓库的中文统一已经基本做到——文档层英文占比 10–22%，真正的语言不统一集中在 `backend/` 的 17 篇（69% 英文）。最贵的漂移不是文字而是 `combo.json` 里指向别台机器的 `localPath`：实测让 `combo:verify` 直接 exit 1，且 `repos.ourfairy.localPath` 因为命中 `isSelfEntry()` 从来不被读取，是纯残留。最该立刻修的文档 bug 有两个：`docs/agents/domain.md` 的文件树（`AGENTS.md:40` 指到的常驻指针，目标集合已残）与 `docs/architecture/agent-capabilities.md` 的两处断言（工具数 26 实为 27、"只有两种 agent" 实际已有第三种），两者都已被代码推翻且都没有检查兜底。

---

## 9. 本轮已落地的改动（批次 A，Lead 授权）

只改 3 个文件，`combo.json` **零改动**（Lead 裁决：改 `localPath` 的值不会让任何机器变绿，净收益为零）。

| 文件 | 改动 | 解决哪条 |
| --- | --- | --- |
| `README.md` | 「先决条件」表补 `OURFAIRY_DSH_DIR` 覆盖说明 | §3.1 —— 该变量此前在 56 篇 durable 文档里**一次都没出现** |
| `README.md` | 「跑测试」节加 `combo:verify` / `backend:doctor` 分工表 + 一句正面表述的分界 | §5 发现的新缺陷（见下） |
| `android/AGENTS.md:22-23` | `ANDROID_HOME=/home/eafen405/...` → `/path/to/Android/Sdk` | §3.2 |
| `work/implementation/CONVENTIONS.md:38-48,78-80` | 六处绝对路径 → 相对仓库根 / `$OURFAIRY_DSH_DIR`；`:42` 三仓措辞改掉；补 `OURFAIRY_DSH_DIR` 回落说明 | §3.2、§5.6 |

### 本轮新发现（Lead 已立案为下一批次独立缺陷）

**`combo:verify` 不会发现 dsh 工作树停在别的提交上。** 实测：

```
检出 /home/fatfish/deepseek-harness
  HEAD                       = d743267388641bc76f17c45ce8b4c231aed1d32c
  origin/product/ourfairy-v1 = c41af067…  ← 锁定值
  merge-base --is-ancestor c41af067 HEAD  →  NO（落后，不含锁定提交）
  apps/cli/lib/bin.js        →  不存在（未构建）

$ OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm run combo:verify
dsh  product/ourfairy-v1  c41af067cf1d5bb9  c41af067cf1d5bb9  ok
combo: combination verified      EXIT=0
```

根因 `scripts/combo.ts:179-181`：比对的是**分支 ref / remote-tracking ref**，不是 `HEAD`。本地无 `product/ourfairy-v1` 时回落读 `origin/product/ourfairy-v1`，该 ref 恰是锁定值 → ok。

- **兜底不在本地**：`scripts/ourfairy-backend.ts:168-184` 的 `resolveDsh()` 会比对 HEAD 并在漂移时 fail，但那是 `backend:doctor`，不是四道本地门禁之一的 `combo:verify`。
- **唯一的产品内 HEAD 校验在 CI YAML 里**：`.github/workflows/check.yml:52-57` 是一段手写 bash（`git rev-parse HEAD` 比对），不在 `scripts/` 里。
- **加 HEAD 比对不会破坏 CI**：`:177` 注释「PR checkout 是 detached」是为了**找 tip**（回落 `origin/<branch>`），与**验 HEAD** 正交——`git rev-parse HEAD` 在 detached 下照常可读。

本轮不改代码（`scripts/combo.ts` 是门禁基础设施，改它要配测试），改为在 `README.md` 写清两条命令的分工，让读者知道「`combo:verify` 通过 ≠ 本机检出可用」。

### 双处已澄清的误报（避免下轮重查）

- `tests/precommit.test.mjs:22-25` 注释「命令不跑」与 `:313` 的 `execFileSync` **不矛盾**：`:313` 带 `--print`，`scripts/precommit.ts:310,316-318` 打印后直接 `return`。
- `README.md:105,118` **已两处**写明 `acceptance:*` 不属于 `npm test` 或 CI；真正缺的是 `acceptance:skill`（见 §6.3）。
