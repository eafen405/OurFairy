# spec 317：Fairy 电费账单

规格 [#317](https://github.com/eafen405/OurFairy/issues/317)（本地副本 [`docs/specs/fairy-bill.md`](../../../../docs/specs/fairy-bill.md)）。
实施票 #318–#324，本地副本见 [`work/tickets/317/`](../../../tickets/317/README.md)。

集成分支 `integration/spec-317`。基线 `main` @ `5b22907`。

## 交付形状

一个新的产品行 `@ourfairy/dsh-bill`（`backend/bill`），挂在 bundle 的 `plugins` 组。它拥有：
跨会话聚合、按修订号失效的缓存、`GET /bill` 一条读取地址、一个只读工具 `electricity_bill`、
以及请求尾部的一段运行时上下文读数。聊天投影的消息行新增回合号与结算分桶；Android 新增账单页
与每条回复的 token 小字。

不加账本表：token 用量已在会话日志里，另存一份是第二权威。

## 关键实现事实（每条都有会失败的检查）

| 事实 | 检查 |
| --- | --- |
| 注入读数在一回合内恒定 | `tests/bill-context.test.mjs` 驱动多步工具回合，断言读数集合长度为 1 |
| 读数位于请求最末尾，其后无内容 | 同上，从模型替身捕获的请求体断言 `tail.includes('\n\n') === false` |
| 相邻两次请求除末尾快照外逐字节相同 | 同上，比较真实 `body.messages` 数组的公共前缀（不是 `body.system`——那样会因为每次重拼整条快照而假绿） |
| 读数顺序高于 harness 全部分配 | `tests/bill-context.test.mjs` 从锁定检出读出 `CONTEXT_ORDERS` 并断言常量大于其最大值 |
| 客户端不能把 token 换算成丁尼 | `tests/bill-denny.test.mjs` 扫描客户端源码，任何「收 token 产出丁尼」的函数即失败 |
| 模型被告知的汇率等于代码应用的汇率 | 同文件，解析工具描述里的汇率与常量比对 |
| 分页读到已结算行的结算值 | `tests/projection-units.test.mjs` 同时断言回合内无值、回合后有值、从该行起的分页仍有值 |
| 悬挂回合不计入 | `tests/bill-fold.test.mjs` |
| 未落盘会话不进缓存 | `tests/bill-aggregate.test.mjs` |
| 空会话集是零账单而不是失败 | `tests/bill-aggregate.test.mjs` |
| 聚合失败报错而不是零 | `tests/bill-route.test.mjs` 用不可读的语料制造真实失败 |

## 实际执行的命令与结果

全部在 `integration/spec-317` 的最终状态上，`OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`。

| 命令 | 结果 |
| --- | --- |
| `npm test`（全量） | **746 tests / 740 pass / 6 fail** |
| `npm test -- tests/bill-*.test.mjs tests/projection-units*.test.mjs tests/remote-chat.test.mjs` | 全绿 |
| `node --test --test-concurrency=1 tests/skill-*.test.mjs` | **165/165 pass** |
| `npm run typecheck` | 通过 |
| `npm run combo:verify` | `ourfairy ok`、`android source ok`、**`dsh MISMATCH`** |
| `cd android && ./gradlew test lintDebug` | **BUILD SUCCESSFUL**（740 tests，0 failures；lint 44 项均为既有） |

### 那 6 个失败是环境，不是回归

两类，都**在干净的 `main` 上同样失败**（用一个临时 worktree 实测，跑完即删）：

1. **dsh 检出漂移**：共享检出 `/home/fatfish/dsh-d80522d2` 被 spec 311 的合并推到了
   `ae2adffd`，而 `combo.json` 锁 `c41af067`。`combo:verify` 与依赖启动器的套件因此报 MISMATCH。
   本 agent 未移动该检出——311 的工作在上面。测试辅助已让「显式 `OURFAIRY_DSH_DIR`」下的漂移
   可用（原来只有 `start` 命令有这条豁免，`doctor`/`probe` 没有）。
2. **`combo.json` 的默认 `localPath` 指向 `/home/eafen405/...`，本机不存在**，所以裸跑
   `npm test` 必然在启动器处失败。

`main` 的全量基线实测为 **679 tests / 626 pass / 44 fail**；本分支 746 / 740 / 6。

### 为什么串行跑会全绿

`skill-learning.test.mjs` 是重负载时序套件。全量并行（Node 默认按 CPU 数）下它会超时；串行
`--test-concurrency=1` 跑全部 skill 套件是 165/165。这是既有的并行脆弱性，不是本 spec 引入。

## 未执行

- **真机/模拟器视觉验收**。Android 侧只有 Robolectric + Compose semantics，没有设备截图。
- **真实模型验收**。全部经模型替身；`acceptance:real` 未跑（需要云模型凭据）。
- **dsh 检出恢复到锁定提交**。见上。

## 已知口径

- 标题生成等不落用量的辅助调用不计入，账单页脚注说明。
- 崩溃留下的悬挂回合不计入。
- 账单是公开合计；本日合计与本人精确用量相减可推出他人当日总量——只有数量、没有内容，规格里
  明写接受。
- 运行时上下文通道会在正文前拼一句固定的英文前言，中文语气改写不覆盖该通道；电费读数因此以
  「英文前言 + 中文读数」出现。规格记为接受的既有接缝。
