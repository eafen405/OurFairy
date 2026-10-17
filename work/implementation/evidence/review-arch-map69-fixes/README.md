# 地图 #69 最终两轴 code-review 的修复

评审报告（四轴，逐字）见 `../review-arch-map69/`。本目录记录**每一条评审项的处理**：已修复、已记录不修（含理由）。两个仓库各有修复分支 `fix/69-review`。

## OurFairy（分支 `fix/69-review`，基于 `c4fd18f`）

| 评审项 | 处理 | 提交 |
| --- | --- | --- |
| **F1** doctor 的 `bundleDeclaresAgentModel` 用子串 `includes`，把 bundle 的 model 改成 `deepseek-flash-drifted` 仍 ok —— `combo.json`/README 的「不能漂移」没有会失败的可执行检查（违反 #64 通则） | **已修**：解析 `agent-default-model` 行的 provider/model 按值比较；`doctor` 的 detail 回显双方；测试改成「制造漂移后该检查必须失败」（临时改写 bundle 行跑一次，跑完还原），并保留一条独立的值相等断言 | `9119b19` |
| **F2** `ownerOf` 不校验参数，能造出 `shortIdOf` 拒绝的 `user:0`/`user:abc`；`probe` 仍手写 `'user:1'` | **已修**：`ownerOf` 只接受正安全整数（否则 TypeError），`probe` 改用 codec；`spaces/test-support` 的测试专用字面量保留并在测试注释里注明是 test-only 例外 | `78dc8d0` |
| **F3** `projection-interface.test.mjs` 的导出解析漏 `export async function`/`export function*` | **已修**：导出扫描覆盖 `export (async )?function`、`export function*`、`export const/let/class` 等形态，并加一条自检证明异步/生成器导出会被捕获 | `7a1a542` |
| **F4** `v1-bundle/README.md` 的 Row set 仍是手写 15 行（实际挂载 33），未兑现 #47「指向或派生」 | **已修**：删除手写行表，改为指向 `cordis.patch.yml`（唯一行集）与 `FORBIDDEN_ROW_IDS`（唯一缺行清单）；`tests/bundle-readme.test.mjs` 改为断言 README 不再罗列行、只指向权威 | `390cb4a` |
| **F5** `tests/helpers/backend.mjs` 注释声称测试请求不得依赖 fetch，但三处仍用 fetch | **已修（注释如实）**：注明共享 helper 是首选，个别套件保留自有客户端（原因逐条写明）；未做大迁移以免扩大改动 | `1637de6` |
| **F6** `tests/product-sources.test.mjs` 在测试里写产品 `src`，与并行 `node --test` 的 start 竞态 | **已修**：探针改用一份临时复制的产品仓库（`backend`/`scripts`/`package.json`/`combo.json`），工作树只读 | `5dcb9d6` |
| F7（判断项）`chat-runtime` only-writer 扫描面窄、`identity-interfaces` 源码正则断言、runtime Feature Envy、history 重复终止原因数组、queues 重入抛错 | **记录不修**：这些都是「结构无行为入口」或已在地图 Notes 事先同意的取舍（`queues` 重入抛错是 #51 主动把静默挂起变成立即失败，票面未要求但地图已记）；为它们改生产结构属扩大范围 | — |

验证：`npm test` **142/142**、`npm run combo:verify` 3 仓 ok（`ourfairy-full.log`、`ourfairy-combo.log`）。

## rikkahub（分支 `fix/69-review`，基于 `c3eea8a0`）

| 评审项 | 处理 | 位置 |
| --- | --- | --- |
| **G1** `RemoteReceiveState` 先 consume 后 publish，catch 却称「Nothing was consumed…可重试」 | **已修**：注释改为真实语义——记录先消费，该次尝试的声音丢失、不重放；重试只发布后续新产生的欠账 | `RemoteReceiveState.kt` catch 分支 |
| **G2** 「跨会话积压合成一条」未兑现：`syncing` 对未收到首帧的会话为 false，错峰重连会多次发布 | **已修**：新增 `RemoteChatSnapshot.isCatchingUp`（`failure == null && (connecting || syncing)`）——仍在打开或追赶的会话压住整批，失败的会话已作答不再压住（不可达会话不会扣住别人的提醒）；测试改为**三会话错峰**（旧实现会发多条） | `RemoteChatState.kt`、`RemoteReceiveState.kt`、`RemoteNotificationBacklogTest.kt` |
| **G3** 在途同步完成时无 detach/绑定守卫，仍可能写 `notificationThrough`/`owed`，重绑补发 | **已修**：认领前用 `current(boundEpoch, opened)` 守卫；若提交落盘期间绑定已失效，则把该次 `notificationOwed` 撤回（消费保留）。新增测试：提交进行中 detach，重启后 `notificationOwed == false` 且无发布 | `RemoteChatState.kt`、`RemoteNotificationStateTest.kt` |
| **G4** `PresentationBenchmarkActivity` 仍手拼 attempt key | **已修**：改用 `attemptRowKey("benchmark", "tail")` | `PresentationBenchmarkActivity.kt` |
| **G5** `RemoteAttachmentStateTest` 仍读替身 `records` | **已修**：改走 `ChatSyncStore.load`（#63 方向） | `RemoteAttachmentStateTest.kt` |
| **G6** `isForeground` 在两处平台接口重复声明、`notifies`/`settleReminders` 同物异名、KDoc 与职责矛盾、恒真空断言 | **已修**：新增 `RemoteForegroundPlatform` 作为唯一 `isForeground` 声明，两个平台接口都继承它；`notifies` 统一为 `settleReminders`；`AndroidRemoteNotifications` 的 KDoc 改为陈述真实职责；删除三处对非空类型的 `assertNotNull` | 多处 |
| **G7** `RemoteChatApi.read` 的 KDoc 声称与 `observe` 同快照但无断言 | **已修（收窄声称）**：改为只陈述可验证的事实——同一投影类型、后端同一投影步骤构建、本客户端不断言两者等价 | `RemoteChatApi.kt` |
| G8（判断项）测试替身/组合根复制、`RemoteChatFixtures` 固定 sessionId、`IdentitySessionsPage` 未用 CardGroup、`RemoteReceiveServiceHost` 新增 | **记录不修**：前者属测试基础设施重复，抽公共替身会牵动 6 个文件的构造方式；页面风格属既有页面的延续（本图未重做该页 UI）；`ServiceHost` 已在 #60 resolution 说明用途（使 controller 可在 JVM 驱动） | — |

**Red 证据**（行为级，不是断言级）：
- `rikkahub-red-G2-syncing-only.log`：把 `isCatchingUp` 退回 `syncing` 后，`three staggered reconnects publish one merged reminder` **FAILED**（旧实现按会话发布），还原后绿。
- G3 的新测试在「仅认领前守卫、不撤回」的中间实现下会红（`notificationOwed` 为 true），加入撤回后绿。

验证：`./gradlew :app:testDebugUnitTest :app:assembleDebug` → **BUILD SUCCESSFUL**；**72 套件 / 533 tests / 0 failures / 0 errors / 0 skipped**；三个 debug APK 产出（`rikkahub-full.log`）。

## 仍未处理（如实记录，建议另立票）

- `backend/identity/README.md` 缺失（#52 范围外发现；`package.json` 的 `files` 声明了它）。
- `backend/sessions/package.json` 的 `files` 声明了不存在的 `README.md`（#66 范围外发现）。
- #53 的剩余成本：`activity` 的逐事件状态是真实输入，`O(事件×任务)` 的 snapshot 构造保留；每订阅者各自折叠未做缓存（票面未要求，属范围外）。
- #51 的对外行为变化：同 key 队列嵌套由「挂起」改为「立即抛错」（地图 Notes 已记，属有意为之）。
- `tests/helpers/backend.mjs` 之外仍有若干套件保留自有 HTTP 客户端（F5 已如实注明，未强制统一）。
- 真机/模拟器、真实 Firebase、真实云模型/ASR 与 vivo S50 性能验收（#43/#44/#45 范围）。

## 评审项与修复对照的完整性

四轴报告共 24 条发现（OurFairy 10、rikkahub 14）。已修复 13 条（F1–F6、G1–G7），记录不修 8 条（F7 三个子项、G8 四个子项、以及「#53 剩余成本」「#51 行为变化」归入下方未尽项），其余为本目录「仍未处理」所列。每条都注明是修复还是记录，没有静默跳过。
