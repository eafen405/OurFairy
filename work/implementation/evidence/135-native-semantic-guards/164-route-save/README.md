# 164 — 路由保存：只覆盖手机可编辑字段

票：GitHub #164（父票 #135，本地票面 `work/tickets/135/03-route-save-allowlist.md`）
分支：`ticket/164-route-save`
基线：`integration/spec-135` tip `28e8d32`（开工时 `git merge-base --is-ancestor` 已确认；收口前再 merge 该分支最新 tip）
提交：本文件所在提交（提交说明写明「上游新增手机不可编辑的模型字段时失败的是哪条断言」）

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
- 收口前需把 `integration/spec-135` 最新 tip merge 进本分支并复跑定向测试（提交后执行）。
