# 06: 请求幂等：同标识连续重发只产生一条消息

## Parent

[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)

## What to build

`/chat/send` 的幂等现在只依赖 transcript 单元里的 receipts 这一份持久锚点。现有用例覆盖了
并发重试与重启后的重发，但没有一条直接断言「同一请求标识连续两次发送」的外部行为。

新增一条行为断言：同一请求标识连续两次发送只产生一条用户消息，且两次返回的受理序号
（`acceptedSeq`）相同；同一标识携带不同内容仍返回 409。断言从产品 HTTP 端点与读回的投影进入，
不断言内部映射表。

这是断言票：如果新用例暴露了真实缺陷，修在 `backend/chat` 的发送路径；否则不改生产代码。

## Acceptance criteria

- [ ] 新增测试 `the same request id sent twice in a row produces one message`：两次顺序发送同一标识，receipt 完全一致（含 `acceptedSeq`），投影里该标识只有一条用户消息
- [ ] 同一标识改文本仍返回 409 `chat/request-conflict`
- [ ] 测试对「去掉 receipt 短路」敏感：证据记录一次临时移除短路后该用例变红，再恢复
- [ ] 若需要生产代码改动，改动最小且不改变既有并发/重启用例的期望
- [ ] 提交说明写明：幂等锚点失效时，失败的是哪一条断言

## Blocked by

None (can start immediately).
