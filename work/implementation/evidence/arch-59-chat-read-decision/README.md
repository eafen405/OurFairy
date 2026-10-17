# 票 #59 — `RemoteChatBackend.read` 去留（决策票）

TICKET: #59
BRANCH: arch/59-chat-read-decision
COMMITS: `e98609ff`（改动）+ `957bd418`（合并集成分支 `product/ourfairy-v1`）
FINAL_SHA: `957bd41853198c2305c625ea8e34b000a9c874a3`

## 结论：保留客户端侧 `read`，补写用途文档

票面已由评审者修正为「决策票」：后端 `/chat/read` 是已文档化的公开契约，**保留后端路由**；
本票只确认客户端侧 `RemoteChatBackend.read` 声明/实现的去留。结论是 **保留 + 补文档**，
理由见下节「依据」。**没有删除任何成员，没有改行为，后端仓库零改动。**

## 依据

### 1. 前提复核：客户端确实无调用者（仍然成立）

`main` 中 `RemoteChatBackend` 的全部出现只有 4 处（DI 绑定、`RemoteChatApi` 实现、
`RemoteChatState` 构造参数），唯一实现是 `RemoteChatApi`，唯一持有者是 `RemoteChatState`。
逐条枚举 `RemoteChatState` 对该字段的调用：`observe`(181)、`page`(252)、`checkpoint`(265)、
`send`(494)、`receipt`(532)、`stop`(547/600) —— **没有 `read`**。

> 排歧：`RemoteChatState` 在 396/435/554/594 行有同名局部变量 `backend`（指向
> `attachmentsBackend`/`jobsBackend`），按词边界 grep 后确认 `upload`/`download`/`output`
> 走的是别的接口，不构成 `RemoteChatBackend.read` 的调用者。

主树中其余 `.read(` 均属别的接口，票面提醒的混淆点已逐一核对：
- `OwnedSessionState.kt:115` → 字段类型是 `SessionBackend`（`SessionApi.kt:42`），不是本接口；
- `RemoteReceiveState.kt:73` → 调的是 `OwnedSessionState.read`。

`premise-and-callers.txt` 是上述全部 grep 的原始输出。

### 2. 为什么保留（而不是删）

- **它是活契约的客户端镜像**，不是遗留死码：`/chat/read` 在 `backend/chat/README.md:7` 被文档化
  为正式契约（含 `maxEvents` 语义与 64/256 的界），`:77` 把 `tasks` 折叠语义同时算在
  `/chat/read` 与 `/chat/observe` 头上。删掉客户端侧不会让后端路由消失，只会让客户端与契约脱节。
- **它与 `observe` 是同一投影的两个 adapter**：二者返回同一个 `RemoteChatProjection`
  （`RemoteChatApi.kt:116` vs `:135`），后端由同一条 `_projection` 构建。这是「一个 seam、
  两个 adapter」的正常形态，不是冗余。区别只在是否需要持有订阅生命周期。
- **无调用者是设计结果，不是缺陷**：每个展示会话的页面都需要流，而 `observe` 的首个快照
  已包含 `read` 会返回的一切，同时开两者等于为同一答案多花一次请求。正因如此，删掉它并不会
  搬走任何复杂度（票面「删除测试」一节同结论）。
- **删除会损失覆盖**：`RemoteChatApiTest.kt:236` 锁定 `POST /chat/read` + body `{"sessionId":"s-1"}`，
  另有 `:269`、`:450` 用 `read` 作被测对象；删除需连带移除 2 个测试与 7 个替身 override，
  换来的是契约侧的空洞，而不是更少的代码。

### 3. 为什么不发明消费者

按票面纪律：不为它造新调用点、不加新机制。文档只如实描述「当前无页面用它」与「保留给
读一次就走的场景（诊断 / 冷启动核对）」，并显式说明它**不是**因为今天有人调用才留下。

## 改动（仅注释，22 行，0 行删除）

`app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt`

- `:99-115` 接口声明处新增 KDoc：`/chat/read` 客户端镜像；与 `observe` 返回同一投影、
  由同一后端步骤构建；各页面用 `observe` 且首个快照已覆盖其返回值；保留给一次性读场景。
- `:175-179` 实现处新增 KDoc：说明线上形状（一次 POST 只带 `sessionId`，用后端默认开窗区间，
  整份投影而非流返回），并指向接口声明处的用途说明。

未新增测试：现有 `RemoteChatApiTest` 的
`read names the session and answers with the projection as sent` 已经锁定本声明的路径与 body，
本票改动不改变任何可观察行为，补一条重复断言只会是 tautological。该测试在本次验收中为绿。

## 命令与结果

定向（改前，red 不适用：本票是文档改动，无行为变更）：

```
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
→ BUILD SUCCESSFUL，18 tests / 0 failures / 0 errors / 0 skipped   （targeted-test.log）
```

验收全量（合并 `product/ourfairy-v1` @ `07adb343` 之后的状态，即 FINAL_SHA）：

```
./gradlew :app:testDebugUnitTest :app:assembleDebug \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
→ BUILD SUCCESSFUL in 18s（EXIT=0）
→ 70 suites / 520 tests / 0 failures / 0 errors / 0 skipped
→ assembleDebug 产出 app-arm64-v8a / app-universal / app-x86_64 debug APK
   （full-acceptance-final.log）
```

条数来自  汇总，不是只看 BUILD SUCCESSFUL。
基线 69 套件 / 515 条；本次 70/520 的增量来自集成分支并入的新套件
（`RemoteActivityTrustTest` 等），非本票新增。

中途两次运行一并留档，可见合并逐步并入的内容：
- 合并前（tip `771bffd1`）69 suites / 515 tests 全绿；
- 合并 `5d8efe42` 后 69 suites / 516 tests 全绿；
- 合并 `07adb343` 后 70 suites / 520 tests 全绿（FINAL_SHA）。

## 未完成项 / 说明

- 只声明 JVM 测试与 debug 构建；**不声称**真机、模拟器、Firebase 运行时或真实云服务验收。
- 后端仓库 `/home/eafen405/projects/OurFairy` 全程只读参考（仅 `sed`/`grep` 读 README 与 service.mjs），
  零改动、零提交。
- 未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。
- 集成分支 tip 在提交后再次前进（`5d8efe42` → `07adb343`），已再次合并并复跑全量，
  最终确认 `product/ourfairy-v1` 是 HEAD 的祖先。

## 合并后核对（merger 记录，2025-10-17）

- 票分支 `arch/59-chat-read-decision` HEAD = `957bd41853198c2305c625ea8e34b000a9c874a3`，与 FINAL_SHA 一致；合并前集成分支 tip `07adb3430a23cad82197a351a961a455f74c8e2c` 已是票分支祖先（无需再合）。
- rikkahub 合并提交（`--no-ff`，无冲突）：`fcba0647041f2810c2a1d89adaa3b4d0f826dfff`。
- **复用依据（tree sha 对比）**：

```
$ git -C /home/eafen405/projects/rikkahub diff --quiet 957bd41853198c2305c625ea8e34b000a9c874a3 fcba0647041f2810c2a1d89adaa3b4d0f826dfff
exit 0
$ git rev-parse 957bd41853198c2305c625ea8e34b000a9c874a3^{tree}  -> 27efb0c15775c9fdeb0bb419133fe1367eee9f5b
$ git rev-parse fcba0647041f2810c2a1d89adaa3b4d0f826dfff^{tree}  -> 27efb0c15775c9fdeb0bb419133fe1367eee9f5b
```

  合并后源树与实现者验收的 FINAL_SHA 完全相同，故不重复跑全量，复用实现者在同一源树上的完整验收：**70 套件 / 520 条 / 0 失败 + `:app:assembleDebug` BUILD SUCCESSFUL**。
- **合并后定向回归**（rikkahub 主 checkout，tip `fcba0647`）：

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

  * *BUILD SUCCESSFUL in 18s**；按  统计 **1 套件 / 18 条 / 0 失败 / 0 跳过**。
- 未改实现者代码：merger 只做合并、核对、证据收录与 `combo.json` pin 回写。
