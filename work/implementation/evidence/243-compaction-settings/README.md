# #243 自动压缩触发阈值：部署设置、网关保存与客户端控件

日期：2026-10-27。票面：[`work/tickets/fairy-memory/03-compaction-threshold-settings.md`](../../../tickets/fairy-memory/03-compaction-threshold-settings.md)。
分支 `ticket/243-compaction-settings`，worktree `.worktrees/243-compaction-settings`，基线
`3da7ba7968`（`integration/spec-240`），合并集成分支后的提交 `c301256e43`。
规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md) Implementation Decisions
§6「设置树与生效」、§7「Android」与 User Stories 49–58、60。
配置拥有者与线协议由 Lead 在实施 notes 中锁定（非仓库文件）：`gateway.compaction =
{ thresholdTokens }`、POST `/gateway/compaction`、`compaction-basic` 行的 `thresholdTokens`
（volatile）、整 token 100000–900000、界面 K / 步长 1K。

本票只做自动压缩触发阈值。记忆组、维护两项、`gateway.maintenance` 属 #247；本票只留下可复用
数值控件与嵌套分组的基础设施，不新增维护字段或分组。真实模型质量与真机验收不在本票范围内。

## 改动

后端 `@ourfairy/dsh-gateway`：

| 文件 | 职责 |
| --- | --- |
| [`src/service.ts`](../../../../backend/gateway/src/service.ts) | `read()` 增加 `compaction: { thresholdTokens }`、`editable.compaction`、`saved.compaction`；`saveCompaction()` 校验整 token 100000–900000（含边界），拒绝缺失/非整数/越界/多余字段，经 `settings.update('compaction-basic', …)` 写入 volatile 字段 |
| [`src/http.ts`](../../../../backend/gateway/src/http.ts) | `GATEWAY_PATHS` 与 handler 表增加 `/gateway/compaction`，沿用 `postHandler` + `asAdmin`（匿名 401、普通代理人 403） |
| [`README.md`](../../../../backend/gateway/README.md) | 路由、读取字段、范围/错误码、热生效与「保留预算不是第三个设置」写入插件契约 |

Android：

| 文件 | 职责 |
| --- | --- |
| [`FairyNumericField.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyNumericField.kt) | 可复用数值组合控件：`FairyNumericSpec`（label/unit/min/max/scale/step）、`FairyNumericDraftState`（同一草稿）、`parseFairyNumeric`/`formatFairyNumeric`、Material 3 `Slider` + `OutlinedTextField` + 单位 + 范围 + 忙态 + 可见错误；#247 直接复用 |
| [`GatewayApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/GatewayApi.kt) | `GatewayCompaction`/`GatewayCompactionDraft`、可空 `compaction` 与 `editable/saved.compaction` 默认值、`/gateway/compaction` 线协议 |
| [`GatewayState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/GatewayState.kt) | `saveCompaction` 走既有串行写 + 写后 `freshRead`；拒绝保留已读配置 |
| [`GatewayPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/GatewayPage.kt) | 新顶级「上下文」组 → 嵌套「自动压缩」组 → 阈值字段；展开状态改为每组独立 key 的 `Set<String>`；成功保存后由重读值重置草稿 |
| `values/strings_identity.xml` + `values-zh/strings_identity.xml` | 新增文案两语言同步 |

测试：

- 后端 [`tests/gateway-compaction-settings.test.mjs`](../../../../tests/gateway-compaction-settings.test.mjs)：
  真实 v1 profile + Loader + 认证产品会话 + 回环 Messages 替身。
- [`tests/gateway.test.mjs`](../../../../tests/gateway.test.mjs)：普通代理人拒绝路径加入
  `/gateway/compaction`，读取默认 500000 与新布尔字段。
- Android `FairyNumericDraftTest`（草稿/范围/无截断）、`FairyNumericFieldTest`（忙态/单位/范围）、
  `GatewayApiTest`（线协议与旧后端兼容）、`GatewayStateTest`（写后重读/拒绝保留）、
  `GatewayPageTest`（嵌套归属、非法草稿、保存、拒绝、忙态）。

## 关键决定

- **配置拥有者是原生行。** `thresholdTokens` 不在网关里建第二份状态，也不在 bundle 里另加一行：
  #242 已挂载 `compaction-basic` 并声明默认 500000/16000；网关按行名 `compaction-basic` 读取
  `settings.describe()` 的解析值，`saved` 只看用户层是否覆盖，`editable` 只看该行是否挂载。
  整个配置编辑器缺席时仍按既有约定返回 503 `gateway/configuration-unavailable`。
- **服务端范围在本票落地。** 原生 `compaction-basic` 的 schema 只声明正整数；100000–900000 是
  产品策略，因此在网关校验，非法值返回 400 `gateway/invalid-compaction` 并带上下界，不取整、
  不 clamp。引擎仍按规格取「绝对阈值、路由比例阈值、扣除输出预留后的容量」最小值，较小窗口模型
  可以更早压缩；#242 与 #241 的测试固定了这条原生语义。
- **规格偏差：压缩范围只有网关一处校验。** 规格 §6 写「后端与各自拥有者的 schema 都校验范围」；
  对维护两项成立（`memory` 行 Config 声明 5–50 / 3–24，越界持久值在加载时由 Loader 拒绝），
  对压缩阈值不成立：`compaction-basic` 归 dsh 所有，schema 只约束正整数，100000–900000 只在
  `/gateway/compaction` 校验。本票有意不改 dsh 的通用 schema——那会把一个产品数字写进上游
  通用插件，且下次更新 dsh 会被覆盖；网关因此是这条范围唯一有文档的校验入口。绕过网关直接改
  profile 用户层仍会被原生 schema 接受，这是已知且接受的残余风险；偏差同时记录在 #248 证据与
  `backend/v1-bundle/cordis.patch.yml` 的压缩配置注释中。
- **热生效靠 volatile 字段，不靠重启。** `settings.update('compaction-basic', { thresholdTokens })`
  写入 profile 用户层后，原生 `compaction-basic` 在每次压力判断读取该引用。行为用例把阈值从
  900000 改到 100000 后，**同一进程的下一次压力检查**就修剪了超长工具结果；900000 时同样的
  500000 输入 token 不触发。用例还固定：修剪后不再发摘要请求（压力已解除），说明观察到的确实是
  原生压力入口，而不是另一条测试自建的阈值计算。
- **保留预算不是可编辑设置。** 原生 settings 保存 volatile 字段时会把该行其余字段一并写回用户层；
  用例显式断言 `retainTokens` 仍是 16000，且接口不接受作为第二字段（多余字段 400）。
- **模型切换不改变阈值。** 用例在重启后把共用选择切到 `deepseek-official / deepseek-flash`，再读
  `/gateway/read`：`compaction.thresholdTokens` 仍为 100000，profile 行不变。这说明设置不在模型
  配置或按模型覆盖里。
- **重启保留是真实持久化。** 保存后读取 profile 的 `cordis.patch.yml`，见 `compaction-basic` 行的
  用户层；重启同一 `OURFAIRY_HOME` 后读取值不变，新会话的下一压力检查仍按 100000 修剪。
- **Android 的嵌套展开。** 页面原先只有一个 `String? open`，无法同时表达父子两级。现在每个组有
  自己的 key（`context`、`context/compaction`、`model`…），父组、子组与模型组可独立展开；阈值
  只在「上下文 → 自动压缩」下出现，模型组不展示它。
- **可复用控件的接口给 #247。** 草稿以显示单位保存字符串，`scale` 负责换算（K token 用 1000，
  维护的回合/小时用默认 1）；`step` 只决定滑块粒度（阈值 1K）。直接输入按精确十进制换算，
  能整除为整 token 才有效（例如 `500.5K` = 500500 token）；越界、非数字与无法整除为整 token
  都保留原文并给出可见错误，`parsed.stored == null` 时页面禁用保存。滑块拖动按 `step` 取整，
  与输入框编辑同一个 `FairyNumericDraftState`。`remember(spec, stored)` 使写后重读的新值重置草稿，
  失败保存不重置。
- **旧后端兼容。** `GatewayConfig.compaction` 可空；旧文档解出 `null` 时页面不渲染「上下文」组，
  也不假装默认值已保存。`editable.compaction` / `saved.compaction` 默认 false。
- **不新增 UI 依赖。** `Slider`、`SliderState` 均来自已声明的 Material 3；没有新增 Gradle 依赖。

## TDD 红绿记录

先加载 `tdd` skill，按切片先写失败用例再实现；每轮实现后跑真实 backend 或 Android 目标用例。

1. 后端实现前（网关无该字段/路由）：
   ```text
   ✖ the threshold is an administrator-only deployment setting: 500K default, 100K–900K, no silent rounding (7552ms)
     AssertionError [ERR_ASSERTION]: the deployment default is 500K tokens
     + actual: undefined
     - { thresholdTokens: 500000 }
   ```
   实现网关读取/写入与校验后：
   ```text
   ✔ the threshold is an administrator-only deployment setting: 500K default, 100K–900K, no silent rounding (1606ms)
   ✔ a saved threshold drives the next pressure check, ignores model switching, and survives a restart (3183ms)
   ℹ tests 2 / pass 2 / fail 0
   ```
2. 数值控件尚不存在时（Android 编译红）：
   ```text
   e: FairyNumericDraftTest.kt:18:22 Unresolved reference 'FairyNumericSpec'.
   e: FairyNumericDraftTest.kt:65:21 Unresolved reference 'FairyNumericDraftState'.
   > Task :app:compileDebugUnitTestKotlin FAILED
   ```
   实现 `FairyNumericField.kt` 后 `FairyNumericDraftTest` 5/5。
3. 网关客户端类型尚不存在时：
   ```text
   e: GatewayApiTest.kt:142:38 Unresolved reference 'compaction' on receiver of type 'GatewayConfig'.
   e: GatewayApiTest.kt:176:25 Unresolved reference 'saveCompaction' on receiver of type 'GatewayApi'.
   e: GatewayStateTest.kt:34:34 Unresolved reference 'GatewayCompactionDraft'.
   ```
   实现 `GatewayCompaction*`、`saveCompaction` 与串行写后重读后，两个测试类 23/23。
4. 页面分组未接线时 `GatewayPageTest` 4 failed（找不到「自动压缩」节点）；实现嵌套组后仍红，
   定位为 Compose 测试时钟未推进点击（`autoAdvance = false` 下 `performClick` 不产生重组），
   把页面用例改为先定帧再 `autoAdvance = true` 后 5/5；这次修正只改测试，实现未因它改动。
5. 页面实现后补上「挂起保存时输入与保存按钮禁用」用例，`GatewayPageTest` 5/5。

## 验证（实际运行）

工作目录 `.worktrees/243-compaction-settings`：

```sh
npm run build
# 通过（scripts/tsc.ts --fresh）

npm test
# tests 375 / suites 7 / pass 375 / fail 0（合并 integration/spec-240 后的最终全量）

node --test tests/gateway-compaction-settings.test.mjs
# tests 2 / pass 2 / fail 0

node --test tests/gateway.test.mjs tests/gateway-service.test.mjs
# tests 15 / pass 15 / fail 0

npm run combo:verify
# ourfairy ok（工作树基于集成 tip c301256e43）/ dsh ok（d80522d276）/ android source ok
# combo: combination verified
```

Android（`android/`，`ANDROID_HOME=/home/eafen405/Android/Sdk`）：

```sh
./gradlew test lintDebug
# BUILD SUCCESSFUL（test + lintDebug，134 tasks，exit 0）
# app 306 + highlight 53 + ui 20 = 379 tests, 0 failures
# lint：0 errors / 31 warnings（本票新增代码无告警；strings_identity 的 1 条为既有
#       impression_counter 的 PluralsCandidate）

./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyNumericDraftTest' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyNumericFieldTest' \
  --tests 'me.rerere.rikkahub.ui.identity.GatewayPageTest' \
  --tests 'me.rerere.rikkahub.data.remote.GatewayApiTest' \
  --tests 'me.rerere.rikkahub.data.remote.GatewayStateTest'
# FairyNumericDraftTest 5 / FairyNumericFieldTest 2 / GatewayPageTest 5 /
# GatewayApiTest 11 / GatewayStateTest 12，全部 0 failed
```

`feat` 与 `test` 两次成功提交的 pre-commit 门禁都在完整代码树上跑过 `npm test`、
`npm run combo:verify` 与 `android ./gradlew test lintDebug`；`feat` 的第一次尝试在 `npm test`
上出现过一次 `memory-impression.test.mjs` 的注入用例失败（与本票文件无关），该次未执行到
combo 与 Android；重试、`test` 提交和合并后的全量均通过（最终 375/375）。这是观察到的偶发，
不是本票改动引入的可复现失败。

## 验收对照

| 票面条目 | 证据 |
| --- | --- |
| 按「上下文 → 自动压缩 → 阈值」呈现，不出现在模型配置 | `GatewayPageTest`：只开模型组时无阈值；父组、子组、模型组可独立展开；阈值标签与 `范围：100–900 K token` 在子组内 |
| 默认 500K、范围 100K–900K、K 显示、保存完整整数 | 后端用例读默认 500000；客户端 `FairyNumericDraftTest` 的 K↔token 换算；`GatewayApiTest` 发出 `{"thresholdTokens":700000}` |
| 滑块与直接输入同一草稿；非法客户端与服务端都拒绝且不截断 | `FairyNumericDraftTest` 的 `slide`/`input` 同一 state；页面越界 950 保留原文并禁用保存；后端 99999/900001/500000.5/缺失/多余字段均 400 且 `saved` 仍 false |
| 控件含单位、范围、忙态、错误 | `FairyNumericFieldTest`（忙态禁用输入与滑块、范围文案）；`GatewayPageTest`（挂起保存禁用、错误可见） |
| 保存后下一次压力判断用新值、重启保留、模型切换不改变 | `gateway-compaction-settings.test.mjs`：900000 不触发 / 保存 100000 后下一次检查修剪工具结果；重启后新会话仍修剪；切模型后读取值不变 |
| 普通代理人不能读取或修改 | `gateway.test.mjs` 与 `gateway-compaction-settings.test.mjs`：匿名 401、普通代理人读/写均 403 `gateway/forbidden` |

## 未完成与风险

- **#247 未做。** 本票只有压缩阈值；记忆 → 维护、`gateway.maintenance`、两项维护数值都留给 #247，
  它们应复用本票的 `FairyNumericSpec` / `FairyNumericDraftState` / `FairyNumericField`。
- **范围校验只在网关。** 原生 `compaction-basic` schema 归 dsh 所有，只约束正整数；100000–900000
  由产品网关强制。若以后有其他写入方绕过网关直接改 profile，原生 schema 不会拒绝 1000 或 1000000。
  已按线协议把范围明确为产品层责任，没有改 dsh。
- **没有真机与真实模型。** Android 只有 Robolectric/Compose；阈值行为由本地 Messages 替身报告的
  input token 驱动，真实供应商的 usage 粒度、摘要质量与 request-size 行为没有实测。
- **模型切换只在读取层断言。** 重启后把选择切到 `deepseek-official` 并断言阈值不变；没有在切换后
  再发一轮模型请求（该路由会离开本地替身）。「阈值不随选择」由服务端读取与字段归属固定。
- **旧后端兼容是页面级。** 缺少 `compaction` 对象的旧后端不会显示上下文组；没有为旧后端发明默认值。
- **一次无关全量偶发。** 已在验证节记录；未在本票内追查 `memory-impression.test.mjs` 的时序。
