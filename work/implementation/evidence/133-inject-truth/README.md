# 133-inject-truth — spec #133 证据索引

父票：[#133 chat 的 inject 与实际依赖对齐：删残留、显式化隐性依赖](https://github.com/eafen405/OurFairy/issues/133)。
子票 [#151](https://github.com/eafen405/OurFairy/issues/151)（inject 对齐）、
[#152](https://github.com/eafen405/OurFairy/issues/152)（README 契约分节）、
[#153](https://github.com/eafen405/OurFairy/issues/153)（收口）。

- 集成分支：`integration/spec-133`，基线 `integration/ourfairy-v1` @ `fc5ea92`（merge-base）。
- 收口前 tip：`4e3e11d`（含 #151、#152 与票面发布/更正的集成分支 tip）。
- 固定组合：dsh `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`（`product/ourfairy-v1`），
  Android 来源 `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`；本 spec 未改 `combo.json`。
- 分析记录与票面工作副本：`work/tickets/133/README.md` 及同目录三张子票。
- 本 spec 不拆包、不移动 `test-support` 夹具、不改 `runtime-facade` 的公开方法集、不改 gateway
  对 `ourfairyChat` 的依赖。

## 本 spec 改了什么

| 票 | 提交 | 改动 | 证据 |
| --- | --- | --- | --- |
| 票面发布 | `a649a59` | 发布 spec 133 与三张子票的本地工作副本 | `work/tickets/133/` |
| #151 | `86b68b5` | `inject` 删 `identity`/`tools`、加 `llm`；`agentLoop` 原位保留并注释排序用途；`runtime.mjs` 唯一调用点改为已声明服务访问；`spill-read.mjs` 注释动态读取与缺席降级 | [01-inject.md](01-inject.md) |
| 合并 | `a036fb8` | `ticket/151-inject` 合入 `integration/spec-133` | — |
| #152 | `eb9d2aa` | `backend/chat/README.md` 分为「传输契约 / 运行时语义」；`docs/decisions/native-capability-dependencies.md` 一行引用同步 | [02-readme.md](02-readme.md) |
| 合并 | `d628f69` | `ticket/152-readme` 合入 `integration/spec-133` | — |
| 分析更正 | `4e3e11d` | 更正分析记录中 `tools` 的传递声明（由 `agentLoop` 而非 `agents` 声明） | `work/tickets/133/README.md` |
| #153 | 本收口提交 | 夹具归属、合并树全量门禁、改动范围与公开服务面记录、证据索引 | 本文件 |

#151 与 #152 的实现细节、逐项审计与各自的命令记录见两份子证据，本文件不重复。

## 全量门禁（#151/#152 合并后的树）

在 `/home/eafen405/projects/OurFairy/.worktrees/153-closeout` 执行；HEAD 为 `4e3e11d`，工作树
只含本收口提交的文档改动。`.githooks/pre-commit` 会在提交时再次执行下面两条命令。

```bash
$ npm test
ℹ tests 234
ℹ suites 7
ℹ pass 234
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 128415.240564
```

```bash
$ npm run combo:verify
row             branch                   expected          actual            result
--------------  -----------------------  ----------------  ----------------  ---------------------------------------------
ourfairy        integration/ourfairy-v1  based on integra  4e3e11d1edc290f1  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  product/ourfairy-v1      460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

本 spec 的两张子票都按票面要求把全量门禁延后到 #153：它们各自的证据只记录票级行为套件，
最终 `npm test` 与 `combo:verify` 以本次合并树为准。

`.githooks/pre-commit` 在每次收口提交时又执行了这两条命令，均为 `tests 234 / pass 234 /
fail 0` 与 `combo: combination verified`。

## 改动范围核对

```bash
$ git diff --stat integration/ourfairy-v1...HEAD    # 收口提交前，HEAD = 4e3e11d
 backend/chat/README.md                             | 267 +++++++++++++++------
 backend/chat/src/index.mjs                         |  12 +-
 backend/chat/src/runtime.mjs                       |   2 +-
 backend/chat/src/spill-read.mjs                    |   8 +
 docs/decisions/native-capability-dependencies.md   |   2 +-
 .../evidence/133-inject-truth/01-inject.md         | 174 ++++++++++++++
 .../evidence/133-inject-truth/02-readme.md         | 161 +++++++++++++
 work/tickets/133/01-inject-alignment.md            |  32 +++
 work/tickets/133/02-readme-contracts.md            |  34 +++
 work/tickets/133/03-closeout.md                    |  30 +++
 work/tickets/133/README.md                         | 123 ++++++++++
 work/tickets/133/published.json                    |   9 +
 12 files changed, 778 insertions(+), 76 deletions(-)
```

收口提交另加两个文档文件，路径仍在本 spec 的声明范围内：

- `work/implementation/evidence/133-inject-truth/README.md`（本文件）
- `work/implementation/evidence/README.md`（索引新增「inject 对齐（规格 #133）」小节）

因此合入后的完整三点 diff 是上面 12 个文件加这两个文件，共 14 个；除此之外没有新增或修改
路径。`git diff --stat integration/ourfairy-v1...HEAD` 是复核命令，重放时以当时的提交为准。

以下文件在该三点 diff 中为空（未改）：

```bash
$ git diff --stat integration/ourfairy-v1...HEAD -- \
    backend/chat/src/service.mjs backend/chat/src/jobs.mjs backend/chat/src/units.mjs \
    backend/chat/src/runtime-facade.mjs backend/chat/package.json combo.json \
    backend/chat/test-support/
# 无输出
```

## 公开服务面未变

```bash
$ git diff integration/ourfairy-v1...HEAD -- \
    backend/chat/src/runtime-facade.mjs backend/chat/src/service.mjs
# 无输出（0 字节）
```

`runtime-facade.mjs` 未改，`ourfairyChat` / `ourfairyChatRuntime` 的导出与方法集因此不变；
`service.mjs` 未改，HTTP 路由与信封不变；`backend/gateway` 也不在改动面内，gateway 对
`ourfairyChat` 的依赖未动。

证明这一点的既有套件（均在上述 `npm test` 的 234 项内）：

| 套件 | 证明的接缝 |
| --- | --- |
| `tests/gateway.test.mjs` | gateway 经公开 chat 服务发起的请求、图片能力检查跟随下一回合选择 |
| `tests/delivery-row.test.mjs` | 投递行经 chat 的跨用户投递与恢复 |
| `tests/text-delivery.test.mjs` | 文字投递的单次送达与故障出口 |
| `tests/file-delivery.test.mjs` | 文件投递的准备、收件附件资格与故障出口 |

单独复跑这四个套件（同一棵树）：

```bash
$ node --test tests/gateway.test.mjs tests/delivery-row.test.mjs \
    tests/text-delivery.test.mjs tests/file-delivery.test.mjs
ℹ tests 24
ℹ pass 24
ℹ fail 0
ℹ duration_ms 89749.665523
```

## `test-support` 夹具归属（本次不移动）

三个夹具仍留在 `backend/chat/test-support/`，**本 spec 不移动它们**；这里只记录主人与故障点，
供后续按主人迁移时使用。

| 夹具 | 主人 | 故障点 | 当前使用处 | 服务名核对 | 本次是否移动 |
| --- | --- | --- | --- | --- | --- |
| `fail-outlets.mjs` | 投递行 | `delivery/message` 的 durability 检查点与通知出口 | `tests/text-delivery.test.mjs`、`tests/file-delivery.test.mjs` | `inject = ['ourfairyChat','sessions']`；与 chat、sessions 今天挂载的服务名一致 | 否 |
| `frame-gap.mjs` | 运行时一侧 | Assistant 帧边界（丢帧/乱序帧的形状） | `tests/reconnect.test.mjs` | 无 `inject` | 否 |
| `lost-event.mjs` | 运行时一侧 | Session 事件读取边界（读到的列表缺一个已提交 seq） | `tests/reconnect.test.mjs` | `inject = ['ourfairyChat']`；与 chat 今天挂载的服务名一致 | 否 |

三个夹具都在各自测试里实际加载；服务名与 chat / sessions 当前挂载的名称一致。

夹具只由测试从 worktree 加载，不进入安装后的 profile；`tests/product-sources.test.mjs` 的
「the hashed set follows what the packages publish, not their test fixtures」断言
doctor 的文件集合里没有任何 `/test-support/` 路径。

## 范围外发现（未修）

- `backend/chat/package.json` 仍声明 peer `@deepseek-ai/dsh-tools`，但 `backend/chat/src/`
  没有任何该包的 import（源码 import 集合里只有 `dsh-agent`、`dsh-jobs`、`dsh-llm`、
  `dsh-session`、`dsh-spill-local`、`cordis`、`zod` 与 `@ourfairy/*`）。这属于 #136
  「产品包清单真实性」的 peer 一致性范围，本 spec 不顺手修改。
- 未拆 chat 为运行时包与传输包；未移动上述夹具；未改 `runtime-facade` 的暴露方法；未改
  gateway 对 `ourfairyChat` 的依赖。这些都是 spec 的显式决定，不是遗留缺陷。

## 未完成项

- **夹具未迁移**：归属已记录，实际移动留给后续票；本 spec 明确「本次不移动」。
- **未新增 `inject` 字面量断言**：spec Testing Decisions 明确禁止断言数组字面量；验证接缝是
  真实启动器加产品 HTTP/SSE 端点，即上面的行为套件。
- **未拆包**：按 spec 决定保持单包。
- **peer 清理未做**：`@deepseek-ai/dsh-tools` 归 #136。
- 本收口提交只改文档；集成分支合入后的门禁继承本次在等价树上的结果（合并后只多这些文档）。
