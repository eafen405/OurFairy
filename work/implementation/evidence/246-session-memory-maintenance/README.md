# #246 单会话增量记忆维护

日期：2026-10-27。票面：[`work/tickets/fairy-memory/06-session-memory-maintenance.md`](../../../tickets/fairy-memory/06-session-memory-maintenance.md)。
分支 `ticket/246-session-memory-maintenance`，worktree `.worktrees/246-session-memory-maintenance`，
基线 `40d8a190ef`（`integration/spec-240`），合并后含 `3da7ba7968`（#242/#245 集成）。
规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md)
Implementation Decisions §1、§2、§5，User Stories 31、34–48；术语见
[`docs/glossary/memory.md`](../../../../docs/glossary/memory.md)。

本票只做每个源会话自己的维护状态机与原生维护子会话。印象（#245）、维护/压缩设置与
Android 网关（#247）、真实轻量模型质量验收（#248）与压缩本身未做；设置项的校验/持久化
留给 #247，本票只暴露 volatile 插件配置并在每次判断时读取。

## 改动

新模块（`backend/memory/src/`）：

| 文件 | 职责 |
| --- | --- |
| `maintenance.ts` | `MaintenanceEngine`：门槛公式、持久观察、静默准入、claim、原生 Agent 子会话、`turn/end` 完成判定、失败恢复、启动/定时重算 |
| `material.ts` | 冻结区间的材料投影：用户消息、Fairy 回复、附件名、记忆变更调用；只按 append 表面事件读取 |
| `preset.ts` | 子会话持久预设 id `ourfairy:memory-maintenance` |
| `store.ts` | 新方法：`maintenance`、`maintenanceRows`、`observeMaintenance`、`claimMaintenance`、`failMaintenance`、`completeMaintenance`、`resetMaintenance`；schema v2 增加 `cut_seq` 与 v1→v2 迁移 |
| `service.ts` | `sourceOf(agent)` 从持久 header 解析写入来源与 owner；`add`/`edit` 接受来源会话 |
| `tools.ts` | 写入工具通过 `sourceOf` 归属；读/删/切换仍按实际调用会话键控门禁 |
| `index.ts` | 维护配置（volatile）与 engine 装配，保留 #245 的印象服务/路由/section |

跨行改动（都是为了“子会话只有记忆工具、没有主会话上下文”）：

| 文件 | 改动 |
| --- | --- |
| `backend/attachments/src/pdf.ts`、`delivery/src/index.ts`、`groups/src/index.ts`、`search/src/index.ts` | 维护预设下跳过自己的工具注册；dsh `restrict()` 不过滤 scope 自己的注册，不能替代该跳过 |
| `backend/attachments/src/index.ts` | `llm/stream` 不为无 owner 的维护子会话做附件刷新；`tools/execute` 同样跳过 |
| `backend/spaces/src/index.ts` | 维护预设不注入文件空间 prompt |
| `backend/spaces/src/directory.ts`、`policy.ts` | 无 owner 的维护子会话仍会被原生 working-directory/sandbox-policy prompt 询问；返回共享根与 read-only 策略而不是抛 `file operation requires an owned session` |

测试与装配：

- `backend/memory/package.json` / `tsconfig.json`：新增 `dsh-system-prompt`、`dsh-http`、`dsh-sessions`
  依赖与项目引用；`backend/attachments/package.json` 增加直接使用的 `dsh-session` peer。
- `backend/v1-bundle/cordis.patch.yml`：memory 行增加 `maintenanceTurns`、`maintenanceDecayHours`、
  `maintenanceModel`、`maintenanceProvider`，环境变量只做部署种子。
- `tests/memory-maintenance.test.mjs`、`tests/memory-maintenance-recovery.test.mjs`：真实 profile +
  Loader + 认证产品会话 + 模型替身的行为测试。
- 长会话旧测试把维护门槛显式设为 50（`tests/memory-crud.test.mjs`、`tests/file-delivery.test.mjs`、
  `tests/chat-stream-backpressure.test.mjs`），避免它们触发维护子会话后改变各自被验证的行为。

## 关键决定

- **子会话用原生 Agent，不挂 subagent 行。** `ctx.agents.create` / `resume`，meta 为
  `parentSession: 源会话`、`origin: 'subagent'`、`agentPreset: 'ourfairy:memory-maintenance'`，
  不设 `owner`。持久 header 是恢复后仍能解析来源的权威；`dispose()` 只摘除 live handle，
  持久日志留给失败后的同一子会话 resume。
- **工具可见性靠“每行按预设跳过 + 子会话 setup 里 `restrict({ allow: [] })`”。**
  `restrict` 只过滤 global/祖先层；四个产品工具行、spaces prompt 与 attachments 的流/刷新入口
  都在自己的注册点跳过该预设。memory 行仍然只注册五个记忆工具，因此子会话目录恰好是
  `memory_add/search/edit/delete/switch`。精确目录由测试断言，不靠源码搜索。
- **材料只从冻结区间投影。** 区间起点是已完成的 `watermark_seq`，终点是开始维护时读到的
  最后一个“有真人 user/message 的 `turn/end`”。只保留用户消息、assistant 文本、附件名和
  `memory_add/edit/delete/switch` 的 `tool/call` 参数；附件正文、其他工具输入输出、
  `memory_search` 调用、印象、源系统提示和压缩替换副本都不进入。附件正文不在材料里由
  真实上传 + 断言正文秘密不存在证明。
- **空区间不会触发。** 计数单位是“有真人 user/message 的 `turn/end`”，repair-only 或
  只有系统注入的回合不计数；水位之后为 0 时即使门槛衰减到 1 也不启动。
- **门槛与时间。** `max(1, maintenanceTurns - floor((now - last_closed_at) / (decayHours*3600000)))`。
  回合数从源日志现算，`last_closed_at` 取持久列；状态为 idle 时新闭合回合推进
  `cut_seq`/`last_closed_at`，更旧或相同的 cut 保留已有时间，因此操作者修正的搁置时间不会被
  下一秒覆盖。1 秒 tick 让“没有新事件的搁置区间”也按当前时间重评，启动时的
  `sessionPersistence.list()` + `maintenance_state` 扫描负责重启重算；两者是不同路径。
- **封口。** 先读一份不可变 observation，以最后有效闭合回合为 cut，再在一个
  `BEGIN IMMEDIATE` 事务里 claim，之后才创建子会话。claim 后的新事件天然在 cut 之后；
  同一源会话处于 running/failed 时不再 claim，因此同一时刻至多一个维护子会话。
- **静默。** 用原生 `ctx.agents.get(source).status` 判断（冷会话视为 idle），不依赖 chat 行的
  `live()` 门面，也不把调度器做成全局会话遍历器；启动扫描只做一次。
- **完成/失败。** 不看 `whenIdle()`（模型失败时它也 resolve），只看子会话自己在 startSeq 之后
  的最后一个持久 `turn/end`：`completed` 才推进水位，零写入同样推进；`error`、`blocked`、
  `aborted`、`interrupted`、`max-tokens` 或无 ending 都不推进。失败保留 child id 与 cut，
  下一 tick 在同一子会话上 resume，续写“上一轮没有完成”的短指令。create 在子会话尚未落盘时
  失败则释放 claim，稍后创建新子会话；resume 找不到子会话时同样释放。
- **来源归属。** `MemoryService.sourceOf` 只读持久 header：普通会话归属自身，维护子会话按
  `parentSession` 找源会话的 header.owner。模型参数没有来源/owner 字段。查询门禁仍以实际
  调用工具的 child session id 为键；源会话的查询不授权子会话，子会话必须自己 search，恢复后
  也必须重新 search（门禁是进程内状态）。
- **配置。** `Config` 的四个维护字段都 `.volatile()`；`readMaintenanceSettings` 每次读取
  `get()` 并再次校验。`maintenanceTurns` 默认 15、5–50；`maintenanceDecayHours` 默认 6、
  3–24；模型默认 `MiniMax-M3.1-Flash`，provider 默认 `minimax-cn`。设置 UI/持久化与热生效的
  端到端证明属于 #247；本票只证明读取函数不缓存、越界值加载失败，并记录 #247 要绑定的
  namespace/键名。
- **数据迁移。** `maintenance_state` 增加 `cut_seq` 需要 v2；v1 文件用 `PRAGMA table_info`
  判断后 `ALTER TABLE`，已有行保留、新列为 NULL。测试用手工 v1 文件验证。
- **主会话模型不受影响。** 子会话显式传 `provider/model`，不读也不写
  `agentDefaultModel`；测试断言源与子会话请求的 model 都是部署路由，且主会话工具目录不变。

## TDD 红绿

先加载 `tdd` skill，按行为切片先写失败用例，再实现。实际关键输出：

1. 首个用例（默认 15 回合、零写入推进水位）在实现前：
   `AssertionError: timed out waiting for the source observation row; last value undefined`（红）。
   实现维护行/engine/material 后转绿。
2. 第一次真实子会话创建失败暴露跨行 ownerless 缺口，实际 stderr/日志：
   `FsError: file operation requires an owned session`，栈分别在
   `backend/spaces/dist/scope.js`（working-directory prompt）、`policy.js`（sandbox prompt）、
   `backend/attachments/dist/index.js`（`llm/stream` 刷新）与 `pdf.js`。逐一把维护预设的
   prompt/刷新入口改为跳过或返回共享只读根。
3. 子会话 `memory_add` 的工具结果：
   `Error: cannot get property "sessionPersistence" without inject`
   ——说明 agent scope 不保证插件服务；把归属解析收敛到 `MemoryService.sourceOf`（插件 ctx）后
   转绿。
4. 材料用例先红在 `other tools inputs never enter the material`：测试替身原先把工具命令作为
   用户文本发送。改为真实 `tool/call`（模型替身按自然语言指令发工具调用）后，材料只含
   memory 变更调用，其他工具参数与结果被排除。
5. 失败恢复用例先红在 `resume same child` 相关断言；实现从持久 `turn/end` 判定并把失败行
   保留 child id 后转绿（第二次请求体同时含原维护材料与续写指令）。
6. 合并 `integration/spec-240` 后，`memory/README.md`、`locale`、`package.json`、
   `tsconfig.json`、`src/index.ts`、`src/store.ts` 发生冲突；逐项保留 #245 的印象服务/路由/
   方法与 #246 的维护 engine/配置/`cut_seq`，重新构建并跑 35 个记忆相关用例转绿。
7. 提交前 hook 跑全量（非本票主动要求的全量）时暴露三个受维护默认值影响的旧测试：
   `chat-stream-backpressure` 40 回合触发子会话并消耗模型脚本、`file-delivery` 长会话触发
   子会话、`pdf-worker-cancel` 用无 `header` 的假 agent 触发 `agentPreset` 读取。分别改为
   显式门槛 50、显式门槛 50、对 stub header 用 optional chaining；三文件重跑 11/11 通过。

## 验证（在 merge 后的 worktree 内实际运行）

```sh
npm run build
# 退出码 0；scripts/tsc.ts --fresh 无输出（合并 #242/#245 后再次通过）

node --test tests/memory-maintenance.test.mjs
# tests 7 / pass 7 / fail 0

node --test tests/memory-maintenance-recovery.test.mjs
# tests 4 / pass 4 / fail 0

node --test tests/memory-crud.test.mjs
# tests 11 / pass 11 / fail 0

node --test tests/memory-impression.test.mjs
# tests 5 / pass 5 / fail 0

node --test tests/memory-maintenance.test.mjs tests/memory-maintenance-recovery.test.mjs \
  tests/memory-crud.test.mjs tests/memory-impression.test.mjs tests/model-double.test.mjs tests/baseline-boot.test.mjs
# tests 35 / pass 35 / fail 0（合并后的记忆面）

node --test tests/bundle-packages.test.mjs tests/bundle-groups.test.mjs tests/config-contracts.test.mjs \
  tests/docs.test.mjs tests/plugin-compatibility.test.mjs tests/gateway.test.mjs
# tests 37 / pass 37 / fail 0（包/行/配置/文档/兼容/网关）

node --test tests/pdf-worker-cancel.test.mjs tests/file-delivery.test.mjs tests/chat-stream-backpressure.test.mjs
# tests 11 / pass 11 / fail 0（受维护默认值影响的旧长会话测试）
```

未运行：全量 `npm test`（按票面要求只跑改动面；提交 hook 的全量尝试见 TDD 第 7 条，修复后
用上述三个文件定点验证）、`npm run combo:verify`、Android `./gradlew test lintDebug`、
真实 MiniMax 语义质量验收（#248）。dsh 无改动，未跑 dsh 测试。

## 未完成与风险

- #247 未做：网关/Android 的“记忆 → 维护”树、设置持久化与保存后热生效的端到端测试。
  本票已把 `maintenanceTurns`/`maintenanceDecayHours` 做成 volatile 配置并记录 #247 绑定
  namespace `memory`；`readMaintenanceSettings` 的“每次读取”有单元级测试，但没有经网关写入
  后触发维护的端到端证明。
- #248 未做：真实 MiniMax-M3.1-Flash 的语义质量验收（明确偏好、无意义寒暄、过期删除等）。
  本票所有维护证据都是模型替身 + 真实 profile/Loader/会话/SQLite 的行为证据。
- `max-tokens` 按失败处理（票面/规格未定义；这是本票写入 README 的判定）。若真实模型经常
  在维护回合截断，会反复 resume 同一子会话；需要 #248 观察。
- 若进程在子会话完成、`completeMaintenance` 落盘前崩溃，重启后会把该子会话当作未完成而
  resume，追加一轮续写；多数情况下模型会零写入结束，但不保证完全不重复评估。这是
  “失败恢复同一子会话”与“完成落盘”之间的已知窗口。
- 维护子会话的 prompt 仍包含 dsh 自身的 runtime context（working directory / read-only
  sandbox policy）和部署级 harness 指令；源会话的 persona、identity、历史与系统提示不在其中，
  维护材料本身也不含它们。若未来要求子会话“系统提示也只有维护指令”，需要 dsh 提供按 session
  关闭 runtime-context/harness 指令的原生接缝（本票未改 dsh）。
- 维护检索沿用普通/深层关键词检索，接受可能漏掉相关旧记忆的已知风险；未加全库扫描或向量
  召回（规格明确排除）。
- 印象（#245）合并后仍只在 owned Agent 上注册；维护子会话无 owner，因此既没有 impression
  section 也没有 impression 工具；该行为由 #245 的 `registerImpressions` owner 检查和本票的
  精确工具目录断言共同固定。
