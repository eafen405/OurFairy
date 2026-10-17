# OurFairy — Spec 轴（只读评审）

- (a) #50「唯一 codec」仅限产品 src：`probe/src/index.mjs:192`、`spaces/test-support/scope-contributors.mjs:25` 仍手写 `user:`；`tests/owner-codec.test.mjs:26-30` 排除，全仓「唯一」不成立。
- (a) #53 只删第二次折叠：`chat/src/history.mjs:35,58` 仍每事件全量 snapshot；`activity.mjs:39` 真消费，票面「构造后丢弃」不成立，O(事件×任务) 成本仍在。
- (b) #51 对外非完全不变：`chat/src/queues.mjs:25-27` 同 key 嵌套由挂起改抛错（票面未要求，地图已记）；「两种 key 空间」已入 `queues.mjs:4-8`。
- (c) #52 四面成立（`identity/src/interfaces.mjs:31-52`），但裸 store 仍进出公开 `identityHandlers`（`identity/src/http.mjs:161`）；`ctx.identity` 外未「收回包内」。
- (c) #64 executable-claims 3/3 通过；doctor 的 bundleDeclaresAgentModel 仍 substring（`scripts:322-324`），前缀漂移可过，票面「cannot drift」仅部分可执行。
- (a) #47 `v1-bundle/README.md:28-44` 表仍手写 15 行（bundle 33），仅降级概览，未「指向/派生」cordis.patch.yml。
- (a) #57 `--patch` 非 probe/start 报错（`scripts:831-833`）合规，测试私有 profile 路径 0；但「helper 承载 HTTP」未完全（`reconnect:24`、`remote-chat:24` 仍手写）。

通过：#49 `search:38` 改走「公开 read」、无 `_ownedHeader`；#62「纯转发」validateIds/register/signIn 无调用点，`sessions/http:62-84` 双路由保留；#48/#54/#66/#67 未见票面缺失。
