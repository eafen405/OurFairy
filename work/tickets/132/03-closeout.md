# 145: 收口：证据索引、两轴复核与全量门禁

**Status:** ready-for-agent

## Parent

[#132 收窄业务库公开面：删除零调用方法、DDL 常量按领域归位](https://github.com/eafen405/OurFairy/issues/132)

## What to build

收口 spec 132：登记前两张票的证据目录，在集成分支上跑全量门禁，并对本次增量跑一次两轴 code review
（Standards + Spec），把评审发现的问题在这次增量里修掉。

两轴评审按 `work/implementation/CONVENTIONS.md` §8 执行：Spec 轴引用本目录的票面副本
（`work/tickets/132/`）与父规格副本（`docs/specs/ourfairy-v1.md`）；两轴之外固定增加一项可执行声称检查——
本次增量里每一条「A 与 B 不能不一致」「X 已被检查/保证」「清单由 Y 派生」的声称，都要能指出在它失效时
会失败的具体命令或测试，并核对它断言的是同一事实；答不出就删除该声称，不为它补断言。

## Acceptance criteria

- [ ] `work/implementation/evidence/README.md` 登记 spec 132 的两个证据目录
- [ ] `work/tickets/132/` 的本地副本与票面一致
- [ ] `npm test` 在集成分支上通过
- [ ] `npm run combo:verify` 三行 ok
- [ ] 两轴 code review 跑过，发现的问题在本次增量里修掉（不留在集成分支上打补丁掩盖）
- [ ] 可执行声称检查逐条过完：本次增量里的每条结构类声称都指出在它失效时失败的具体测试
- [ ] 「store 公开面是 19 个方法」与「DDL 搬移行为零变化」两条声称各自有会失败的检查
- [ ] 证据写入 `work/implementation/evidence/145-closeout/README.md`

## Blocked by

- #143
- #144
