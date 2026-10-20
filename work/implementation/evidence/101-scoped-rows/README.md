# 101-scoped-rows — 票 #101 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/05-scoped-provider-rows.md`；落点
> `work/implementation/notes/73-row-plan.md`、`73-boundary.md`、`73-execution.md`。
> 分支 `ticket/101-scoped-rows`；基线 `integration/spec-73`（开工时 `d73f88f`，已先合入
> `0a8f2de`，含 #98 的 peer 范围改写）。

## 改了什么

`backend/spaces` 从「一个插件内部再 `ctx.plugin` 四个 provider」改为「spaces 行只拥有 scope，
四个 provider 各自是 bundle 行」：

| 模块 | 行 id | 行名 | 内容 |
| --- | --- | --- | --- |
| `src/fs.mjs` | `scoped-fs` | `@ourfairy/dsh-spaces/fs` | `export default ScopedFileSystem` + `static Config = LocalFileSystem.Config`；行 config 显式 `cwd: dshHomePath('spaces')`、`diffBasisMaxBytes: 10485760` |
| `src/sandbox.mjs`（新） | `scoped-sandbox` | `@ourfairy/dsh-spaces/sandbox` | 原内联 `ScopedSandbox`，bwrap argv 与拒绝签名不变 |
| `src/bash.mjs`（新） | `scoped-bash` | `@ourfairy/dsh-spaces/bash` | 原内联 `ScopedBash` + `shellQuote`；workdir 必须落在可写根内 |
| `src/directory.mjs`（新） | `scoped-directory` | `@ourfairy/dsh-spaces/directory` | 原内联 `ScopedDirectory`；越界 cwd 恢复到私有根 |

- `backend/spaces/src/index.mjs` 只保留 `SpaceScope`、`tools/execute` 作用域包裹、systemPrompt
  贡献与 groups 安装（groups 行由 #100 迁出，合并时按 #100 删除）；四个 `ctx.plugin` 调用删除。
- `backend/spaces/package.json` 的 `exports` 增加 `./fs`、`./sandbox`、`./bash`、`./directory`；
  同一包的不同模块 specifier，bundle 无需新增依赖。
- `backend/v1-bundle/cordis.patch.yml` 增加四行（只插入，不重排既有行）。
- `backend/probe/src/index.mjs` 的 `SERVICE_ROWS` 从「五个服务都映射到 `spaces`」改为显式映射：
  `ourfairySpaces`→`spaces`、`fs`→`scoped-fs`、`shell`→`scoped-bash`、`sandbox`→`scoped-sandbox`、
  `workingDirectory`→`scoped-directory`。
- `backend/spaces/README.md` 记录 provider 已成为独立行。

## 新增测试

`tests/scoped-provider-rows.test.mjs`（3 条，全部通过）：

1. 四个行存在、`fiberState: active`、行名正确；四个服务 live 且 `expectedRow` 指向各自行；
   `ourfairySpaces` 仍由 `spaces` 行提供。
2. 逐个用 overlay `{ id: <row>, disabled: true }` 禁用：`probe --patch` 非零退出、`report.ok=false`、
   该服务 `live=false`（证明没有换成未加 scope 的原生 provider）、失败信息同时命名服务与行、
   依赖它的工具行不再 active；并断言组合里没有 `fs-sandbox`/`working-directory`/`bash-sandbox`/`sandbox`
   这些原生 provider 行。
3. `scoped-bash` 禁用下用模型替身跑一次 `probe --turn`：第一次模型请求的工具清单仍有 `read`、
   没有 `bash`；第二次请求的 `tool_result` 为 `is_error: true` 且文本含 `unknown tool "bash"`。

## 实际执行与结果

在 `ticket/101-scoped-rows` 的最终状态上执行：

```
$ node --test tests/scoped-provider-rows.test.mjs
✔ the four scoped providers are active bundle rows with their own services
✔ disabling one provider row leaves its capability waiting with no native fallback
✔ a bash call under a disabled shell row fails clearly while read stays offered
ℹ tests 3  pass 3  fail 0
```

```
$ node --test tests/spaces.test.mjs tests/baseline-boot.test.mjs tests/bundle-packages.test.mjs tests/attachments.test.mjs tests/groups.test.mjs
ℹ tests 32  pass 32  fail 0
```

```
$ npm test
ℹ tests 163  pass 162  fail 1
✖ read intervals have inclusive original positions, omit tool results, and bound message text
  AssertionError: 8001 !== 8000 (tests/conversation-search.test.mjs:140)
```

该失败在并发跑另一套全量测试时出现；单独重跑同一文件：

```
$ node --test tests/conversation-search.test.mjs
ℹ tests 6  pass 6  fail 0
```

即已知的负载抖动（与 `pdf-worker-cancel` 同类），不是本票改动路径上的行为差异：
本票不触碰 conversation-search 的读取或投影代码。

`npm run combo:verify`：ourfairy 一项 ok（分支已含 `integration/spec-73` tip）；rikkahub 一项
按 `73-execution.md` 预期 MISMATCH（外部归档提交 `2d97ed14` ≠ `combo.json` 锁定 `460109d1`）。
本票未改 `combo.json`。

## 未执行项与原因

- 未在真实设备/真实模型服务上验证；本票只改装配与行，测试用模型替身与真实 bwrap 子进程。
- 未跑 Android 构建（不在本票范围）。
- `pdf-worker-cancel` 与 `conversation-search` 的偶发失败未修：并发全量下的已知抖动，单独重跑通过；
  修复属测试稳定性问题，不在本票范围。

## 2026-10-20 终审轮补记：disabled expected row 的探针规则

探针的 `collectServices` 现在把「expected row 被禁用且服务缺席」当作刻意缺席、把「服务 live
但 expected row 被禁用」当作替换行提供，两者都不计失败。仍然失败的是：expected row 存在且未
禁用但服务缺席、服务 live 但 expected row 不在组合中、服务 live 但未禁用行未激活。行本身继续
由 `collectInactiveProductRows` 按「非刻意禁用」检查。

因此本文件第 2 条用例的四个 provider 结果由 `tests/scoped-provider-rows.test.mjs` 固定为：

- `scoped-bash` 禁用 → probe 退出 0、`report.ok=true`、`services.shell.live=false` 且
  `disabled=true`，不再出现 `service "shell" is not live`；#105 因此可以用 launcher `start`
  证明「scoped provider 禁用后仍能启动」。
- `scoped-fs`、`scoped-sandbox`、`scoped-directory` 仍失败，但失败来自等待中的依赖（fs →
  attachments/chat 的 `ourfairyAttachments`；sandbox → `shell`；directory → attachments），
  不是被禁用行自己的服务。
- 四种情况下组合都不出现原生 fallback 行，被禁用行的工具行不 active。

本票其余内容（行拆分、服务映射、模型 turn 证据）不变。
