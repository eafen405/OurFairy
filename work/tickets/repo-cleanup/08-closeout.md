## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-08。

## What to build

在 CLEAN-01～CLEAN-06 合入目标集成分支后完成两轴评审、证据登记和最终全量门禁，确认各票的小步结果在最终集成状态共同成立。

## Scope

- 目标集成分支上的评审与合并核对。
- `work/implementation/evidence/` 下本轮收口证据及必要索引描述。
- 评审发现退回所属票修复；收口票不直接扩大生产代码改动。

## Acceptance criteria

- [ ] 六张代码票的增量均可追溯到票面验收项，没有夹带格式化、升级或范围外删除。
- [ ] 调用 `code-review` skill，以集成分支 merge-base 为固定点完成 Standards 与 Spec 两轴评审；Spec 轴使用本 ticket 集。
- [ ] 额外核对本轮可执行声称，尤其是测试选择、票副本状态与参数派生；发现的问题回到所属票修复。
- [ ] 在最终集成状态运行全部下列命令并记录真实结果，不用单票子集替代。
- [ ] 若 CLEAN-07 已执行，记录 Android 门禁是否从已清缓存状态重建；未执行则明确不作冷重建声称。
- [ ] 证据索引登记本轮交付，原始构建日志不提交。
- [ ] 工作区状态、worktree 和推送状态按 `specs:status` 复核；未提交或未合入成果明确保留，不为清场丢弃。

## Verification

```bash
npm test
npm run combo:verify
(cd android && ./gradlew test lintDebug)
node scripts/evidence-index.ts --check
npm run specs:status -- --offline
```

CI 与推送只在集成交付时按仓库协议执行一次；不为了每张票重复触发。

## Blocked by

- CLEAN-01
- CLEAN-02
- CLEAN-03
- CLEAN-04
- CLEAN-05
- CLEAN-06

CLEAN-07 是本机操作，不阻塞代码合并。

## Out of scope

不在收口票直接修生产问题，不补真实云服务或真机验收，不删除历史证据，不把未执行的检查写成通过。
