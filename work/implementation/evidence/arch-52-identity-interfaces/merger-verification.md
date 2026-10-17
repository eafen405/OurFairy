# arch-52 merger verification — identity 按领域 interface（不拆库）

- 票：#52
- 集成分支：`integration/ourfairy-v1`，合并前 tip `26cc002`（#68 pin）
- 票分支：`arch/52-identity-interfaces`，合并前 HEAD `d0eab3a`（与实现者报告 FINAL_SHA 一致）
- 合并提交：`52a3170`（`Merge branch 'arch/52-identity-interfaces' into integration/ourfairy-v1`，`--no-ff`，无冲突）
- 合并策略：`ort`，23 个文件，+2134/−33；未改动实现者代码
- 本次合并后集成 tip：`52a3170`

## 前置核对（全部通过）

```text
主 checkout 分支            integration/ourfairy-v1
主 checkout 工作树          clean（git status --porcelain 空）
票分支 HEAD                 d0eab3a1835d26f9bb9c539cc8ae1160318cd933  == 报告 FINAL_SHA
集成分支 tip 是否祖先       26cc002 ancestor of HEAD: yes
```

说明：实现者报告链路中的 `27631a8`/`0a477b6` 是同一父提交 `fb84ef6` 的悬空旧版证据提交（随后被 `d0eab3a` 取代，仅差 `commit-evidence.log` 与其 README 自引用说明），不在分支上，不影响 FINAL_SHA 一致性。

## 合并后验证（在 `52a3170` 的树，OurFairy 主 checkout）

```bash
cd /home/eafen405/projects/OurFairy
npm test                  # → EXIT 0，139 tests / 139 pass / 0 fail（6 suites，25.3s）
npm run combo:verify      # → EXIT 0，combo: combination verified
```

`combo:verify` 原文摘要：

```text
repo      branch                   expected          actual            result
ourfairy  integration/ourfairy-v1  based on integra  52a31704a3a31e6a  ok (worktree is the integration tip)
dsh       product/ourfairy-v1      fe2bbc3b1c14efd7  fe2bbc3b1c14efd7  ok
rikkahub  product/ourfairy-v1      c3eea8a09738def2  c3eea8a09738def2  ok
```

原始日志：本目录 `merger-npm-test.log`、`merger-combo-verify.log`。

## 本票公共面与「不拆库」依据（摘要，详见 README.md）

- 最终形状：`ctx.identity` 暴露四个领域面，共 12 个方法，全部有真实消费者：
  - `users.byShortId`（chat delivery / spaces groups / attachments / search）
  - `groups.forMember/create/changeMember/owns`（spaces）
  - `uploads.read/insert/update`（attachments）
  - `deliveries.prepare/prepareFile/pending/complete`（chat delivery）
- 裸 `identity.store` 从公开面移除，store 改由模块私有 `STORE` Symbol 持有（理由：Cordis 以 traceable proxy 调用 service 方法，`#` 私有字段经 proxy 不可读，定向行为测试 32 条红后定位并修正）。
- 不拆库：单 `DatabaseSync` 连接、单 `BEGIN IMMEDIATE` 事务、单 `SCHEMA_VERSION = 6` 迁移阶梯是个人规模下的真实 leverage；拆库只会把跨领域原子性/迁移版本复杂度搬家。本票未改表结构、迁移与业务规则。
- `/identity/register`、`/identity/sign-in` 保留包内直取 store（沿用 #62 删除纯转发决定），`identityHandlers` 显式接收 store。

## 收录与提交

- 实现者证据随票分支合入本目录，未改动。
- 本次新增 `merger-verification.md` 与两份合并后日志，一个提交 `chore: pin integrated arch-52-identity-interfaces and record evidence`（pre-commit hook 复跑 `npm test` + `combo:verify`）。
- 未改动 `combo.json`（本票不涉及 rikkahub pin 变化；`combo:verify` 三仓一致）。

## 未完成项

- 本票不新增 `backend/identity/README.md`（票面旁证，非修复方向；如需另立票）。
- 未拆库/未改迁移（票面明确不做）。合并冲突：无。
