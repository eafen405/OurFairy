# #133 两轴复核修复：删除无依据断言并对齐 spec

父票：[#133](https://github.com/eafen405/OurFairy/issues/133)。审查分支 `ticket/133-review-fixes`，
基线 `integration/spec-133` tip `f40719e`。本文件记录两轴复核（Standards / Spec）的逐条修复、
审查中接受的准确性修正，以及本次运行的命令。

本次是 docs/comment-only 改动：不改行为、测试、夹具、`package.json`、`combo.json` 或公开
服务面；`runtime.mjs`、`service.mjs`、`jobs.mjs`、`units.mjs`、`runtime-facade.mjs` 未改。

## 逐条映射

| 编号 | 复核发现 | 改动 |
| --- | --- | --- |
| Standards 1 | README 把 `changed()` 写成 `version` 的唯一写入者 | `backend/chat/README.md`「投影派生」改为「每次已发布输入变化时递增（`src/runtime.mjs` 的 `changed()`）」。 |
| Standards 2 | spill 段借 native-capabilities/doctor 检查暗示服务改名不会静默通过；两项检查只断言行 id + 包名 | `backend/chat/README.md`、`work/tickets/133/README.md` 的 spill 决定与 `backend/chat/src/spill-read.mjs` 注释都改为「`spill-local` 行（行 id + 包名）存在；检索行为由 `tests/spill-read.test.mjs` 钉住」。 |
| Standards 3 | 服务依赖开头把「只列缺了会错的服务」写成已保证的最小性 | `backend/chat/README.md` 改为取舍规则，并写明本 spec 按 Testing Decisions 不新增 inject 字面量断言、最小性由审查与提交说明承担、没有自动守卫。 |
| Standards 4 | 声称其余条目都有直接 `ctx.<name>` 调用、缺席会在特定处失败 | `backend/chat/README.md` 改为「其余条目在源码里各有使用处；新增或删除 inject 时，以 `src/index.mjs` 的声明与注释为准，并在提交说明里写明依据」。 |
| Standards 5 | `src/index.mjs` 注释含「an entry belongs here only if…」与悬空的 called out at their sites | 注释改为「Services this row waits for before it accepts work…」；排序项与 `spillStore` 动态读取各自指向注释处。`01-inject.md` 的「改动后」代码块同步。 |
| Standards 6 | 分析记录用「传递保证」并声称组合可用性仍被保证 | `work/tickets/133/README.md` 改为「传递可用性」，限定在 pinned composition 的两处声明。 |
| Standards 7 | `01-inject.md` 把 grep 当作结构声称的持续验证；沿用「传递保证」与 spill 过度声称 | grep 改为一次性前提核对并写明没有自动守卫；「传递保证」改为「传递可用性」；spill 句改为行 id + 包名与 `tests/spill-read.test.mjs`。 |
| Spec 8 | `llm` 声明与用户故事 9「不触碰运行时文件」冲突但未记录 | `work/tickets/133/README.md` 的 `llm` 决定下与 `01-inject.md` 各加「与用户故事 9 的冲突」小节：明确故事 9 未满足；替代方案「保持动态读取并注明允许缺席」对 `llm` 不成立；代价是 `src/runtime.mjs:120` 一行，能跑回合的组合行为不变。 |
| Spec 9 | 夹具服务名未核对（故事 5） | `work/tickets/133/README.md` 与 `work/implementation/evidence/133-inject-truth/README.md` 的夹具表加「服务名核对」列：`fail-outlets` inject `['ourfairyChat','sessions']`、`lost-event` inject `['ourfairyChat']`、`frame-gap` 无 `inject`；三者都在各自测试里加载，名称与 chat / sessions 今天挂载的服务名一致。 |
| Duplication 10 | `/chat/read` 的观察窗口写成「本连接」 | `backend/chat/README.md` 改为「一次读取或一条 SSE 观察的窗口」。 |
| Duplication 11 | `next`/`earliest` 在传输侧与运行时侧重复 | 保留传输侧句子；运行时侧改为「偏移与输出环位置由原生注册表给出」。 |
| Wording 12 | `llm` 行「缺席应在组合期失败」夸大 cordis 行为 | `backend/chat/README.md` 的 `llm` 行与 `work/tickets/133/README.md` 的对应决定改为「未满足 inject 的行保持 pending」；发布票面工作副本 `work/tickets/133/01-inject-alignment.md` 保持原文。 |
| Wording 13 | 分析记录的升级复核归属与 README 不一致 | `work/tickets/133/README.md` 把 `chat-cold-boundary` 标为「跨两侧（运行时语义为主；含 HTTP 观察）」、`jobs` 标为「跨两侧（传输契约为主；含折叠观察）」；「确实跨两侧的测试写『跨两侧（哪一半为主）』」规则句保留。`backend/chat/README.md` 的表未动。 |
| Duplication 14 | `spillStore` 行与运行时段重复完整理由 | `backend/chat/README.md` 的 `spillStore` 行缩短为「缺席是受支持的降级，理由见读取处注释」。 |
| Judgement 15 | 证据 README 重复「收口提交未使用 `--no-verify`」并带 git 参数声称 | `work/implementation/evidence/133-inject-truth/README.md` 删除两处该句及相关推断，只保留门禁结果和 pre-commit 钩子重跑的事实。 |
| Judgement 16 | 已接受的准确性修正可能被误改 | 未改：`docs/decisions/native-capability-dependencies.md` 指针同步、README 的 `settled`→`transitions`/任务 id 组成/删除「唯一」、`4e3e11d` 分析更正。见下节。 |
| Evidence 17 | 缺少本次修复的证据 | 本文件；记录映射、接受项、命令与范围。 |

## 审查中已接受、本次不动的准确性修正

以下在审查中作为准确性修正被接受，不属于「无依据断言」：

- `docs/decisions/native-capability-dependencies.md` 的 `"后台任务"` → `"后台任务折叠"` 指针同步；
  链接目标未变。
- `backend/chat/README.md` 的事实更正：transcript 行 `settled` → `transitions`；任务 id 由注册表
  generation 与原生 job id 组成；activity 删除无检查支撑的「唯一」。
- `4e3e11d` 对分析记录中 `tools` 传递声明的更正：由 `agentLoop` 的 `AgentLoop.inject` 声明，
  不是 `agents`。

## 命令与结果

全部在 `/home/eafen405/projects/OurFairy/.worktrees/133-review-fixes` 执行，基线 HEAD `f40719e`。

```bash
$ node --test tests/docs.test.mjs
✔ every relative link in the repository Markdown resolves
ℹ tests 1 / pass 1 / fail 0
```

```bash
$ node --test tests/projection-units.test.mjs tests/projection-fold.test.mjs
ℹ tests 17 / pass 17 / fail 0
```

```bash
$ node scripts/combo.mjs verify
row             branch                   expected          actual            result
--------------  -----------------------  ----------------  ----------------  ---------------------------------------------
ourfairy        integration/ourfairy-v1  based on integra  f40719ee403b0d5a  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  product/ourfairy-v1      460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

```bash
$ npm test
ℹ tests 234 / pass 234 / fail 0
```

提交时 `.githooks/pre-commit` 再次执行 `npm test` 与 `npm run combo:verify`；提交成功即这两道
门禁在该提交上通过（钩子 `set -eu`）。

## 范围与公开服务面

- 改动文件：`backend/chat/README.md`、`backend/chat/src/index.mjs`（仅注释）、
  `backend/chat/src/spill-read.mjs`（仅注释）、`work/tickets/133/README.md`、
  `work/implementation/evidence/133-inject-truth/01-inject.md`、
  `work/implementation/evidence/133-inject-truth/README.md`、本文件。
- 未改 `runtime.mjs`、`service.mjs`、`jobs.mjs`、`units.mjs`、`runtime-facade.mjs`、测试、夹具、
  `package.json` 或 `combo.json`；`ourfairyChat` / `ourfairyChatRuntime` 的导出、方法集与 HTTP
  路由不变，gateway 对 `ourfairyChat` 的依赖不变。
