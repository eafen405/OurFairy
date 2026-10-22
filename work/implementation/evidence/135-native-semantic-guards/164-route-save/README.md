# 164 — 路由保存：只覆盖手机可编辑字段

票：GitHub #164（父票 #135，本地票面 `work/tickets/135/03-route-save-allowlist.md`）
分支：`ticket/164-route-save`
基线：`integration/spec-135` tip `28e8d32`（开工时 `git merge-base --is-ancestor` 已确认）
提交：`1ac25f0`（实现 + 测试 + README + 本证据）；收口合并 `83b2700`（merge `integration/spec-135` tip `cd0c6c7`，无冲突）
最终 SHA：`83b2700`

## 改动

- `backend/gateway/src/service.mjs`：`keepDeploymentFields` 从「硬编码搬运 `reasoningEfforts` + `compat`」改为允许列表：
  以同 id 的先前模型条目为底（`{ ...prior }`），只覆盖手机可编辑的五个字段
  `id/name/contextWindow/maxTokens/input`（复用校验用的 `MODEL_FIELDS`，不再有第二份字段清单）。
  - 草稿给出的可编辑字段覆盖旧值；草稿省略的字段从结果中删除（手机的「空白即未设置」语义），不继承。
  - 新模型 id 没有先前条目，原样写入草稿声明的内容。
  - 路由级字段不参与：函数只合并 `draft.models`，路由级 `retryPolicy` 等仍只在部署层。
- `backend/gateway/README.md`（供应商路由）：字段保留说明改为允许列表口径，并写明路由级部署字段不复制进用户层。
- `tests/gateway.test.mjs`：新增 `a route saved from the phone keeps model fields the draft does not edit`。
  - 从持久化文档断言：`<OURFAIRY_HOME>/dsh-home/profiles/ourfairy/cordis.patch.yml` 用 dsh 自己的
    `@deepseek-ai/dsh-app-boot` `loadOverlayPatches` 解析（解析器锚定 pinned dsh checkout，未引入第二个 YAML 解析器）。
  - 「先前条目」的期望值由 pinned dsh 的 `@deepseek-ai/dsh-llm-pi-ai` `Config` 解析部署 bundle 的声明得到，
    不读被测网关的返回值；覆盖：省略 `contextWindow` 被清除、给出 `maxTokens` 被覆盖、第二次保存清除上一次用户层值、
    新模型 id 原样写入、路由级 `retryPolicy` 不在用户层、以及「草稿不编辑的每个模型字段都原样保留」的逐字段循环。
- 既有行为用例 `a route saved from the phone keeps the deployment retry policy the draft does not own` 保持通过。

## red / green

```bash
# red：把搬运逻辑去掉（函数直接返回草稿），新测试必须失败
node --test --test-name-pattern "keeps model fields" tests/gateway.test.mjs
# ✖ AssertionError [ERR_ASSERTION]: model field "reasoningEfforts" the draft does not edit must survive the save unchanged
# ℹ pass 0  ℹ fail 1

# green：允许列表实现
node --test --test-name-pattern "keeps model fields|deployment retry policy" tests/gateway.test.mjs
# ✔ ... keeps the deployment retry policy the draft does not own
# ✔ ... keeps model fields the draft does not edit
# ℹ pass 2  ℹ fail 0

# 整文件
node --test tests/gateway.test.mjs
# ℹ tests 10  ℹ pass 10  ℹ fail 0
```

提交时 pre-commit 钩子跑全量入口（`1ac25f0`，未用 `--no-verify`）：

- `npm test`：`ℹ tests 235  ℹ pass 235  ℹ fail 0`（exit 0）。
- `npm run combo:verify`：三行 `ok`，`combo: combination verified`（exit 0）。

收口：`ticket/164-route-save` 先 merge `integration/spec-135` tip `cd0c6c7`（merge commit `83b2700`，无冲突），
随后该分支已被合入集成分支（`98f6d3b Merge branch 'ticket/164-route-save'`），本分支再 fast-forward 到
集成分支最新 tip `ac21e9a`（`git diff integration/spec-135 HEAD` 为空）。在 `ac21e9a` 上复跑：

- `node --test tests/gateway.test.mjs`：`ℹ tests 10  ℹ pass 10  ℹ fail 0`。
- `npm test`：`ℹ tests 239  ℹ pass 239  ℹ fail 0`（exit 0）。
- `npm run combo:verify`：三行 `ok`，`combo: combination verified`（exit 0）。

说明：当前部署只声明了 `reasoningEfforts` 与 `compat` 两个模型级部署字段，旧的硬编码搬运恰好覆盖它们，
所以新测试对旧实现是绿的；它的守卫作用在「上游新增第三个模型级字段」时生效。下面用实验证明这一点。

## 敏感度检查

1. **去掉搬运**：见上面 red，失败断言为
   `model field "reasoningEfforts" the draft does not edit must survive the save unchanged`。
2. **模拟上游新增第三个模型级部署字段**：临时在 `backend/v1-bundle/cordis.patch.yml` 的
   `MiniMax-M3.1-Flash` 上增加 `futureDeploymentField: {marker: simulated}`（实验后已还原，未入库）：

   - 允许列表实现：`✔ a route saved from the phone keeps model fields the draft does not edit`（新字段被默认保留）。
   - 换回旧的硬编码实现：`✖`，失败断言为
     `model field "futureDeploymentField" the draft does not edit must survive the save unchanged`。

   即：上游新增一个手机不可编辑的模型字段、保存不再默认保留它时，失败的是上面这条断言；
   新实现下该字段默认保留，测试保持绿。

## 未完成项

- 无。未做真机/真实供应商请求验收：本票只改路由保存的字段合并与持久化断言，模型请求路径未变；
  `retryPolicy` 的行为用例仍在同一提交内通过。
- 合并后全量复跑曾遇到无关用例的并行负载抖动（`remote-chat` 冷读工件快照、`speech` 超时、PDF 资源预算）；
  同一文件单独复跑均通过，集成分支随后以 `7f3d979 test(chat): settle the accepted turn before the next artifact snapshot`
  修掉了其中一条。最终 `ac21e9a` 全量 239/239 通过，未使用 `--no-verify`。
