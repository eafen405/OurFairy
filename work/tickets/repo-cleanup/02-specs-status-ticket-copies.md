## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-02。

## What to build

让 `specs:status` 从票面已有的父规格声明识别命名票目录，不再假定 `work/tickets/<目录>` 的目录名必须是 spec 数字。

## Current evidence

`work/tickets/fairy-memory/README.md:3` 明确声明父规格 #240，但 `scripts/specs-status.ts:155-172` 只发现纯数字目录，`:213-216` 只检查 `work/tickets/${spec}`。实际 `specs:status --offline --spec 240` 因此报告 `copies=MISSING`，与仓库内容不符。

该命令是根 `AGENTS.md` 指定的 spec/worktree 状态入口，误报会引导 Agent 重取票面或误判交付状态。

## Scope

- `scripts/specs-status.ts`
- `tests/specs-status.test.mjs`

`specsInCheckout` 与分支上的副本判定必须复用同一个“票目录→父规格”读取规则；读取指定 Git ref 时不得只读当前工作树。优先复用票面现有的 `published.json.parent` 或 README 父规格链接，不新增第二份目录映射。

## Acceptance criteria

- [ ] 先用临时仓库 fixture 复现：非数字目录带有父规格声明，却被报告为缺失。
- [ ] 命名目录能被发现为已知 spec，即使没有同名数字目录。
- [ ] spec 分支 tip 与落地分支上的命名票目录都能被正确判定；仍保留纯数字目录行为。
- [ ] 没有对应父规格声明时仍报告 `copies=MISSING`，不把任意 README 当作票副本。
- [ ] 离线模式不访问 tracker，现有 pushed/merged/content-landed/worktree 判定不变。
- [ ] 在实际检出运行后，#240 不再误报副本缺失。

## Verification

```bash
node --test tests/specs-status.test.mjs
npm run specs:status -- --offline --spec 240
```

## Blocked by

无。

## Out of scope

不重新设计票面格式，不要求所有历史票目录补机器可读文件，不改变 GitHub issue 与原生 blocked-by 的权威地位。
