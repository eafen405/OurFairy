## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

产品 bundle 挂载 dsh 原生的 `llm-retry`、`spill-local`、`spill-policy` 三行。模型遇到限流/超时/传输错误时由原生插件在耐久 step 边界重试，产品不再自写重试循环或计数；停止回复能取消等待中的 backoff；重试耗尽仍走现有 agent/error 路径。大工具结果由原生 policy 按统一预算保留有界预览并把完整结果写入原生 spill 存储，工具调用本身不失败。预算用真实工具输出测量后确定，不照搬旧项目常量。

## Acceptance criteria

- [ ] bundle 新增三行（`llm-retry`、`spill-local`、`spill-policy`），spill 根落在 `DSH_HOME` 内；provider 行声明 `retryPolicy`（normal 模式，原生默认）
- [ ] 模型替身先返回 `rate_limit`（429，带 `Retry-After`）再成功：同一 `requestId` 只有一条用户消息、一个最终 assistant 结算；`llm/retry` 与 `llm/retry-started` 事件可回放，且不进入模型可见历史
- [ ] 在 backoff 期间调用 `/chat/stop`，整轮及时结束且历史一致
- [ ] 真实工具产生大于预算的结果时，模型收到有界预览与 locator，工具调用不失败；`maxInlineTokens` 的取值附实测记录（工具输出字符数/估算 token）
- [ ] 产品代码中不存在自写重试循环或重试计数（现有代码本就没有；本票以测试与检查固定该事实，不新增「不能漂移」式文档声称）
- [ ] 现有全量测试不回归

## Blocked by

None (can start immediately).
