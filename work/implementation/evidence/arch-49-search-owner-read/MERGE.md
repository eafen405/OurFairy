# Merge record — arch-49-search-owner-read (#49)

- Ticket: #49（后端 / OurFairy）`search` 跨包调用 `sessions` 私有 `_ownedHeader`，公开 `read` 等价
- 票分支：`arch/49-search-owner-read`，FINAL_SHA `9939b0210686cf88ee3aab2883568f4ae5809957`
- 合并前集成分支 tip：`integration/ourfairy-v1` = `fd7da7f679b8ca61e263cab9b819d6dde2b92459`
  - `git merge-base --is-ancestor fd7da7f 9939b02` → EXIT=0，票分支已包含集成分支 tip，无需回合并
- 合并提交（`--no-ff`）：`43208729f4840bc68f57527c02a9c7aee9266abe`
  - parents：`fd7da7f6`（集成分支旧 tip）、`9939b02`（票分支）
- 冲突：无（`Merge made by the 'ort' strategy`，7 files changed, 83 insertions(+), 8 deletions(-)）
- 合并后集成分支 tip：`43208729f4840bc68f57527c02a9c7aee9266abe`

## 源树等价

```bash
git -C /home/eafen405/projects/OurFairy diff --quiet 9939b02 4320872
# EXIT=0（无差异）
git rev-parse '9939b0210686cf88ee3aab2883568f4ae5809957^{tree}'  # 257293b2140bd7088ac361fc66f21095be42eba7
git rev-parse '43208729f4840bc68f57527c02a9c7aee9266abe^{tree}'  # 257293b2140bd7088ac361fc66f21095be42eba7
```

tree sha 相同 → 合并后源树与实现者验收的 FINAL_SHA 源树逐字节相同。

## 合并后验证（本次实际执行，OurFairy 主 checkout）

`pre-merge-commit` hook 不存在（仓库只有 `.githooks/pre-commit`），`merge --no-ff` 不触发 hook；
按 MERGER.md 第 3 步在合并后状态手动全量执行：

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | **111 tests / 111 pass / 0 fail**，exit 0（基线 109 + 本票 2 条） |  |
| `npm run combo:verify` | `combo: combination verified`，exit 0；ourfairy/dsh/rikkahub 三项 ok |  |

`combo:verify` 明细：ourfairy `43208729f4840bc6` ok (worktree is the integration tip)、
dsh `fe2bbc3b1c14efd7` ok、rikkahub `5d8efe425d4abb45` ok。

## combo.json

本票为后端票，未改 rikkahub，`repos.rikkahub.productCommit` 保持 `5d8efe425d4abb45ad1d1333214bd0c9a23473cc`
（与 rikkahub 当前 `product/ourfairy-v1` tip 一致），无需 pin 回写；证据提交只新增本目录文件。

## 实现者偏差（`--no-verify` 提交）与消解

实现者第一次 `git commit` 走 pre-commit hook 失败，失败项与本票改动无关：

- `tests/lifecycle.test.mjs` 的 doctor 检查：rikkahub 检出 `5d8efe4` 与当时 combo.json 锁定的 `771bffd` 不一致
  —— #61 刚合入 rikkahub、combo.json 重新 pin 尚未落地的中间态；
  证明该失败在未改动的主 checkout 集成分支上同样出现。
- `tests/pdf.test.mjs` 的 resource-budget 用例在负载下偶发 `worker-unavailable`；单独重跑通过。

实现者遂以 `--no-verify` 提交 `8c15dca`，随后集成分支前进到 `fd7da7f`（已 pin rikkahub `5d8efe4`），
按协议 merge 集成分支得到 `9939b02`，合并后 `combo:verify` 与 `npm test` 均通过。

**merger 侧消解**：合并提交 `4320872` 之后，在主 checkout 重跑 `npm test`（111/111）与 `combo:verify`（ok），
两项此前导致 hook 失败的原因均已消失（rikkahub pin 已落地、pdf 用例未复现）。偏差已如实记入 #49 resolution。

## 未做

- 未改动实现者代码。
- 未做真实云服务/设备验收；本票只声明 Node 测试与组合一致性。
- 实现者记录的范围外发现（`backend/spaces/src/scope.mjs` 等处其余 `user:` 自建解析）保持原样，属 #50。
