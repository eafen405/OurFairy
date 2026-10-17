# #66 merger 验证记录

- 集成分支：`integration/ourfairy-v1`，合并前 tip `42bbf89`。
- 合并：`git merge --no-ff arch/66-session-events -m "Merge branch 'arch/66-session-events' into integration/ourfairy-v1"`，
  merge commit **`f360385`**。合并无冲突，工作树无未提交改动。
- 实现者报告 FINAL_SHA `eb590a1`，实际合并的票分支 tip 即 `eb590a1`；合并前已确认
  `git merge-base --is-ancestor 42bbf89 arch/66-session-events` 通过（merge-base 就是 `42bbf89`）。
- **合并后源树与实现者验收树完全相同**：`git diff --quiet eb590a1 f360385` exit 0（两者 tree sha 均为
  `c6dadfb1182417a287929708c5bfd7cb3613d3dc`）。merger 仍在合并后 tip 上独立复跑全量，不依赖复用。

## 合并后实测（集成分支 tip `f360385`）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | 124 pass / 0 fail，EXIT 0（`tests 124`，`suites 6`，`pass 124`，`fail 0`，`duration_ms 43963`） |  |
| `npm run combo:verify` | 3 仓全 ok，EXIT 0 |  |

`combo:verify` 输出：

```
ourfairy  integration/ourfairy-v1  based on integra  f360385dc278c856  ok (worktree is the integration tip)
dsh       product/ourfairy-v1      fe2bbc3b1c14efd7  fe2bbc3b1c14efd7  ok
rikkahub  product/ourfairy-v1      189648274074846e  189648274074846e  ok
combo: combination verified
```

dsh pin `fe2bbc3b1c14efd7`、rikkahub pin `189648274074846e` 均未变，本票（后端）未改 `combo.json`。

## 证据收录

实现者证据已随票分支合入 `work/implementation/evidence/arch-66-session-events/`（8 个文件：README、red/green
定向日志、combo-verify、首次全量与 PDF 重跑、最终全量）；外部暂存目录
`/home/eafen405/ourfairy-evidence/arch-66-session-events/` 不存在，无分支外证据需要复制。merger 只新增本文件
及两个合并后日志。

## 票面偏差（实现者记录，merger 复核属实）

- 票面称 `chat` 与 `attachments` 的 `_events` 逐字相同且都依赖 `{events, cursor}`；实际 `attachments`
  返回 `observation.events`（无 `cursor`），并非逐字相同。实现保留 attachments 本地 `.events` 形状，
  3 个调用方零改动，未扩大范围。
- 实现者首次合并前全量 `npm test` 出现既有 PDF flake（`tests/pdf.test.mjs` 期望 `resource-limit`、实际
  `worker-unavailable`），隔离重跑 5/5 通过、全量重跑 124/124；merger 合并后全量 124/124，PDF 四条全部通过

## 范围外发现（如实转交，未修）

- `backend/sessions/package.json` 的 `files` 声明了 `README.md`，但该文件不存在；
  `productSourceHash` 会静默跳过。非本票范围，未改动。
- 主 checkout 存在合并前即有的未跟踪 AppleDouble 文件 `._refactoring-plan.template.md`、`._skill.md`，
  merger 未触碰、未提交。

## 结论

合并与验收通过；票可关闭。#66 关闭后 #51 解除阻塞。
