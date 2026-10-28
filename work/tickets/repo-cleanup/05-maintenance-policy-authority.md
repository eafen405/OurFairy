## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-05。

## What to build

把记忆维护回合数与衰减小时的默认值、合法区间收敛为 memory 包提供的一份代码策略，供 memory 配置、运行时校验和 gateway 入参校验共同使用。

## Current evidence

同一组数值目前出现在：

- `backend/memory/src/index.ts:53-59`：zod Config 的默认值与区间。
- `backend/memory/src/maintenance.ts:41-48,94-126`：运行时 fallback 与区间校验。
- `backend/gateway/src/service.ts:131-139,699-730`：gateway 的默认值视图与手写区间校验。

三处当前数值一致，但没有共享来源；漂移时手机端校验、已保存配置和下一次维护判断可能给出不同结果。

## Scope

- `backend/memory/` 内一个小型策略模块及其必要导出。
- `backend/memory/src/index.ts`
- `backend/memory/src/maintenance.ts`
- `backend/gateway/src/service.ts`
- 为新增包边而必须修改的 package manifest。
- `tests/gateway-maintenance-settings.test.mjs`、`tests/memory-maintenance.test.mjs` 及必要的包组合测试。

## Acceptance criteria

- [ ] 先通过现有测试入口固定默认值、闭区间边界 5/50 与 3/24、越界拒绝、错误码和保存后读取行为。
- [ ] memory Config、memory 运行时校验和 gateway 校验消费同一策略，不再各自声明数值常量。
- [ ] 策略模块只包含这组产品配置决策，不变成通用配置框架。
- [ ] wire 字段名、profile 字段名、HTTP 状态码、错误码与既有 volatile 行为不变。
- [ ] 新增运行时包依赖按现有 manifest/bundle 规则声明，`bundle-packages` 与兼容性检查通过。
- [ ] bundle 中的显式部署配置不因本票改值；若需要改变生成或注入机制，停止并上报范围变化。

## Verification

```bash
npm run build
node --test tests/gateway-maintenance-settings.test.mjs tests/memory-maintenance.test.mjs tests/bundle-packages.test.mjs tests/plugin-compatibility.test.mjs
npm run combo:verify
```

## Blocked by

无。

## Out of scope

不改变维护算法、默认模型路由、数据库结构、Android 设置页面或真实模型验收，不顺带统一其他 gateway 配置。
