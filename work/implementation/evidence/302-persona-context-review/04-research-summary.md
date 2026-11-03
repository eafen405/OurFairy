# task-4 研究摘要（给 Lead）

日期：2026-11-03
产出正文：[`docs/research/2026-11-03-persona-stability.md`](/home/fatfish/OurFairy/docs/research/2026-11-03-persona-stability.md)（755 行，未改 `docs/research/README.md`）
本摘要：`/tmp/persona-review/04-research-summary.md`

---

## 一、三条最有迁移价值的判据

### 判据 A：可信的稳定机制是"具体到当前情境的指示"，不是"把人格重放一遍"——而这条最强的数字其实只是探索性结果

- **证据**：1,200 段 28 轮对话 / 4 模型 / 2 档人格强度，三种提示级干预相对无干预的漂移下降为：完整人格逐字重放 **35–38%**、反思提醒 **22–27%**、行为级具体指令 **87%**。原文同时写「**None eliminated drift**」「no evidence that adaptive timing outperformed static scheduling」。[arXiv:2609.24532](https://arxiv.org/abs/2609.24532)
- **必须随身带的限定**（同一篇作者原话）：「the reinjection advantage is **tentative**, and the behavior-specific comparison is **exploratory and bundled**. It should therefore be treated as **an organizing hypothesis for component-level experiments rather than as a demonstrated general principle**.」该文统计流程也明确 87% 属 exploratory 层。
- **迁移价值**：把"人格约束"从"开头写一段长描述"改成"在生成点附近给出针对本轮的可执行指示"。**但不要引用 87% 这个幅度**，只能引用它的方向。
- **如何验证**：三臂对照（无干预 / 人格重放 / 中性句），若"人格重放"与"中性句"无显著差异，则重放无效。

### 判据 B：否定式约束只能用于"禁止行为"，不能用于"塑造风格"——区分点是"有没有可观察的正面替代形态"

- **证据（三家方向一致，但依据不同）**：
  - Anthropic 成对给出改写范例：「Instead of: "Do not use markdown in your response" / Try: "Your response should be composed of smoothly flowing prose paragraphs."」
  - SillyTavern 给出人格场景同类改写：「*"Do not decide what {{user}} says or does"* … some users find *"Write {{char}}'s responses in a way that respects {{user}}'s autonomy"* is more effective.」
  - **反例**：OpenAI Cookbook 在"禁止编造事实"这类**无正面形态**处照常使用 `Do not fabricate facts, numbers, sources, or citations.`
- **迁移价值**：写人格时，每条"不要 X"必须配一条"应该 Y"；配不出的，说明它是**行为红线**而非风格约束，归另一类管理。
- **如何验证**：对人格提示做静态检查——列全部否定句，逐条要求配对应肯定句，配不出的进行为红线清单。

### 判据 C：人格应带**硬长度预算**并把"当前用量"渲染进 prompt；对人格的修改只允许定点替换

- **证据（Letta/MemGPT，代码事实，tag `0.16.8` = `1131535716e8a31c9a437f8695e25ac98f203a24`）**：
  - 人格是具名 block（`label="persona"`），带**字符**上限 `limit`；渲染时拆成 `<description>` + `<metadata>`（含 `chars_current` / `chars_limit`）+ `<value>` 三段——**每轮把预算用量告诉模型**。
  - `core_memory_replace` 在 `old_content` 不匹配时 `raise ValueError`；只有 `memory_rethink` 允许整块重写（即最危险的那个，需单独管控）。
  - 默认人设 `sam_pov.txt` 仅 **1,171 字节**（对比 SillyTavern 生态典型 1000–2000 tokens）。
- **迁移价值**：人格"短"不是靠自我克制，是靠**机制**（字符上限 + 用量展示 + 拒写而非静默截断）。
- **如何验证**：构造一个恰好超限的人格文本，断言装配**失败并报错**，而不是静默截短后照常发送；断言不存在的 `old_content` 替换会抛错且不改动存储。

---

## 二、其它高价值发现（备选，若上面某条不适用）

- **指令冲突时"靠后的赢"**（OpenAI 明确写：「GPT-4.1 tends to follow the one closer to the end of the prompt」）。这解释了 Author's Note 类机制为何有效，但也意味着**末尾临时注入会压过开头人格**——这是设计时必须显式决定的取舍。
- **"压缩"被人格系统自己点名为威胁**：Letta《Context Constitution》把"stuffing the system prompt with rarely-needed instructions"列为失败模式，同时警告过度裁剪会抹掉人格。另有论文证据表明 in-session compaction「neither reliably resets nor amplifies」漂移——**压缩不能当人格复位手段**。
- **压漂移不能靠"重置"**：ContextEcho 的 single-shot anchor 有效，但**安慰剂对照显示可能只是语域重置**（generic register-reset effect）。任何"加一句锚定语就好"的观察都需要对照组。
- **示例台词 = 会被复读的字符串**：OpenAI 明确警告 sample phrases 会被逐字复用；Google 明确说"示例够清楚就可以删掉指令"。所以**示例本身就是口癖配置项**，必须逐条审。

---

## 三、证据空白（必须让决策知道的部分）

1. **"短人格 + 结构化 block 比长描述更稳"没有任何对照实验。** Letta 的短是代码事实、其主张是文档声称，但因果未验证。这是本报告最大的一处推断裸露。
2. **中文口癖/语气词控制没有成熟做法。** 评测层有（CharacterEval 的 Persona-Utterance 指标），**控制层是空的**。最贴近的综述以明确强度写「comparable measurements of the newest releases are sparse」「English word lists transfer poorly to Chinese」，且它给的是"下一步该做什么"而非已有方法。
3. **`logit_bias` 对中文语气词不可良定义**（语气词通常不独立成 token，同一词在不同上下文对应不同 token ID；未找到任何人做过目标模型词表枚举）。且 **DeepSeek 无此字段、Anthropic 列为 Ignored**——只能当"少数后端可用的增强"，不能当主机制。
4. **OpenAI 官方 Prompt engineering 指南页与 Model Spec 正文取不到（HTTP 403）。** 我用 `openai/openai-cookbook`（官方维护）与 `model-spec.openai.com` 替代，并已在正文**明确降级标注**，不以替代品冒充。
5. **Anthropic 文档正文只能经 `llms-full.txt` 取**，常规页返回应用壳，引文无法给稳定页面锚点。
6. **DeepSeek 无独立 prompt engineering 指南页**（sitemap 已核），其对人格/语气/提示长度的官方立场**取不到**。
7. **本文未做任何实验**：没部署 SillyTavern、没跑 Letta、没跑漂移探针。所有效果类数字都是转述原文，不是本地测量。
8. **"人格稳定"≠"人格贴切"**。原文自己写的边界「stability is not validity」直接适用：一个稳定的人格也可能是错的、刻板的。本报告没有任何证据能回答"这个人格像不像我们要的那个人"。

---

## 四、方法论备注（供你判断可信度）

- **一手来源**：SillyTavern（固定 `06bde939…`）、CCv2（`8083fb38…`）、CCv3（`f3a86af0…`）、Letta（tag `0.16.8`）、OpenAI Cookbook（`500df203…`）、openai-python（`f6e8480f…`）、arXiv 论文 9 篇（逐条 ID）。
- **三分标注**：全文用【代码事实】/【文档声称】/【本文推断】，另加【论文】（经同行评审但**本文未复现**）。共 216 处引用标记，43 条唯一外部链接。
- **与前文分工**：不重复 `persona-context-and-injection-resistance.md`（dsh/MaiBot/AstrBot 注入面）；增量是「角色扮演成熟实现 + 人格稳定性实证 + 厂商官方立场 + 结构化人格先例」。两文共同的核心空白（"一份人格 / 多用户状态分区"无先例）在第八节第 10 条**再次标记、未推进**。
- **已做的自我修正**（文末「修正记录」有记）：① 3.4 节原拟写"SillyTavern 与 Lost-in-the-Middle 一致"，核对后发现**只有一半一致**（该文是两端都优，不是越靠后越优），已改为记录张力；② 6.4 节原拟写"可用 logit_bias 压中文语气词"，核对 tokenizer 事实后改为**不可良定义**；③ 初稿把 P2 的 87% 当"最硬证据"，复核原文后改为**探索性**并补上作者限定。
