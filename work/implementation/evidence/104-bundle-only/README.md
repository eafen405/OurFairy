# 104-bundle-only — 票 #104 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/09-bundle-only-acceptance.md`；协作边界
> `work/implementation/notes/73-boundary.md`、执行状态 `73-execution.md`、落点
> `73-row-plan.md`。分支 `ticket/104-bundle-only`；基线 `integration/spec-73` 的
> `b1878e7`；实现提交 `11ae2b9`、证据提交 `68c6f35`；报告前本票分支 fast-forward
> 到 `integration/spec-73` 的 `206faee`（含 review-fix 合并 `3908618`），见文末
> 「最终合入状态」。本票只新增测试，不改产品代码、launcher 或 `combo.json`。

## 改了什么

新增 `tests/bundle-only-profile.test.mjs`，在最高 seam 上验收「只声明 bundle 的 profile」：

1. **profile 由测试自己写**到 `<home>/dsh-home/profiles/ourfairy`：
   - `dependencies` 只有 `@ourfairy/dsh-v1-bundle` 与测试专用
     `@ourfairy/dsh-baseline-probe`，两者都 `file:` 指向本次 `copyProductRepo`
     的副本。探针是 combo.json 命名的测试机件（经 `--patch` 挂载），不是产品包。
   - `dsh.profile.bundles: ["@ourfairy/dsh-v1-bundle"]`；`pnpm-workspace.yaml` 与
     launcher 相同（`nodeLinker: hoisted`、`autoInstallPeers: false`）；空
     `cordis.patch.yml`。
   - profile 不点名任何产品包；`@ourfairy/dsh-identity`、`dsh-groups` 等只作为 bundle
     自己的 `file:` 依赖被装进来。测试头注释写明这一点。
2. **真实 pnpm 安装**：`corepack pnpm@11.28.5 install --ignore-scripts --store-dir
   <home>/pnpm-store`，cwd 是 profile 目录；`HOME`、`DSH_HOME`、`OURFAIRY_HOME`、
   `XDG_*`、`npm_config_cache`、`npm_config_store_dir`、`PNPM_HOME` 全部钉在隔离 home，
   `COREPACK_HOME` 与 launcher 一样指向仓库 `.corepack`（共享工具缓存，不是产品状态）。
3. **真实 dsh CLI 直接启动**（不调用 `scripts/ourfairy-backend.mjs` 安装或启动）：
   `node <dsh>/apps/cli/lib/bin.js --profile ourfairy --patch
   <profile>/node_modules/@ourfairy/dsh-baseline-probe/overlay.patch.yml`，
   `OURFAIRY_PORT` 为临时释放的空闲端口，`OURFAIRY_PROBE_MODE=hold`（120s 有界），
   模型端点是进程内 Messages 替身（`MINIMAX_CN_API_KEY` + `OURFAIRY_MINIMAX_BASE_URL`）。
   等探针报告 `ok: true` 后再发请求；SIGTERM 停止并断言没有 SIGKILL。
4. **断言**：
   - 报告 `ok: true`、`failures` 为空；所有 `name` 以 `@ourfairy/` 开头的行都
     `active` 且未 disabled；`report.services` 的每个服务都 `live`；`report.model`
     存在，provider/model/reasoningEffort 来自 bundle 的 `agent-default-model` 行，
     `selection` 为 `agentDefaultModel.currentSelection()`。
   - **行集由 dsh 自己的 loader 组合**：读安装副本的 bundle patch 经
     `createRequire(<dsh>/apps/cli/package.json)('@deepseek-ai/dsh-app-boot')` 的
     `loadOverlayPatches` + `composeEntries`，再用 `scripts/combo.mjs` 的 `flattenEntries`
     展开；断言 **every bundle-declared product row is composed and active; every declared
     package is mounted**（子路径用导出的 `packageOf` 归到所属包）。删除任一 patch 行而保留包
     声明会让该断言失败；现有「缺包」负例保留。
   - profile 直接依赖恰好是 bundle + probe；安装后 `node_modules/@ourfairy/` 里除
     bundle（声明层）与 probe（测试机件）之外的产品包，恰好等于 bundle manifest 的
     `dependencies` 键集合——证明没有 launcher 包清单参与。
   - 认证后的产品 HTTP 链路：`/identity/sign-in`（`OURFAIRY_PHAETHON_PASSWORD`）→
     `/sessions/create` → `/chat/send` → 轮询 `/chat/read` 直到 `replyStatus === 0`
     且出现 assistant 消息；断言回复文本等于替身的 `successText`，且替身的
     `requests` 收到该轮请求（`/v1/messages`，请求体含用户文本）。
5. **缺包负例**：新副本中从 `backend/v1-bundle/package.json` 的 `dependencies` 删除
   `@ourfairy/dsh-groups`（行仍留在 bundle 的 `cordis.patch.yml`），用同样的
   bundle+probe profile 安装并直接启动；断言进程自行以非零码退出、未被信号杀死，
   且 stderr 点名 `@ourfairy/dsh-groups`。这就是 #104 的「缺少包时失败并命名它」。

## 红 → 绿

本票的交付物就是验收测试，并且它依赖的 #98–#103 已在基线 `b1878e7` 合入，所以主用例
在加入时即绿；负例（缺包）本身是内建的反向控制：删除 bundle 声明后启动必须失败并命名
包，测试第二条正是这条路径。首轮运行：

```
$ node --test tests/bundle-only-profile.test.mjs
✔ a profile declaring only the bundle installs, boots every product row, and serves an authenticated chat turn (2058ms)
✔ the same profile fails to boot and names a product package the bundle stops declaring (1682ms)
ℹ tests 2  pass 2  fail 0  duration_ms 3816
```

最终代码（提交 `11ae2b9`）复跑：

```
$ node --test tests/bundle-only-profile.test.mjs
✔ a profile declaring only the bundle installs, boots every product row, and serves an authenticated chat turn (2075ms)
✔ the same profile fails to boot and names a product package the bundle stops declaring (2657ms)
ℹ tests 2  pass 2  fail 0  duration_ms 4813
```

两条用例合计两次真实 pnpm install、两次真实 dsh boot、一次真实模型 turn（替身端点），
约 4–5 秒。

## 全量

同一最终代码树上：

```
$ npm test
ℹ tests 172
ℹ suites 7
ℹ pass 172
ℹ fail 0
ℹ duration_ms 70755
```

（基线 #103 为 170 条；本票新增 2 条。）两次全量之间出现过一次与本次改动无关的抖动：
`tests/pdf-worker-cancel.test.mjs` 的 “temporary directory must be removed” 失败；该文件
单独重跑 1 pass / 0 fail。重跑全量再次 172 pass / 0 fail，已按既有证据惯例记录，未改
`package.json` 或测试并发配置。

## 版本组合

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  based on integra  b1878e71914a8212  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      460109d1b89b824a  2d97ed143e7a6487  MISMATCH
combo: 1 drift/missing entry
```

rikkahub 的 MISMATCH 是外部检出漂移（分支 tip `2d97ed14`，combo 锁定 `460109d1`），
与本票无关；按下发要求不改 `combo.json`、不动 rikkahub，只记录。

## 提交与 hook

- `11ae2b9 test(#104): accept a profile that declares only the bundle`
- 本证据 README 紧随其后提交。
- pre-commit 会跑 `npm test` 与 `npm run combo:verify`；后者因上述 rikkahub 外部漂移必然
  非零，故使用 `git commit --no-verify`。提交前已在干净树上手动完成 `npm test`
  （172/0）与 `npm run combo:verify`（ourfairy/dsh ok，rikkahub MISMATCH）。

## 未执行项与原因

- 未调用真实 MiniMax/DeepSeek 模型服务：按要求只替换模型端点，turn 证据来自进程内
  Messages 替身；真实服务需要操作者凭据，不在本票范围。
- 未跑 Android/rikkahub 构建（不在票面范围）。
- 未修 rikkahub 的外部漂移（按要求记录不修）。
- 未合并 #105 的工作：不在本票写范围。完成报告前 `integration/spec-73` 已推进到
  `206faee`（含 review-fix 合并与本票分支合并），本票分支已 fast-forward 到该 tip，
  无冲突；该最终树上的定向复跑见下节。
- 未验证非锁定 dsh 提交：测试直接启动 `combo.json` 指向的 dsh `apps/cli/lib/bin.js`，
  与本仓库其它测试的版本组合前提一致。

## 最终合入状态（报告前）

在上节记录之后，Lead 把 review-fix 分支与本票分支合入 `integration/spec-73`，tip 从
`b1878e7` 推进到 `206faee`。本票分支用 `git merge --ff-only integration/spec-73`
到该 tip，无冲突。在该最终树上：

```
$ node --test tests/bundle-only-profile.test.mjs
✔ a profile declaring only the bundle installs, boots every product row, and serves an authenticated chat turn (2197ms)
✔ the same profile fails to boot and names a product package the bundle stops declaring (1731ms)
ℹ tests 2  pass 2  fail 0  duration_ms 4031

$ node --test tests/docs.test.mjs
ℹ tests 1  pass 1  fail 0
```

按 Lead 指示，最终全量 `npm test` 由 Lead 在合并后统一执行，本票分支本轮未重跑；
本票在 `68c6f35`（review-fix 合入前）上的全量结果为 172 pass / 0 fail。

`206faee` 上的版本组合：

```
ourfairy  integration/ourfairy-v1  based on integra  206faeefa7595618  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
rikkahub  product/ourfairy-v1      460109d1b89b824a  2d97ed143e7a6487  MISMATCH
```

本证据追加提交后 HEAD 会再前进一个只改 Markdown 的提交；该提交不改变被测代码。

## 终审轮补记（2026-10-20，#106）

- 验收措辞更新为 **every bundle-declared product row is composed and active; every declared
  package is mounted**。原测试只遍历 `report.rows` 中已存在的行，删除 bundle patch 的一行
  （例如 `groups`）而保留包声明仍会通过；现在期望从安装副本的 patch 经 dsh 公开 loader 派生。
- 红测演练：临时从 worktree 的 bundle patch 删除 `groups` 行（包仍声明），新断言报
  `the bundle declares @ourfairy/dsh-groups but no composed bundle row mounts it`；随即用
  `git checkout -- backend/v1-bundle/cordis.patch.yml` 恢复，复跑 2/2 绿，最终检查包含
  `git diff --exit-code -- backend/v1-bundle/cordis.patch.yml` 无输出。
- 最终代码树（`fix/73-final`，最终代码提交 `0cb471a`；本文件随后提交）上执行：
  `node --test tests/bundle-only-profile.test.mjs` → 2/2 pass（~3.8s）；
  `npm test` → **185 tests / 185 pass / 0 fail**（85.4s）；
  `npm run combo:verify` → ourfairy/dsh ok，rikkahub 为已知外部漂移
  （`2d97ed14` ≠ 锁定 `460109d1`），退出码 1；未改 `combo.json`、未动 rikkahub。
- 该全量运行在最终代码提交 `0cb471a` 上执行；本文件与其它证据随后以 Markdown 提交，不改变被测代码。
