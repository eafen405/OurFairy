## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

`/chat/page` 改为在固定截点取值：事件窗口用有界读取（只取本页区间），消息用 durable transcript 在截点上的行，不再先读取完整事件流再切片、也不再 fold 完整前缀。页仍不包含 attempt 或回复状态，`throughSeq/fromSeq/beforeSeq/hasMore` 与工具结果排除规则保持不变。

## Acceptance criteria

- [ ] 页的事件恰好是 `K..end-1`（`end=min(throughSeq+1,beforeSeq)`、`K=max(0,end-maxEvents)`），消息是截点上属于该区间的行
- [ ] 在截点上，被后续事件替换过的消息仍按截点时的 seq 与 status 归属页（与改造前折叠前缀的结果一致）
- [ ] 深历史、中部、尾部翻页，空终止页，非法区间 400，归属 404，冻结截点重试结果一致
- [ ] 每次翻页只读取本页所需事件，不再读取完整日志
- [ ] 原有 page 相关测试全部通过

## Blocked by

- [投影单元：transcript / tasks+activity 注册到原生 registry](https://github.com/eafen405/OurFairy/issues/89)
