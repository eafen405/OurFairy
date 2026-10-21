# 04: 收口：证据、零语义变化对照与全量门禁

**What to build:** 把前三票的交付收成一次可复查的收口：证据目录写清改了什么、跑了什么、结果如何；用改动前后的行集合对照证明「这次改动不改变任何行的实际配置」；在集成分支最终状态跑全量门禁并记录结果。

**Blocked by:** #159、#160、#161

**Status:** ready-for-agent

- [ ] 证据落在 `work/implementation/evidence/134-bundle-groups/README.md`，并在 `work/implementation/evidence/README.md` 索引里登记
- [ ] 证据含零语义变化对照：以集成分支上分组前的提交为基线，用 dsh 自己的加载器取行集合，逐行比较 id/name/config；除新增的两个 group 行外差异为空。对照脚本或其命令可重放，原始输出不入库
- [ ] 证据记录探针多报的两个 group 行（`kernel`、`plugins`），并说明确认过没有任何断言因此失败、也没有按行数比较的断言
- [ ] 证据记录「`plugins` 整组停用后内核仍启动」的实测结果，并注明断言依据是子行状态（group 行自身始终 `disabled: false`）
- [ ] 集成分支最终状态：`npm test` 全绿、`npm run combo:verify` 三行 ok、`npm run backend:doctor` 全绿，三者结果写进证据
- [ ] `work/tickets/134/` 下四张票的本地副本与 GitHub 上的票面一致
