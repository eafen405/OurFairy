# 03-absence-attribution — 票 #160 证据

> 父票 [#134](https://github.com/eafen405/OurFairy/issues/134)；票面
> [`work/tickets/134/03-absence-attribution.md`](../../../tickets/134/03-absence-attribution.md)；
> 分析记录 [`docs/research/dsh-bundle-group-composition.md`](../../../../docs/research/dsh-bundle-group-composition.md) §3、§4。
> 分支 `ticket/160-absence-attribution`，基线 `integration/spec-134` 的 `cf81810`。
> 本票只改缺席名单的组织方式与注释，不增删 bundle 行、不改挂载状态、不碰
> `backend/v1-bundle/cordis.patch.yml`（#161 的范围），也不为 README 新增对账检查。

## 改了什么

1. `tests/baseline-boot.test.mjs` 的 `FORBIDDEN_ROW_IDS` 按性质分成四段，每段一行理由注释；
   新增 `session-title`、`session-title-llm`、`user-questions` 三个 id，总数 34 → 37。
   原有 34 个 id 一个不少、一个不改（逐项比对见下方命令 3）。理由写在名单旁的注释里，
   名单仍是缺席期望的唯一权威。
2. `backend/v1-bundle/README.md` 的「Absent rows」删掉手写归类散文（它把 `tool-fs-search`
   归进「被 scoped 适配器替换的原生默认」，是错的），保留指向 `FORBIDDEN_ROW_IDS` 的指针。

不新增检查，不新增第二份缺席清单。

## 四段归属

| 段（注释原文） | id 数 | id |
| --- | --- | --- |
| Deferred: the product needs these, but has not adapted them yet | 2 | `session-title`、`session-title-llm` |
| Conflicts with the scoped filesystem | 1 | `tool-fs-search` |
| Hard exclusion (Remote seam) | 1 | `user-questions` |
| Product decision: not wanted, or replaced by the scoped adapters | 33 | `fs-sandbox`、`working-directory`、`bash-sandbox`、`pwsh-sandbox`、`tool-pwsh`、`sandbox`、`approval`、`permission`、`skill`、`skill-filesystem`、`tool-skill`、`goal`、`goal-round-driver`、`tool-goal`、`command-goal`、`subagent`、`subagent-spawn-in-process`、`subagent-fork-in-process`、`tool-subagent`、`tool-subagent-control`、`tool-subagent-list-agents`、`tool-subagent-fork`、`otel`、`session-telemetry-otel`、`web`、`web-search-deepseek`、`web-fetch-http`、`tool-web`、`mcp-resources`、`plan-mode`、`workflow-ptc`、`tool-workflow`、`ptc-runtime` |
| **合计** | **37** | |

理由按票面要求写「缺什么」：`session-title` 写产品的会话投影没有标题字段、客户端没有消费
`title` 投影单元的位置；`session-title-llm` 写它在 `session-title` 落地前没有注册目标、
辅助请求要落到产品的 `llm-pi-ai` 路由；`tool-fs-search` 写 ripgrep 二进制不在产品的 bwrap
命名空间内、返回路径以全局 cwd 为基准而 scoped 根按归属派生；`user-questions` 写它唯一的
出厂应答路径是 Typert/Remote 方法、产品刻意不接这条接缝。

## 执行过的命令与结果

在 `cf81810` 之上（工作区含本票改动），worktree 根目录：

1. `node --test tests/baseline-boot.test.mjs` — **6 pass / 0 fail**（约 15 s）。
   两个缺席相关用例 `real profile boot reports every required service live (keyless)`
   与 `v1 profile mounts scoped file/shell adapters and excludes unused capabilities`
   原样通过（断言体未改）。
2. `node --test tests/docs.test.mjs` — **1 pass / 0 fail**。
3. `node --test tests/ecosystem-boundary.test.mjs` — **8 pass / 0 fail**。
4. `npm test` — **234 pass / 0 fail**（约 126 s，7 suites）。
5. `npm run combo:verify` — 三行 ok：`ourfairy ok (worktree is based on the integration tip)`、
   `dsh ok`、`android source ok (declaration matches)`，末行 `combo: combination verified`。
6. `git merge integration/spec-134` — `Already up to date.`（分支已含 `cf81810`）。

## 名单敏感性（红）

「缺席断言仍对名单敏感」不能只靠它今天通过。用一次临时改动验证：把实际挂载的行
`sessions` 临时加入名单后跑单条用例

```sh
node --test --test-name-pattern="excludes unused capabilities" tests/baseline-boot.test.mjs
```

结果 **0 pass / 1 fail**，失败信息点名该行：

```text
AssertionError [ERR_ASSERTION]: forbidden row(s) mounted in the v1 profile: sessions; mounted rows were ["include","agent","session",…,"groups","ourfairy-baseline-probe"]
```

同一份 report 的 rows 里也没有 `session-title`、`session-title-llm`、`user-questions`，
即新增的三个 id 在当前组合里确实缺席。临时改动已还原，未入库。

## 新增 id 的缺席事实

三个 id 在 `backend/v1-bundle/cordis.patch.yml` 中不出现（`grep` 无命中），因此加入名单
不改变任何行的挂载状态；probe 报告的 rows 是运行时事实，测试只对名单求交集。

## 未完成项与边界

- 本票只在本 worktree 提交，未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。
- 未编辑 `work/implementation/evidence/README.md`（索引条目由收口票 #162 拥有）。
- 理由文字本身是判断，不是可执行检查：本票按父规格刻意**不**新增 README 对账检查。
  失效时的检查是 `node --test tests/baseline-boot.test.mjs`——某个 id 一旦被挂载，
  第二个用例会点名它；理由是否仍然成立仍属评审问题。
