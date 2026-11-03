# #247 记忆维护设置：网关读写、热生效与「记忆 → 维护」

日期：2026-10-27。票面：[`work/tickets/fairy-memory/07-maintenance-settings.md`](../../../tickets/fairy-memory/07-maintenance-settings.md)。
分支 `ticket/247-maintenance-settings`，worktree `.worktrees/247-maintenance-settings`，基线
`e07471ee33`（`integration/spec-240`，含 #241–#246）。提交：feat `4d58a6b594`、
test `68b32307a5`、docs 本条提交。
规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md) Implementation Decisions
§5「维护状态机与材料」、§6「设置树与生效」、§7「Android」与 User Stories 52–58、60。
线协议由 Lead 在实施 notes 中锁定（非仓库文件）：`gateway.maintenance = { triggerTurns, decayHours }`、
POST `/gateway/maintenance`、配置拥有者为 `memory` 行的 `maintenanceTurns` / `maintenanceDecayHours`
（均 volatile）、整数 5–50 与 3–24（含边界）、非法 `gateway/invalid-maintenance`、不 clamp。

本票只把两项维护数值接到设置面并证明热生效。压缩阈值（#243）、维护状态机的材料/claim/完成判定
（#246）与真实轻量模型质量验收（#248）未改；维护引擎仍只在每次评估时读取 volatile 配置。

## 改动

后端 `@ourfairy/dsh-gateway`：

| 文件 | 职责 |
| --- | --- |
| [`src/service.ts`](../../../../backend/gateway/src/service.ts) | `read()` 增加 `maintenance: { triggerTurns, decayHours }`、`editable.maintenance`、`saved.maintenance`；`saveMaintenance()` 校验两个完整整数（5–50 / 3–24，含边界），拒绝缺失/非整数/越界/多余字段，经 `settings.update('memory', …)` 写入 `maintenanceTurns` / `maintenanceDecayHours` 两个 volatile 字段 |
| [`src/http.ts`](../../../../backend/gateway/src/http.ts) | `GATEWAY_PATHS` 与 handler 表增加 `/gateway/maintenance`，沿用 `postHandler` + `asAdmin`（匿名 401、普通代理人 403） |
| [`README.md`](../../../../backend/gateway/README.md) | 路由、读取字段、范围/错误码、热生效、不重置水位与重启保留写入插件契约 |
| [`backend/memory/README.md`](../../../../backend/memory/README.md) | 配置节与「本行不做什么」改为指向已交付的网关设置面，不再写「#247 未做」 |

Android：

| 文件 | 职责 |
| --- | --- |
| [`GatewayApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/GatewayApi.kt) | `GatewayMaintenance`/`GatewayMaintenanceDraft`、可空 `maintenance` 与 `editable/saved.maintenance` 默认 false、`/gateway/maintenance` 线协议 |
| [`GatewayState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/GatewayState.kt) | `saveMaintenance` 走既有串行写 + 写后 `freshRead`；拒绝不覆盖已读配置 |
| [`GatewayPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/GatewayPage.kt) | 新顶级「记忆」组 → 嵌套「维护」组 → 两个 `FairyNumericField` 与一个保存按钮；展开状态沿用每组独立 key（`memory`、`memory/maintenance`）；两个草稿由同一 `MaintenanceSection` 持有 |
| `values/strings_identity.xml` + `values-zh/strings_identity.xml` | 新增记忆/维护组、两项标签与单位（`回合` / `小时`）、说明、保存按钮；两语言同步 |

测试：

- 后端 [`tests/gateway-maintenance-settings.test.mjs`](../../../../tests/gateway-maintenance-settings.test.mjs)：
  真实 v1 profile + Loader + 认证产品会话 + 回环 Messages 替身；默认值/边界/拒绝、普通代理人拒绝、
  profile 用户层持久化与重启、保存后下一次维护评估（搁置区间）、不重置水位、衰减间隔改变后重评。
- [`tests/gateway.test.mjs`](../../../../tests/gateway.test.mjs)：权限环加入 `/gateway/maintenance`，
  读取默认 `{triggerTurns:15,decayHours:6}`、新布尔字段与非法配置错误码。
- Android `GatewayApiTest`（线协议、旧后端兼容、错误码透传）、`GatewayStateTest`（写后重读、拒绝保留）、
  `GatewayPageTest`（嵌套归属、两项同一控件/草稿、非法草稿、一起保存、忙态、拒绝可见）、
  `FairyNumericDraftTest`/`FairyNumericFieldTest`（既有共享控件规则，未改）。

## 关键决定

- **配置拥有者是原生 `memory` 行，网关不建第二份状态。** 线协议字段 `triggerTurns` /
  `decayHours` 在服务层映射到该行的 `maintenanceTurns` / `maintenanceDecayHours`；
  `read()` 从 `settings.describe()` 的解析值读取，`editable.maintenance` 只看该行是否挂载，
  `saved.maintenance` 只看 profile 用户层是否已覆盖这两个数值之一。整个配置编辑器缺席时仍按
  既有约定返回 503 `gateway/configuration-unavailable`。
- **一次保存写两个字段。** 请求必须同时含 `triggerTurns` 与 `decayHours`，两者都是完整整数且
  在各自范围内；任一缺失/非法/多余字段返回 400 `gateway/invalid-maintenance` 并说明该字段的
  上下界，不取整、不 clamp、不落到边界值。一次 `settings.update('memory', …)` 写入，客户端只有
  一个保存按钮，避免两项分别保存造成半套配置。
- **热生效靠 volatile 字段，不靠重启。** `memory` 行两个字段声明为 `.volatile()`，
  `readMaintenanceSettings` 在每次评估重新读取。用例证明：6 回合的已搁置区间在默认 15 回合下
  不触发，保存 `triggerTurns=5` 后**同一进程的下一次定时评估**启动维护子会话；10 回合、最新闭合
  时间前移 15 小时的区间在默认 6 小时衰减下门槛为 13 不触发，保存 `decayHours=3` 后门槛为 10，
  同一无新回合的区间在下一次评估触发。两次都未重启、未新增用户回合。
- **保存不碰水位。** 设置写入只经过 profile 配置层；`maintenance_state` 的 `watermark_seq`、
  `cut_seq`、`child_session` 不由该写路径修改。用例在完成一次维护后记下水位，再保存新的衰减
  间隔并等待两个 tick，断言水位不变且没有第二个子会话；重启后同一源会话的水位仍是保存后的值，
  启动扫描没有重新维护它。
- **重启保留是真实持久化。** 保存后读取 profile 的 `cordis.patch.yml`，见 `memory` 行的
  `maintenanceTurns`/`maintenanceDecayHours`；重启同一 `OURFAIRY_HOME` 后读取值与用户层覆盖
  不变。重启用例还用**新源会话**的 5 个闭合回合触发维护，证明进程用的是持久化的 5 而不是
  bundle 的 15 默认值。
- **不改变维护子会话的模型路由。** 原生 settings 保存 volatile 字段时会将该行其余 volatile
  字段与路径一并写回用户层（#243 已记录同一原生行为）。本票只提交两个数值，模型/供应商保持
  部署的 `!!js` 表达式，重启后仍按部署环境求值；用例检查保存后的行配置仍含
  `MiniMax-M3.1-Flash` / `minimax-cn`，并断言重启后维护子会话的请求 model 仍是
  `MiniMax-M3.1-Flash`。
- **Android 的嵌套展开。** 沿用 #243 的每组独立 key 模型：`memory` 与 `memory/maintenance`
  各自开关，模型组、上下文组与记忆组互不替换。记忆组只在后端返回 `maintenance` 对象时渲染，
  旧后端不会显示一个发明出来的默认值。
- **两项复用同一数值控件与同一套校验/错误逻辑。** 两个 `FairyNumericSpec` 都是 `scale=1`、
  `step=1`，滑块与直接输入编辑各自的 `FairyNumericDraftState`；保存按钮要求两个草稿都
  `parsed.stored != null`，忙态同时禁用两个输入、两个滑块与按钮，服务端拒绝保留原文并显示
  failure banner 的 code/message。单位 `回合` / `小时` 只是新增字符串；没有新增 UI 依赖。
- **摘要用 `%s` 而非 `%d`，不新增 lint 告警。** 维护组折叠摘要把两个数字作为字符串格式化，
  避免 `PluralsCandidate`；`lintDebug` 的告警数保持 31（其中 1 条是既有
  `impression_counter`），本票新增代码无新告警。

## TDD 红绿记录

先加载 `tdd` skill，按切片先写失败用例再实现；每轮实现后跑真实 backend 或 Android 目标用例。

1. 后端读取切片（网关尚无 `maintenance` 字段/路由）：
   ```text
   ✖ the maintenance numbers are an administrator-only deployment setting: 15/6 defaults, 5–50 and 3–24, no clamping (7691ms)
     AssertionError [ERR_ASSERTION]: the deployment defaults are 15 closed turns and a 6-hour decay interval
     + actual: undefined
     - { triggerTurns: 15, decayHours: 6 }
   ```
   实现 `read()` 的视图/可编辑/已保存字段与 `/gateway/maintenance` 校验写入后：
   ```text
   ✔ the maintenance numbers are an administrator-only deployment setting: 15/6 defaults, 5–50 and 3–24, no clamping
   ℹ tests 1 / pass 1 / fail 0
   ```
2. 行为切片在 read/save 切片转绿后编写并立即通过；它们不是该轮新增实现的红绿，而是把
   「保存后的下一次评估」「不重置水位」「重启保留」与「搁置区间按新衰减重算」固定为回归用例。
   触发回合数用例：搁置 6 回合 → 保存 5 → 下一次评估触发、水位推进、第二次保存不重置、
   重启保留；衰减用例：15 小时搁置、10 回合，6 小时衰减不触发、保存 3 小时后同一区间触发：
   ```text
   ✔ a saved trigger turn count re-evaluates a parked interval, does not reset the watermark, and survives a restart (10.3s)
   ✔ a saved decay interval re-evaluates a parked interval under the new threshold (5.1s)
   ℹ tests 3 / pass 3 / fail 0
   ```
3. Android 客户端类型尚不存在时（编译红）：
   ```text
   e: GatewayApiTest.kt:143:25 Unresolved reference 'maintenance' on receiver of type 'GatewayConfig'.
   e: GatewayStateTest.kt:382:64 Unresolved reference 'maintenance' on receiver of type 'GatewaySaved'.
   e: GatewayStateTest.kt:389:31 Unresolved reference 'GatewayMaintenanceDraft'.
   e: GatewayStateTest.kt:401:15 Unresolved reference 'saveMaintenance' on receiver of type 'GatewayState'.
   > Task :app:compileDebugUnitTestKotlin FAILED
   ```
   实现 `GatewayMaintenance*`、`saveMaintenance` 与串行写后重读后，`GatewayApiTest` 12/12、
   `GatewayStateTest` 14/14。
4. 页面分组未接线时 `GatewayPageTest` 5 failed（新的 5 个用例都停在找不到「记忆」组）：
   ```text
   GatewayPageTest > the maintenance numbers are a nested memory group, not flat and not beside the model FAILED
   java.lang.AssertionError at GatewayPageTest.kt:171
   10 tests completed, 5 failed
   ```
   实现「记忆 → 维护」、两个 `FairyNumericField` 与共同保存后 10/10；与 Api/State/Draft/Field
   一起 43/43。
5. 一次只改测试的修正：共享控件的中文范围错误串在单位与「之间」之间有空格
   （`请输入 5 到 50 回合 之间的值。`），页面用例最初按无空格写；按既有资源原文改正期望，
   实现未因此改动。`lintDebug` 曾因折叠摘要用 `%d` 新增 1 条 `PluralsCandidate`，改回
   `%s` 后告警数与基线一致。

## 验证（实际运行）

工作目录 `.worktrees/247-maintenance-settings`：

```sh
npm run build
# 通过（scripts/tsc.ts --fresh，无输出）

npm test
# tests 378 / suites 7 / pass 378 / fail 0（最终全量）

node --test tests/gateway-maintenance-settings.test.mjs
# tests 3 / pass 3 / fail 0

node --test tests/gateway.test.mjs
# tests 12 / pass 12 / fail 0

node --test tests/gateway-compaction-settings.test.mjs tests/gateway-service.test.mjs
# tests 5 / pass 5 / fail 0（压缩设置与网关单元面未回归）

npm run combo:verify
# ourfairy ok（工作树基于集成 tip）/ dsh ok（d80522d276）/ android source ok
# combo: combination verified
```

Android（`android/`，`ANDROID_HOME=/home/eafen405/Android/Sdk`）：

```sh
./gradlew test lintDebug
# BUILD SUCCESSFUL（test + lintDebug，134 tasks，exit 0）
# app 314 + highlight 53 + ui 20 = 387 tests, 0 failures
# lint：app 0 errors / 31 warnings（本票新增代码无告警；31 中的
#       1 条为既有 impression_counter 的 PluralsCandidate），
#       highlight 无问题，ui 0 errors / 0 warnings / 1 hint

./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.GatewayApiTest' \
  --tests 'me.rerere.rikkahub.data.remote.GatewayStateTest' \
  --tests 'me.rerere.rikkahub.ui.identity.GatewayPageTest' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyNumericDraftTest' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyNumericFieldTest'
# GatewayApiTest 12 / GatewayStateTest 14 / GatewayPageTest 10 /
# FairyNumericDraftTest 5 / FairyNumericFieldTest 2，共 43，全部 0 failed
```

`feat`、`test`、`docs` 三次提交的 pre-commit 门禁均通过：前两次都触及 `android/`，按仓库门禁
运行完整后端与 Android `test lintDebug`；docs 提交按 Markdown 门禁执行。集成分支
`integration/spec-240` 在本票实施期间未前进（仍为 `e07471ee33`），因此没有额外合并。

## 验收对照

| 票面条目 | 证据 |
| --- | --- |
| 「记忆 → 维护」归属，不平铺也不在模型旁 | `GatewayPageTest`：只开模型组时无维护输入；「记忆」组独立展开，其下「维护」再展开才出现两个字段；两个父组与模型组可同时展开 |
| 默认 15、5–50；默认 6 小时、3–24 | 后端读取默认 `{15,6}`；`GatewayPageTest` 断言 `范围：5–50 回合` 与 `范围：3–24 小时`；后端边界 5/50、3/24 均接受 |
| 两项复用同一数值控件、草稿、校验与错误反馈 | 页面两个字段都是 `FairyNumericField` + `FairyNumericDraftState`；非法任一项都会显示共享控件的范围错误并禁用唯一的保存按钮；忙态同时禁用两项 |
| 客户端与服务端都拒绝非法输入；普通代理人不能改 | 页面 4/25 均不出请求；后端 4/51/5.5/'5'/null、2/25/3.5/'6'、缺失与多余字段均 400 `gateway/invalid-maintenance`，拒绝后读值不变且 `saved.maintenance=false`；匿名 401、普通代理人读/写 403 `gateway/forbidden` |
| 保存后下一次维护评估采用新值，不重置既有水位，重启保留 | `gateway-maintenance-settings.test.mjs`：保存 `triggerTurns=5` 后下一次定时评估维护同一搁置区间；第二次保存后水位与子会话不变；重启后读取值不变、新 5 回合会话触发维护；profile 用户层保存两值 |
| 修改衰减间隔或初始回合数后搁置区间按新配置重算 | 6 回合搁置区间：15 不触发 → 保存 5 后触发；10 回合 + 15 小时搁置：6 小时衰减门槛 13 不触发 → 保存 3 后门槛 10 触发；两次均无新用户回合 |

## 未完成与风险

- **设置写入会带上 `memory` 行其余字段。** 原生 settings 保存 volatile 字段时会写回整行
  volatile 值与数据库路径；这是 #243 已记录的原生行为，不是网关新增的第二权威。模型与
  供应商字段以部署的 `!!js` 表达式保留、重启后按当时环境求值；若以后要求「保存设置时
  不动该行其他字段」，需要 dsh settings 提供窄写接缝（本票未改 dsh）。
- **保存与运行中的维护子会话没有专门的计时测试。** 规格要求保存不主动中断正在运行的维护；
  实现只改配置，`claim` 后的子会话使用 claim 时读到的设置，因此不会被保存打断。但本票
  只证明「下一次评估采用新值」，未构造「子会话运行期间保存」的用例；失败恢复/并行语义
  仍由 #246 的用例覆盖。
- **`saved.maintenance` 是「任一字段已被用户层覆盖」。** 通过原生设置界面单独改一项也会
  显示已保存；网关接口本身总是同时写两项。没有单独的「两项都已保存」判定，因为原生
  `user` 形状不区分写入来源。
- **维护语义质量不在本票。** 子会话是否写出好的记忆、真实 MiniMax-M3.1-Flash 的语义
  质量仍属 #248；本票所有维护行为证据都是模型替身 + 真实 profile/Loader/会话/SQLite。
- **没有真机。** Android 只有 Robolectric/Compose 页面证据；滑块触感、软键盘输入与折叠
  动画没有在设备上验收。
- **旧后端兼容是页面级。** 缺少 `maintenance` 对象的旧后端不会显示「记忆」组，也不会
  为它发明默认值；`editable.maintenance` 只表示 `memory` 行是否挂载。
- **评估节奏仍是 1 秒 tick。** 「搁置区间按新配置重新计算」依赖 #246 的定时重评；本票没有
  新增「保存即主动评估」的触发路径（规格只要求下一次评估生效，避免保存产生副作用）。
