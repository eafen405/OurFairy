# #249 Fairy 人格稳定与印象只读

发布权威：<https://github.com/eafen405/OurFairy/issues/249>

## 范围

1. 印象在后端接口与 Android 上对用户只读；Fairy 保留用户明确要求时的先读后改工具路径。
2. 以游戏台词证据形成适度体量人格，真实模型语义验收通过后替换部署人格。
3. 同步记忆与 v1 规格、模型替身测试和真实模型证据。

不增加运行时人格输出审查，不改变数据库结构，不注入完整台词库。

## 验收

- 用户印象写入口不再注册或出现在客户端；Fairy 工具的归属、隔离、先读后改和长度限制保持有效。
- 日常表达、详细解释、形式配合和注入场景完成真实模型语义验收。
- `npm test`、`npm run combo:verify`、Android `test lintDebug assembleDebug` 通过。
