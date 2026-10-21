# 02: 停止结果：保留原生词表，未知结果响亮失败

## Parent

[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)

## What to build

`/chat/jobs/stop` 把原生 `kill` 的返回值折叠成 `requested ? 1 : 2`。原生词表是
`'requested' | 'already-finished'`，任何将来的第三种返回值都会被报成「已结束」，用户无法区分
真的结束与未知。

本票只映射产品认识的原生值：`requested` → 1、`already-finished` → 2；其它任何返回值都**响亮
失败**——返回一个带产品错误码与原始值的 5xx，而不是 2。不可用任务仍返回 0。

同时新增测试期对账：读取 pinned dsh 中产品实际调用的 `kill` 声明的返回类型，与产品映射的键
集合比较；上游增删成员时测试失败并指出成员名。

## Acceptance criteria

- [ ] `requested` 仍返回 1，`already-finished` 仍返回 2，不可用任务仍返回 0
- [ ] 原生返回一个未识别的值时，响应是 5xx 且带产品错误码，消息包含原始值；绝不返回 2
- [ ] 新增测试 `native job stop outcome vocabulary matches the adapter`：从 pinned dsh 读取 `kill` 的返回类型成员，与产品映射比较；漂移时失败并指出成员
- [ ] 未识别值的路径有直接断言（映射函数或等价窄接缝），不依赖真实后端恰好产生未知值
- [ ] 提交说明写明：上游改变 `kill` 返回类型时，失败的是哪一条断言

## Blocked by

- [01 任务状态词表](#01-任务状态词表未知状态显式化并与原生类型对账)（同一模块与测试接缝；本票复用其原生类型读取方式）
