# 146-147-triage — 票 #146 / #147 证据

票面：<https://github.com/eafen405/OurFairy/issues/146>、<https://github.com/eafen405/OurFairy/issues/147>；
triage 结论与 agent brief 见各自 issue 的评论。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `tests/conversation-search.test.mjs` | 假模型服务器不再逐块解码请求体：新增 `readRequestBody`，先累积 Buffer 再一次性 UTF-8 解码；新增回归测试，把 8000 码点请求体在 emoji 中间拆成两块、经真实假模型 HTTP 服务器送入，断言收到的文本不变。 |
| `backend/identity/src/store.mjs` | 文件头删除「AGENTS.md forbids both」这一错误出处，只陈述「schema 不声明 UNIQUE 与外键，唯一性与关联存在性在事务内检查」的设计事实。 |

## Red / green

#146：把 `readRequestBody` 临时改回逐块 `data += chunk` 后只跑新测试，断言失败：

```
✖ the fake model decodes a request body split inside a multi-byte character
actual: '消息预算����消息预算😀…'
```

还原为一次解码后：

```
$ node --test tests/conversation-search.test.mjs
ℹ tests 7 / pass 7 / fail 0
```

#147：`grep -n "AGENTS.md" backend/identity/src/store.mjs` 无输出；
`node --test tests/identity-store.test.mjs` → 12/12。

## 验收命令与结果

- `node --test tests/conversation-search.test.mjs` → 7 pass
- `node --test tests/identity-store.test.mjs` → 12 pass
- `npm test` → 235 pass（由 pre-commit 门禁在最终提交上运行）
- `npm run combo:verify` → ok

## 提交

- #146：`664588f` test(#146): decode the fake model's request body once, not per socket chunk
- #147 与本文：本目录所在提交

## 范围外发现（未修）

1. 同样的逐块解码还留在另外 10 个测试替身：`tests/jobs.test.mjs`、`tests/groups.test.mjs`、
   `tests/spaces.test.mjs`、`tests/text-delivery.test.mjs`、`tests/file-delivery.test.mjs`、
   `tests/pdf.test.mjs`、`tests/attachments.test.mjs`、`tests/row-addressability.test.mjs`、
   `tests/spill-read.test.mjs`、`tests/chat-cold-boundary.test.mjs`。它们目前没有字节精确断言；
   按 triage 约定本票只修 conversation-search，建议后续抽 `tests/helpers/backend.mjs` 的共享
   读取函数统一替换。
2. `tests/identity-store.test.mjs` 的 unique 断言有洞：它只看 `sqlite_master.sql`，而列级
   `UNIQUE` 生成的 `sqlite_autoindex_*` 的 `sql` 为 NULL，断言会放过。实测给 `users.name`
   加 `UNIQUE` 后该测试仍 12/12 通过。因此本票的文件头注释只陈述事实、不再声称该测试保证；
   是否加固（改用 `PRAGMA index_list` 的 `origin`/`unique`）另立票决定。
3. `tests/speech.test.mjs` 的 `speech/timeout` 负载型偶发与本票无关，未处理。

## 未完成项与边界

- 只在本 worktree 提交，未 push、未合入集成分支、未评论/关闭 issue。
- 未做真实模型/真机验收；证据全部是本地 Node 测试与门禁输出。
