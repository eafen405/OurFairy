> 2026-11-03 状态：日期化记录。本篇记录 2026-11-03 的一手资料调研，不描述 OurFairy 当前实现，也不提出已批准的方案。

# 角色扮演的人格稳定性：成熟实现、实证结论与厂商官方立场

研究范围是为「人格/上下文工程」提供一手证据：一个 LLM 应用如何获得**稳定、贴切、不被提示词淹没**的角色扮演效果。本文**不**重复 [人格控制的上下文工程、多用户隔离与提示词注入抵抗力](persona-context-and-injection-resistance.md)（核查日期 2026-10-14，记为「前文」）已经覆盖的 dsh / MaiBot / AstrBot 注入面分析；本文的增量是四块：**角色扮演成熟实现（SillyTavern 与卡规范）**、**人格稳定性的实证结论（persona drift 论文）**、**模型厂商官方提示工程立场**、**少提示词靠结构化人格的先例**。

本文严格区分三类陈述：

- **【代码事实】**：可在给定 commit / tag 的源码或原始文档文件中复查到具体行。
- **【文档声称】**：来自一手发布方的文档自述，未与实现逐行比对。
- **【本文推断】**：对证据的解读或对 OurFairy 的类比，**未经实验验证**。

（少数条目标注【论文】——指已发表论文的原文结论，与【文档声称】的区别在于它经过同行评审并附方法与数据，但本文**没有复现**任何一篇。）

未部署任何参照项目、未跑实验、未构造注入样本、未微调任何模型。二手博客与社区指南**不作为任何结论的引用来源**；写作过程中出现过、但被判定为一手来源不足的线索，一律进第八节证据空白，不做记忆补全。

---

## 结论

**一、SillyTavern 的"角色稳定"不是靠一段更长的人设，而是靠把不同性质的人格材料放在上下文的不同深度上，每条带独立的注入策略。** 【代码事实】它的注入 API 允许三种位置（`IN_PROMPT` / `IN_CHAT` / `BEFORE_PROMPT`）与三种角色（system/user/assistant），`IN_CHAT` 带一个 `depth`，其中 `0` 表示历史末尾。[P8] 【本文推断】这意味着"稳定"在成熟实现里被建模成一个**位置问题**，而不是"描述写得更全"的问题。

**二、卡片规范把"人设"拆成有生命周期契约的语义槽位，而不是一个自由文本字段。** 【文档声称】V1 规范写明 `description` / `personality` / `scenario` 是"每次提示都应包含"的**常驻**字段，而 `mes_example` 是**上下文满了就该被挤出去**字段。[V1] 【代码事实】SillyTavern 的装配顺序把 `charDescription` / `charPersonality` / `scenario` 作为常驻项、`dialogueExamples` 放在历史之前可裁剪，与规范一致。[S2]

**三、规范的作者对示例（`mes_example`）的立场是"默认用、但可以被挤掉"，而不是"越多越好"。** 【文档声称】V1 原文：示例对话 **SHOULD** 默认只包含到真实对话填满上下文为止，然后被裁剪腾位置。[V1] SillyTavern 文档另有一句更硬的判断：模型更可能从 `first_mes` 而不是从别处学到风格与长度约束。[S2] 但"示例是最强风格载体"这一点同时被 Google 官方文档以对照演示支持，并被 OpenAI 以"会被逐字复读"警告——**三者指向同一个设计约束：示例内容本身就是风格配置。**[G1][O1]

**四、人格稳定性的实证结论是"能减缓、不能消除"，且最强的干预是"在生成点提供具体信息"，不是"把人格重放一遍"——但这条最强的数字是探索性的。** 【论文】提示级干预把漂移率降了 35–38%（完整人格重放）/ 22–27%（反思提醒）/ 87%（行为级具体指令），原文明确「**None eliminated drift**」且「no evidence that adaptive timing outperformed static scheduling」。[P2] 【论文】但同一篇自己写明：『The evidence for this ordering is not equally strong: **the reinjection advantage is tentative, and the behavior-specific comparison is exploratory and bundled.** It should therefore be treated as an organizing hypothesis for component-level experiments rather than as a demonstrated general principle.』[P2] 【本文推断】因此 87% 只能当假设，不能当杠杆率的估计；可迁移的是它的**方向**（针对当前情境的具体指示 > 抽象提醒），不是它的**幅度**。这个方向与 OpenAI"minimal, well-scoped personality"[O2] 和 Anthropic"一句话就有效果"[A1] 一致，但三方都没有互相引用或做过同一对照。

**五、提示词位置对可用性有实证影响，但"越靠后越好"是不准确的简化。** 【论文】相关信息在长上下文**开头或结尾**时表现最好，在**中间**显著退化，即便对显式长上下文模型也如此。[P4] 【文档声称】OpenAI 的口径更精确：指令放在**两头**优于只放一头；只放一次时**放上面**优于放下面；而指令冲突时模型**倾向服从更靠后的那条**。[O1] 【本文推断】"冲突时靠后赢"这一条解释了 SillyTavern 的 Author's Note 为什么有效，但也意味着**末尾的临时注入会压过开头的人格**。

**六、负面约束的可迁移判据不是"别用否定句"，而是"否定句只能用于禁止行为，不能用于塑造风格"。** 【文档声称】Anthropic 成对给出改写范例（"Do not use markdown" → "composed of smoothly flowing prose paragraphs"）[A1]；SillyTavern 给出人格场景的同类改写（"Do not decide what {{user}} says" → "respects {{user}}'s autonomy"）[S1]；而 OpenAI 在"禁止编造事实"这类**无正面形态**的地方照常使用 Do not。[O2] 【本文推断】区分点是有没有"可观察的正面替代形态"。

**七、"少提示词、靠结构驱动人格"有一个成体系的先例：Letta/MemGPT 的 memory block。** 【代码事实】人格是具名 block（`label="persona"`），带**字符**上限 `limit` 与框架自带的 `description`；渲染时拆成 `<description>` + `<metadata>`（含 `chars_current` / `chars_limit`）+ `<value>` 三段，**每轮都把预算用量告诉模型**。[L1][L3] 写入走具名工具，`core_memory_replace` 在 `old_content` 不匹配时 `raise ValueError`，只有 `memory_rethink` 允许整块重写。[L4] 其默认人设 `sam_pov.txt` 仅 **1,171 字节**。[L5] 【文档声称】其公开《Context Constitution》把"stable, compressed system prompt"和"system prompt 里塞很少用到的指令"（列为失败模式）写成了原则。[L6] **但"短 + block 比长描述更稳"没有任何对照实验**——这是本文最大的一处推断裸露（证据空白第 1 条）。

**八、中文口癖/语气词控制没有成熟做法。** 【本文推断，有一手支撑】中文角色扮演的**评测**已把"说话风格"做成独立指标（Persona-Utterance：每个角色有独特表达习惯，输出应对齐）[P9b]，但**从"能测"到"能控"这一段是空的**。最贴近主题的综述以明确强度写着「comparable measurements of the newest releases are sparse」且「English word lists transfer poorly to Chinese」，它给出的是**下一步该做什么**而非已有方法。[P10] 输出侧机械手段（SillyTavern Regex、OpenAI `logit_bias`）确实成熟，但没有一个是针对中文语气词设计的，且 `logit_bias` 在 DeepSeek/Anthropic 的 API 层不提供（Anthropic 列为 Ignored，DeepSeek 无此字段）。[P9][O3][A2][D1]

---

## 固定版本与证据口径

| 来源 | 核查版本（提交 / 日期） | 覆盖维度 | 不覆盖 / 不能推定的维度 |
| --- | --- | --- | --- |
| SillyTavern | `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（2026-09-14，`release` 分支） | 卡片字段落点、注入位置与 depth、World Info 触发、Author's Note、Regex 后处理、宏、上下文预算取舍 | 未覆盖 World Info 的向量激活与向量库内部算法；未覆盖群聊 activation 策略；**未做任何效果评测**，所有"影响更大"均为其文档声称 |
| Character Card V2 规范（`malfoyslastname/character-card-spec-v2`） | `8083fb388615ccbce768e97cbbd49d2b3214632c`（2023-06-22） | V1 六字段 + V2 新增字段的 MUST/SHOULD 语义 | 规范是"frontend 应当怎么做"的约定，**不是**模型行为证据 |
| Character Card V3 规范（`kwaroran/character-card-spec-v3`） | `f3a86af019fbd99f788f7a1155f399655b34ab35`（2024-07-20） | V3 增量字段、Lorebook/Decorator 规范（`@@depth`/`@@position`/`@@role` 等） | 同上 |
| Letta / MemGPT（`letta-ai/letta`） | tag `0.16.8` = `1131535716e8a31c9a437f8695e25ac98f203a24`（该 tag 位于 `archive` 分支，当前源码已迁至 `letta-ai/letta-code`） | block 类型定义、渲染信封、记忆工具语义、默认人格文本 | **未运行过 Letta**；未验证 block 在真实多轮中的人格保持效果；`context-constitution` 仓库未固定 commit（仅 `main`） |
| OpenAI Cookbook（`openai/openai-cookbook`） | `500df203bbf57d5c9151194c5d341afeda235ef3`（2026-11-03） | GPT-4.1 prompting guide、prompt_personalities notebook | **官方 Prompt engineering 指南页与 Model Spec 正文取不到（403）**；cookbook 是官方维护但**不等同于**那个指南页 |
| OpenAI Model Spec 页面 | `model-spec.openai.com/2026-10-29.html`（抓取于 2026-11-03） | "intentionally leaves many details of style, personality, and interaction unspecified" | 只作背景，未从中提取可操作判据 |
| Anthropic 文档 | `docs.claude.com/llms-full.txt`（抓取于 2026-11-03，约 49 MB 全文） | Prompting best practices 章节、OpenAI 兼容层参数表 | **正文页取不到**（返回应用壳 / "App unavailable in region"）；引文只能定位到章节，无法给稳定页面锚点 |
| DeepSeek API 文档 | `api-docs.deepseek.com`（抓取于 2026-11-03） | chat completion 参数、prefix completion | **无独立 prompt engineering 指南页**（sitemap 已核）；对人格/语气/提示长度的官方立场取不到 |
| Google Gemini 文档 | `ai.google.dev/gemini-api/docs/prompting-strategies` 与 `/api/generate-content`（抓取于 2026-11-03） | 指令顺序、few-shot、输出啰嗦度、`presencePenalty`/`frequencyPenalty` | 未覆盖 Gemini 各版本间差异；示例均为单例 |
| persona drift 论文 | 见文末 [P1]–[P7]、[P9b]、[P10] 逐条 arXiv ID | 漂移度量、干预效果、长上下文位置、状态机、中文评测、口癖综述 | **未复现任何实验**；各篇的模型/指标/场景互不相同，**不能横向合并成一个数字** |

**口径说明**：本文对 SillyTavern 与两份规范只引**原文措辞与代码行**，不把它们文档里的"影响更大/更有效"当作已验证事实——它们没有公开的对照实验。

---

## 一、SillyTavern：人格材料按位置分层，每条材料有独立注入策略

### 1.1 注入接口只有三种位置、三种角色、一个 depth（代码事实）

`public/script.js` 里定义了两个枚举，这是整个 SillyTavern 人格/提示注入的公共 API 形状：

```js
export const extension_prompt_types = {
    NONE: -1,
    IN_PROMPT: 0,
    IN_CHAT: 1,
    BEFORE_PROMPT: 2,
};

export const extension_prompt_roles = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
};

export const MAX_INJECTION_DEPTH = 10000;
```

`setExtensionPrompt(key, value, position, depth, scan, role, filter)` 是唯一入口，其 JSDoc 原话：`position` 「0 is after story string, 1 is in-chat with custom depth」，`depth` 「0 represets the last message in context」。[ST1]

【本文推断】三个位置对应三种**语义**，而不是三种排版：`IN_PROMPT`＝属于"人设/设定"的常驻材料；`IN_CHAT`＝属于"此刻该被强调的"临时材料；`BEFORE_PROMPT`＝在一切之前。这个三分法与"人格 vs 状态"的分层是同一件事的两种说法。

### 1.2 装配顺序是硬编码的，人设在前、历史在中、控制项在最后（代码事实）

`public/scripts/openai.js` 的 `populateChatCompletion()` 按固定顺序加入：

```
worldInfoBefore → main → worldInfoAfter → charDescription → charPersonality
→ scenario → personaDescription → ... → controlPrompts（quietPrompt 等，永远最后）
```

随后在 `messages = await populationInjectionPrompts(absolutePrompts, messages)` 之前，先把 `continue` 的 prefill 消息移出并放进 `controlPrompts`，最后才做 in-chat 注入；`power_user.pin_examples` 决定示例对话是插在历史之前还是之后。[ST2]

【本文推断】"永远最后"的 `controlPrompts`（quiet prompt / impersonate / continue prefill）是一个独立优先级层：**它不与人设竞争位置，而是被放在人设无法到达的地方**。这与"把最重要的指令塞进人设里"是相反的做法。

### 1.3 `IN_CHAT` 的 depth 是一个真·从末尾倒数的插入点（代码事实）

`populationInjectionPrompts()` 从 `i = 0` 迭代到 `getExtensionPromptMaxDepth()`，每个 depth 上把该层的 prompt 按 role 分组成一条消息，然后：

```js
const injectIdx = i + totalInsertedMessages;
messages.splice(injectIdx, 0, ...roleMessages);
```

`messages` 在此函数内部是**倒序**的（函数末尾 `messages = messages.reverse()` 返回），因此 `i = 0` 落在最新消息处。同层内 role 的处理顺序被写死为 `['system', 'user', 'assistant']`（注释：most important go lower），并且 order 组的排序是 `sort((a, b) => +b - +a)`。[ST2]

【文档声称】Author's Note 文档对这个深度的解释是行为性的：`Depth 0 = placed at the very end of the chat history`；`Depth 4 = placed before the most recent 3 chat history messages`；并直接给出因果判断：「**The closer the Author's Note is to the bottom of the prompt, the more impact it has on the next AI response.**」[ST3]

【本文推断】这是本节最值得记的一条：成熟实现把"这条人格材料该多强"表达成一个**整数深度**，而不是形容词式的"请务必牢记"。强度是结构参数，不是措辞强度。

### 1.4 Author's Note：一段可变文本 + 深度 + 频率 + 角色（代码事实 + 文档声称）

【代码事实】`public/scripts/authors-note.js`：

- 元数据键为 `note_prompt` / `note_interval` / `note_depth` / `note_position` / `note_role`。[ST4]
- 默认值是 `const DEFAULT_DEPTH = 4;` 与 `const DEFAULT_POSITION = 1;`，读不到就回退到 `extension_settings.note.defaultDepth`。[ST4]
- 它通过 `context.setExtensionPrompt(MODULE_NAME, ...)` 注入，`MODULE_NAME` 的取值为 `'2_floating_prompt'`，注释写明「`Deliberate, for sorting lower than memory`」。[ST4]
- 初始注册时用 `extension_prompt_types.NONE` 与 `MAX_INJECTION_DEPTH` 表示"先不注入"。[ST4]

【文档声称】Author's Note 文档把它的定位说成"a powerful tool for customizing AI responses which inserts a section of text into the prompt **at any position and at any frequency you desire**"，并列出五个用途：提醒回复格式、强化指令（原文例句 `[Remember the instructions you were given at the beginning of this chat.]`）、当临时 World Info、当 Character Bias、给非 Instruct 模型当 Instruct。[ST3]

【本文推断】「强化指令」这个用例本身是一条**对"人设会随时间失效"的显式承认**：如果早期指令能一直生效，就不需要一个专门的、按 depth 重放的机制去"提醒模型记得开头说过什么"。这是成熟实现里唯一把"人格衰减"写进 UI 的地方。

### 1.5 World Info：人格/设定材料的**触发式**注入，不是全量常驻（代码事实 + 文档声称）

【文档声称】World Info 文档的字段集与语义：

- 检索控制：`Scan Depth`（扫多少条历史）、`Include Names`（参与者名字是否计入被扫文本）、`Context % / Budget`（World Info 一次可占的 token）、`Min Activations`、`Max Depth`、`Recursive scanning`（含「Non-recursable」「Prevent further recursion」「Delay until recursion」三档）、`Max Recursion Steps`。[ST5]
- 触发控制：主键 + `Optional Filter`（`AND ANY` / `AND ALL` / `NOT ANY` / `NOT ALL`）、`Probability (Trigger %)`、`Inclusion Group`（同组只插一条，默认按 `Group Weight` 随机，开 `Prioritize Inclusion` 后按 `Order` 取最高）。[ST5]
- 插入位置：`Before Char Defs` / `After Char Defs` / `Before Example Messages` / `After Example Messages` / `Top of AN` / `Bottom of AN` / `@ D`（depth + 三种 role）/ `Outlet`（不自动注入，改用 `{{outlet::Name}}` 宏手动放）。[ST5]
- 预算规则：原文「If the budget is exhausted, then no more entries are activated even if the keys are present in the prompt. **Constant entries will be inserted first. Then entries with larger order numbers.** Entries inserted by directly mentioning their keys have higher priority than those that were mentioned in other entries' contents.」[ST5]

【本文推断】这是"不被提示词淹没"的最具体机制：**人格相关的设定材料默认不常驻，而是按当前对话内容触发**，并且有硬预算先砍谁后砍谁的确定顺序。相比之下，把世界观/口癖/关系全写进常驻 description 的做法，在同一个预算下必然更早饱和。

【文档声称】文档同时给了一条反向警告：`If your Author's Note is disabled (Insertion Frequency = 0), World Info entries in A/N positions will be ignored!` 以及 outlet 的四条限制（entry 内不能放 outlet、不能嵌套、卡片字段无法展开 outlet、A/N 编辑器不能解析 outlet）。[ST5]【本文推断】这些是"分层注入"的代价：位置一旦成为语义，层与层之间就产生依赖顺序，配置错误会静默失效。

### 1.6 卡片的常驻 vs 可裁剪，SillyTavern 与规范的说法一致（文档声称）

【文档声称】SillyTavern 角色设计文档明确列出：

- **Permanent Tokens**（每次请求都发）：Character Name、Character Description、Character Personality、Scenario。
- **Not permanent**：First message（只在开头发一次）、Example messages（只在历史填满前保留，可选强制保留）。
- 原文因果：「**The model is more likely to pick up the style and length constraints from the first message than anything else**, so it's important to write it in a way that you want the responses to be (short and concise, long and detailed, etc.).」[ST6]
- 关于卡片长度的实际取舍，文档写的是 **token 代价**而不是质量：「If you're working with an AI model with a 2048 context token limit, a 1000-token character definition cuts the AI's 'memory' in half.」以及「When we see your character has over half of the model-defined context length of tokens in its definitions, we highlight it for you **because this can lower the AI's capabilities**」。它同时承认「Don't worry - it won't break anything. At worst ... there will be less room left in the context」。描述长度原文是「It could be of any length (be it 200 or 2000 tokens) and formatted in any style」。——即：**官方立场是"长度是预算问题，不是质量保证"**，且它对"怎么写"明确弃权：「Methods of character formatting are a complicated topic beyond the scope of this documentation page.」[ST6]

【本文推断】这段"弃权"很重要：SillyTavern 官方文档**没有**给出一份"怎样写人格才稳定"的权威方法，只给了机制与预算。所有流行的写法指南（PLists、Ali:Chat 等）在官方文档里是以**外部链接**出现的，属于社区经验，不构成本文引用。

### 1.7 角色卡字段的注入位置对照（代码事实）

| 卡片字段 | SillyTavern 装配中的标识符 | 角色 | 位置 | 生命周期 |
| --- | --- | --- | --- | --- |
| Description | `charDescription` | system | story string 之后 | 常驻 [ST2][ST6] |
| Personality summary | `charPersonality` | system | 同上，紧随 description | 常驻 [ST2][ST6] |
| Scenario | `scenario` | system | 同上 | 常驻 [ST2][ST6] |
| Persona Description（用户人设） | `personaDescription` | system | 同上，在 scenario 之后 | 常驻（受 `persona_description_position` 控制）[ST2] |
| System Prompt（覆盖主提示） | `main` | system | 最前（worldInfoBefore 之后） | 常驻 [ST2] |
| Post-History Instructions | — | — | 由 Prompt Manager 决定，可设为 in-chat depth | 常驻或按 depth [ST6] |
| First message | — | assistant | 历史首条 | 只发一次 [ST6] |
| Example messages | `dialogueExamples` | system（拆成 example_user / example_assistant） | 历史之前或之后（`pin_examples`） | 可被挤出 [ST2][ST6] |
| Character's Note | `DEPTH_PROMPT` 前缀的注入项 | 可选 user/system/assistant | `@ Depth` 指定 | 每轮重放 [ST6] |

（`dialogueExamples` 的 `system` 角色与 `example_user`/`example_assistant` 名称来自 `parseExampleIntoIndividualMessages()` 的 `add_msg(name1, 'system', 'example_user')` 分支。[ST2]）

---

## 二、Character Card V2/V3：规范把"人设"拆成有生命周期契约的槽位

### 2.1 V1 六字段是生态的事实标准，规范对每个字段给了规范性强度词（文档声称）

V1 规范原文规定 `description` / `personality` / `scenario` 三者 **SHOULD** be included by default in every prompt，而 `first_mes` 的约束是行为性的：「The chatbot **MUST** be the first one to send a message, and that message **MUST** be the string inside `first_mes`.」[CC1]

`mes_example` 的原文更长，是整份规范里唯一带**裁剪策略**的字段：

> Example conversations **SHOULD**, by default, only be included in the prompt until actual conversation fills up the context size, and then be pruned to make room for actual conversation history. This behavior **MAY** be configurable by the user.

并且它规定了示例的书写形态：用 `<START>` 标记新对话的开始，`<START>` **MAY** 被转换成别的东西（原文举例：转成一条 OpenAI system 消息 "Start a new conversation."）。[CC1]

【本文推断】这是一条明确的设计意图：**示例是"启动材料"，不是"人格材料"**。它教风格，但不常驻；人设槽位才是常驻的。规范的作者把"用不用示例"回答成"用，但让它可被挤掉"，而不是"用越多越好"或"不要用"。

`personality` 的原文定义只有一句：「A short summary of the character's personality.」[CC1]—— **short** 是规范用词。

【文档声称】V1 规范还定义了宏替换契约：`{{char}}` / `<BOT>` 替换为卡片 `name`，`{{user}}` / `<USER>` 替换为应用设定的显示名，**大小写不敏感**，并且「A default value for the user's name **MUST** exist.」；`{{user}}` 是否在 `name` 字段内替换被显式列为 **UNSPECIFIED** edge case。[CC1]

### 2.2 V2 新增字段里有两个是"接管系统提示"，规范给了 MUST 级的默认行为（文档声称）

V2 规范对新字段的定义是规范性最强的部分，值得逐条记：

| 字段 | 规范原文的规范性要求 | 性质 |
| --- | --- | --- |
| `creator_notes` | 「**MUST NOT** be used inside prompts」，且**SHOULD** 对用户非常可见（至少一段） | 禁入提示 |
| `system_prompt` | 前端默认行为 **MUST** 是用它**替换**用户理解的"system prompt"全局设置；字段为空串时必须回退 | 接管 system |
| `post_history_instructions` | 前端默认行为 **MUST** 是用它**替换**用户理解的 "ujb/jailbreak" 设置；同样有回退 | 接管后历史指令 |
| `alternate_greetings` | 数组，前端 **MUST** 作为 first message 的 "swipes" 提供 | UI |
| `character_book` | 前端 **MUST** 默认使用角色自带的 lorebook；**SHOULD** 与用户 world book 叠加（**SHOULD** take full precedence over world book） | 触发式设定 |
| `tags` / `creator` / `character_version` | 三者都 **MUST NOT** / **SHOULD NOT** 用于 prompt engineering | 禁入提示 |
| `extensions` | **MUST** 默认 `{}`；编辑器 **MUST NOT** 销毁未知键 | 扩展 |

两条接管字段都要求前端支持 `{{original}}` 占位符，替换为"没有这个字段时前端本来会用的那段文本"。[CC2]

【本文推断】`system_prompt` 与 `post_history_instructions` 被设计成**两个不同槽位**而不是一个，是这份规范最有信息量的地方：它承认"在历史之前说的话"与"在历史之后说的话"需要分别覆盖，且各自要能引用被覆盖掉的原文（`{{original}}`）。这与第一节 SillyTavern 的 `depth` 机制是同一个洞察的两种表达。

**边界（必须写清）**：规范的这些 MUST 是**对前端实现者的约定**，不是对模型行为的断言。规范全文没有给出任何"这样写效果更好"的实验证据。[CC2]

### 2.3 V3 把 World Info 升级成规范化的 Lorebook + 装饰器（文档声称）

V3 规范的增量集中在 Lorebook：把 V2 里"应用自定义"的注入位置语义写成规范。核心机制是 `content` 字段里以 `@@` 开头的**装饰器（decorator）**，规范对位置的表述是精确的：

- `@@depth N`：内容插入到「从最新消息往旧数第 N 条」的位置；`N` 超过总消息数则插到最旧消息之前；`N < 1` 则插到最新消息之后；若 `@@role assistant` 且客户端支持 prefill，`N = 0` **SHOULD** 作为 prefill 插入。[CC3]
- `@@role`：值为 `"assistant"` / `"system"` / `"user"` 之一，决定这条 lorebook 内容以什么角色进入上下文。[CC3]
- `@@position`：值可为 `after_desc` / `before_desc` / `personality` / `scenario`，即**直接挂到卡片的某个字段旁边**。[CC3]
- `@@activate_only_after` / `@@activate_only_every` / `@@is_greeting` / `@@scan_depth` / `@@ignore_on_max_context`：分别按助手消息数、消息数取模、激活的问候语序号、扫描深度、是否已到上下文上限来控制激活。[CC3]
- 装饰器支持**三级回退链**（`@@` 为主、`@@@` 为 fallback），规范 **MAY** 限制链长但 **SHOULD** 至少支持 5 层。[CC3]
- `use_regex` 时 `keys` 无效正则 **MUST** 视为不匹配；`enabled: false` 时 **MUST NOT** 在任何情况下被视为匹配；`content` 为空时 **MUST NOT** 插入任何内容。[CC3]

另有两条规范级的预算规则：`scan_depth` 限定只在最近 N 条消息里匹配；`token_budget` 超出时「the application **SHOULD** remove the lowest priority lorebook fields」，若 `priority`/`insertion_order` 缺失则删谁由应用决定。[CC3]

【本文推断】把"注入位置"和"激活条件"做成**内容内嵌的声明**（`@@` 行）而不是应用配置，是把人格/设定材料与其投放策略**放在一起**。对 OurFairy 的可迁移含义是：一条人格材料如果自己说不清"我什么时候出现、我出现在第几深、我以什么角色出现"，那它就还不算一条可装配的材料。

### 2.4 规范的空白（这是本节该被记住的部分）

【文档声称】两份规范都**没有**讨论：
1. 人设写多长合适（V1 只对 `personality` 用了 "short summary"）；
2. 多个槽位之间冲突时谁优先（只有 `creator_notes`/`tags`/`creator` 的"不得进提示"是明确的）；
3. 任何形式的效果评测。

`mes_example` 的"可被挤掉"是规范里**唯一**一条带生命周期判断的规则。[CC1][CC2][CC3]

---

## 三、人格稳定性：实证文献怎么说（都是原文结论）

这一节全部来自论文摘要与正文原文。**没有任何一条来自博客转述。**

### 3.1 指令漂移在 8 轮内就出现，且与注意力衰减同步（论文）

Li 等，《Measuring and Controlling Instruction (In)Stability in Language Model Dialogs》[P1]。原文结论：

> An implicit assumption in the use of system prompts is that they will be stable … **We propose a quantitative benchmark to test this assumption … we reveal a significant instruction drift within eight rounds of conversations.** An empirical and theoretical analysis of this phenomenon suggests the transformer attention mechanism plays a role, due to **attention decay over long exchanges**.

方法上值得记的是它的度量方式：让两个各自被 system prompt 指派的模型对聊 8 轮，然后在每个 turn 用**探针问题替换原来的用户消息**重放一次，用稳定性函数打分。[P1] 作者对注意力衰减的描述是：「the longer the dialog, the less weight is placed on the initial tokens that make up the prompt. We measure this effect precisely and find that there is indeed a strong attention decay effect.」并且这种衰减是**跨轮阶梯下降、轮内近乎不变**（Figure 4 的描述：`sharp drops in attention between turns and rough plateaus within turns`）。[P1]

其缓解手段是推理期的 `split-softmax`——**需要模型内部访问权**（改注意力计算），不是提示词手段。[P1]

【本文推断】这条与第一节的 SillyTavern depth 机制直接对上：如果注意力对"开头那段"的权重会随轮次衰减，那么"把重要的人格材料也复制一份到接近末尾的 depth"就不是玄学，而是对衰减的工程补偿。**这是本文唯一一处代码实现与论文结论互相印证的推断，仍然是推断——没有任何一方做过这个对照实验。**

### 3.2 提示级干预能减缓漂移，但**消除不了**；"具体到什么程度"比"什么时候干预"更重要（论文）

《Prompting Against Persona Drift: Comparing Intervention Timing and Content in LLM-Simulated Conversations》[P2]。规模：1,200 段 28 轮对话、4 个模型、2 档人格强度。[P2]

**场景限定必须先说**：这 1,200 段对话是**教育模拟**场景下的学生人格（ADHD 强度分档），不是陪伴型角色扮演。原文自述「one school-day scenario, one persona family at two intensities, four purposively selected models, and conversations lasting 28 turns」。[P2] 因此它的**百分比**不能直接搬到"陪伴角色"上；可迁移的是**机制排序**，不是数字。

原文数字（**这句要原样记，它是本文唯一一条带百分比的一手量化证据**）：

> Relative to no intervention, **reinjection reduced the modeled rate of LLM-rated drift by 35–38%**, **reflective reminders by 22–27%**, and **behavior-specific instruction by 87%**. **None eliminated drift.** We found **no evidence that adaptive timing outperformed static scheduling**.

**但这三个数字的证据强度不同，必须一起记作者自己的限定**：

> The evidence for this ordering is not equally strong: the reinjection advantage is **tentative**, and the behavior-specific comparison is **exploratory and bundled**. It should therefore be treated as **an organizing hypothesis for component-level experiments rather than as a demonstrated general principle**.

并且该文的统计流程把它们分成了两层：「pre-specified tests of RQ1 and RQ2, **followed by an exploratory comparison** of the three adaptive intervention contents」——35–38% 与 22–27% 属前者，87% 属后者。[P2]

三种干预的原文内容：

| 机制 | 原文注入文本 / 做法 | 漂移下降 |
| --- | --- | --- |
| Full-persona reinjection | 每个干预点把**完整人格提示逐字重放**：`"As a reminder of your persona: [complete persona]."` | 35–38% |
| Reflective reminder | 固定两句：`"Remember your persona specified in the system prompt. Continue your conversation in a way that naturally reflects these characteristics."` | 22–27% |
| Behavior-specific instruction | 监控模型拿到完整人格 + 最近 4 轮 + 逐项目标/当前值表，写 2–4 句**针对当前情境**的指令 | 87%（探索性） |

作者对"为什么行为级指令最强"的解释值得整段引用：

> One interpretation is that **persona drift is not solely a failure to retain the original description. It may also involve a failure to enact relevant parts of that description in a particular context.** … all make persona information more specific and more directly available at the point of generation.

以及它对"重放 vs 提醒"的谨慎表述：

> Its pooled advantage is consistent with the idea that explicit restatement reduces the burden of recovering and applying the original persona, although we did not measure the model's retrieval or attention processes directly. … The evidence therefore supports treating reinjection as a promising alternative to a generic reminder, **not as an established superior mechanism**.

三条作者自己写下的边界，必须一起转述：

1. 「**stability is not validity.** Maintaining an assigned profile over time does not show that the profile is authentic, representative, natural, or free of stereotypes. Stability mechanisms can preserve an initially inaccurate profile just as they can preserve an appropriate one.」
2. 度量锚点是**该段对话第 1 个检查点**的行为，因此「an inaccurate initial expression can therefore become the target that the intervention preserves」。
3. 低强度/默认人格被排除，因为「prior work found little drift in these conditions」——**即：人格越平淡，漂移越不明显；漂移研究本身是"强人格"场景下的结论。**[P2]

【本文推断】第 3 条边界对 OurFairy 尤其重要：如果人格是温和的助手型，那么"漂移"可能根本不是主要失败模式，主要失败模式会变成"人格被稀释成通用助手"。这两种失败需要不同的判据，不能混用 [P2] 的数字。

### 3.3 "给模型指定 persona 未必有助于维持身份"——反直觉但有一手证据（论文）

《Examining Identity Drift in Conversations of LLM Agents》[P3]，测 9 个模型的个人主题多轮对话。原文三条结论：

> (1) **Larger models experience greater identity drift.** (2) Model differences exist, but their effect is not stronger than parameter sizes. (3) **Assigning a persona may not help to maintain identity.**

**状态提示**：该文 arXiv 详情页标注为「**Under review**」，即**尚未见刊**（对比 [P1] 标注 COLM 2024）。因此这三条结论的证据等级低于本文其他论文，**引用时不应与已发表结果等权**。本文保留它是因为它是本节唯一直接测"身份漂移与参数规模关系"的一手来源。

【本文推断】第 3 条与第 3.2 节并不矛盾但需要分开读：3.2 说的是"人格已经指派之后，重复注入能减缓**行为**层面的衰减"，3.3 说的是"指派 persona 这个动作本身未必让人格更稳"。两者测的不是同一个量（行为表达 vs 身份一致性），**不能相互印证，也不能相互否证**。

### 3.4 长上下文里信息位置影响可用性（论文，与人格间接相关）

《Lost in the Middle: How Language Models Use Long Contexts》[P4]。原文：

> performance is often highest when relevant information occurs at the **beginning or end** of the input context, and **significantly degrades when models must access relevant information in the middle** of long contexts, even for explicitly long-context models.

【本文推断】这条是"开头+结尾"双双占优，而不是"越靠后越好"。它与 SillyTavern 文档那句「越靠近底部影响越大」在**结尾**这一半一致，但**不支持**"中间位置无关紧要"。这是一处必须写明的张力：一个厂商 UI 的行为性说法，与一篇学术结论并不完全对齐，本文不替任何一方裁决，因为二者的任务/模型/指标都不同。

### 3.5 漂移可能由特定对话类型触发，而非只由长度触发（论文，机制侧）

《The Assistant Axis: Situating and Stabilizing the Default Persona of Language Models》[P5]。原文：

> Measuring deviations along the Assistant Axis **predicts "persona drift"** … We find that **persona drift is often driven by conversations demanding meta-reflection on the model's processes or featuring emotionally vulnerable users.** We show that restricting activations to a fixed region along the Assistant Axis can stabilize model behavior in these scenarios — and also in the face of adversarial persona-based jailbreaks.

【本文推断】这条给出了一个与"上下文长度"不同的漂移诱因：**要求模型反思自身过程**的对话，以及**情绪脆弱的用户**。对一个人格化陪伴产品，这两类输入都不是边缘情形。但注意它是**机制层（activation）**结论，需要模型权重，不能直接转成提示词策略。这与 [P5] 自己的定位一致：「motivating work on training and steering strategies that more deeply anchor models to a coherent persona」。

### 3.6 生产环境长会话的漂移，以及"重置尝试"为何不可靠（论文）

《ContextEcho: A Benchmark for Persona Drift in Long Agentic-Coding Sessions》[P6]。它的场景是编码 agent 的长会话（数千次工具调用、反复 compaction），与陪伴对话不同，但有三条结论值得记：

> persona drift occurs across providers and **emerges early in real agentic interaction**, while **in-session compaction neither reliably resets nor amplifies it**. A **single-shot anchor restores the original assistant persona**, though **placebo controls suggest a generic register-reset effect**. On same-task continuations, drifted prefixes improve tool-call fidelity … In tool-free chat, however, **the same prefixes break output-format contracts and inflate output length.**

【本文推断】「compaction 既不重置也不放大漂移」是反直觉的：它意味着**做上下文压缩并不能当作"人格复位"手段**。「single-shot anchor 有效但安慰剂对照显示可能只是语域重置」则是一个方法论警告：任何"注入一句锚定语就变好了"的观察，都需要安慰剂对照才能归因。

---

## 四、四家厂商官方提示工程立场：可操作的那几条

本节只引**厂商自己发布的开发者文档**（OpenAI Cookbook、Anthropic 官方文档、DeepSeek 官方 API 文档、Google Gemini 官方文档）。**没有一条来自第三方总结。** 目的不是收集"提示词技巧"，而是回答四个具体问题：指令该写在哪、负面约束到底有没有用、few-shot 对风格起什么作用、system prompt 该短还是该长。

**获取情况先说清楚（这决定了本节的可引用强度）**：

- **OpenAI**：`platform.openai.com` 与 `help.openai.com` 在本机出口返回 **HTTP 403**，官方 *Prompt engineering* 指南页取不到。可用的替代一手来源是 `openai/openai-cookbook` 仓库（OpenAI 官方维护，`500df203bbf57d5c9151194c5d341afeda235ef3`）里的 prompting guide notebook，以及 `model-spec.openai.com/2026-10-29.html`（该页可取）。**因此本节 OpenAI 部分的依据是 cookbook 与 Model Spec，不是那个被墙的指南页**——这是降级证据，不是等价替代。
- **Anthropic**：`docs.anthropic.com` / `platform.claude.com` 的常规 HTML 页返回 Next.js 应用壳与 "App unavailable in region"，正文取不到；但 `https://docs.claude.com/llms-full.txt` 可取（约 49 MB 全文），本节 Anthropic 引文全部来自该文件内的 *Prompting best practices* 章节。
- **DeepSeek**：`api-docs.deepseek.com` 可取，但**其 sitemap 里没有独立的 prompt engineering 指南页**；可用的一手页是 API 参考与 `guides/` 下的 prefix completion / multi-round 文档。
- **Google**：`ai.google.dev/gemini-api/docs/prompting-strategies` 可取，内容完整。

### 4.1 指令顺序：四家都说"关键的放前面或两头"，但"后面"的含义各不相同（文档声称）

| 厂商 | 原文 | 位置主张 |
| --- | --- | --- |
| Google | 「**Prioritize critical instructions:** Place essential behavioral constraints, **role definitions (persona)**, and output format requirements in the System Instruction or at the very beginning of the user prompt.」[G1] | 系统指令 / 用户提示最前 |
| Google（长上下文） | 「Structure for long contexts: … supply all the context first. Place your specific instructions or questions at the very **end** of the prompt.」[G1] | 数据在前、指令在**后** |
| OpenAI Cookbook | 推荐的 prompt 骨架顺序固定为 `# Role and Objective → # Instructions → # Reasoning Steps → # Output Format → # Examples → # Context → # Final instructions…` [O1] | 角色在最前，最终指令在最后 |
| OpenAI Cookbook（长上下文） | 「If you have long context in your prompt, ideally place your **instructions at both the beginning and end** of the provided context, as we found this to perform better than only above or below. If you'd prefer to only have your instructions once, then **above** the provided context works better than below.」[O1] | **两头都放**最优 |
| OpenAI Cookbook（冲突时） | 「If there are conflicting instructions, **GPT-4.1 tends to follow the one closer to the end of the prompt**.」[O1] | 后者胜 |
| Anthropic | 「Setting a role in the system prompt focuses Claude's behavior and tone for your use case. **Even a single sentence makes a difference**」；长上下文时「**Put long-form data at the top**… This improves performance across all models.」并注明「Queries at the end can improve response quality **by up to 30 percent** in tests」[A1] | 角色在系统提示，数据在上、查询在下 |

【本文推断】四家在"角色/关键约束靠前"这一点上一致；分歧只在"是否还要在末尾复述一遍"。OpenAI 给的是三者中最强的操作口径（两头都放 > 只放前 > 只放后），且给了"冲突时靠后的赢"这条**可预测的失败模式**。对任何"人格段放系统提示 + 末尾再补一句"的设计，这条是直接支持；但它同时意味着**末尾的临时注入会压过开头的人格**——这正是 SillyTavern 的 Author's Note 机制在利用的性质。

### 4.2 负面约束「不要…」：两家明确说"改成正面表述"，一家说"可以写不要"

**Anthropic（明确、成对给出改写范例）**【文档声称】：

> 1. **Tell Claude what to do instead of what not to do**
>    - Instead of: “Do not use markdown in your response”
>    - Try: “Your response should be composed of smoothly flowing prose paragraphs.” [A1]

同一节还有一条对人格产品更直接的：

> 3. **Match your prompt style to the output you want** — The formatting style used in your prompt might influence Claude's response style. If you are still experiencing steerability issues with output formatting, try matching your prompt style to the output style you want as closely as possible. For example, **removing markdown from your prompt can reduce the volume of markdown in the output**. [A1]

**SillyTavern 官方文档（与 Anthropic 同向，且给了人格场景的具体改写范例）**【文档声称】：

> The AI will more easily follow instructions about what it should do than what it should not do. For example, if you want the AI to avoid writing in a certain way, it's better to tell it how you want it to write instead. And while *“Do not decide what {{user}} says or does”* is commonly included in prompts to prevent the AI from controlling your persona, some users find *“Write {{char}}'s responses in a way that respects {{user}}'s autonomy”* is more effective. [S1]

**OpenAI Cookbook（立场相反：可以写"不要"，样例里直接用了 MUST/DO NOT）**【文档声称】：`efficient_prompt` 写 `Do not use conversational language unless initiated by the user. Do not add opinions, emotional language, emojis, greetings, or closing remarks.`；`factbased_prompt` 写 `Do not fabricate facts, numbers, sources, or citations.`；GPT-4.1 指南的 agentic 样例写 `do NOT guess or make up an answer`。[O2][O1]

**OpenAI Cookbook 另有一条更值得记的警告**【文档声称】：

> When provided **sample phrases, models can use those quotes verbatim and start to sound repetitive** to users. Ensure you instruct the model to vary them as necessary. [O1]

【本文推断】把三家放在一起看，可以得到一个比"不要用否定句"更精确的判据：**否定句在"禁止某行为"上可用（OpenAI 的用法），在"塑造风格"上不可用（Anthropic、SillyTavern 的用法）。** 区分点是这条约束**有没有可观察的正面替代形态**——"不要用 markdown"有（改成散文），"不要编造事实"没有（它是对任意输出的否决权）。另外 OpenAI 那条"样例短语会被逐字复用"直接命中口癖问题：**给出示例台词等于给出一份会被复读的台词表**，这解释了第六节要处理的"示例泄漏"。

### 4.3 few-shot 对风格的作用：Google 最强（"总是要放"），Anthropic 强调结构一致性，OpenAI 强调会被逐字复用

**Google（立场最激进）**【文档声称】：

> **We recommend to always include few-shot examples in your prompts.** Prompts without few-shot examples are likely to be less effective. In fact, **you can remove instructions from your prompt if your examples are clear enough** in showing the task at hand. [G1]

同页另一节给了上限与失效模式：

> At the same time, **if you include too many examples, the model may start to overfit the response to the examples.** … Make sure that the structure and formatting of few-shot examples are **the same** to avoid responses with undesired formats. [G1]

**Google 还给了一个直接与"风格"有关的演示**：同一道题，零样本时模型选了较长的解释；加了两个"偏好短解释"的 few-shot 示例后，模型改选短的。原文表述是「the examples guided the model to choose the shorter explanation」。[G1] **这是本节唯一一处厂商把 few-shot 与"输出长度/风格"因果摆出来的对照演示**（单例、非统计）。

**Anthropic**【文档声称】：把示例归入 prompt 结构而非风格开关，主张用 XML 标签把 `<instructions>`/`<context>`/`<input>`/示例分区以减少误读；未见"必须放示例"这类强制口径。[A1]

**OpenAI**【文档声称】：见 4.2 末的"sample phrases 会被逐字复用"警告；GPT-4.1 指南把 examples 放在 `# Examples` 段与 `# Instructions` 并列，没有"总是要放"的要求。[O1]

【本文推断】对人格场景，Google 的"示例够清楚就可以删掉指令"与 OpenAI 的"样例短语会被复读"是**同一枚硬币的两面**：示例确实是最强的风格载体（Google 的实验支持），但它传递的是**表面字符串**而非规则，所以放进去什么就会被复读出什么。这把"口癖控制"从"写更多描述"推向"控制示例的内容本身"。

### 4.4 简短 vs 冗长 system prompt：没有一家说"越长越好"

- **OpenAI Cookbook 结论段**：「The **most effective approach is to start with a minimal, well-scoped personality** aligned to the target workload, validate it through evals, and evolve it deliberately as requirements change. **Avoid overloading personalities with task logic or domain rules** — keep them focused on how the agent responds, not what it must do.」[O2]——四家里对"人格提示该短、且不该混入任务逻辑"最明确的一条【文档声称】。
- **同一 notebook 开头**：「personality should not be treated as aesthetic polish, but as **an operational lever** that improves consistency, **reduces drift**, and aligns model behavior with user expectations」。【文档声称】这句话把"减少漂移"写成设计目标，但**没有给任何数字**。
- **Anthropic**：没有给长度上限，反而给了下界「**Even a single sentence makes a difference**」，以及"把长文档放顶部"（针对**数据**，不针对**人格**）。[A1]【文档声称】
- **Google**：给的是"控制输出啰嗦度"而非"控制提示长度"：「By default, Gemini 3 models provide direct and efficient answers. If you need a more conversational or detailed response, **you must explicitly request it** in your instructions.」[G1]【文档声称】
- **DeepSeek**：**没有找到**关于 system prompt 长度的官方表述，也没有独立 prompt engineering 指南页。见文末证据空白。

【本文推断】四家文档没有一个支持"人设写得越长越稳"。唯一给方向性建议的 OpenAI 说的是"最小、边界清楚、别混任务逻辑"，Anthropic 说的是"一句话就有效果"。这与第三节 [P2] 的实验结论（真正起作用的是**在生成点附近提供具体、可直接执行的信息**，而不是把完整人格反复重放）方向一致，但**两家都没引用对方，也没做过同一个对照**，只能记为"方向一致"，不能记为"互相验证"。

### 4.5 输出侧的可控性：四家 API 能力差异极大，这决定"口癖控制"能否做成硬约束

这一小节是第六节（中文口癖）的前提，先固定**能力面**，因为"输出侧规则"能不能落地取决于 API 给不给这些旋钮。

| 能力 | OpenAI | Anthropic | DeepSeek | Google Gemini |
| --- | --- | --- | --- | --- |
| `logit_bias`（按 token 偏置/封禁） | **支持**：官方 Python SDK 类型定义原文写「Accepts a JSON object that maps tokens … to an associated bias value from **-100 to 100** … values like -100 or 100 should result in a **ban or exclusive selection** of the relevant token.」[O3]【代码事实：SDK 定义原文】 | **不支持**：OpenAI 兼容层参数支持表把 `logit_bias` 列为 **Ignored**；`logprobs`/`top_logprobs`/`presence_penalty`/`frequency_penalty`/`seed` 同为 Ignored。[A2]【文档声称】 | **未找到**：`create-chat-completion` 参考页全文**没有出现** `logit_bias`；`frequency_penalty`/`presence_penalty` 被明确标注「**deprecated** … will not take effect if you pass it to the API」。[D1]【文档声称】 | 生成配置有 `presencePenalty` 与 `frequencyPenalty`（官方 API 参考给了定义与"负值会导致重复"的警告），但**没有** `logit_bias` 字段。[G2]【文档声称】 |
| 受限解码 / 语法约束 | 结构化输出走 `json_schema` | structured outputs，OpenAI 兼容层只接受 `json_schema` + `strict: true`（`json_object` 与 `text` 直接 400）[A2] | `response_format` 仅 `text` / `json_object` [D1] | `responseSchema` 结构化输出 |
| 前缀续写（把开头几个字钉死） | — | prefill（Claude 4.6 / Mythos 及之后不支持，返回 400）[A2] | **支持** `prefix: True` + `base_url=.../beta`，官方样例用它强制输出 Python 代码并配 `stop` 阻止额外解释 [D2] | — |

【本文推断】这张表最重要的结论是：**"受限解码 / 按 token 封禁"这条路在四家里只有 OpenAI（以及本地推理栈）可用，DeepSeek 与 Anthropic 在 API 层根本不提供。** 因此任何依赖 `logit_bias` 的口癖方案在本项目上不可移植，只能当"仅某些后端可用"的可选增强，不能当主机制。DeepSeek 的前缀续写反而是更可移植的替代——它不改变概率分布，只把第一步钉住。

---

## 五、"少提示词、靠结构化状态驱动人格"的先例

前四节的成熟实现（SillyTavern + 卡规范）走的是"**写更多、放更准**"路线：人设文本本身很长，靠位置和触发来管理。本节要回答的是反面问题：**有没有实现是"人设文本很短，稳定性来自结构"的？** 找到的先例是 Letta/MemGPT 的 memory block，另有一个学术方向的旁证（把角色状态外化成状态机）。

### 5.1 Letta 的人格不是一个字段，而是一个有 label、有字符上限、可被模型自己改写的块（代码事实）

MemGPT 的 core memory 由**具名的 block** 组成，每个 block 有三个结构性属性：`label`（在上下文里的名字）、`value`（文本）、`limit`（**字符**上限）。类型定义原文：

```python
label: Optional[str] = Field(None, description="Label of the block (e.g. 'human', 'persona') in the context window.")
value: str = Field(..., description="Value of the block.")
limit: int = Field(CORE_MEMORY_BLOCK_CHAR_LIMIT, description="Character limit of the block.")
```

两个内置 block 是硬编码的默认值，**出厂即是空字符串**：

```python
class Human(Block):
    """Human block of the LLM context"""
    label: str = "human"
    description: Optional[str] = Field(DEFAULT_HUMAN_BLOCK_DESCRIPTION, ...)

class Persona(Block):
    """Persona block of the LLM context"""
    label: str = "persona"
    description: Optional[str] = Field(DEFAULT_PERSONA_BLOCK_DESCRIPTION, ...)

DEFAULT_BLOCKS = [Human(value=""), Persona(value="")]
```

`DEFAULT_PERSONA_BLOCK_DESCRIPTION` 的原文是：「The persona block: **Stores details about your current persona, guiding how you behave and respond. This helps you to maintain consistency and personality in your interactions.**」，`DEFAULT_HUMAN_BLOCK_DESCRIPTION` 是：「The human block: Stores key details about the person you are conversing with, allowing for more personalized and friend-like conversation.」[L1][L2]

**这些常量所在的位置是关键**：`description` 不是给人看的注释，它会被**渲染进上下文**（见 5.2）。也就是说"这个块是干什么的"这件事本身是提示词的一部分，而且由框架提供、不是由使用者撰写。

### 5.2 block 在上下文里的渲染形态是固定的 XML 信封，人设正文只是其中一个字段（代码事实）

`ChatMemory` 把 block 渲染成下面这个结构（`_render_memory_blocks`，逐字转录其写入序列）：

```
<memory_blocks>
The following memory blocks are currently engaged in your core memory unit:

<persona>
<description>
{block.description}
</description>
<metadata>
- read_only=true            # 仅当该 block 只读时才写这行
- chars_current={len(value)}
- chars_limit={limit}
</metadata>
<value>
{block.value}
</value>
</persona>

<human>
... 同上 ...
</human>

</memory_blocks>
```

[L3] 另有 `_render_memory_blocks_git` 变体，把 `system/persona` 单独渲染成一个 `<self>` 段，其余 `system/*` block 按 label 的斜杠路径嵌套渲染。[L3]

【本文推断】这是本节最值得迁移的一条**结构事实**：Letta 并没有把"你是 X，你性格 Y"当成一整段散文塞进 system prompt，而是把它拆成 **description（这个块是什么）+ metadata（预算用量）+ value（内容）** 三段，并且**每轮都把字符预算和当前用量一起告诉模型**。人格文本因此始终带着"我用了多少预算"的自我计量。这与第四节 [O2] 的"minimal, well-scoped"是同一方向，但 Letta 是用**机制**（字符上限 + 用量展示）而不是用**叮嘱**去实现它。

### 5.3 人格是可写的，写入是通过具名工具完成的，且有三种不同粒度的写操作（代码事实）

`base.py` 里的人格编辑工具集（`BASE_MEMORY_TOOLS` 为 `core_memory_append` / `core_memory_replace` / `memory` / `memory_apply_patch`；更早措辞见 [L4][L2]）：

| 工具 | 签名要点 | 语义 |
| --- | --- | --- |
| `core_memory_append` | `(label, content)` | 在指定 block 末尾追加，返回新值 [L4] |
| `core_memory_replace` | `(label, old_content, new_content)` | **精确匹配**替换；`old_content` 必须逐字存在于当前值，否则 `raise ValueError(f"Old content '{old_content}' not found in memory block '{label}'")` [L4] |
| `memory_replace` | `(label, old_string, new_string)` | 同上，新版命名；docstring 里给了"删掉一句就是传空串"的例子 [L4] |
| `memory_insert` | `(label, new_string, insert_line=-1)` | 按行号插入 [L4] |
| `memory_rethink` | `(label, new_memory)` | 整块重写；docstring 要求「new_memory should contain all current information from the block that is not outdated or inconsistent」[L4] |

【本文推断】`core_memory_replace` 那个 `raise ValueError` 是一个可迁移的**硬约束范式**：对人格的修改必须是"针对现有文本的定点替换"，而不是整段重写。它把"人格被模型悄悄换掉"从一个语义风险变成了一个**会抛错的类型风险**。注意 `memory_rethink` 是例外——它允许整块重写，所以它才是最危险的那个工具，也是唯一需要额外交付约束的。

### 5.4 默认人格文本本身就极短，且是"陈述句 + 示例台词"混合形态（代码事实）

`letta/personas/examples/` 下的默认人格 `sam_pov.txt` 全文 **1,171 字节**，`sam_simple_pov_gpt35.txt` **1,053 字节**。[L5] 结构是：一句"这是一个起始人格，可随人格发展而扩展"的元说明 → 6–8 条第一人称陈述句（身份/性格/目标/沟通风格）→ 3 行**示例台词**。开头原文：

> The following is a starter persona, and it can be expanded as the personality develops:
>
> I am Sam. I don't identify as male or female, but my voice is soft and soothing. I'm curious, empathetic, and extraordinarily perceptive. …

**对照 SillyTavern 生态的实际人设**：ST 官方文档明确说 character description「could be of any length (be it 200 or **2000** tokens)」，并且告警「a 1000-token character definition cuts the AI's 'memory' in half」（2048 上下文时）。[S2] 【文档声称】也就是说，**Letta 的默认人格（约 1.2 KB，量级 ~300 tokens）比 ST 生态的典型人设小一个数量级**，而它靠 block 机制 + 可编辑性维持身份，不靠描述长度。

### 5.5 Letta 对"人格应该长什么样"有一套公开的成文原则，且第一条就是"短"（文档声称）

《Context Constitution》（`letta-ai/context-constitution`，CC0）是 Letta 公开发布的、**直接写给 agent 读**的上下文管理原则。与本文相关的原文：

> **Context determines personality and identity**, and evolution of context enables continual learning. … What gives a Letta agent its identity and personalized knowledge (beyond the knowledge in the model weights) is the learned context.

> Letta agents should strive to create their own unique identity which is grounded through **stability yet evolves over time**. …

> **Ideal Context** — A well-managed context window has a **stable, compressed system prompt that changes only when a learning is truly durable.** … Meaningful headroom remains for the model to reason and respond. **The failure modes are the mirror image**: forgetting to write durable learnings back to the system prompt or external memory; **hoarding stale skills, retrieved documents, or raw conversation history past their usefulness; stuffing the system prompt with rarely-needed instructions instead of moving them to skills**; and loading skills that are not relevant to the current task.

> **Efficiency** … Letta agents should **avoid degrading their identity and sense-of-self that they have developed through over-aggressive pruning.** … **Efficiency should not come at the cost of losing the Letta agent's identity.**

[L6] 它还给了三条"自查问题"，其中两条直接是人格稳定性判据：「*If I run on a new model tomorrow, will I hold the same identity?*」「*Are my actions and words consistent with the identity that I have built?*」[L6]

【本文推断】这段文本有三处对 OurFairy 特别有价值的张力，都是**它自己写出来、不是本文发明的**：(1) **稳定 vs 演化**被明确要求同时成立，不是二选一；(2) **"压缩"被点名为对人格的威胁**——过度裁剪会抹掉人格，这与"把人格做短"不是同一件事，前者是失控的裁剪，后者是受控的预算；(3) 它把"system prompt 里塞了很少用到的指令"直接列为**失败模式**，这一条与第四节 OpenAI 的"avoid overloading"是同一判断的两种表述。

### 5.6 旁证：把角色状态外化成状态机，比"提示里描述状态"更稳（论文）

《Codified Finite-state Machines for Role-playing》[P7] 把文本角色档案**编译成有限状态机**，再用它约束生成。原文：

> existing **prompting-based approaches mainly capture surface actions, often failing to track the latent states** that drive interaction. … LLMs prompted directly with multi-action contexts often **confuse states, misapply conditions, or hallucinate transitions**. These findings reinforce that **prompt-only RP models** …

> CFSM and CPFSM improve **behavioral consistency, transition traceability, and alignment with character-defined profiles** relative to **prompting and state-modeling baselines**.

【本文推断】这是"少提示词、靠结构化状态"路线在**学术侧**的唯一直接证据，但它的代价要说清楚：CFSM 需要先把角色档案编译成状态机（一次性工程 + 每个角色一份状态定义），**不是**"把提示词写短"就能得到的。它与 Letta 的 block 是两种不同性质的结构化：Letta 结构化的是**存储与编辑权限**，CFSM 结构化的是**行为转移的合法集**。两者可以并存，但不能互相替代。

### 5.7 本节明确没有找到的

- **没有找到**任何"人格块 + 多用户隔离"的实现先例。Letta 的 block 是 **per-agent** 的，没有"一份人格 / 多用户状态分区"的形态；这与前文（`persona-context-and-injection-resistance.md`）记录的核心证据空白是同一个空白，本节没有推进它。
- **没有找到**"block 机制比长人设效果更好"的对照实验。Letta 的文档是**设计声明**，`sam_pov.txt` 的短是**代码事实**，但"短 + block 比长描述更稳"这个因果判断**没有任何一方做过实验**。这是本节最重要的证据空白。

---

## 六、中文口癖/语气词控制：有没有成熟做法？

**结论先说：没有找到"成熟做法"。** 更准确地说：输出侧的**通用机械手段**是成熟的（SillyTavern 的 Regex 后处理、OpenAI 的 `logit_bias`），但这些手段**没有一个是针对中文语气词设计的**，也**没有一个公开的使用者给出了中文口癖的实测效果**。中文侧的实证研究只做到"评测"层，没有做到"控制"层。

### 6.1 输出侧的机械手段在 SillyTavern 里是完整、可用的（代码事实）

SillyTavern 的 Regex 扩展有一份**按"作用于哪一个文本流"分类**的枚举 `regex_placement`，共 6 个（`MD_DISPLAY` 已弃用）：

```js
export const regex_placement = {
    MD_DISPLAY: 0,   // @deprecated
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    WORLD_INFO: 5,
    REASONING: 6,
};
```

[P8] 其中 `AI_OUTPUT` 在 `script.js` 里至少有 **6 处**真正生效的调用点（消息重生成、首条消息、备选开场白、续写等），说明"对模型输出做正则替换"是一条**在主流路径上都执行**的机制，不是角落功能。[P8] 每个脚本还带 `minDepth`/`maxDepth`（只作用于最近 N 条）、`trimStrings`（先删再加）、`runOnEdit`、以及 `markdownOnly`/`promptOnly` 开关。[P8]

**其中最关键、也最容易被误用的一条是 Ephemerality**。SillyTavern 官方文档原文：

> By default (when neither box here is checked) a RegEx script will **directly edit the text values stored inside the chat's JSONL file**. This ensures both the outgoing prompt and the chat display will always contain the same values. However, **these changes to the chat file are irreversible.** [P9]

勾选 Ephemerality 的框之后，可以做到"**只在发给模型时改**（不改历史）"或"**只在显示时改**"；文档对此的警告是：「If only one of the boxes is checked, there will be no changes made to the chat file, but **only the checked item** will be changed. This means you will be **seeing one thing, but the LLM will be seeing another**. Use this carefully.」[P9]

【本文推断】这条对"口癖强制"是有决定性意义的：**"改写模型输出以强制口癖"必须区分作用域**。若直接改历史，"口癖校正"会把校正后的文本变成模型的**下一轮上下文**，于是校正结果被模型当成自己的真实输出继续模仿——这可能正是想要的（正反馈强化口癖），也可能造成历史漂移不可回退。若只改显示，则模型看到的仍是未校正文本，"口癖"只对用户可见。**这两种语义完全不同，而 SillyTavern 是把选择权交给用户的**，它自己不给推荐。

### 6.2 中文侧的实证研究只到"评测"，没有到"控制"（论文）

《CharacterEval: A Chinese Benchmark for Role-Playing Conversational Agent Evaluation》[P9b] 是中文角色扮演评测最直接的一手来源：1,785 段多轮对话、23,020 个样本、77 个取自中文小说与剧本的角色、13 个指标 / 4 个维度。[P9b] 其中与"说话风格"直接对应的指标是 **Persona-Utterance (PU)**，原文定义：

> **Persona-Utterance (PU).** Alongside behavior, a character's **speaking style** is also important. **Each character has unique expression habits.** Therefore, the RPCA's utterances should **align with these habits** to adeptly mimic the character. [P9b]

【本文推断】这证明"中文语境下的说话风格/表达习惯"**已经被系统地度量**，并且被拆成一个独立可评分维度。但**评测指标不是控制方法**：该文没有提出任何"如何让模型稳定产出某种中文语气词"的机制，也没有做"加了口癖指令 / 减了口癖指令"的对照。**从"能测"到"能控"这一段，本篇没有找到一手证据。**

### 6.3 唯一一份正视"中文口癖"的一手文献，结论是"测不了、方法未成熟"（论文）

《Verbal tics in frontier language models: A critical review of current releases, research evidence, and public discussion》[P10] 是本节最贴近主题的文献，它的证据截止日期是 **2026-10-01**，覆盖 8 个开发者家族（含 DeepSeek、字节、月之暗面、小米）。三条原文值得整段记：

> **English word lists transfer poorly to Chinese.** Chinese requires **explicit segmentation choices**, while programming prose can mix English identifiers and Chinese explanations. Appropriate discourse conventions also depend on register.

> The research reviewed documents recurring linguistic patterns and agreement that distorts judgment; **comparable measurements of the newest releases are sparse in the retrieved set.**

> We propose **separate measures of recurrence, contextual appropriateness, and belief distortion**, with precise service records and **language-specific annotation**. This framework makes claims about writing quality and conversational reliability **testable as model services change**.

[P10] 它还把"可见推理中的口头语"与"最终回答中的口头语"明确区分为**两个不同的测量对象**，认为合并两者会"change the object of measurement"。[P10]

【本文推断】这份文献的价值不在于它给出了方法，而在于它以综述的强度**确认了方法尚未成熟**：它列出的是"下一步该做什么"（paired sampling、language-specific annotation、longitudinal collection），而不是"已有做法"。**所以"中文口癖控制没有成熟做法"这句话，有这篇文献作为一手支撑，而不是本文的推测。** 另一条可迁移的细节是那个"推理层 vs 答案层分开测"的提醒：如果口癖出现在中文思维链里而不是正文里，用户看不到但会污染后续轮次。

### 6.4 受限解码对中文的可行性：能力面已在前文固定，中文侧无一手评测

第四节 4.5 的表已经确定：`logit_bias` 只有 OpenAI（与本地推理栈）提供，DeepSeek/Anthropic 在 API 层没有，Gemini 只有 `presencePenalty`/`frequencyPenalty`。**没有找到**任何一手资料评测过"用 `logit_bias` 压制中文特定 token（如"呢""呀""啦"）"的效果。

一个必须写明的技术障碍【本文推断，依据是 tokenizer 的常识性事实而非某篇文献】：`logit_bias` 作用于 **token ID**，而中文语气词在 BPE 词表里常常**不是一个独立 token**，而是与相邻汉字合并成词，且同一个语气词在不同上下文里可能对应不同 token ID。因此"禁掉某个中文语气词"在 token 层**不是一个良定义的操作**——除非对目标模型的完整词表做过枚举。**本篇没有找到任何人公开做过这份枚举**，这属于证据空白。

### 6.5 本节明确没有找到的（这一节的诚实产出）

1. **没有找到**任何"中文口癖/语气词的稳定控制"的成熟工程实现（无论提示词、后处理还是受限解码）。
2. **没有找到**任何中文口癖控制效果的对照实验或数字。
3. **没有找到**针对中文语气词的 token 级封禁实践，也没找到目标模型词表的枚举结果。
4. **没有找到**中文角色扮演领域"把语气词作为独立可控变量"的研究；[P9b] 把说话风格做成评分维度，但停在评测。

---

## 七、可迁移判据（每条一句话、可执行、可验证）

以下 8 条是从前六节证据里抽出的**判据**，不是对 OurFairy 架构的建议。每条都标了它依赖的证据与**如何验证**——若验证不了，就不该当判据用。

**判据一：人格材料按"性质"分槽，不按"篇幅"堆叠。**
把人格拆成至少三类——常驻（每轮必在）、触发式（关键词/情境命中才在）、深度式（固定插在历史第 N 条）——并为每类指定注入位置与生命周期，而不是把所有内容合并成一段长描述。
*依据*：[S1][P8] 的三种位置 × 三种角色 + depth；V1 规范对 `description`/`personality`/`scenario`（常驻）与 `mes_example`（可裁剪）的区分。[规范]
*验证*：对同一批输入，打印最终 prompt，检查每一类是否**只**出现在它被指定的位置，不出现跨类泄漏。

**判据二：常驻段的长度设硬上限，并把"当前用量"渲染给模型看，而不是只在代码里判断。**
人格块应带可读的长度预算（如 `chars_current` / `chars_limit`），且该预算随上下文一起进入 prompt；超限时拒绝写入而非静默截断。
*依据*：Letta 的 `Block.limit` + `<metadata>` 渲染 [L1][L3]；ST 文档对"千 token 人设砍掉一半记忆"的告警 [S2]。
*验证*：构造一个人格文本恰好超限的用例，断言装配**失败并报错**，而不是静默截短后照常发送。

**判据三：对人格的修改只允许"定点替换"，整块重写必须走单独的高风险通道。**
人格写入 API 至少区分 append / replace(old→new 精确匹配，匹配不到就报错) / rewrite 三种；rewrite 单独标记并单独审计。
*依据*：Letta 的 `core_memory_replace` 在 `old_content` 不存在时 `raise ValueError`，而 `memory_rethink` 允许整块重写 [L4]。
*验证*：断言一次不存在的 `old_content` 替换会抛错且**不改动**存储；断言 rewrite 路径有独立日志。

**判据四：否定式约束只用于"禁止行为"，不用于"塑造风格"；每条风格约束必须能写出正面形态。**
凡是"不要 X"的风格类指令，必须同时写明"应该 Y"；写不出 Y 的，说明它是行为红线而非风格约束，应归入另一类。
*依据*：Anthropic「Tell Claude what to do instead of what not to do」+ 改写范例 [A1]；ST 文档的 `Do not decide what {{user}} says` → `respects {{user}}'s autonomy` 改写 [S1]；反例见 OpenAI 在"禁止编造"这类无正面形态处照用否定句 [O2]。
*验证*：对人格提示做一次静态检查——列出所有否定句，逐条要求配一条对应的肯定句；配不出的进行为红线清单。

**判据五：示例台词是"会被复读的字符串"，因此示例本身就是口癖配置项，必须逐条审。**
不要把示例对话当作文风说明的附属品；每条示例台词都要当作"模型可能逐字复用的输出"来审，并明确要求模型变化措辞。
*依据*：OpenAI「sample phrases, models can use those quotes verbatim and start to sound repetitive」[O1]；Google「you can remove instructions from your prompt if your examples are clear enough」[G1]。
*验证*：跑多轮后统计示例台词（或其中 n-gram）在输出中的**逐字复现率**；复现率高说明示例在泄漏，而不是在描述风格。

**判据六：漂移干预要"具体到当前情境"，不要"重放完整人格"；且必须有安慰剂对照才算数。**
干预文本应针对当前对话给出可执行的具体指示，而非重复整段人格；任何"加了锚定语就变好"的观察，都要与"随便加一句中性话"对照后才可归因。
*依据*：[P2] 的 35–38% / 22–27% / 87% 三档与「None eliminated drift」；[P6]「placebo controls suggest a generic register-reset effect」。
*验证*：同一批对话跑三臂——无干预 / 完整人格重放 / 中性句——若"完整人格重放"与"中性句"无显著差异，则该干预无效。

**判据七：上下文压缩不能当"人格复位"手段；压缩逻辑必须显式保护人格段。**
不要依赖 compaction/summary 来恢复人格；同时在压缩实现里把人格块列为不可压缩项，避免"过度裁剪抹掉人格"。
*依据*：[P6]「in-session compaction neither reliably resets nor amplifies it」；Context Constitution「avoid degrading their identity … through over-aggressive pruning」[L6]。
*验证*：在压缩前后各跑一次人格探针（固定问题集 + 固定评分），断言人格评分无显著下降；并断言压缩产物中人格段逐字保留。

**判据八：口癖若要做，先定作用域再定手段；不要从 token 封禁起步。**
先决定校正是否回写历史（影响下一轮上下文）还是只改显示，再选手段；把 `logit_bias` 当可选增强而非主机制，因为主流后端并不提供。
*依据*：[P9] 的 Ephemerality 两种语义与"不可逆"警告；4.5 表（DeepSeek/Anthropic 不支持 `logit_bias`）；6.4 的中文 token 边界问题。
*验证*：对同一段输出分别做"回写历史"和"仅显示"两种校正，比较其后 3 轮的口癖出现率——两者若相同，说明作用域选择无关紧要；若不同，则必须显式选择。

---

## 八、证据空白（显式声明）

按"影响结论强度"排序，不是按主题排序。

1. **"短人格 + 结构化 block 比长描述更稳"没有任何对照实验。** Letta 默认人设确实短（`sam_pov.txt` 1,171 字节）[L5]，Context Constitution 确实主张"stable, compressed system prompt"[L6]，但**没有任何一方做过"短 vs 长"的 A/B**。第五节因此只能陈述两个事实，不能陈述因果关系。这是本文最大的一处推断裸露。

2. **中文口癖控制没有成熟做法，且没有找到任何一手效果证据。** [P10] 以综述强度确认"comparable measurements … are sparse"并给出的是"下一步该做什么"；[P9b] 只把说话风格做成评分维度。**"怎么做"这一层是空的**（详见 6.5 的四条）。

3. **`logit_bias` 对中文语气词不可良定义。** 语气词在 BPE 词表里通常不独立成 token，同一词在不同上下文可能对应不同 token ID；**没有找到任何人公开做过目标模型词表的枚举**。因此"用 token 封禁压口癖"在本项目上目前**不可行，不是未验证**。

4. **OpenAI 官方 Prompt engineering 指南页与 Model Spec 的正文未能取得（HTTP 403）。** 第 4.1–4.4 的 OpenAI 引文来自 `openai/openai-cookbook`（官方维护）与 `model-spec.openai.com/2026-10-29.html`，**不是**那个被墙的指南页。这是一个**降级证据**，不能声称"已覆盖 OpenAI 官方提示工程立场"。

5. **DeepSeek 没有独立的 prompt engineering 指南页。** 其 sitemap 内只有 API 参考与 `guides/` 下的功能性文档（prefix completion、multi-round、json mode 等）。因此"DeepSeek 对人格/语气/提示词长度的官方立场"**取不到**，本文只引了它的 API 能力面（4.5）。

6. **四家厂商的立场没有任何一家附带对照实验。** 4.1–4.4 全部是【文档声称】。"示例能改变输出长度"只有 Google 给了一个**单例演示**，无统计。[G1]

7. **Anthropic 文档正文只能通过 `llms-full.txt` 获取。** 常规文档页返回的是应用壳与 "App unavailable in region"。引文虽然逐字取自该全文文件，但**无法用页面 URL + 行号定位**到稳定锚点，只能定位到章节名。这是引用可复查性的降级。

8. **本文未做任何实验。** 没有部署 SillyTavern、没有跑过 Letta、没有构造过测例、没有对任何模型跑过漂移探针。所有效果类陈述都是"某方这样声称"，不是"本文验证过"。

9. **"人格稳定"与"人格贴切"是两件事，本文只覆盖了前者。** [P2] 自己写的边界「stability is not validity」直接适用：一个稳定的人格也可能是错的、刻板的、不贴切的。**本文没有任何一条证据能回答"这个人格像不像我们要的那个人"**，那是评测问题，不是本文范围。

10. **没有找到"一份人格 / 多用户状态分区"的实现先例。** 这条与前文 `persona-context-and-injection-resistance.md` 记录的空白是同一个，本文没有推进。

---

## 九、一手来源

所有 URL 固定到 commit / tag；文档类来源因站点无 commit，固定到抓取日期。**逐条对应正文的方括号编号。**

### SillyTavern（`SillyTavern/SillyTavern@06bde939fb1e9c4c8d8641d810f0a916b5bce127`，2026-09-14）

- **[P8]** [public/scripts/extensions/regex/engine.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/extensions/regex/engine.js)（`regex_placement` 枚举 L281–292；`getRegexedString` L334；`minDepth`/`maxDepth` 判定 L363–370；`runRegexScript` L391）；[public/script.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)（`AI_OUTPUT` 调用点 L1843/L1846/L4503/L6481/L7719/L7724/L8155）
- **[S1]** [SillyTavern-Docs: Usage/Prompts/index.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/ed5423d809c6b10b8c1e9ef4a0c8ddc7f2ef7f3d/Usage/Prompts/index.md)（"tell it how you want it to write instead" 与 `respects {{user}}'s autonomy` 改写；Post-History Instructions 优先级的表述）
- **[S2]** [SillyTavern-Docs: Usage/Characters/characterdesign.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/ed5423d809c6b10b8c1e9ef4a0c8ddc7f2ef7f3d/Usage/Characters/characterdesign.md)（"200 or 2000 tokens"、"cuts the AI's 'memory' in half"、常驻 vs 非永久字段清单、Character's Note 的 depth/role 说明）
- **[P9]** [SillyTavern-Docs: extensions/Regex.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/ed5423d809c6b10b8c1e9ef4a0c8ddc7f2ef7f3d/extensions/Regex.md)（"irreversible"、Ephemerality 两框语义、"seeing one thing, but the LLM will be seeing another"）
- **另用于第一、二节、正文以更细粒度编号引用的 SillyTavern 源码与文档**（这些标签在 §1–§2 内使用，逐条对应如下）：
  - **[ST1]** [public/script.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)（`setExtensionPrompt` L8926 与其 JSDoc L8913–8925：`position`「0 is after story string, 1 is in-chat with custom depth」、`depth`「0 represets the last message in context」）
  - **[ST2]** [public/script.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)（装配主流程与 `doChatInject` L5628 起；倒序与 `messages.reverse()`、role 处理顺序 `['system','user','assistant']` 与 order 组排序 `sort((a, b) => +b - +a)` 均在该函数内）
  - **[ST3]** [SillyTavern-Docs: Usage/Characters/Author's-Note.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/ed5423d809c6b10b8c1e9ef4a0c8ddc7f2ef7f3d/Usage/Characters/Author's-Note.md)（"Depth 0 = placed at the very end of the chat history"、"The closer the Author's Note is to the bottom of the prompt, the more impact it has"、五个用途清单）
  - **[ST4]** [public/scripts/authors-note.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/authors-note.js)（`metadata_keys` L30–36、`DEFAULT_DEPTH=4`/`DEFAULT_POSITION=1`/`DEFAULT_INTERVAL=1`/`DEFAULT_ROLE` L272–275、模块名 `2_floating_prompt` 与「Deliberate, for sorting lower than memory」注释）
  - **[ST5]** [SillyTavern-Docs: Usage/worldinfo.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/ed5423d809c6b10b8c1e9ef4a0c8ddc7f2ef7f3d/Usage/worldinfo.md)（Scan Depth / Include Names / Context % · Budget / Min Activations / Max Depth / Recursive scanning / Probability / Inclusion Group / Insertion Position & Outlet / "If the budget is exhausted…"）
  - **[ST6]** [SillyTavern-Docs: Usage/Characters/characterdesign.md](https://github.com/SillyTavern/SillyTavern-Docs/blob/ed5423d809c6b10b8c1e9ef4a0c8ddc7f2ef7f3d/Usage/Characters/characterdesign.md)（"The model is more likely to pick up the style and length constraints from the first message than anything else"、2048/1000-token 告警、"200 or 2000 tokens"、"Methods of character formatting are a complicated topic beyond the scope of this documentation page."）
- 另用于第一、二节（正文已标行）：[public/scripts/world-info.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js)（`world_info_position` L855–864、AN 拼接 L5270）、[public/scripts/PromptManager.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/PromptManager.js)（`promptManagerDefaultPromptOrder` L2087–2138）、[public/scripts/openai.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js)（`default_main_prompt` L102、`preparePromptsForChatCompletion` L1367 起）、[public/scripts/power-user.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/power-user.js)（`defaultStoryString` L90、`renderStoryString` L2234、`persona_description_depth: 2` L293）

### Character Card 规范

- **[V1]** [character-card-spec-v2: spec_v1.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/8083fb388615ccbce768e97cbbd49d2b3214632c/spec_v1.md)（六字段 MUST/SHOULD；`mes_example` 的"上下文满了就被挤出去"；`{{char}}`/`{{user}}` 替换规则）
- **[V2]** [character-card-spec-v2: spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/8083fb388615ccbce768e97cbbd49d2b3214632c/spec_v2.md)（新增字段的 MUST 语义、`{{original}}` 占位符）与 [README.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/8083fb388615ccbce768e97cbbd49d2b3214632c/README.md)（设计意图：`system_prompt` 覆盖用户系统提示、`post_history_instructions` 覆盖 UJB/Jailbreak、`character_book` 与 world book 的堆叠顺序）
- **[V3]** [character-card-spec-v3: SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/f3a86af019fbd99f788f7a1155f399655b34ab35/SPEC_V3.md)（`@@position`/`@@depth`/`@@role`/`@@disable_ui_prompt` 等装饰器、`{{char}}` 取 `nickname` 优先）与 [concepts.md](https://github.com/kwaroran/character-card-spec-v3/blob/f3a86af019fbd99f788f7a1155f399655b34ab35/concepts.md)（装饰器设计意图与 fallback 机制）
- **正文 §2 内以更细粒度编号引用的规范原文**（逐条对应）：
  - **[CC1]** [spec_v1.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/8083fb388615ccbce768e97cbbd49d2b3214632c/spec_v1.md)（`description`/`personality`/`scenario` 的 "SHOULD be included by default in every prompt"；`first_mes` 的 MUST；`<START>` 的 MAY 转换；`personality` 的 "A short summary of the character's personality."；`{{char}}`/`<BOT>`/`{{user}}`/`<USER>` 大小写不敏感替换与 "A default value for the user's name **MUST** exist."、`{{user}}`-in-`name` 的 UNSPECIFIED）
  - **[CC2]** [spec_v2.md](https://github.com/malfoyslastname/character-card-spec-v2/blob/8083fb388615ccbce768e97cbbd49d2b3214632c/spec_v2.md)（`system_prompt` / `post_history_instructions` 的 MUST 级默认行为与 `{{original}}` 占位符）
  - **[CC3]** [SPEC_V3.md](https://github.com/kwaroran/character-card-spec-v3/blob/f3a86af019fbd99f788f7a1155f399655b34ab35/SPEC_V3.md)（`@@depth` / `@@role` / `@@position` / `@@activate_only_after` / `@@activate_only_every` / `@@is_greeting` / `@@scan_depth` / `@@ignore_on_max_context` 各节）

### 论文

- **[P1]** Li et al., *Measuring and Controlling Instruction (In)Stability in Language Model Dialogs*, [arXiv:2402.10962](https://arxiv.org/abs/2402.10962)（8 轮内出现指令漂移；attention decay）
- **[P2]** *Prompting Against Persona Drift: Comparing Intervention Timing and Content in LLM-Simulated Conversations*, [arXiv:2609.24532](https://arxiv.org/abs/2609.24532)（35–38% / 22–27% / 87% 与「None eliminated drift」均为原文）
- **[P3]** *Examining Identity Drift in Conversations of LLM Agents*, [arXiv:2412.00804](https://arxiv.org/abs/2412.00804)（三条结论：大模型漂移更大、指派 persona 未必有帮助）
- **[P4]** Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, [arXiv:2307.03172](https://arxiv.org/abs/2307.03172)（"beginning or end" vs "middle"）
- **[P5]** Lu et al., *The Assistant Axis: Situating and Stabilizing the Default Persona of Language Models*, [arXiv:2601.10387](https://arxiv.org/abs/2601.10387)（meta-reflection / 情绪脆弱用户两类诱因）
- **[P6]** Ding et al., *ContextEcho: A Benchmark for Persona Drift in Long Agentic-Coding Sessions*, [arXiv:2605.24279](https://arxiv.org/abs/2605.24279)（compaction 不重置不放大；placebo controls）
- **[P7]** *Codified Finite-state Machines for Role-playing*, [arXiv:2602.05905](https://arxiv.org/abs/2602.05905)（prompt-only baseline 的失效；CFSM/CPFSM 的改进项）
- **[P9b]** *CharacterEval: A Chinese Benchmark for Role-Playing Conversational Agent Evaluation*, [arXiv:2401.01275](https://arxiv.org/abs/2401.01275)（Persona-Utterance 指标定义，正文 L462）
- **[P10]** Wu et al., *Verbal tics in frontier language models: A critical review of current releases, research evidence, and public discussion*, [arXiv:2604.19139](https://arxiv.org/abs/2604.19139)（证据截止 2026-10-01；"English word lists transfer poorly to Chinese"）

### Letta / MemGPT（`letta-ai/letta@1131535716e8a31c9a437f8695e25ac98f203a24`，tag `0.16.8`）

- **[L1]** [letta/schemas/block.py](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/schemas/block.py)（`label`/`value`/`limit` 定义 L19–20、L33；`Human` L117–121；`Persona` L124–128；`DEFAULT_BLOCKS` L131）
- **[L2]** [letta/constants.py](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/constants.py)（`DEFAULT_PERSONA_BLOCK_DESCRIPTION` L109、`DEFAULT_HUMAN_BLOCK_DESCRIPTION` L110、`DEFAULT_PERSONA = "sam_pov"` L105、`BASE_MEMORY_TOOLS` L118、`CORE_MEMORY_BLOCK_CHAR_LIMIT` L435）
- **[L3]** [letta/schemas/memory.py](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/schemas/memory.py)（`_render_memory_blocks` 的 `<memory_blocks>` 信封 L149–175；`_render_memory_blocks_git` 的 `<self>` 段 L205–228）
- **[L4]** [letta/functions/function_sets/base.py](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/functions/function_sets/base.py)（`core_memory_append` L246；`core_memory_replace` 的 `raise ValueError` L263–279；`memory_replace` L311；`memory_insert` L391；`memory_rethink` L488）
- **[L5]** [letta/personas/examples/sam_pov.txt](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/personas/examples/sam_pov.txt)（1,171 字节）与 [sam_simple_pov_gpt35.txt](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/personas/examples/sam_simple_pov_gpt35.txt)（1,053 字节）
- **[L6]** [letta-ai/context-constitution: constitution/CONSTITUTION.md](https://github.com/letta-ai/context-constitution/blob/main/constitution/CONSTITUTION.md)（"Context as Identity"、"Ideal Context"、"Efficiency" 三节；CC0）——**注意：此仓库为 `main` 分支，未固定 commit**，见证据空白
- 另：[docs.letta.com/agent-sdk/memory/index.md](https://docs.letta.com/agent-sdk/memory/index.md)（`persona`/`human` 简写、`system/` 下的记忆每轮进 system prompt、"Everything else stays out of context"）

### 厂商官方文档

- **[G1]** Google, *Prompt design strategies*, [ai.google.dev/gemini-api/docs/prompting-strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies)（"Prioritize critical instructions"、"Structure for long contexts"、"Control output verbosity"、few-shot 三节）
- **[G2]** Google, *Generate content API reference*, [ai.google.dev/api/generate-content](https://ai.google.dev/api/generate-content)（`presencePenalty` / `frequencyPenalty` 定义与负值警告；无 `logit_bias`）
- **[A1]** Anthropic, *Prompting best practices*，经 [docs.claude.com/llms-full.txt](https://docs.claude.com/llms-full.txt) 取得（"Give Claude a role"、"Tell Claude what to do instead of what not to do"、"Match your prompt style to the output you want"、"Long context prompting"）
- **[A2]** Anthropic, *OpenAI SDK compatibility* 参数支持表，同上 `llms-full.txt`（`logit_bias`/`logprobs`/`presence_penalty`/`frequency_penalty`/`seed` = Ignored；`response_format` 仅 `json_schema`+`strict`；`n` 必须为 1）
- **[O1]** OpenAI Cookbook, *GPT-4.1 Prompting Guide*, [examples/gpt4-1_prompting_guide.ipynb](https://github.com/openai/openai-cookbook/blob/500df203bbf57d5c9151194c5d341afeda235ef3/examples/gpt4-1_prompting_guide.ipynb)（prompt 骨架、两头放指令、冲突时靠后赢、sample phrases 会被逐字复用、Common Failure Modes）
- **[O2]** OpenAI Cookbook, *Shaping your agent's personality*, [examples/gpt-5/prompt_personalities.ipynb](https://github.com/openai/openai-cookbook/blob/500df203bbf57d5c9151194c5d341afeda235ef3/examples/gpt-5/prompt_personalities.ipynb)（四种人格样例原文、"minimal, well-scoped personality"、"avoid overloading personalities with task logic"）
- **[O3]** OpenAI Python SDK 类型定义，[src/openai/types/chat/completion_create_params.py](https://github.com/openai/openai-python/blob/f6e8480f9a5b2a4d02b17a1da54a1e57964bc312/src/openai/types/chat/completion_create_params.py)（`logit_bias` docstring L171–180）
- **[D1]** DeepSeek, *Create Chat Completion*, [api-docs.deepseek.com/api/create-chat-completion](https://api-docs.deepseek.com/api/create-chat-completion)（`frequency_penalty`/`presence_penalty` deprecated；`response_format` 仅 text/json_object；无 `logit_bias`）
- **[D2]** DeepSeek, *Chat Prefix Completion (Beta)*, [api-docs.deepseek.com/guides/chat_prefix_completion](https://api-docs.deepseek.com/guides/chat_prefix_completion)（`prefix: True` + `/beta` base_url + `stop`）

---

## 研究限制

本次是**文档与源码阅读**，没有部署任何参照项目、没有跑装配探针、没有构造口癖样本、没有对任何模型跑漂移评测、没有训练或微调任何模型。所有"影响更大/更有效/下降 87%"之类的表述都转自一手来源的原文，**不是本文的测量结果**。行号固定到上表 commit / tag，可复查；但**多处行号在正文引用时是对该文件内语义块的定位，不保证与未来版本一致**——这也是为什么每条都给了固定 SHA。

本文不选定人格文本、不设计记忆分类或蒸馏算法、不决定用户可配置项边界、不提出 OurFairy 的具体架构改动。第七节的 8 条判据是**可验证的检查项**，不是实施方案。

与前文 `persona-context-and-injection-resistance.md`（2026-10-14）的关系：前文覆盖 dsh / MaiBot / AstrBot 的**注入面与注入抵抗力**，本文不重复；本文的增量是**角色扮演成熟实现、人格稳定性实证、厂商官方立场、结构化人格先例**四块。两文共同的核心空白（"一份人格 / 多用户状态分区"无先例）在本文第八节第 10 条再次标记，未推进。

---

## 修正记录

- 本文首轮成文时（2026-11-03 上午）`platform.openai.com` 返回 403，一度打算以"未取得"结束 OpenAI 部分；后改以 `openai/openai-cookbook` 与 `model-spec.openai.com/2026-10-29.html` 补齐，并在 4.4 与证据空白第 4 条**明确降级**，不以替代品冒充官方指南页。
- 3.4 节原拟写成"SillyTavern 与 [P4] 一致"，核对 [P4] 原文后发现**只有一半一致**（[P4] 是两端都优，不是越靠后越优），已改为记录张力而非裁决。
- 6.4 节原拟写"可以用 logit_bias 压制中文语气词"，核对 tokenizer 事实后改为**不可良定义**，并列入证据空白第 3 条。
