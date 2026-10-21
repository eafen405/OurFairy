# 04 / #166 选型写入：走原生保存入口

票：GitHub #166（父票 #135，本地票面 `work/tickets/135/04-selection-native-entry.md`）
分支：`ticket/166-selection-native-entry`
基线：`integration/spec-135` tip `98f6d3b`（开工时 `git merge-base --is-ancestor` 已确认；收口前再
merge 该分支最新 tip）
提交：本文件所在提交（提交说明写明「保存顺序失去保证时失败的是哪条断言」）

## 改动

- `backend/gateway/src/service.mjs`：`saveSelection` 不再用
  `settings().mutate('agent-default-model', …)` 直接写行，改为调用原生
  `this.ctx.agentDefaultModel.saveSelection({provider, model, reasoningEffort?})`。
  - 网关自己的校验原样保留：provider 已注册、`resolveModelInfo` 成功、适配器目录成员、
    `reasoningEffort` 形状；失败码仍是 400 `gateway/invalid-selection`。
  - 保留 503 `gateway/configuration-unavailable`：先调用现有的 `this.settings()`（读取路径同一个
    seam）。设置服务自身 `inject = ['configEditor','profileContext']`，因此它的缺失就是配置编辑器的
    缺失；原生入口在没有编辑器时会静默保持组合入口，不能让它变成一次「成功」的保存。
  - 省略 `reasoningEffort` 时，从同一设置行的继承层取组合默认值
    （`this.row('agent-default-model')?.base?.reasoningEffort`）随完整选择一起提交。原生入口写的是
    完整选择；若只传 `{provider, model}`，用户层行会覆盖掉组合声明的 `reasoningEffort: max`，
    生效值变成「无 effort」。旧实现 `settings().mutate` 的 `unset` 也把继承值写回（见
    `packages/settings/settings/src/index.ts` 的 `mutate`：`inherited` 存在时把 unset 换成 set），
    所以这是保持既有语义，不是新增钉死：保存值等于组合声明时 `configEditor.edit` 的
    `isDeepStrictEqual(next, inherited)` 仍会删除整行，profile 覆盖确实被清除。
  - 返回体与语义不变：`{selection: <effective>, applies: 'next-turn'}`；运行中的回复不切换
    （该行为在 chat 侧，本票未改）。
- `backend/gateway/README.md`（共用选模）：写明经原生保存入口写入、原生入口按提交顺序串行化
  （重叠保存由上游 `agent-default-model` 测试固定）、无编辑器时 503，以及省略 effort 的
  「取继承默认值 → 等于组合声明时删除 profile 行」机制。
- `tests/gateway.test.mjs`：新增 `consecutive selection saves commit in submission order`：
  两次按提交顺序等待完成的保存（`low` → `high`），逐次断言回显，再从 `/gateway/read` 读回并断言
  最后一次提交的值是生效值。

## red / green

```bash
# red（省略 effort 的语义）：临时把原生调用改成只传 {provider, model}，不解析组合默认值
node --test --test-name-pattern "the gateway reads the shared configuration" tests/gateway.test.mjs
# ✖ AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
#   + actual - expected
#     { model: 'MiniMax-M3.1-Flash', provider: 'minimax-cn' }
#   -   reasoningEffort: 'max'
#   位置：tests/gateway.test.mjs:217（省略 effort 的保存回显）

# green：恢复解析组合默认值的实现
node --test --test-name-pattern "consecutive selection saves|the gateway reads the shared configuration" tests/gateway.test.mjs
# ✔ the gateway reads the shared configuration, refuses an ordinary agent, and survives a restart
# ✔ consecutive selection saves commit in submission order
# ℹ pass 2  ℹ fail 0

# 整文件
node --test tests/gateway.test.mjs
# ✔ 11 个用例全绿（新增用例约 4.5s）
# ℹ tests 11  ℹ pass 11  ℹ fail 0
```

说明：新用例对「旧的直接 `settings().mutate` 写」也是绿的——两次保存是**依次等待完成**的，
客户端已经用响应把两次写排成序，直接写同样按序落盘。这是票面允许的确定性写法：HTTP seam 上
唯一无歧义的提交顺序就是「第一次完成后再提交第二次」；重叠提交的顺序由各自异步校验
（`resolveModelInfo`/`listModels`）完成先后决定，不是提交顺序。下面的敏感性检查记录了这一点。

## 敏感性检查

1. **按要求临时恢复直接 `settings().mutate` 写**，跑新用例：

   ```bash
   git checkout -- backend/gateway/src/service.mjs   # 实验用，随后恢复
   node --test --test-name-pattern "consecutive selection saves|the gateway reads the shared configuration" tests/gateway.test.mjs
   # ✔ the gateway reads the shared configuration, refuses an ordinary agent, and survives a restart
   # ✔ consecutive selection saves commit in submission order
   # ℹ pass 2  ℹ fail 0
   ```

   结果：**没有断言变红**。原因如上：两次 awaited 保存把顺序交给了客户端，直接写也按序提交。
   在「两次保存都完成后再读回」这个可观察点上，旧写法和原生入口没有确定性差异；差异只在
   **重叠提交**时出现，而 HTTP seam 无法确定性地表达重叠提交的提交顺序。

2. **重叠提交探针（临时实验，未入库）**：同一后端内做 12 轮「并发发 low 与 high，然后读回」。
   新实现与旧实现的结果相同：

   ```text
   新实现 final-values: ["high","low","high","high","high","low","high","high","high","high","high","low"]
   旧实现 final-values: ["high","high","high","high","high","high","high","high","low","low","low","high"]
   ```

   两版各有 3/12 轮落在先提交的 `low`。原因是第二个请求的异步校验可以先完成、先进入保存入口；
   所以并发 HTTP 用例会因校验顺序而不是写路径 flake，不能作为提交顺序的断言。该探针里失败的
   断言正是 `the last submitted selection save must be the effective one`。

3. **原生入口才是重叠保存的保证**：pinned dsh 的
   `packages/core/agent-default-model/src/index.ts` 用 `this.saves` 链把 `editor.edit` 按
   `saveSelection` 调用顺序串行化（`const saved = this.saves.then(() => editor.edit(...))`），
   上游测试 `serializes overlapping saves and continues after a rejected write`
   （`packages/core/agent-default-model/tests/agent-default-model.spec.ts`）断言两次重叠保存
   的 `calls` 顺序为 `['rejected','saved']`、最终选择是后一次。本票的网关改动就是把这个保证
   接到 HTTP 保存路径上；网关测试固定的是「按提交顺序完成两次保存后，最后提交的值生效」，
   重叠串行化由上述上游测试固定。

4. **断言有牙**：临时把原生调用短路（`if (false) await this.edit(() => …saveSelection…)`），
   新用例在第一次回显处失败：

   ```text
   ✖ consecutive selection saves commit in submission order
     AssertionError [ERR_ASSERTION]: the first save is echoed as submitted
   ```

   即保存路径不落盘时，用例会在回显/读回断言处失败。

## 未完成项

- 「没有配置编辑器时 503」没有端到端用例：本组合里 `settings` 被多个产品行依赖，用 overlay
  禁用 `config-editor` 后整机不能就绪（`identity` fiber failed，`gateway` 一直 pending），
  无法在 HTTP seam 上构造该部署。代码用现有 `this.settings()`（与读取同一 seam）保留 503，
  原生入口的静默 no-op 不会变成成功保存。
- 未做真机/真实供应商请求验收：本票只改选型写入路径，模型请求路径未变；下一轮生效与运行中
  回复不切换由既有用例覆盖。
- 收口前需把 `integration/spec-135` 最新 tip merge 进本分支并复跑定向测试（提交后执行）。
