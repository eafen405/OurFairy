# #64 merger 验证记录

- 集成分支：`integration/ourfairy-v1`，合并前 tip `704a1a9`。
- 合并：`git merge --no-ff arch/64-executable-claims -m "Merge branch 'arch/64-executable-claims' into integration/ourfairy-v1"`，
  merge commit **`ce225bb`**。合并无冲突，工作树干净。
- 实现者报告 FINAL_SHA `cc3a06e`，实际合并的票分支 tip 即 `cc3a06e`；合并前已确认
  `git merge-base --is-ancestor 704a1a9 arch/64-executable-claims` 通过。
- **合并后源树与实现者验收树完全相同**：`git diff --quiet cc3a06e ce225bb` exit 0（两者 tree sha 均为
  `9115f92801d934e218a671674f960c6e5c38a601`）。merger 仍在合并后 tip 上独立复跑全量，不依赖复用。

## 合并后实测（集成分支 tip `ce225bb`）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | 121 pass / 0 fail，EXIT 0（`tests 121`，`pass 121`，`fail 0`） | `merger-npm-test.log` |
| `npm run combo:verify` | 3 仓全 ok，EXIT 0 | `merger-combo-verify.log` |

`combo:verify` 输出：

```
ourfairy  integration/ourfairy-v1  based on integra  ce225bb114057b9a  ok (worktree is the integration tip)
dsh       product/ourfairy-v1      fe2bbc3b1c14efd7  fe2bbc3b1c14efd7  ok
rikkahub  product/ourfairy-v1      189648274074846e  189648274074846e  ok
combo: combination verified
```

rikkahub pin `189648274074846e`、dsh pin `fe2bbc3b1c14efd7` 均未变，本票（后端）未改 `combo.json`。

## 证据收录

实现者的外部证据目录 `/home/eafen405/ourfairy-evidence/arch-64-executable-claims/` 与其随分支提交的
`work/implementation/evidence/arch-64-executable-claims/` 逐文件 md5 相同（11 个文件全部 SAME），
无分支外遗漏文件，因此无需复制；merger 只新增本文件与两个合并后日志。

## 范围外发现（如实转交，未修）

实现者记录的 `bundleDeclaresAgentModel` 用 `patch.includes('model: ' + selection.model)` 做子串匹配，
`model: deepseek-flash-drifted` 仍会被判为通过（`finding-doctor-accepts-prefix-drift.log`）；
本票新增测试在测试层做严格相等比较，但 doctor 自身的「cannot drift apart」声称仍未被真值化。
merger 未改实现代码，已按要求在关票 resolution 中作为「建议另开票」记录。
