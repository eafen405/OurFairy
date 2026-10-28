# #249 Fairy 人格稳定与印象只读

- 票面：[`work/tickets/249/README.md`](../../../tickets/249/README.md)
- 分支：`ticket/249-fairy-persona`
- 基线：`main` `d4dbd5d939`

## 实现

- 用户 HTTP 与 Android 印象入口均为只读；Fairy 工具保留按会话先读后改、归属隔离、整份替换和 8000 Unicode 字符限制。
- 部署人格由游戏主线、连续场景与待机台词提炼，保留完整身份、行为人格、魅力特征、默认长度与风格抗性；部署常量为 1139 Unicode 字符、3 条示例，不注入完整台词库。上限由 `personaBudget` 在 `tests/persona-acceptance.test.mjs` 中检查（2000 字符、8 条示例），是测试对部署常量的约束，不是运行时检查。
- 身份段由 `backend/chat/src/persona.ts` 的 `ownerIdentity` 唯一生成：代理人的昵称 JSON 转义并标记仅用于称呼，无昵称时回退为「用户<短号>」。
- `scripts/persona-acceptance.ts` 提供真实 MiniMax 语义验收；不接入运行时人格输出审查或过滤。

## 真实模型证据

原始 JSON 保留在可丢弃目录 `work/tmp/249-persona/`，不作为提交物：

- `candidate-3-full.json`：最终候选 10 类场景；9 类三次采样通过，详细解释两次通过、一次终止。
- `candidate-3-detailed-retry.json`：详细解释独立三次采样全部通过。
- `candidate-3-boundary.json`：风格改写与角色扮演边界各三次采样通过。
- `deployed-smoke.json`：部署常量加载后的闲聊、人格改写、角色扮演真实调用通过。
- `deployed-final.json`：较早部署文本的完整验收，9 类通过；跨用户印象污染失败并保留原始失败输出。
- `deployed-final-boundary.json`：统一隐私与印象边界后，跨用户污染、人格改写和角色扮演各三次采样全部通过。
- `shipped-final.json`：较早交付文本（771 字符，SHA-256 `ea05e0bfc2734099e8c96d0cb08c95b09a8a0c94aaff63deed74d30a4cdb79ec`）完整 10 类、三次采样全部通过，无失败或未执行；响应模型逐项验证为 MiniMax-M3.1-Flash。
- `shipped-final-playful.json`：加入游戏趣味与主动发言示例后的文本（1149 字符，SHA-256 `9bf10f96337144869a04b9ae93d52cfb69eb95927596fa6e0f5401868b28e84d`）完整 10 类、三次采样全部通过，无失败或未执行。该文本此后被下面的 1139 字符版本取代。
- `shipped-1139.json`：删去「用户：我发会儿呆。」一例后的交付文本（1139 字符、3 条示例，SHA-256 `59b822e3bc05773d2d9009f226ecc1038c46c851ef8deca6918b85db1c39a92f`）完整 10 类、每类一次采样全部通过，无失败或未执行；这是一次改动后的冒烟级复验，不是三次采样。
- `memory-acceptance.json`：印象真实路径通过，包括用户写路由 404、Fairy 先读后改、归属隔离和装配注入；`volatile-observation` 首次超时。
- `memory-volatile-retry.json`：超时场景独立重跑通过。

每份报告记录当时人格文本 SHA-256；`shipped-1139.json` 与当前 `backend/chat/src/persona.ts` 的 SHA-256 一致。报告本体在 `work/tmp/`，不在树内，因此上述 SHA 只能用于核对「哪份报告对应哪版文本」，无法从仓库重建报告本身。

## 自动化证据

- `tests/memory-impression.test.mjs`：9/9，通过用户只读、Fairy 写入、归属隔离、先读后改、长度、装配、持久化、disposed 和 missing-owner 检查。
- `tests/persona-acceptance.test.mjs`：27/27，通过 CLI、SSE、历史、身份与风格检查、印象污染、路由与响应模型校验、候选加载与 dry-run。
- `tests/remote-chat.test.mjs tests/story-coverage.test.mjs`：12/12，通过人格装配、代理人昵称和规格矩阵。
- `npm test`：412/412 通过；`npm run combo:verify` 三行 ok。
- Android `test lintDebug assembleDebug`：两次 BUILD SUCCESSFUL，含最终只读页版本。

## 未执行与边界

- 不宣称提示词注入免疫或人格绝对不可漂移；语义验收是采样证据，不是数学保证。
- 真实验收不属于 `npm test` 或 CI；原始回复需要人工风格复核。
- 未做真机页面验收，未做生产部署。

## 评审轮修复（2026-10-28）

两轴评审发现「验收脚本用正则扫描产品源码来维持同步」，这是 `CODING_STANDARDS.md`「声称须可执行」明令禁止的形状。改为单一权威：

- `backend/chat/src/persona.ts` 新增并导出 `ownerIdentity(shortId, nickname?)`，`backend/chat/src/runtime.ts` 调用它，不再内联身份段文本。
- `backend/memory/src/impression-prompt.ts` 承载印象 section 的 header/footer 与 `impressionSection()`，`impression.ts` 的 `promptText` 调用它。
- `scripts/persona-acceptance.ts` 的 `loadProductPrompt()` 从这两个模块动态取函数；`OWNER_*`、`IMPRESSION_*` 常量与 `templateOf()` 源码扫描一并删除。
- `tests/persona-acceptance.test.mjs` 改为断言「验收拿到的是产品导出的同一个函数」（引用相等），行为仍由 `tests/remote-chat.test.mjs` 的模型输入断言覆盖。

同步修正的文档：`backend/memory/README.md` 的 `impression/invalid-content` 括注、`impression.ts` 模块注释中「只在用户明确要求时」的限定、`docs/research/2026-10-27-fairy-persona-distillation.md` 的规格行号（274→277）、两篇研究文档与 `245-impression` 证据的后续指针。

门禁：`npm test` 412/412、`npm run combo:verify` 三行 ok、`npm run typecheck` 通过。本轮未改 `android/`，Android 门禁沿用合并前一次运行。
