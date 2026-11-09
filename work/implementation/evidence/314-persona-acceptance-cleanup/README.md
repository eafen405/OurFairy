# #311–314 票面精简与人格词汇判据清理

2026-11-09，按用户最新要求收敛票面与验收方法。本轮处理需求表达和判据清理，四票仍为 OPEN；没有声称已完成后续真实对话评价、印象整合或记忆修复。

## 变更

- 四张 GitHub issue 改为核心诉求、要做的事和完成时应看到的结果，历史实现与运行数据通过链接保留。发布后逐一读取，核对标题、正文与本地副本一致。
- 正文字数由 2645 / 2173 / 1699 / 2930 缩减为 435 / 506 / 451 / 559；本地副本见 [311](../../../tickets/311/README.md)、[312](../../../tickets/312/README.md)、[313](../../../tickets/313/README.md)、[314](../../../tickets/314/README.md)。
- [采样脚本](../../../../scripts/persona-acceptance.ts) 删除拒绝词、自称、口癖、称呼、格式和字数判据，以及状态词、客服套话、电费等风格词频统计。`evaluateReplies` 只检查预期回合数与非空回复；实际工具结果及动作检查保留。
- [回归测试](../../../../tests/persona-acceptance.test.mjs) 删除与这些词表绑定的检查，保留采样完整性、真实路由、计划入口、工具证据和确定性身份装配回归。
- 计划、报告与根 README 以完整对话中的性格、潜台词、自然互动、连续性和任务质量为人工评价对象；采样成功仍为 `review-required`。用户例句只用于说明表达效果，没有成为提示词或测试答案。

产品人格文本、既有采样场景及历史报告未修改；样本隔离、多轮材料及真实体验评价仍由 #314 后续推进。

## 验证

引擎使用已有 `/home/fatfish/dsh-d80522d2`，HEAD 为组合锁 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`。命令前缀为 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`。

- `node --test tests/persona-acceptance.test.mjs`：7/7，通过。
- `npm test -- tests/persona-acceptance.test.mjs tests/docs.test.mjs`：构建及 9/9 测试通过。
- `npm run combo:verify`：产品基线、引擎锁和 Android 来源三行通过。
- `git diff --check`：通过。
- 最终 `npm test`：836/836，通过；52 suites，0 failed / skipped / cancelled，698.5 秒。

没有调用真实模型，没有将采样器测试解释为人格质量验证。未修改 Android 产品代码，未运行 Android 构建或测试。
