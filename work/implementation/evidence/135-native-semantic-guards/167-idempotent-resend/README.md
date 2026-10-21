# 06 / #167 请求幂等：同标识连续重发只产生一条消息

父规格：[#135 原生语义漂移守卫](https://github.com/eafen405/OurFairy/issues/135)；
票面副本：[work/tickets/135/06-idempotent-resend.md](../../../../tickets/135/06-idempotent-resend.md)。

## 改了什么

只有测试，没有生产代码改动。

- `tests/remote-chat.test.mjs` 新增一条行为断言
  `the same request id sent twice in a row produces one message`。它从产品 HTTP 端点进入
  （`/chat/send`、`/chat/read`），顺序发送同一 `{sessionId, requestId, text}` 两次：
  - 两次都是 200，且第二份 receipt 与第一份**整体相等**（`deepEqual`，含 `acceptedSeq`），
    另单独断言 `acceptedSeq` 相等；
  - 读回投影里该 `requestId` 的 role 1 消息恰好一条，且 `messageId` 等于 receipt 的 `messageId`；
  - 同一标识改文本仍 409 且 `error.code === 'chat/request-conflict'`；
  - 冲突被拒后再读，该标识仍只有一条用户消息（拒绝路径不写入）。
- 没有断言 transcript 单元内部的 `receipts` 映射，只断言端点返回与读回投影。

既有并发重试 + 重启用例 `a stable send is durably accepted once across concurrent retries and backend restart`
未改动。

## 红 / 绿

工作目录 `.worktrees/167-idempotent-resend`，分支 `ticket/167-idempotent-resend`，
基线 `integration/spec-135`（`28e8d32`）。

```bash
node --test tests/remote-chat.test.mjs
```

结果：9 个用例全绿（新增用例 267 ms）。摘要：

```text
✔ a stable send is durably accepted once across concurrent retries and backend restart
✔ the same request id sent twice in a row produces one message
✔ all remote paths reject anonymous and foreign owners, including administrator, before cold resume
✔ SSE preserves every text prefix and disconnecting observation leaves the backend reply running
✔ a stop settles the visible prefix as interrupted and does not cancel the next reply
✔ a failed model attempt retains its exact partial text after a cold restart
✔ the deployment owner identity is separate from a chat attempt to edit the persona
✔ stopping the current reply preserves accepted queued input for the next wake
✔ stopping before visible output records interruption rather than a failed reply
ℹ tests 9  ℹ pass 9  ℹ fail 0
```

没有观察到红：当前发送路径已经满足票面要求，因此按票面「否则不改生产代码」处理。

## 敏感性检查（临时移除 receipt 短路）

把 `backend/chat/src/service.mjs` 里 `if (found === null) {` 临时改成 `if (true) {`，
即跳过「命中 receipt 就直接返回」的短路，让每次重发都重新 followup：

```bash
node --test --test-name-pattern="the same request id sent twice in a row produces one message" \
  tests/remote-chat.test.mjs
```

结果：红。投影里同一 `requestId` 出现两条 role 1 消息，断言在 `2 !== 1` 处失败：

```text
✖ the same request id sent twice in a row produces one message
  AssertionError [ERR_ASSERTION]: [{"messageId":"59da…","seq":7,"requestId":"alice-sequential-resend",
    "role":1,"status":2,"text":"这一条只应出现一次","attachments":[]},
    {"messageId":"66ef…","seq":11,"requestId":"alice-sequential-resend",
    "role":1,"status":1,"text":"这一条只应出现一次","attachments":[]}]
  2 !== 1
  at tests/remote-chat.test.mjs:104
```

随后 `git checkout -- backend/chat/src/service.mjs` 恢复，`git diff --exit-code` 确认与 HEAD
逐字节一致（工作区只剩 `tests/remote-chat.test.mjs` 一处修改）。恢复后重跑
`node --test tests/remote-chat.test.mjs` 再次全绿。

结论：这条断言确实盯着「receipt 去重锚点」——锚点不再短路时它会红，且红的方式正是
「同一标识产生两条消息」。

## 全量入口

提交 `40ad8e3` 经仓库 pre-commit 钩子（`.githooks/pre-commit`）通过，`git commit` 退出码 0，
即同一棵树上 `npm test` 与 `npm run combo:verify` 都通过；未使用 `--no-verify`。原始输出未入库
（证据协议），需要时在同一提交上重放这两条命令。

本提交的 `--amend` 只改这份证据文本，不改测试或生产代码；amended 提交仍经同一钩子通过。

## 未完成项

- 无。票面要求的三项（顺序重发一条消息、改文本 409、敏感性）都已覆盖，未改生产代码。
