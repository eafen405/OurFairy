# 03: 路由保存：只覆盖手机可编辑字段

## Parent

[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)

## What to build

手机保存供应商路由时，网关现在只把 `reasoningEfforts` 与 `compat` 两个硬编码的部署自有模型
字段搬回草稿。上游新增第三个模型级部署字段后，每次手机保存都会静默抹掉它。

改成允许列表：保存时以**先前模型条目为底**，只覆盖手机有权编辑的那一组字段
（`id`、`name`、`contextWindow`、`maxTokens`、`input`），其余字段——包括上游将来新增的——默认
保留。手机没有发送的可编辑字段按「未设置」处理，与手机草稿的既有语义一致。新模型 id 按草稿
原样写入，没有可保留的先前条目。

路由级部署字段（例如 `retryPolicy`）仍留在部署层，不因为这次保存被复制进用户层；现有「保存后
仍执行部署重试策略」的行为不变。

网关 README 中「保留哪些字段」的描述同步改成允许列表口径。

## Acceptance criteria

- [ ] 保存一条先前模型条目声明了 `reasoningEfforts` 与 `compat` 的路由后，持久化设置里这两个值原样保留
- [ ] 手机可编辑字段以草稿为准：草稿给出的值覆盖，草稿省略的字段被清除（不是保留旧值）
- [ ] 新模型 id 按草稿写入，不凭空继承同路由其它模型的部署字段
- [ ] 路由级 `retryPolicy` 仍来自部署层，既有行为用例保持通过
- [ ] 新增测试 `a route saved from the phone keeps model fields the draft does not edit`，从保存后的设置文档实际内容断言保留结果
- [ ] 网关 README 的字段保留说明与实现一致
- [ ] 提交说明写明：上游新增一个手机不可编辑的模型字段时，失败的是哪一条断言

## Blocked by

None (can start immediately).
