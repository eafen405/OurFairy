# OurFairy — Standards 轴（只读评审）

**硬（文档标准）**
1. 可执行声称：`tests/executable-claims.test.mjs:114-118` 仅查 doctor detail 含两值；`scripts/ourfairy-backend.mjs:323` 用子串 `includes`，`model: deepseek-flash-drifted` 仍通过，故 `v1-bundle/README.md:86-88` / `combo.json:58` 的「doctor 断言两值相等」没有会失败的可执行检查。arch-64 证据自认该缺口并转新票，违反新增 `CODING_STANDARDS.md:7`「另立新票不算落实」。
2. `tests/projection-interface.test.mjs:23` 的导出解析漏 `export async function`/`function*`；新增异步导出时测试仍绿，与「publishes exactly its receipt and transcript seam」不符。

**判断/smell**
3. `tests/chat-runtime.test.mjs:81-86` 称「only writer」却只扫 3 个文件；`tests/identity-interfaces.test.mjs:85-93` 以源码正则代替行为断言，触 `CODING_STANDARDS.md:6`「避免依赖私有实现」（结构声称无行为入口，属判断项）。
4. `identity/src/owner.mjs:14,22-23`：ownerOf 不校验参数，能造出 shortIdOf 拒绝的 `user:0`/`user:abc`，与「positive short number」及 codec 往返声称矛盾；测试只覆盖 `ownerOf(2)`。
5. `chat/src/runtime.mjs:126-188` 的 SessionRuntime 方法集体修改 `LiveSession` 字段（Feature Envy）；`chat/src/history.mjs:19,23` 终止原因数组重复（Duplicated Code）。
6. 复用未收口：`tests/helpers/backend.mjs:213-214` 声称测试请求不得依赖 fetch，但 `attachments.test.mjs:18`、`pdf.test.mjs:20`、`speech.test.mjs:11` 仍用 fetch；remote-chat/reconnect 也保留自有 request。
7. `tests/product-sources.test.mjs:26,110` 在测试中写入产品 `src` 文件，与并行 `node --test` 的其他 start 存在竞态；closeout 证据已记未修，属证据/声明一致性缺口。
8. `chat/src/queues.mjs:23-27` 的「重入即抛」针对未观测故障，属防御性 Speculative Generality（AGENTS 规模校准，判断项）。

正面：owner codec、readSessionEvents、download 工厂、PRODUCT_SOURCES 改派生均是真实复用/减法。
