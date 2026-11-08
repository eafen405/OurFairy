# #331 收敛 Android 远程资源的串行读写状态机

- 票：[#331](https://github.com/eafen405/OurFairy/issues/331)；父规格 [#328](https://github.com/eafen405/OurFairy/issues/328)
- 分支：`ticket/331-android-remote-state`；worktree `/home/fatfish/OurFairy/.worktrees/331-android-remote-state`
- 基线：`integration/spec-328` @ `e8350e4`（开工时 tip）；交付前合并集成分支 @ `012abdc`（合并提交 `fc79481`）
- 交付提交：`70b8253`（共享状态机 + 统一 interface 测试）、`a31759d`（三领域迁移与页面两处引用）、
  本证据提交；工作面笔记 `E4-android.md` §1（仓库外 `/home/fatfish/OurFairy-work/spec-328/`）
- 票面勘误：印象写分支已在 `0d83ee1`（#302/#249，*make impressions read-only*）删除，本票按
  **只读消费者**收口，不恢复写入口（issue #331 Lead comment，2026-11-08）

## 问题（基线代码事实）

`SkillsState.kt` / `GatewayState.kt` 各有一份逐字等价的「串行写 → 写后重读 → 拒绝保留旧快照 →
传输失败映射」；`ImpressionState.kt` 只剩串行读。同一规则被写三遍，也被三份结构相同的类注释各写一遍：

| 关注点 | SkillsState（147 行） | GatewayState（172 行） | ImpressionState（69 行） |
| --- | --- | --- | --- |
| `MutableStateFlow` + `Mutex` | `:49-53` | `:69-73` | `:46-50` |
| 锁内读 / 写后重读 | `:67-69` / `:135-136` | `:80-83` / `:154-166` | `:55-58` / 无（只读） |
| 拒绝保留旧快照 | `:129` | `:132-135` | `:60` |
| 传输失败映射 | `:71-74`、`:131-141` | `:84-88`、`:136-141` | `:61-63` |
| 领域 Failure 三元组 | `:18-22` | `:37-41` | `:18-22` |

第四份同类实现 `BillState.kt` 是同一失败形状的第四份拷贝（`BillFailure`、自己的 `Mutex`/`load`）。
票面只点名三个页面，Lead 勘误也写明 Bill 范围外，本票**未动**。

## 做法

新增 `android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteResource.kt`（package
`me.rerere.rikkahub.data.remote`，纯 Kotlin + coroutines，无 Android 依赖，因此统一测试是纯 JVM）：

- `data class RemoteFailure(unreachable, code, message)`：三个领域 Failure 类收敛为一份；
- `interface RemotePageState<S>`：`val failure` + `settled(...)`，页面保留自己的 Snapshot 类型，
  机器只能改失败与两个忙碌标记，**结构上拿不到 payload**；
- `class RemoteResource<S>(scope, initial, read)`：`snapshot: StateFlow<S>`、`load(token)`、
  `write(token, onAccepted, operation)`（写 → 重读；写被接受即回调，重读失败不影响回调）、
  `perform(onAccepted, operation)`（写一次、不重读，答案交调用方）。

### 接口形状与 E4 §1.5 示意的唯一偏差

E4 示意 `settled(failure, reading: Boolean, writing: Boolean)`（两个标记非空）。实现改为
`settled(failure: RemoteFailure?, reading: Boolean? = null, writing: Boolean? = null)`，
`null` = 保持该标记原值。原因是两条代码事实：

1. `load` 的 `loading=true` 必须在 `scope.launch` **之前**同步置位，而这不能清掉在飞写的
   `working`；`write` 的 `working=true` 必须在锁**内**置位，也不能清掉排队读的 `loading`
   （E4 §1.5 行为细节 1，两处都不能挪）。非空参数会让机器必须知道另一个标记的当前值。
2. `ImpressionSnapshot` 没有 `working` 字段（只读页）。非空参数会强迫只读页伪造一个永远 false
   的标记，或让 module 自己另存一份 flag——后者是第二份权威状态。

失败参数非空语义不参与这套编码：失败总是被整体替换（同步起点清空、失败时写入），只有两个忙碌
标记用 `null` 表示「不动」。

### 三领域的收口

| 文件 | 行数（前 → 后） | 保留的领域钩子 | 移交给 module |
| --- | --- | --- | --- |
| `RemoteResource.kt` | 新增 → 156 | 无（通用机器） | 锁、launch、两套 catch、写后重读、失败映射 |
| `SkillsState.kt` | 147 → 72 | `fromPool` 派生；`openPending` 走 `perform` | `load` / 三个写 / 公开快照 |
| `GatewayState.kt` | 172 → 81 | `config` 快照派生；六个写转发；`saveRoute` 的 `onAccepted` | `load` / `write` / `freshRead` / 失败映射 |
| `ImpressionState.kt` | 69 → 36 | `impression` 快照派生；只 `load` | 串行读 / 失败映射 |

页面侧只改 Failure 类型引用 4 处：`SkillsPage.kt`（import + banner 参数）、`ImpressionPage.kt`
（import + banner 参数）；三个 Snapshot 字段、页面签名、DI、导航、BillState/FairyBillPage 未动。
`GatewayPage.kt` 收的是 snapshot，不受影响。

### 不能拍平的特殊行为（逐条保留）

1. **技能审核入口写一次、不重读**：`openPending` → `resource.perform`，`onAccepted` 收到后端
   答案 `sessionId`，不触发重读。`SkillsStateTest` 的
   `the pending entry asks the backend once and opens the primary session it answers`（不改）仍断言
   `backend.reads == 1`。
2. **网关写被接受、重读失败仍回调**：`saveRoute` → `write(onAccepted = { onSaved() })`，回调在
   重读尝试之后、与其成败无关；拒绝时既不再读也不回调。`GatewayStateTest` 的
   `an accepted route write closes the editor even when the follow-up read fails` /
   `a refused route write keeps the editor open`（不改）仍绿。
3. `refused.failure()` 的 `message.orEmpty()` 不丢；重读失败只清 `working` 不清 payload；
   拒绝不重读。`SkillsStateTest` / `GatewayStateTest` / `ImpressionStateTest` 的既有拒绝用例
   （不改）覆盖。
4. 只捕 `IdentityRefused` / `IdentityUnreachable`；`CancellationException` 继续上抛而不是被映射成
   页面失败（`RemoteResourceTest` 的 `a cancelled read is not reported as a failure`，并证明取消后
   lane 仍可用）。
5. `load` 的同步置位与 `write` 的锁内置位：`RemoteResourceTest` 的
   `load marks the page busy before its read is launched` 与
   `the working mark is set before the operation runs`；页面层
   `GatewayPageTest` 的 `a pending save disables the draft and the save button`（不改）仍绿。
6. 印象只读：`ImpressionStateTest` 四条（不改）仍断言「没成功读到就没有 impression、失败不伪造
   空印象、拒绝保留后端 code、重试再读」。

## 验证（全部在本 worktree 真实执行）

环境：`JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9`，`android/local.properties` 与
`android/app/google-services.json` 从主检出复制；命令均在 `android/` 下执行。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `:app:testDebugUnitTest --tests RemoteResourceTest --tests SkillsStateTest --tests GatewayStateTest --tests ImpressionStateTest` | 38 tests（11+9+14+4），0 failures | `work/tmp/331/data-suites.log` |
| `:app:testDebugUnitTest --tests SkillsPageTest --tests GatewayPageTest --tests ImpressionPageTest` | 27 tests（14+10+3），0 failures | `work/tmp/331/page-suites.log` |
| `./gradlew test lintDebug`（全量） | BUILD SUCCESSFUL in 25m59s；84 suites / 753 tests / 0 failures（app 681、ui 20、highlight 52）；lint 通过 | `work/tmp/331/full-test-lint.log` |
| `git merge integration/spec-328` @ `012abdc` 后重跑上述 7 个 suite | BUILD SUCCESSFUL in 2m4s；65 tests，0 failures | `work/tmp/331/merged-relevant-suites.log` |

全量运行发生在最终提交内容落地之后（工作树内容与 `a31759d` 的 Android 部分一致）。

## 门禁与合并说明

- **功能提交跳过本地 commit 钩子（`--no-verify`）**：当时同机 4–6 个并行 worktree 在跑重型套件，
  钩子中的 `npm test` 已持续 35+ 分钟未结束（另一 worktree 的 pre-commit 进程实测）；本票是
  Android-only 改动，钩子的 Android 部分 `./gradlew test lintDebug` 已在上表第 3 行真实跑绿，
  后端全量权威结果由 Lead 在集成分支独占运行产出（Lead 统一口径，2026-11-08）。
- **合并 `integration/spec-328` @ `012abdc` 用 `git merge --no-verify`**（Lead 统一口径：合并钩子
  的全量 `npm test` 在并行负载下会被负载敏感型 flake 打红，全量留收口）；合并干净无冲突，
  合并后重跑相关 suite 绿（上表第 4 行）。

## 未完成项 / 范围外

- `BillState.kt`（`BillFailure` + 自己的读锁）是同一形状的第四份拷贝，按票面与 Lead 勘误**不在
  本票范围**，未改；后续票可评估是否并入 `RemoteResource`（它多一个兜底异常分支与显式取消重抛）。
- 本票是数据层状态机重构，无 UI/协议/依赖变化；没有真机或模拟器验收项。
- 集成分支最终全量门禁（`npm test` / `npm run combo:verify` / `./gradlew test lintDebug`）由
  Lead/收口执行；本票不自行合入集成分支。
