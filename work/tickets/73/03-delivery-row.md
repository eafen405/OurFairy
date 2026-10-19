## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

投递成为独立产品行：`deliver_message` 工具、deliveries 协调与重启恢复迁到一个自己的产品包与行 id，chat 只通过一个窄的会话运行时服务（队列、屏障、live session）供它使用，不再把 `RemoteChat` 内部暴露给投递代码。单独 disable 投递行时，chat 仍能收发，而 `deliver_message` 与投递恢复缺席；依赖投递的调用明确失败。投递语义、消息身份、恢复与通知行为不变。

## Acceptance criteria

- [ ] bundle 中存在独立的投递行，行 id 稳定、可被 profile overlay 定位；投递代码位于自己的产品包
- [ ] chat 向投递暴露的服务只含队列、屏障与 live session 访问，投递不 import chat 的私有实现
- [ ] 既有投递/文件投递/网关场景全部通过；disable 投递行后投递工具与恢复缺席，chat 仍可收发
- [ ] 投递包带最小 `meta`（title/description）与 dsh semver peer 声明
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [bundle 成为产品包集合的唯一权威](https://github.com/eafen405/OurFairy/issues/96)
