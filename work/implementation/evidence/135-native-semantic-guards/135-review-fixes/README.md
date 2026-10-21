# 135-review-fixes — 两轴评审修复证据

票面：父票 #135（本地票面 [`work/tickets/135/README.md`](../../../../tickets/135/README.md)）。
分支：`ticket/135-review-fixes`，基线 `integration/spec-135` tip `bd54362`（提交前已 merge 该分支）。
范围：修复 spec #135 集成分支的两轴评审发现（1 条未落实的「顺序保证」声称、1 条未构造的启动失败
声称、1 条票面行为缺口、6 条判断项），不改变产品行为，只把声称换成有牙的检查。

## 发现与修复

| # | 发现 | 修复 | 现在失败即失败的检查 |
| --- | --- | --- | --- |
| 1 | 边界文档 §4 与 `backend/gateway/README.md` 用 `consecutive selection saves commit in submission order` 支撑「重叠保存按提交顺序串行化」；该用例逐次 await，旧的直接 `settings().mutate` 写法同样通过 | 新增 `tests/gateway-service.test.mjs`：普通 cordis `Context` + 伪造 `settings` 行/`agentDefaultModel`/`llm`，在服务 seam 上断言保存经原生入口、且未调用 `settings().mutate`；另一用例断言无配置编辑器时 503 且原生保存未调用。文档改述：调用路径由该单元测试固定；重叠保存串行化是原生服务自己的契约（上游测试 `serializes overlapping saves and continues after a rejected write`），不是产品 HTTP 测试的断言 | `tests/gateway-service.test.mjs`：`a selection save goes through the native default-model entry`、`a selection save refuses when the profile cannot be edited`（均已登记进边界文档引用清单与 `CITED_CHECKS`） |
| 2 | `backend/gateway/README.md` 声称缺少原生目录会让启动失败并点名包/子路径，但没有测试构造该失败 | 从 `backend/gateway/src/service.mjs` 抽出并导出 `loadNativeModalities(specifier = NATIVE_CATALOG_MODULE)`：动态导入、校验列表、失败时抛出点名 specifier 与 peer 的现有消息；模块级加载仍调用它，`GatewayService` 构造函数重抛同一错误。无回退列表 | `tests/gateway-service.test.mjs`：`a missing native catalog fails naming the peer and the module specifier`（用不存在的子路径断言消息点名子路径与 peer；默认调用返回原生列表） |
| 3 | 票面把任务状态/停止行为放在 `tests/jobs.test.mjs`，新增断言只有 adapter 级 | 在 `tests/jobs.test.mjs` 增加真实后台任务的两次 `/chat/jobs/stop`：运行中第一次 `outcome: 1`，任务落定（status 4）后第二次 `outcome: 2`；使用新会话，不依赖其它用例的 serial 或任务 | `tests/jobs.test.mjs`：`stopping the same real job twice reports requested first and already-finished after it settles` |
| 4 | `tests/gateway.test.mjs` 复制了一份 `PHONE_MODEL_FIELDS` | 从 `backend/gateway/src/service.mjs` 导出 `PHONE_EDITABLE_MODEL_FIELDS`（原 `MODEL_FIELDS`，同一份 allowlist 供校验/投影/覆盖与测试使用），测试改为导入；「未编辑字段」仍从运行时先前条目派生 | `tests/gateway.test.mjs`：`a route saved from the phone keeps model fields the draft does not edit`（测试通过导入的集合推导期望） |
| 5 | `tests/gateway.test.mjs` 有未使用的 `readFileSync` 导入 | 删除该导入；`combo.json` 读取改用已导入的 dsh 包，不再需要 fs | 测试文件加载即覆盖（ESLint 不在本仓库；以 `node --test` 加载为准） |
| 6 | `tests/native-job-stop-outcome.test.mjs` 只断言任意 5xx / 任意 `chat/` 码 | 收紧为 `status === 500` 与 `code === 'chat/unknown-stop-outcome'`，与 `backend/chat/README.md` 一致 | `tests/native-job-stop-outcome.test.mjs`：`an unknown native stop outcome is a 500 product error naming it` |
| 7 | `NATIVE_CATALOG` 未说明是模块 specifier；`keepDeploymentFields` 未说明覆盖/删除手机可编辑字段 | 重命名为 `NATIVE_CATALOG_MODULE` 与 `overlayPhoneEditableModelFields`，更新注释；历史证据目录未改写 | 行为由既有 `a route saved from the phone keeps model fields the draft does not edit` 与新的目录失败用例覆盖 |
| 8 | `saveSelection` 里裸 `this.settings()` 读起来像死表达式 | 抽出 `requireConfigurationEditor()`，`rows()`/`saveSelection`/路由与 ASR 写路径统一经它取设置服务；503 路径读作意图 | `tests/gateway-service.test.mjs`：`a selection save refuses when the profile cannot be edited`（去掉该调用即变红，见下） |
| 9 | `tests/gateway.test.mjs` 另用 `createRequire` 解析 dsh 包 | 统一走 `tests/helpers/dsh-peers.mjs`：给 `@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-llm-mock-server` 补 anchor，测试改用裸 specifier 动态导入；`dshRequire` 已完全移除，未保留例外 | `tests/gateway.test.mjs` 全部用例加载与通过 |

## red / green

### 1. 原生保存入口（必须变红的关键项）

临时把 `saveSelection` 改回旧的直接写行：

```text
$ python3 - <<'PY'   # 临时补丁，实验后从备份恢复
... await this.settings().mutate('agent-default-model', [ ... ]) ...
PY
$ node --test --test-name-pattern "a selection save goes through the native default-model entry" tests/gateway-service.test.mjs
✖ a selection save goes through the native default-model entry
  AssertionError [ERR_ASSERTION]: the save must reach the native default-model entry with the complete selection
  + actual - expected
  + []
  - [ { model: 'MiniMax-M3.1-Flash', provider: 'minimax-cn', reasoningEffort: 'max' } ]
  ℹ fail 1
```

恢复原生调用后：

```text
$ node --test tests/gateway-service.test.mjs
✔ a selection save goes through the native default-model entry
✔ a selection save refuses when the profile cannot be edited
✔ a missing native catalog fails naming the peer and the module specifier
ℹ tests 3 / pass 3 / fail 0
```

### 2. 503 守卫

临时删掉 `saveSelection` 里的 `this.requireConfigurationEditor()`：

```text
$ node --test --test-name-pattern "refuses when the profile" tests/gateway-service.test.mjs
✖ a selection save refuses when the profile cannot be edited
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
  ℹ fail 1
```

该用例显式传 `reasoningEffort`，因此只有配置编辑器守卫能拒绝这次保存；没有守卫时原生保存会被
调用，用例失败。

### 3. 目录加载无回退

临时在 `loadNativeModalities` 的 catch 里返回 `['text', 'image']`：

```text
$ node --test tests/gateway-service.test.mjs
✖ a missing native catalog fails naming the peer and the module specifier
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
  ℹ fail 1
```

### 4. 真实任务的两次停止

临时让 `stopOutcomeOf` 恒返回 1：

```text
$ node --test --test-name-pattern "stopping the same real job twice" tests/jobs.test.mjs
✖ stopping the same real job twice reports requested first and already-finished after it settles
  AssertionError [ERR_ASSERTION]: the same job reports already-finished after it settled
  1 !== 2
  ℹ fail 1
```

恢复映射后该用例通过（真实原生 `JobRegistry.kill` 在运行中返回 `requested`、落定后返回
`already-finished`）。

## 验证

定向入口（与父任务要求一致）：

```text
$ node --test tests/gateway-service.test.mjs tests/native-job-stop-outcome.test.mjs \
    tests/native-job-status.test.mjs tests/gateway.test.mjs tests/jobs.test.mjs \
    tests/ecosystem-boundary.test.mjs tests/docs.test.mjs
ℹ tests 39 / pass 39 / fail 0
```

整仓入口与组合校验结果见提交前的运行记录（`npm test`、`npm run combo:verify`；pre-commit hook
同两条命令）。文档改动后 `tests/ecosystem-boundary.test.mjs` 与 `tests/docs.test.mjs` 仍为绿：
新增的两个单元测试标题已同时登记在边界文档 §4 与 `CITED_CHECKS`。

## 未修复项

无。九条发现全部落实。第 9 条的 `dshRequire` 没有被保留：两个缺失 anchor 直接补进
`tests/helpers/dsh-peers.mjs`，`tests/gateway.test.mjs` 已全部改用该解析器，并用整份
`tests/gateway.test.mjs` 验证。

## 文档措辞修正（评审后）

- 边界文档 §4 选型行第一列从「默认模型选型保存入口的串行化行为」改为
  「选型写入绕过原生保存入口（改回直接写设置行）」：被引用的产品测试只固定调用路径与 503，
  不会因串行化变化失败；串行化保留为背景说明（原生服务契约 + 上游测试）。
- `backend/gateway/README.md` 的目录失败句改写为「模块级加载失败被 `GatewayService` 构造函数
  重新抛出 → 启动失败」，并点名 `loadNativeModalities` 的单元测试直接构造加载失败；没有声称
  存在整机启动用例。
