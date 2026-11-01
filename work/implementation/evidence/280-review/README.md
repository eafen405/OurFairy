# #280 两轴复审修订（`ticket/280-review-fixes`）

- 父 spec：[#280](https://github.com/eafen405/OurFairy/issues/280)
- 复审基线：`integration/spec-280` @ `321675f4a8`；两轴报告的增量 diff 为 `2739e34d5f...HEAD`
- 修订分支：`ticket/280-review-fixes`，基于 `integration/spec-280` @ `321675f4a8`
- 本目录记录两轴报告的原文、逐项处置与本轮实际跑过的命令。最终门禁（`npm test`、`npm run
  combo:verify`、Android `test lintDebug`）由 Lead 在修订合入后的最终集成 tip 运行，见 F3。

## 两轴报告（原文）

### Standards axis — spec #280 (diff 2739e34d5f...HEAD)

```text
# Standards axis — spec #280 (diff 2739e34d5f...HEAD)

## HARD (documented standards)
1. `backend/sessions/README.md:93–96` and `backend/sessions/src/service.ts:312–315` claim `canHostDelivery` "answers false rather than throwing" for missing/ownerless/foreign sessions. No test calls `canHostDelivery`; `tests/delivery-target.test.mjs:38–43` feeds booleans into the pure function, and `work/implementation/evidence/282-self-delivery-text/README.md:86–87` admits "没有单独的服务级用例". Breaks `CODING_STANDARDS.md:7`（声称须可执行）. Add owned-session cases (missing id, archived, other owner) or delete the sentence.
2. `backend/delivery/README.md:17` says `src/target.ts` "is that rule's only home and has no imports" (`src/target.ts:7` repeats it). Single-encoding structural claim with no seam/check, and `backend/delivery/src/index.ts:144` already repeats the self-recipient predicate `recipientShortId === senderShortId` that `target.ts:39` owns. Also `backend/sessions/README.md:34` ("never has to enumerate the caller's archive list") is unenforced. Violates `CODING_STANDARDS.md:7`（结构类声称须做成接缝，做不到就删除）and `AGENTS.md:11`（权威唯一）.
3. Conditional: `work/implementation/evidence/285-landing-notifications/README.md:76–88` records full `npm test` red, `combo:verify` skipped, commits via `--no-verify`. `CODING_STANDARDS.md:9`（完整检查）requires both at final integration state (Android `test lintDebug` was run). If HEAD is the delivery candidate this is unmet; no spec-level evidence of those gates in the diff.

## JUDGEMENT (baseline smells)
4. Duplicated Code: `tests/text-delivery.test.mjs:275–277`, `:306–308`, `:349–351`, and `tests/file-delivery.test.mjs:334–336` repeat the identical block: `const primary = (await request('/sessions/primary', X.token)).session.id; await tool(X,'groups',{},primary); const origin = (await request('/sessions/create', X.token)).session.id`. Extract one helper.
5. Duplicated Code: archive predicate `owner_short_id = ? AND status = ? AND deleted_at IS NULL` now a third copy at `backend/sessions/src/archive-store.ts:118` (also `:102`, `:159`).
6. Private-schema assertions (precedent in same suite keeps it judgement): new tests read `deliveries.recipient_session_id`/`status` and inject SQL triggers at `tests/text-delivery.test.mjs:312–325,354–356`, against `CODING_STANDARDS.md:6`（避免依赖私有实现）and #280 "不窥探数据库行"; the receipt already exposes the landing.
7. Non-reproducible sensitivity claim: `work/implementation/evidence/284-retry-landing/README.md:46–56` bases "用例会对回归失败" on reverted, uncommitted mutations; same 声称须可执行 rule, judgement only.

Not flagged: queue re-entry fix is backed by `tests/chat-runtime.test.mjs:55–75`; Android comments are backed by the updated backlog tests.
```

### Spec axis — spec #280 (diff 2739e34d5f...HEAD)

```text
# Spec axis — spec #280 (diff 2739e34d5f...HEAD)

## (a) Missing/partial
1. Spec 280.md:55 asks coverage "无发起会话的投递（创建者不是用户会话）→ 回落主会话"; only a pure-function case exists (tests/delivery-target.test.mjs:32). Ticket 282.md:29 sanctions it ("该输入今天不可经工具到达"), so this is a spec/ticket conflict, not silent omission — but the launcher-seam case the spec asked for does not exist.
2. Spec 280.md:45 术语 "主会话的定义拆成「通知落点 + 跨用户投递落点」"; Android doc still says the split never happened: android/.../data/remote/SessionApi.kt:113-114 "The backend refuses the primary session, which is where replies and notifications land."

## (b) Scope creep
1. backend/chat/src/queues.ts:22-47 replaces the held-set guard with `HeldEntry.settled` so a settled entry may be re-entered (also for runDelivery). No ticket or spec line asks for this; evidence 282 itself calls it "票面写范围外的必要偏离". Risk: when a concurrent `/chat/send` holds the same session queue, a self delivery now waits instead of failing fast, and that send's barrier may wait on the turn awaiting the delivery — a silent hang replacing a fast error. Needs a targeted interleaving test.
2. backend/delivery/src/index.ts:150 skips `primary()` (and its lazy creation) whenever the landing is the origin; delivery/README.md:27 documents "created on first use, only when it is the landing". Spec 280.md:39 only prescribes the fallback rule; not creating the primary is an unasked side-effect change with no test.

## (c) Looks wrong
1. tests/text-delivery.test.mjs:312-380 asserts `deliveries.status` / `recipient_session_id` / `message_id` and installs DB triggers. Spec 280.md:50: "只断言外部行为…不检查内部函数、不窥探数据库行". (The suite already does this at :190, but the spec resets the bar.)
2. backend/sessions/src/service.ts:328-331 changes the archive-refusal KDoc while spec 280.md:45 says "归档拒绝主会话的理由保持不变": it now adds "a self delivery instead follows the conversation it was issued from and does not depend on the primary being in the default view" — circular, since the refusal is about landing targets remaining possible, not default-view membership.

Correctly done: canHostDelivery as the only new service surface (service.ts:316), one landing decision recorded before prepare (index.ts:144-150), receipt reads row.sessionId, retry/recovery reuse the record (284 cases), per-landing Android notifications (RemoteReceiveState.kt:243-255) with per-session tags, GLOSSARY/READMEs updated.
```

## 逐项处置

| 编号 | 结论 | 处理与理由 |
| --- | --- | --- |
| F1（Standards 1） | 已修 | 在 `backend/sessions/src/service.ts` 的 `canHostDelivery` KDoc 与 `backend/sessions/README.md` 删除「missing/ownerless/foreign 返回 false 而不是抛错」的句子；保留谓词定义（header 存在、owner 是调用者、未归档）。归档输入已由 `tests/text-delivery.test.mjs` 端到端覆盖，不新增服务级接缝。 |
| F2（Standards 2 + Spec b2） | 已修 | `backend/delivery/src/target.ts` 改为 `deliveryTargetOf({ senderShortId, recipientShortId, originSessionId, originCanHost, primarySessionId }) => string`，直接返回落点会话 id；`backend/delivery/src/index.ts` 恢复始终解析主会话，并无条件问一次 `canHostDelivery`（跨用户投递也问），自身收件人谓词只留在纯规则里。`tests/delivery-target.test.mjs` 同步。`backend/delivery/README.md` 删除「only home / no imports」「created on first use, only when it is the landing」与无 import 保证叙事；`backend/sessions/README.md` 删除「不必枚举归档列表」的保证，改写为单行读的事实。记录行的 `settle` 与回执路径未改。 |
| F3（Standards 3） | 未在本分支修 | 最终门禁不在本分支跑，也不在本证据声称。Lead 在本次修订合入后的最终集成 tip 运行 `npm test`、`npm run combo:verify` 与 `cd android && ./gradlew test lintDebug`。此项保持未完成，待 Lead 记录。 |
| F4（Standards 4） | 已修 | `tests/text-delivery.test.mjs` 增加 `selfDeliverySessions` helper，替换 3 处「填充主会话再建普通会话」块；`tests/file-delivery.test.mjs` 增加同名 helper，替换 1 处。既有断言不变。 |
| F5（Standards 5） | 未修（有理由） | 三条 archive SQL 回答不同问题：`list` 的集合查询、`isArchived` 的单行读取、restore 的状态写入。共享 SQL 片段会把这三种语义压成一个不透明片段；按 AGENTS「结构按需」保留三处直写。 |
| F6（Standards 6 + Spec c1） | 已修 | `tests/text-delivery.test.mjs` 的重试用例只把 `deliveries` UPDATE 触发器当故障注入，经短生命周期连接安装/删除，不读 `status`/`recipient_session_id`/`message_id`；外部断言工具错误、重试回执 `sessionId`、`origin` 恰一条消息、主会话无、换文本冲突。启动恢复用例改用既有 `backend/chat/test-support/fail-outlets.ts` 的 `failFlush`：失败一次、归档 `origin`、不带故障层重启，只在重启后读投影断言 `origin` 恰一条、主会话无，不读库、不调工具。`work/implementation/evidence/284-retry-landing/README.md` 已同步。 |
| F7（Standards 7） | 已修 | 删除 `work/implementation/evidence/284-retry-landing/README.md` 的临时变异敏感性表和「会对回归失败」的不可复现声称；改为直接列出用例断言的外部事实。 |
| S1（Spec a1） | 不改（接受） | 「无发起会话」的纯函数用例是已批准的解决：该输入今天不可经工具到达，`work/tickets/280/282.md:29` 明确认可为未来后台投递保留；不为它新增启动器接缝。 |
| S2（Spec a2） | 已修 | `android/app/src/main/java/me/rerere/rikkahub/data/remote/SessionApi.kt` 归档注释由「replies and notifications land」改为「replies and deliveries from other users land」。仅注释，无 Kotlin 行为变化。 |
| S3（Spec b1） | 已修 | 保留 `SessionQueues` 的 `settled` 修复（自投回写发起会话需要它；`send` 不 await 回合，新条目不会等这次投递）。`tests/chat-runtime.test.mjs` 新增用例：已结算条目的后续重入排在更新的运行中条目之后，不会越过；仍在运行的嵌套条目仍立即失败。 |
| S4（Spec c2） | 已修 | `backend/sessions/src/service.ts` 归档 KDoc 删除「self delivery … does not depend on the primary being in the default view」一句；拒绝理由仍为 replies and deliveries from other users land there。 |

## 实际跑过的命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run build` | exit 0 |
| `node --test tests/delivery-target.test.mjs`（实现前，红） | 4 fail：旧规则返回 `'origin'`/`'primary'`，断言期望落点会话 id |
| `node --test tests/delivery-target.test.mjs`（实现后） | 4 pass / 0 fail |
| `node --test tests/chat-runtime.test.mjs` | 5 pass / 0 fail |
| `node --test --test-name-pattern="self delivery retry\|boot recovery settles" tests/text-delivery.test.mjs` | 2 pass / 0 fail |
| `node --test tests/text-delivery.test.mjs tests/file-delivery.test.mjs tests/chat-runtime.test.mjs tests/delivery-target.test.mjs tests/docs.test.mjs`（第一次） | 27 pass / 1 fail；唯一失败是 `tests/docs.test.mjs` 指向本 README 的链接（本文件当时尚未创建），不是行为失败 |
| 同上（创建本 README 后复跑） | 28 pass / 0 fail |
| `git merge integration/spec-280` | 集成 tip `321675f4a8` 已是本分支祖先，`Already up to date.`；无合并提交 |
| `git status --porcelain` | 空（提交后检查） |

未运行 `cd android && ./gradlew test lintDebug`：S2 只改 KDoc 注释，不改 Kotlin 行为，按任务约定不跑；最终 Android 门禁仍由 Lead 在 F3 覆盖。

未运行全量 `npm test` 与 `npm run combo:verify`：属于 F3 的最终门禁，本分支不声称完成。
