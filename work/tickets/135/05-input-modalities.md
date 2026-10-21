# 05: 输入模态：从原生列表导入

## Parent

[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)

## What to build

网关用一个本地常量 `new Set(['text', 'image'])` 校验手机提交的模型输入模态。原生侧已把这份
词表作为运行时值导出（`MODALITIES`，`@deepseek-ai/dsh-llm-pi-ai` 的目录子路径）。上游新增
模态后，产品会给出误导性的 400「不认识的模态」。

改成从原生包导入该列表，删除本地集合；网关的模型条目校验、读取回显与错误文案都基于同一份
原生值。导入失败时启动响亮失败，而不是回退到本地列表。

测试改为断言网关接受原生列表里的每一项，并仍然拒绝一个不在列表里的值。

## Acceptance criteria

- [ ] 网关不再维护本地模态集合，校验与回显都使用原生导入的列表
- [ ] 新增测试 `the gateway accepts every native input modality`：遍历原生列表逐项提交并得到 200
- [ ] 不在原生列表里的值仍被拒绝，错误码仍为 `gateway/invalid-route`
- [ ] 原生包解析失败时启动失败并指出缺的是哪个包/子路径，不静默回退
- [ ] `backend/gateway/package.json` 声明对应的 peer 依赖
- [ ] 提交说明写明：上游增删模态时，失败的是哪一条断言

## Blocked by

- [04 选型写入：走原生保存入口](#04-选型写入走原生保存入口)（同一模块与测试接缝）
