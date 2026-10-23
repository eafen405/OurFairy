# #177–#179 测试与文档基建收口

三张复盘票的交付记录：合并重复断言、补回安装隔离断言、证据索引改为生成。都不改产品行为。

## 改动与验证

| 票 | 改动 | 失效时失败的检查 |
| --- | --- | --- |
| #177 | chat 幂等只在并发重试+重启的用例里断言，并补上顺带覆盖的三项（受理序号相同、冲突错误码 `chat/request-conflict`、冲突后仍只有一条消息）；删除顺序重发的重复用例 | `tests/remote-chat.test.mjs`：`a stable send is durably accepted once across concurrent retries and backend restart` |
| #177 | attempt 文本累积前缀性质只保留一处断言，删除另两个用例里的同样循环 | `tests/remote-chat.test.mjs`：`SSE preserves every text prefix and disconnecting observation leaves the backend reply running` |
| #178 | 新增一条真实安装后的隔离断言：源码与已装副本 inode 不同，改副本不回写源码，改源码不被已装副本跟随 | `tests/product-sources.test.mjs`：`an installed product file is a copy of its source, not the same file` |
| #179 | 规格小节改为从 `evidence/index/*.json` 生成，新增 `npm run evidence:index`；手写小节原样保留 | `npm run evidence:index -- --check` 报告索引已是最新（生成不进 CI，见票面） |

## 实际执行

```
node --test tests/product-sources.test.mjs tests/remote-chat.test.mjs tests/reconnect.test.mjs tests/ecosystem-boundary.test.mjs
npm test
npm run evidence:index            # 与提交前内容逐字节一致
node scripts/evidence-index.mjs --check
```

`npm test`：285 条全通过（80.7 s）。

## 判断与未执行项

- **#177 的标题引用**：删除用例后 `tests/ecosystem-boundary.test.mjs` 的引用清单与
  `docs/architecture/dsh-ecosystem-boundary.md` 的引用条目一并改到保留下来的用例；两条都断言"标题仍存在于源码"，
  所以少改一处会立刻失败。
- **#178 的成本**：这条用例跑一次真实 doctor（约 12 s），并用**自己的**仓库副本，避免与同文件里
  "发布模板"用例共用副本——否则 doctor 会复制那份替身模板而不是真的安装，断言会看不到已装文件。
- **#179 的取舍**：规格小节在索引里与其他手写小节交错（`仓库环境`、`Triage 修复` 夹在中间），因此生成器按
  **标题**就地替换每个规格小节，未匹配到的新描述文件插在最后一个规格小节之后；手写小节不参与生成。
  描述文字保留在描述文件里而不是取证据 README 的 H1——现有 H1 语言与粒度不一，直接替换会丢掉索引的可读性。
- 未执行：没有真机、没有性能测量；三张票都不涉及。
