> 发布权威：[#153](https://github.com/eafen405/OurFairy/issues/153)。本文件是工作副本。

## Parent

[#133 chat 的 inject 与实际依赖对齐：删残留、显式化隐性依赖](https://github.com/eafen405/OurFairy/issues/133)

## What to build

在 #151 与 #152 合并后的 `integration/spec-133` 上收口：记录遗留 `test-support` 夹具的归属，跑全量门禁，确认公开服务面与运行时行为未变，更新证据索引。

夹具归属（本次不移动，只记录）：

- `backend/chat/test-support/fail-outlets.mjs`：投递故障夹具，主人是投递行。
- `backend/chat/test-support/frame-gap.mjs`：Assistant 帧边界故障，归运行时一侧。
- `backend/chat/test-support/lost-event.mjs`：Session 事件读取故障，归运行时一侧。

## Acceptance criteria

- [ ] 证据 README 记录三个夹具的归属与「本次不移动」
- [ ] 在 T1/T2 合并后的集成分支上跑 `npm test` 与 `npm run combo:verify`，命令与结果入库
- [ ] 记录改动范围：只有 `backend/chat/src/index.mjs`（声明/注释）、`runtime.mjs`（llm 调用点）、`spill-read.mjs`（注释）、`README.md` 与证据；`service.mjs`、`jobs.mjs`、`units.mjs`、`runtime-facade.mjs` 无行为改动
- [ ] 记录公开服务面未变：gateway/delivery 相关测试通过；`ourfairyChat`/`ourfairyChatRuntime` 方法未变
- [ ] 记录范围外发现（例如 chat 的 `@deepseek-ai/dsh-tools` peer 无 import，归 #136），未顺手修改
- [ ] 更新 `work/implementation/evidence/README.md` 索引
- [ ] 未完成项如实记录

## Blocked by

- #151
- #152
