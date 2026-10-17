# Ticket #54 — SpaceScope 贡献者注册机制

- 仓库：OurFairy（后端）
- worktree：`.worktrees/arch-54-space-scope-contributors`
- 分支：`arch/54-space-scope-contributors`
- 集成分支：`integration/ourfairy-v1`，开工 tip `c878d6c`（与参数一致）
- 提交：`2073946 refactor(spaces): register scope contributors instead of assigning fields`
- 合并记录：提交前集成分支两次前进，均 `git merge` 后复跑验收（两次都无冲突）
  - `fd7da7f`（arch-61 合入）→ 合并后 `2073946`
  - `4320872`（arch-49 search owner codec 合入）→ 合并提交 `cb53c54`
- FINAL_SHA：`cb53c54f26a21e65abf416bfe7b4a86e6b717088`（合并 `4320872` 之后的 tip）

## 改了什么

1. `backend/spaces/src/scope.mjs`
   - 删除可变字段 `extraRoots = () => []` / `readonlyFiles = () => []`，改为两个注册方法：
     `contributeExtraRoots(fn)` / `contributeReadonlyFiles(fn)`，各返回**只注销自己**的 disposer；
     内部用 `Set` 保存贡献者，`writeRoots`/`readRoots` 每次操作对所有存活贡献者求值（保持「无成员缓存」语义）。
   - 保留 `readonlyFiles(session)` 作为只读文件的聚合入口（`backend/spaces/src/index.mjs:22` 的 bwrap 挂载继续调用它）。
2. `backend/spaces/src/groups.mjs`：原「赋值 + 复位成 `() => []`」改为
   `ctx.effect(() => scope.contributeExtraRoots(session => …))`，拆除由注册机制统一处理。
3. `backend/attachments/src/index.mjs:63`：原裸赋值改为
   `ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(session => service.readonlyFiles(session)))`——
   这是本票在 attachments 的**唯一**改动点（后续票 #57 另涉该文件）。
4. `backend/spaces/README.md`：把 `extraRoots/readonlyFiles` 字段描述改写为注册机制，并说明「单个贡献者卸载只移除自己」。
5. 新增测试支撑 `backend/spaces/test-support/scope-contributors.mjs`（test-only profile row，无 HTTP 路由、无模型回合）：
   通过 `ctx.plugin` 载入两个独立贡献者插件，逐个 `dispose()`，记录每步 `writeRoots`/`readRoots`。
6. `tests/spaces.test.mjs`：新增一条用例，断言
   ①两个贡献者同时生效（不是最后写入者胜出）；②只读文件不进 writable roots；
   ③注销第一个后只移除它自己的 extra root 与 read-only file，另一个仍在；④全部注销后不再生效。

未改动：`combo.json`、集成分支、issue；未 push。

## 定向 red / green

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 基线 | `node --test tests/spaces.test.mjs` | 7/7 pass（`baseline-spaces.log`） |
| red | 同上（新增用例 + fixture，尚未实现注册 API） | 8 条中 1 条 fail：`TypeError: ctx.ourfairySpaces.contributeExtraRoots is not a function`（`red-spaces.log`） |
| green | 同上（实现注册机制后） | 8/8 pass（`green-spaces.log`） |
| green（相关处） | `node --test tests/groups.test.mjs tests/attachments.test.mjs` | 9/9 pass（`green-groups-attachments.log`） |

## 变异检查（证明新用例真的钉住缺陷类）

两次都在改坏 `scope.mjs` 后跑 `node --test tests/spaces.test.mjs`，然后还原（`git diff` 确认无残留）：

| 变异 | 模拟的原缺陷 | 结果 |
| --- | --- | --- |
| A：注册位仍是单槽、最后写入者胜出 | 票面「最后写入者胜出」 | 红：`both contributors must grant their extra root at the same time, not last writer wins`（`mutation-a-last-writer-wins.log`） |
| B：注销时 `contributors.clear()` | 票面「`groups.mjs:26` 复位抹掉其他贡献者」 | 红：`the contributor still loaded must keep its own extra root and read-only file`（`mutation-b-teardown-clears-all.log`） |

## 验收（合并集成分支后的 tip 上）

```bash
cd /home/eafen405/projects/OurFairy/.worktrees/arch-54-space-scope-contributors
npm test              # 112 tests / 112 pass / 0 fail
npm run combo:verify  # combo: combination verified
```

- 合并 `fd7da7f` 后：110 条（基线 109 + 本票新增 1）全绿（`merged-npm-test.log`、`merged-combo-verify.log`）；
  提交时 pre-commit hook 同样跑 `npm test` + `combo:verify`，全绿。
- 合并 `4320872`（arch-49 又新增 2 条）后：112 条全绿 + combo 一致（`acceptance.log`，落于 `cb53c54`）。

## 一次失败与处置（如实记录）

首次提交时 pre-commit 的 `npm test` 出现 1 条**与本票无关**的失败：
`tests/pdf.test.mjs:161` 期望 `resource-limit`，实际 `worker-unavailable`（`worker-unavailable` 是 PDF worker 起不来的降级码）。
当时主机 load average 9.26（32 核、多张票并行构建）。单独复跑 `node --test tests/pdf.test.mjs` 5/5 通过（`pdf-retry.log`），
随后 `npm test` 110/110 通过（`merged-npm-test-retry.log`），再提交成功。判定为并发负载下的 flake，不是本票引入。

## 未完成 / 边界

- 只声明 Node 测试通过；未做真机、云服务或性能验收。
- 范围外发现（未改）：
  1. `backend/spaces/src/scope.mjs` 的 `contributeExtraRoots` 传入的贡献者若返回非数组会被 `flatMap` 静默展平/跳过，
     当前两个消费者都返回数组，未加防御（按仓库「不为假设场景加防御」）。
  2. `backend/spaces/src/index.mjs:22` 仍单独读 `scope.readonlyFiles(session)` 给 bwrap 挂载，与 `readRoots` 是两条读取路径；
     本票只改了贡献来源，未合并这两处调用。
  3. `tests/attachment-download-abort.test.mjs` 通过 `indexOf` 切片读取 `backend/attachments/src/index.mjs` 源码来定位 responder；
     本票在 `:63` 附近的改动位于该切片之后，不影响它（该测试仍绿）。
  4. 合并进来的 #49 新增了 `backend/identity/src/owner.mjs`（`user:<shortId>` 编解码唯一处），
     而 `backend/spaces/src/scope.mjs:38` 仍内联 `^user:[1-9]\d*$` 正则；两处是同一权威的重复表述。
     `spaces` 包不依赖 `identity`，本票不改，留待后续票决定是否改由 codec 承担。
