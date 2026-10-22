# 04: 选型写入：走原生保存入口

## Parent

[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)

## What to build

共用选型现在由网关直接写 `agent-default-model` 行，绕过了原生默认模型服务的保存入口。原生入口
按提交顺序串行化写入，并在没有配置编辑器时保持组合入口；直接写没有这两条保证，连续保存时
后发的旧值可能最后落盘。

改成调用原生 `agentDefaultModel.saveSelection(...)`。保留网关自己的校验（provider 已注册、
model 可解析、适配器目录成员、`reasoningEffort` 形状）与现有「没有配置编辑器时 503」的拒绝——
不能因为原生入口在没有编辑器时静默不写，就让网关假装保存成功。

正在运行的回复不因选型保存而中途换路由，这条行为不变。

## Acceptance criteria

- [ ] 连续两次保存选型后读回的是第二次的值，不会出现后发的旧值
- [ ] 省略 `reasoningEffort` 仍清除 profile 覆盖并回到组合默认值；显式值仍按保存值回显
- [ ] 没有配置编辑器时仍以 503 `gateway/configuration-unavailable` 拒绝，而不是接受一次不落盘的保存
- [ ] 校验失败的请求仍不落盘，错误码不变
- [ ] 新增测试 `consecutive selection saves commit in submission order`，两次保存后从 `/gateway/read` 读回
- [ ] 提交说明写明：保存顺序失去保证时，失败的是哪一条断言

## Blocked by

- [03 路由保存：只覆盖手机可编辑字段](#03-路由保存只覆盖手机可编辑字段)（同一模块与测试接缝）
