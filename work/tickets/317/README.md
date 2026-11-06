# #317 Fairy 电费账单：任务图

父规格：[#317 Fairy 电费账单规格](https://github.com/eafen405/OurFairy/issues/317)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `5b22907`。集成分支 `integration/spec-317`。

## 任务图

阻塞边以 GitHub 原生 blocked-by 为准。

| 票 | issue | 阻塞于 | 交付 |
| --- | --- | --- | --- |
| 01 电费快照与聚合 | [#318](https://github.com/eafen405/OurFairy/issues/318) | — | 从全部会话日志派生日/月/累计与 30 天序列，按修订号缓存 |
| 02 账单读取地址 | [#319](https://github.com/eafen405/OurFairy/issues/319) | #318 | `GET /bill`，只要求认证，一次返回全部三个总量与序列 |
| 03 上下文注入与只读工具 | [#320](https://github.com/eafen405/OurFairy/issues/320) | #318 | 请求尾部的电费读数与 `electricity_bill` 工具 |
| 04 消息行回合号与分桶 | [#321](https://github.com/eafen405/OurFairy/issues/321) | — | 投影行携带回合号与该回合结算分桶 |
| 05 Android 账单页 | [#322](https://github.com/eafen405/OurFairy/issues/322) | #319 | 三个总量、30 天柱状图、主页入口 |
| 06 Android token 小字 | [#323](https://github.com/eafen405/OurFairy/issues/323) | #321 | 每条完成回复下方的输入/缓存/输出 |
| 07 收口 | [#324](https://github.com/eafen405/OurFairy/issues/324) | #320 #322 #323 | 全量门禁与可执行声称复核 |

frontier 起步是 #318 与 #321（互不依赖）。

## 实施顺序与合并

按 frontier 并发：`#318` 与 `#321` 先做；两者并入集成分支后 `#319`、`#320` 与 `#323` 解除阻塞；
`#319` 并入后 `#322` 解除阻塞；最后 `#324` 收口。

证据见 [`work/implementation/evidence/317-bill/`](../../implementation/evidence/317-bill/README.md)。
