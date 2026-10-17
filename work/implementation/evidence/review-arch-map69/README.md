# 地图 #69 最终两轴 code-review（Standards + Spec）

评审对象与固定起点：
- OurFairy：`git diff c878d6c...HEAD -- backend scripts tests combo.json CODING_STANDARDS.md work/implementation/CONVENTIONS.md docs`（73 commits，60 files，+2108/−749）
- rikkahub：`git diff 771bffd1...c3eea8a0 -- app/src/main app/src/test`（19 commits，27 files，+1118/−235）

四个只读评审子代理并行：OurFairy Standards / OurFairy Spec / rikkahub Standards / rikkahub Spec。原始报告逐字记录在
`ourfairy-standards.md`、`ourfairy-spec.md`、`rikkahub-standards.md`、`rikkahub-spec.md`。
修复与「记录不修」的决定见 `../review-arch-map69-fixes/README.md`。

## 汇总（按轴，不做跨轴重排）

### OurFairy — Standards
- 硬：`bundleDeclaresAgentModel` 子串匹配使「doctor 断言 model 不漂移」没有可执行检查（违反 #64 通则）；`projection-interface.test.mjs` 导出解析漏 `export async function`/`function*`。
- 判断：`ownerOf` 不校验参数；`chat-runtime` only-writer 扫描面窄、`identity-interfaces` 源码正则断言；runtime Feature Envy / history 重复数组；helpers 注释与实际 fetch 使用不符；`product-sources` 测试写产品 src 与并行 start 竞态；queues 重入抛错属防御性。
- 正面：owner codec、`readSessionEvents`、download 工厂、`PRODUCT_SOURCES` 改派生均为真实复用/减法。

### OurFairy — Spec
- #50「唯一 codec」未覆盖 probe 产品源的手写 `user:1`（test-support 属测试例外）。
- #53 只删掉第二次折叠；activity 确实消费逐事件状态（「构造后丢弃」不成立），O(事件×任务) 成本仍在。
- #51 同 key 嵌套由「挂起」改为「立即抛错」是票面外的对外行为变化（地图已记录）。
- #52 四个领域面成立；`identityHandlers` 仍是同包内直接拿 store（属包内实现，未扩大公开面）。
- #64 doctor substring 使「cannot drift」仅部分可执行（与 Standards 同一项）。
- #47 README Row set 表仍是手写 15 行（降级为概览但未指向/派生）。
- #57 非 probe/start 命令拒绝 `--patch` 合规、测试私有 profile 路径 0；HTTP helper 迁移未完全（reconnect/remote-chat 仍手写 request）。
- 通过：#49 公开 read、无 `_ownedHeader`；#62 纯转发删除无调用点、双路由保留；#48/#54/#66/#67 未见缺失。

### rikkahub — Standards
- 硬：`RemoteReceiveState.kt` 先 consume 后 publish 的 catch 注释「Nothing was consumed」不成立且该路径无测试；`RemoteChatApi.read` 新 KDoc 声称与 observe 同快照但没有断言证明。
- 判断：`RemoteReceivePlatform` 与 `RemoteNotificationPlatform` 重复声明 `isForeground`、enabled 两路；组合根/替身复制；`RemoteChatFixtures` 固定 sessionId；`notifies`/`settleReminders` 同物异名、KDoc 矛盾、Pair→Owed 数据团；`IdentitySessionsPage` 未用 CardGroup；恒真空断言与一处重复断言。
- 专项：断言语义未弱化；`ChatSyncRecord` 新字段置末默认 false 兼容旧 JSON/位置参数。

### rikkahub — Spec
- #56：「等 syncing」对从未收到首帧的 chat 失效，错峰重连可能多次发布；测试标题 three sessions 实际两会话且同步。
- #56：consume 先于 publish 的注释错误（与 Standards 同一项）。
- #60：另建 `ReceivePlatform`/`ServiceHost`（票面称 NotifPlatform 已存在；controller 实际不持有发布平台，实现者已在票内说明）。
- #55：在途同步完成时无 detach/绑定守卫，仍可能写通知状态；TrustTest 未断言 owed。
- #61：`PresentationBenchmarkActivity` 仍手拼 attempt key。
- #63：Attachment 测试仍读替身 records。
- 通过：#55 谓词共用、#56 旧 publish 删除、#58 同步清空、#60 无缓存、#68 五个转发方法删除。

## 轴内总结
- OurFairy Standards：硬 2 项；最重为「doctor model 声明无法防漂移」。
- OurFairy Spec：最重为 #47 Row set 仍手写、#53 成本未完全消除（前者可修，后者记录）。
- rikkahub Standards：硬 2 项；最重为 consume/publish 注释与行为不一致（可修）。
- rikkahub Spec：最重为 #56 错峰聚合与 #55 detach 守卫（行为级，需修）。
