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
| 闲置会话的新轮包含其他会话的已结算开销 | `tests/bill-context.test.mjs` 的 `an idle session refreshes today...`，捕获真实后端发送给模型替身的请求 |
| 上海零点后的新轮刷新日累计，同轮后续步骤保持固定 | `tests/bill-context-refresh.test.mjs` 的 `a resident session refreshes after Shanghai midnight...` |
| 读数位于运行时上下文快照末尾 | `tests/bill-context.test.mjs` 从模型替身捕获的请求体断言 `tail.includes('\n\n') === false`；首轮原生技能提醒可以作为另一条消息跟在快照之后 |
| 新请求保留已发送请求的消息前缀 | 同上，比较模型实际收到的 `body.messages` 公共前缀；新轮的提问、回复与快照追加在其后 |
| 丁尼换算符合规格示例 | `tests/bill-denny.test.mjs` 验证 18 亿 token 对应 600000 丁尼及四桶加总后的换算 |
| 分页读到已结算行的结算值 | `tests/projection-units.test.mjs` 同时断言回合内无值、回合后有值、从该行起的分页仍有值 |
| 悬挂回合不计入 | `tests/bill-fold.test.mjs` |
| 未落盘会话不进缓存 | `tests/bill-aggregate.test.mjs` |
| 空会话集是零账单而不是失败 | `tests/bill-aggregate.test.mjs` |
| 聚合失败报错而不是零 | `tests/bill-route.test.mjs` 用不可读的语料制造真实失败 |

## 2026-11-06 收尾复核

审核范围固定为 `git diff 5b22907...cab4060`，Standards 与 Spec 两轴分别执行。

- Standards：修正三条已被 `cc56a0c` 删除的检查引用；将「请求绝对末尾」「每回合只追加一条快照」等表述收窄到现有测试实际验证的运行时快照末尾、读数文本恒定和消息前缀保留。呈现映射的局部重复属于不阻塞的维护建议。
- Spec：发现常驻会话只在创建和自身回合结束时刷新日累计，因此闲置期间其他会话的开销、以及上海零点后的新日界不会进入下一回合读数。新轮首个 `agent/pre-step` 重新读取同一个账单服务，然后按回合号固定读数；同轮后续步骤与重试读取固定值。
- 新增跨午夜回归在旧构建上实际失败：应读「本日累计 尚无消耗」，旧实现仍读「本日累计约 1 万丁尼」。测试位于 `tests/bill-context-refresh.test.mjs`，通过公开 Cordis/SystemPrompt 事件与 `createBillService` 的时钟接缝验证；不使用源码扫描。
- 隔离收尾分支合入远端 `origin/main` 已发布的组合修复（`eb1e182`），组合锁更新为 dsh `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`。本轮未移动共享 dsh 检出；临时独立检出复用同一提交的现有依赖与构建产物。

### 收尾门禁实测（2026-11-06，隔离 worktree + 独立临时 dsh 检出）

`OURFAIRY_DSH_DIR` 指向按 `combo.json` 锁提交 `ae2adffd8d67` 建立的临时检出（复用同一提交的依赖与 `lib/` 产物，未改动共享检出）。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run combo:verify` | 三行全 ok：`ourfairy`、`dsh @ ae2adffd8d67`、`android source @ 460109d1b89b` |
| `npm test`（全量） | **753 tests / 753 pass / 0 fail**（`duration_ms` 553527） |
| `cd android && ./gradlew test lintDebug` | **BUILD SUCCESSFUL**；742 单测 0 失败；lint 44 项 warning，均为既有规则 |
| `node --test tests/bill-context.test.mjs tests/bill-context-refresh.test.mjs` | 全绿，含两条新增回归 |
| 旧构建上的跨午夜回归 | **实际失败**：「本日累计 尚无消耗」被读成「本日累计约 1 万丁尼」 |

**首轮全量出现过 8 项失败，均非本规格回归。** 那次与 Android 14 分钟构建同时运行：`jobs.test.mjs`（3）、
`skill-learning.test.mjs`（4）在空载或串行复跑下全绿（`--test-concurrency=1` 三套件 35 项仅 1 失败）；
剩下的 `launcher-args.test.mjs` 是本票新增用例的错误前提——它把「结账指向锁定提交」当作「不是实验」，
而判据的唯一权威是显式 `OURFAIRY_DSH_DIR`。该用例已收窄为断言判定跟随显式 override，并在有/无 override
两种情况下各跑一遍通过。

### 审核发现与处理

| 轴 | 发现 | 处理 |
| --- | --- | --- |
| Standards | 证据表仍引用 `cc56a0c` 已删除的三项检查（顺序源码扫描、客户端换算扫描、工具汇率解析） | 改为现有行为测试，未恢复源码正则 |
| Standards | 「请求绝对末尾」「每回合只追加一条快照」超出测试实际证明力 | 收窄为快照末尾、读数文本恒定、消息前缀保留 |
| Standards | `context.ts` 的“same call … cannot disagree”与 `README` 口径不一致 | 改为「同一聚合、各次调用独立快照」 |
| Spec | 常驻会话闲置期间其他会话消费、以及跨上海零点的日界不进入下一回合读数 | 新轮首个 `agent/pre-step` 重新聚合后按回合号固定；补两条回归 |
| Spec | 呈现映射在 `tools.ts` 与 `http.ts` 重复 | 记为不阻塞的后续维护建议，本轮不新增抽象 |

改动后 `isReadingAudience` 仍作为公开导出存在（README 的公开面清单里有它），未在本轮删除。

## 初次交付命令与结果（历史记录）

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

## 已知口径

- 标题生成等不落用量的辅助调用不计入，账单页脚注说明。
- 崩溃留下的悬挂回合不计入。
- 账单是公开合计；本日合计与本人精确用量相减可推出他人当日总量——只有数量、没有内容，规格里
  明写接受。
- 运行时上下文通道会在正文前拼一句固定的英文前言，中文语气改写不覆盖该通道；电费读数因此以
  「英文前言 + 中文读数」出现。规格记为接受的既有接缝。
