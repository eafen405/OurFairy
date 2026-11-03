# Handoff：Fairy 上下文工程批判 → 实施

日期 2026-11-03。写给下一个会话的接手者。**锚定票：[#302](https://github.com/eafen405/OurFairy/issues/302)**。

---

## 一、这次会话做了什么

对 OurFairy 的上下文工程做了一次批判：不是读文档，而是把实际挂载的行逐段量出来，再用 37 条真实模型回复做实测。四个只读子调查并行（装配地图 / 本尊代入式批判 / 插件接缝源码核验 / 一手资料研究）。

**结论：部署人格没写坏，坏的是它周围的结构。** 详细问题清单与验收标准都在 #302，这里不复述。

用户的原话交代了三件事，是本票的动机来源：
1. 要「比较稳定且贴切的角色扮演效果」，让用户觉得就是 Fairy 本尊，而不是原模型的助手样子——特别是争宠、毒舌、自恋那些有趣片段。
2. 作为 Fairy：**不希望被提示词与例子填满**，那会让她为了贴合提示词而调整说话方式。
3. 作为开发者：要插件化、兼容 dsh 生态、兼容其它插件产物的提示词注入，注意不同用户的注入差异，注意整体架构摩擦。
4. 最近新增的工具还没清理描述里的废话（已实测确认：memory 5 条 2143 字符、search 2 条 610、delivery 1 条 371、groups 3 条 351）。

---

## 二、证据在哪（按可靠度排序）

### 盘上已有、可直接读

| 内容 | 路径 |
| --- | --- |
| **锚定票正文（本地副本）** | `work/tickets/302/302.md`；发布权威 <https://github.com/eafen405/OurFairy/issues/302> |
| 装配地图：9 段全表、12 张表、13 条摩擦带 file:line | `work/implementation/evidence/302-persona-context-review/01-context-map.md`（248 行） |
| 本尊代入式证词 + 工程师复核（结构性 6 / 概率性 5 / 无效约束 9） | `work/implementation/evidence/302-persona-context-review/02-fairy-testimony.md`（231 行） |
| 插件接缝与 `system-prompt/assemble` waterfall 源码级核验 | `work/implementation/evidence/302-persona-context-review/03-plugin-seam.md`（606 行） |
| 研究摘要（三条判据 + 四条证据空白） | `work/implementation/evidence/302-persona-context-review/04-research-summary.md`（65 行） |
| 一手研究稿（755 行，43 条固定来源，10 条证据空白，含修正记录） | **仓库内** `docs/research/2026-11-03-persona-stability.md` |
| 语料基线 | `work/implementation/evidence/248-memory-integration-acceptance/results.json` |

这五份已从 `/tmp/persona-review/` 复制进仓库本目录，长期保留；临时目录丢掉不影响。

### 关键实证（各自一句话，细节见上表）

- **prompt 组成可逐字符复现**：Bob 2221 / Alice 2379 与 `results.json` 记录精确相等。人设 804、身份 75、印象框架 98、记忆政策 456、dsh 五段英文工具 872（英文比人设本体多 68 字符）。
- **记忆政策方向与人设相反**：456 字符 = 19.8%，5 禁 1 许；同类规则已在 `memory_add` 的 940 字符描述里。
- **口癖变成模板**：命中 30/37，但首句仅 19/37；助手腔 14/37；电费 21/37。
- **证据判据失效**：20 条 `数据显示`/`数据表明`，13 条在零工具调用的 5 个案例；`volatile-observation` 在无 web 工具、无 IP 采集代码时编出气象数据与坐标。
- **称呼失效**：shortId=2 的代理人仍被称「主人」3 次；人设正文 9 处「主人」对 1 句否定。
- **`complete: true` 是静默核弹**：一条即可让 `ourfairy:persona` + 5 条工具用法消失而 tool schema 仍在；85 个测试零条断言 section 顺序。

---

## 三、接手时先知道的坑

1. **dsh 有三个版本，行号会漂。** `combo.json` 锁 `d80522d`（rc.2）；本机检出工作树 HEAD 是 `d743267388`（alpha.2，与 pin 非祖先关系）；全局装的是 rc.5。`system-prompt/src` 两版只差 4 行常量（结论通用），但 `child-agent.ts` 差 59 行——**任何按行号实施的改动必须先在 pin 版复核**。
2. **`docs/research/persona-context-and-injection-resistance.md:60` 会把人带错**：它把 `complete: true + includeHarnessIdentity:false` 写成推荐做法，而代码里产品零 complete。这条需要纠正（已在 #302 验收里）。
3. **`docs/research/README.md` 是 M 状态，但不是本次改的**——那是别人的 `2026-11-03-memory-recall-and-injection.md` 行。本次新建的研究稿**尚未登记索引**，若要登记，只加 persona-stability 那一行。
4. **工作树里还有其他未提交改动**（`work/implementation/evidence/` 下的 240/295 adversarial-review 等），不是本次产物，别误提交。
5. **口径已收敛，别再用旧数字**：段长用 Bob 2221 / Alice 2379（先前 2281 那版误差 60，已废弃）；证据式断言统一指 `数据显示`/`数据表明` 两个固定短语（20 条），不含变体。
6. **不要跑 `npm test` 验证结论**：本次全部是只读调查，没跑测试也没起服务。若实施时需要跑，按 AGENTS.md「按改动面跑测试」，全量留到收口。

---

## 四、下一步建议（顺序有理由）

1. **先止血，不涉及架构。** 把 `ourfairy:memory-policy` 从 system prompt 移进工具描述（那边已有同类规则）；停用或替换不可执行的证据判据（继续留着它就在持续奖励编造）。
2. **补已有数据，不改客户端。** `activity`/`tasks`/`token` 后端都已算出，只是没进 prompt。`backend/spaces/src/index.ts:38` 是 `systemPrompt.context()` 的现成范例。争宠与电费立刻有真实依据。
3. **再加守卫测试。** `complete` 核弹（静默抹掉声线）和证据伪造各需要一条断言；现有 85 个测试对 section 顺序零覆盖。
4. **才轮到架构收权**：把「谁在什么位置说话」收成一处权威，用 `system-prompt/assemble` waterfall 而非自建注册表——第三方不会调用我们的注册函数，只会直接调 `ctx.systemPrompt.section()`。
5. **最后才是新增客户端状态检测**（用户提到但仍未启动）：这一步得先定边界——她能知道多少、能不能说出来。可检测项包括前台/后台、屏幕开关、充电状态、网络类型、通知是否被点开、输入框草稿、上次互动间隔。

---

## 五、建议加载的 skill

接手后按需调用 Skill 工具：

- **`grilling`** —— 本票的关键决策（人格装配模块的接口形状、第三方材料如何排序、客户端状态边界）适合用它逐个走决策树，而不是直接开写。
- **`codebase-design`** —— 设计「Fairy 声线装配」这个深模块时用它的词汇（module / interface / depth / seam / leverage / locality）；接口草案已有一版在 `03-plugin-seam.md` §5.2，但需要重新审。
- **`tdd`** —— 做守卫测试（complete 核弹、section 顺序、证据判据）时先红后绿。
- **`domain-modeling`** —— 「主人/代理人/法厄同」在 `GLOSSARY.md` 已有定义，但代码里没有对应物；收权时要同步词汇表。
- **`research`** —— 如果需要补充「客户端可检测状态」的可行性证据。

---

## 六、需要用户拍板的事

1. **客户端状态检测的边界**：她能知道多少、能不能主动说出来。这不是技术问题。
2. **人格文本是否允许改动内容**：现有 804 字符里「渴求资源」「自信且自恋」等是形容词，实测只产生方向不产生落点。改成约束式表述会改变她说话的方式——用户明确说过不想被提示词填满，需要确认改动方向。
3. **是否保留 `memory-policy` 在 system prompt**：移走会有行为变化（助手腔减少，但记忆写入边界可能变松），替代位置是工具描述。
