# 05 / #168 输入模态：从原生列表导入

票：GitHub #168（父票 #135，本地票面 `work/tickets/135/05-input-modalities.md`）
分支：`ticket/168-input-modalities`
基线：`integration/spec-135` tip `fb2bb9f`（开工 `git merge-base --is-ancestor` 已确认；收口前
merge 该分支最新 tip）
提交：本文件所在提交（提交说明写明上游增删模态时失败的是哪条断言）

## 改动

- `backend/gateway/src/service.mjs`
  - 删除本地 `MODALITIES = new Set(['text', 'image'])`。模型条目校验改为
    `MODALITIES.includes(modality)`；`MODALITIES` 来自 pinned dsh 的
    `@deepseek-ai/dsh-llm-pi-ai/src/catalog.ts` 运行时导出。网关不再有本地模态字面量；
    读取回显仍是保存值本身（同一份声明），没有第二份列表。
  - 原生导入是顶层 `await import(NATIVE_CATALOG)`，失败被捕获后在 `GatewayService`
    构造器里抛出带包名/子路径的错误。原因：dsh loader 对「模块求值阶段失败」只报
    `gateway (@ourfairy/dsh-gateway): failed to import`，不展示原因；构造器失败会打印错误
    消息与 cause（见「启动证据」）。两条路径都以非零退出，且没有回退到本地列表。
- `backend/gateway/package.json`：声明 peer `@deepseek-ai/dsh-llm-pi-ai`（`^0.2.1-alpha.2`，
  与其它 dsh peer 同一版本行）。
- `backend/gateway/README.md`（供应商路由）：写明 `input` 以原生 `MODALITIES` 为唯一权威、
  网关不维护本地词表、原生新增模态无需产品改动、解析失败启动失败不回退。
- `tests/helpers/dsh-peers.mjs`：为 `@deepseek-ai/dsh-llm-pi-ai` 增加解析 anchor。
- `tests/gateway.test.mjs`：新增 `the gateway accepts every native input modality`。测试通过
  helper 动态导入同一原生列表（不复制字面量），逐项提交 `input: [modality]` 并断言 200 与
  回显；再从 `audio/video/pdf` 中取一个不在原生列表里的值，断言 400 `gateway/invalid-route`。

## red / green

```bash
# 新增用例（实现前：本地集合恰好等于原生列表 ['text','image']）
node --test --test-name-pattern "the gateway accepts every native input modality" tests/gateway.test.mjs
# ✔ ... ℹ tests 1 ℹ pass 1 ℹ fail 0
# 今天本地列表与原生一致，旧代码在这个时点不会红；红的是「本地列表落后于原生」的漂移，
# 见下面的敏感性检查。

# red：把本地集合临时收窄为 ['text']（模拟上游已有 image、本地列表没有）
# ✖ the gateway accepts every native input modality
#   AssertionError [ERR_ASSERTION]: native modality "image" must be accepted:
#     {"ok":false,"error":{"code":"gateway/invalid-route","message":"models[0].input does not know modality \"image\""}}
#   400 !== 200   (tests/gateway.test.mjs:320)

# green：改为导入原生 MODALITIES
node --test --test-name-pattern "the gateway accepts every native input modality" tests/gateway.test.mjs
# ✔ the gateway accepts every native input modality
# ℹ tests 1 ℹ pass 1 ℹ fail 0

# 整文件（含既有 invalid-configuration 与路由/选型行为）
node --test tests/gateway.test.mjs
# ✔ 12 个用例全绿
# ℹ tests 12 ℹ pass 12 ℹ fail 0
```

## 敏感性检查

1. 在最终实现下，临时在 `service.mjs` 加入 `LOCAL_MODALITIES = new Set(['text'])` 并让校验改用它
   （保留原生导入，使 boot 仍成功），跑新用例：

   ```text
   ✖ the gateway accepts every native input modality
     AssertionError [ERR_ASSERTION]: native modality "image" must be accepted:
       {"ok":false,"error":{"code":"gateway/invalid-route","message":"models[0].input does not know modality \"image\""}}
     400 !== 200
   ```

   即网关一旦回退到缺少原生模态的本地列表，新用例在第一个缺失模态处失败并点名它。
   实验后已恢复（`grep LOCAL_MODALITIES backend/gateway/src/service.mjs` 无结果）。

2. 为什么这是**前瞻性对账**而不是今天就能红：pinned dsh `5b8ec0f175` 的 `MODALITY_GATE`
   只有 `text`/`image`，旧本地集合与它恰好相同，所以旧实现在当前 commit 上也能通过新用例。
   上游新增模态时，若网关仍用本地列表，该模态的提交返回 `gateway/invalid-route`，失败的断言即
   `the gateway accepts every native input modality`（消息点名模态）；若网关已按本票导入原生
   列表，则网关与测试一起前进，无需产品改动。上游删除模态时，测试循环自然不再提交它，原生侧
   `MODALITY_GATE` 的 `Record` 编译检查会在上游命名被删的键。既有 invalid-configuration 用例
   继续断言 `audio` 被拒（当前原生列表之外）；若上游把 `audio` 升为原生模态，该断言会失败并
   提示更新这个「列表之外」的样本。

## 启动证据（pinned profile install 带 peer 启动）

```bash
OURFAIRY_HOME=work/tmp/168-probe-good OURFAIRY_PORT=0 OURFAIRY_PHAETHON_PASSWORD=probe-password \
  node scripts/ourfairy-backend.mjs probe --report work/tmp/168-probe-good/report.json
# ourfairy-baseline-probe: ok (24 services live, 48 rows composed, mode boot)   # exit 0
```

解析失败（临时把导入子路径改成 `catalog-missing.ts`，`work/tmp/168-boot-missing2`）：

```text
dsh: warning: 1 entry did not activate
gateway (@ourfairy/dsh-gateway): Error: cannot load the native input modality list from
  "@deepseek-ai/dsh-llm-pi-ai/src/catalog-missing.ts"; install the @deepseek-ai/dsh-llm-pi-ai
  peer at the pinned dsh version (Cannot find module
  '.../packages/bundle/base/node_modules/@deepseek-ai/dsh-llm-pi-ai/src/catalog-missing.ts' ...)
ourfairy-baseline-probe: 2 failure(s)
  - bundle product row "gateway" (@ourfairy/dsh-gateway) is not active (fiber failed)
  - service "ourfairyGateway" is not live (expected row "gateway" = @ourfairy/dsh-gateway)
# exit 1；没有回退到本地列表
```

## 未完成项

- 无。收口前已把 `integration/spec-135` 最新 tip merge 进本分支并复跑 `node --test
  tests/gateway.test.mjs`；`npm test` 与 `npm run combo:verify` 由 pre-commit hook 在提交时执行。
