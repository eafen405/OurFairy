# 103-model — 票 #103 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/07-single-model-authority.md`；落点
> `work/implementation/notes/73-row-plan.md` 的「#103 单一模型权威」。
> 分支 `ticket/103-model`；基线 `integration/spec-73` 的 `c6a20d6`。
> 实现提交 `83d0069`（探针读取服务）与 `b32f828`（删除第二份声明与比对）。

## 改了什么

1. **初始声明只剩 bundle 的 `agent-default-model` 行。**
   - `combo.json`：删除 `backend.agentModel` 与 `backend.agentModelNote`；版本组合不再重复
     provider/model，也不再描述「combo 与 bundle 两处声明、doctor 比对」。
   - `scripts/ourfairy-backend.mjs`：删除 `readCombination()` 对 `backend.agentModel` 的校验、
     `bundleAgentModel()` / `bundleDeclaresAgentModel()`、doctor 的 `bundle agent model` 检查，
     以及 `childEnv()` 注入的 `OURFAIRY_PROBE_PROVIDER/MODEL/REASONING_EFFORT`。
   - `scripts/real-acceptance.mjs`：不再从 `combo.json` 读模型；登录后经 `/gateway/read` 读回
     有效选择，仅在报告里记录 `requestedModel`。
   - `backend/v1-bundle/README.md`、`backend/probe/README.md`：改掉「launcher 显式传同一对值」
     「doctor 比对两份声明」的失效措辞，写明唯一声明与 `agentDefaultModel.currentSelection()`。

2. **探针从启动后的组合读取模型。**
   - `backend/probe/src/index.mjs` 新增 `readAgentDefaultModel(ctx)`：取
     `ctx.get('agentDefaultModel')` 的 `currentSelection()`，校验 provider/model 非空；服务缺席
     或选择不可用时抛 `ProbeConfigError`，消息点名 `agentDefaultModel`（退出码 3），不再读任何
     `OURFAIRY_PROBE_*` 选择变量。
   - boot 模式把选择写入 `report.model = { provider, model, reasoningEffort?, selection:
     'agentDefaultModel.currentSelection()' }`，外部无需跑 turn 即可断言组合值。
   - `runTurn` 在 turn 开始时读同一服务作为 `agentOptions`；结果字段（sessionId、events、
     output、flushReturned）附加在同一 `report.model` 上。credential 查询仍按
     `selection.provider` 解析该 route 的 `apiKeyEnv`。

3. **测试。**
   - `tests/executable-claims.test.mjs` 替换为 `tests/bundle-manifest.test.mjs`（旧双声明比对
     用例删除）：
     - `combo.json` 无 `agentModel` / `agentModelNote`；`doctor --json` 的 checks 名单中没有
       `bundle agent model`。
     - 复制仓库 → 只改 bundle `agent-default-model` 行的 model 为
       `MiniMax-M3.1-Flash-Preview-drifted` → 跑 `probe --report`（boot）→ 断言
       `report.model` 恰为 drift 后的 provider/model/effort 与 selection 来源。
   - `tests/bundle-packages.test.mjs`：installed-copy 用例去掉已不存在的 combo selection 环境
     变量，boot 不再依赖显式选择。
   - `tests/lifecycle.test.mjs`：doctor 的本地检查名单移除 `bundle agent model`。
   - `tests/gateway.test.mjs` 未改：保存选择覆盖初始声明、下一轮生效、运行中不切换的既有断言
     保持通过。

## 红 → 绿

实现前（测试先写）：

```
$ node --test tests/bundle-manifest.test.mjs
✖ combo.json declares no second model selection and doctor runs no comparison
  AssertionError: combo.json must not repeat the bundle's model selection;
  got {"provider":"minimax-cn","model":"MiniMax-M3.1-Flash-Preview","reasoningEffort":"max","apiKeyEnv":"MINIMAX_CN_API_KEY"}
✖ a drifted bundle model row reaches the probe boot report
  AssertionError: the boot report must read the composed row, not a second declaration; got null
ℹ tests 2  pass 0  fail 2
```

实现后：

```
$ node --test tests/bundle-manifest.test.mjs
✔ combo.json declares no second model selection and doctor runs no comparison
✔ a drifted bundle model row reaches the probe boot report
ℹ tests 2  pass 2  fail 0  duration_ms 31347
```

## 定向回归（均通过）

```
$ node --test tests/baseline-boot.test.mjs tests/model-double.test.mjs
ℹ tests 8  pass 8  fail 0
$ node --test tests/lifecycle.test.mjs tests/bundle-packages.test.mjs
ℹ tests 11  pass 11  fail 0
$ node --test tests/gateway.test.mjs
ℹ tests 9  pass 9  fail 0
```

`tests/gateway.test.mjs` 的 `the shared selection applies from the next turn, and a running reply
keeps its original model` 通过，验证保存选择仍覆盖 bundle 的初始声明、下一轮生效、运行中不切换。

## 全量

```
$ npm test
ℹ tests 170  pass 170  fail 0  duration_ms 69055
```

合入 `integration/spec-73`（结果 `Already up to date.`，本地 tip 仍为 `c6a20d6`，无新提交）后重跑：

```
$ npm test
ℹ tests 170  pass 170  fail 0  duration_ms 86785
```

本轮全量未出现 `conversation-search` / `pdf-worker-cancel` 抖动，无需单独重跑。

## 版本组合

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  based on integra  b32f828  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f            5b8ec0f  ok
rikkahub  product/ourfairy-v1      460109d1           2d97ed14 MISMATCH
```

上表是证据提交前（HEAD `b32f828`）的运行；证据提交 `e4b1b9a` 后重跑，ourfairy 项为
`e4b1b9a ... ok (worktree is based on the integration tip)`，dsh 仍 ok，rikkahub 仍 MISMATCH。

rikkahub 的 MISMATCH 是外部检出漂移（`product/ourfairy-v1` 实际 `2d97ed14`，combo 锁定
`460109d1`），与 #102 证据记录一致；本票未改 `combo.json` 的仓库锁定，未修。

## 未执行项与原因

- 未调用真实 MiniMax / SiliconFlow 服务：本票改的是声明来源与探针读取路径；turn 证据用
  `tests/model-double.test.mjs` 的 loopback Messages 替身，boot 为 keyless。`real-acceptance.mjs`
  只做了语法检查，未跑真实验收（需要操作者凭据）。
- 未跑 Android 构建（不在本票范围）。
- 未修 rikkahub 外部漂移（按下发要求记录不修）。
- 合并 `integration/spec-73` 为 no-op，无冲突需要处理。
