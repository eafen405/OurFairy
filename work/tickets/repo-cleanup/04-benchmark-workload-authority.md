## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-04。

## What to build

让 projection benchmark 的生产者与回归门禁从同一个无副作用模块读取工作负载形状，消除 history/observer cell 的多处硬编码。

## Current evidence

`scripts/bench-projection.ts:46-71` 定义 `historyTurnCounts=[40,160]` 与 `observerCounts=[1,2]`；`scripts/bench-gate.ts:35,152-173` 又硬编码四个 cell、两个 history 值和两个 observer 值。生产者参数变化时，门禁可能检查错误集合或误报缺失。

## Scope

- 新增一个小型、无副作用的 benchmark 参数模块。
- `scripts/bench-projection.ts`
- `scripts/bench-gate.ts`
- `tests/bench-gate.test.mjs`

## Acceptance criteria

- [ ] 先用现有公开测试 seam 固定四个 cell、缺失 cell 失败和六项 gate 的现有结果。
- [ ] history 数量与 observer 数量只有一份参数声明；门禁所需 cell 集合由笛卡尔积派生。
- [ ] historySlope、cost160、observerRatio 读取派生后的对应 cell，不再另写字面量键。
- [ ] 参数模块被 import 时不启动 benchmark、不读写文件、不解析 CLI。
- [ ] 既有 `LIMITS`、JSON 输入格式、CLI 输出含义和缺 cell 即失败行为不变。
- [ ] 保留既有导入兼容性；若需改导出，先证明没有消费者并同步所有使用点。

## Verification

```bash
npm run build
node --test tests/bench-gate.test.mjs
```

本票不要求重跑真实 benchmark；若修改了实际采样行为而不仅是参数接线，必须补跑并记录 before/after。

## Blocked by

无。

## Out of scope

不调整基准负载、阈值、采样次数、性能实现或证据中的历史基线，不抽象通用 benchmark 框架。
