# 84-history-seam — 票 #84 证据

票面：OurFairy#84（父规格 #71）。在 dsh fork 暴露 Host 可调用的会话历史/跟随
算法接缝，供 #85 在产品侧复用。dsh 仓库 `product/ourfairy-v1`；实现提交
`ffb5a266aa`、`158d0955c7`、`e17dbc9a3b`、`b2c6e91cad`，合并提交
`5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`（`combo.json` 锁定值，已推到
`fork` 远端）。产品侧适配见 [85-history-adapter](../85-history-adapter/README.md)。

## 改了什么（dsh）

| 文件 | 改动 |
| --- | --- |
| `packages/core/agent/src/session-history.ts`（新） | 公开子路径 `@deepseek-ai/dsh-agent/session-history`：`createSessionHistorySeam(ctx)` 观察全局 `agent/assistant-stream`/`agent/disposed`，返回 `assistantStream(sessionId)`（活动 attempt 的 `attemptId`、`startedAfterSeq`、`turn`、`step`、`nextIndex`、compact stream、`revision`，以及 `needsResync`）与 `eventCursor(cursor)`（`SessionEventCursor`：重放 seq 忽略，下一 seq 接受，跨 seq 抛 `SessionHistoryGapError`，`reset()` 修复切点）。 |
| `packages/core/agent/package.json` | 增加 `./session-history` 公开导出；`files` 覆盖已构建的 `lib/types/**`。 |
| `packages/core/agent/README.md` / `.zh.md` | 记录接缝的两个 reader、gap 语义、per-Session 生命周期与替换规则。 |
| `packages/api/session-controller/src/assistant-stream.ts` | 原 controller 自维护的帧接受状态机改为复用新的 native 接缝（不再有第二套 fold）。 |
| `packages/api/session-controller/src/history.ts` | `follow` 的缺口检测/assistant baseline 切点改为消费公开接缝。 |
| `packages/core/agent/tests/session-history.spec.ts`、`session-history-loader.spec.ts`（新） | 契约测试：连续帧累计正文、`startedAfterSeq` 对齐、revision 重置/乱序帧/dense-index 缺口触发 `needsResync`、cursor 缺口报错与 `reset`、公开子路径可加载。 |

接缝**不导出** Client/Typert/Remote controller，也不要求 Gateway；产品只导入这一个子路径。

## 与规格正文的边界（实测后收窄）

规格正文要求接缝覆盖固定 `throughSeq`/`beforeSeq`/`maxEvents`、冷读与 follow。
实测边界（`work/implementation/notes/spec71-boundary.md`）：`@deepseek-ai/dsh-api-session-controller`
不在产品可解析的 CLI 安装域，且 `history.ts`/`assistant-stream.ts` 不在其公开
exports；把 controller 引入产品被规格明确禁止。因此本票暴露的是**算法**：
assistant 流基线与 durable event cursor/gap 判定；分页窗口与 `/chat/page` 的固定
截点/切片仍由产品读取路径承担（#85 票面与 AC5 明确归 #72），冷读仍是产品对
自有事件日志的读取。接缝依赖的 controller 侧 fold 已改为调用同一公开实现，
不存在第二份算法。

## 命令与结果

在 dsh 检出 `/home/eafen405/projects/deepseek-harness`（`product/ourfairy-v1`
@ `5b8ec0f175`）执行：

```
$ corepack pnpm@11.28.5 exec vitest run \
    packages/core/agent/tests/session-history.spec.ts \
    packages/core/agent/tests/session-history-loader.spec.ts
 ✓ packages/core/agent/tests/session-history.spec.ts (6 tests)
 ✓ packages/core/agent/tests/session-history-loader.spec.ts (2 tests)
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

产品侧门禁是 `tests/reconnect.test.mjs`（#85），在全量 `npm test` 中通过；它导入
的就是 `@deepseek-ai/dsh-agent/session-history` 的已构建子路径。

## 替身与真实服务分界

- **真实：** dsh 源码、`Context` 事件总线、`SessionEventCursor` 与
  `SessionAssistantStreamAccumulator`、产品对已构建子路径的真实导入。
- **替身：** 契约测试用合成的 `agent/assistant-stream` 帧（start/chunk/end）与
  耐久 seq，不启动模型、不连接网络。
- 未调用真实模型；未跑 dsh 全量测试（dsh 规则要求按变更路径跑定向测试）。

## 未执行 / 已知缺口

- 接缝未覆盖 `/chat/page` 的 `throughSeq`/`beforeSeq`/`maxEvents` 切片；该读取路径归
  #72，本票不重写（见上「边界」）。
- dsh `session-controller/src/history.ts` 的 `wireAssistantStreamRecord` 仍按
  `AssistantStreamRecord` 的四个 variant 手写 switch，未加 `assertNever` 默认分支；
  dsh 的 `assertNever` 规则针对闭合 union。本轮未改 dsh 代码以免在并行规格
  （#72/#73）进行中移动锁定的 dsh 提交；该点记录在 #87 的评审遗留项。
- README 中「`agent/disposed` 丢弃 per-Session 状态、dispose 移除两个监听」由
  实现直接保证，但本轮没有为它单独的 dsh 测试；产品侧释放路径由
  `ctx.effect` 的插件生命周期覆盖。
