# #219/#220/#221 集成收口

日期：2026-10-25。集成分支 `integration/fixes-219-221`，worktree
`.worktrees/integration-219-221`。被测代码 tip 为 `2cc857a9a1`（收口修复提交）；本目录与证据索引
随后由只改文档的提交加入，并推送到 `origin/integration/fixes-219-221`。开工时分支 tip 为
`7cd5597d1b`（三票合并与索引登记后的状态）。

## 三票范围

| 票 | 本分支交付的行为 | 证据 |
| --- | --- | --- |
| [#219 代理人互见](https://github.com/eafen405/OurFairy/issues/219) | 只读 `POST /identity/agents`，仅返回用户编号与用户名；客户端设置页以折叠组展示同行代理人（含自己）。收口把该响应类型更名为 `AgentSummary`，语义仍是「编号 + 名字的名册摘要」。 | [219-agent-list](../219-agent-list/README.md) |
| [#220 空会话唯一](https://github.com/eafen405/OurFairy/issues/220) | `/sessions/create` 复用空会话：primary 为空则返回 primary，否则返回 `createdAt` 最新的空 ordinary，都没有才新建；`hasMessages` 是「空」的唯一判定。客户端生产代码零改动；收口补页面层用例。 | [220-empty-session](../220-empty-session/README.md) |
| [#221 动态内容边界](https://github.com/eafen405/OurFairy/issues/221) | 眼屏展开时内容上边界增加 `FairyScreenOpenHeight`（176dp）并同步收起；`screenOpen` 单一来源。收口把 350ms 收为共享常量、加 overlay 测试接缝与逐帧过渡断言。 | [221-content-boundary](../221-content-boundary/README.md) |

收口没有改这三票的产品行为与范围，没有改 `combo.json`（dsh pin 仍 `d1b6099ae716`，android source
仍 `460109d1b89b`），也没有动 #219/#220 的既有语义。

## 两轴 review 结论与逐项处理

范围是 `7cd5597d1b` 之后的收口增量。Standards 轴依据 [`AGENTS.md`](../../../../AGENTS.md) 与
[`CODING_STANDARDS.md`](../../../../CODING_STANDARDS.md)；Spec 轴依据本地票面副本
（[219](../../../tickets/219-agent-list.md)、[220](../../../tickets/220-empty-session.md)、
[221](../../../tickets/221-content-boundary.md)）与父规格
[`docs/specs/ourfairy-v1.md`](../../../../docs/specs/ourfairy-v1.md)。

| 编号 | 轴 | 发现 | 处理 | 落点 |
| --- | --- | --- | --- | --- |
| A1 | Standards | 350ms 在顶栏和内容 inset 各写一份；几何常量全部公开，只有本文件使用的也在其中 | 收为 `internal const val FAIRY_SCREEN_TRANSITION_MS = 350`，顶栏 `windowSpec`/`fadeSpec` 与 `animateDpAsState` 共用；三个仅本文件使用的几何常量收窄为 `private`，`FairyWindowBarHeight`、`FairyScreenOpenHeight` 保持 `internal` | `FairyWindowBar.kt`、`FairyConversationPage.kt` |
| A2 | Spec | 「无遮挡」只有 176dp 位移断言，没有对眼屏真实下界的断言，也没有过渡期覆盖 | 展开眼屏块加 `Modifier.testTag("fairy-screen-overlay")`；思考中与空会话用例改用 `overlay.boundsInRoot.bottom` 断言第一条消息/空提示的 top；新增允许空间动效下的逐帧过渡用例 | `FairyWindowBar.kt`、`FairyPagesTest.kt` |
| A3 | Spec | 测试用 176dp/236dp 字面量推算边界，与 `FairyScreenOpenHeight` 可能漂移 | 位移断言改读 `FairyScreenOpenHeight.value`；下界直接读 overlay 真实边界，不再自己加常量 | `FairyPagesTest.kt` |
| B | Standards | `AgentPresence` 名不副实：接口只返回编号与名字，是名册摘要而非在线状态 | 后端类型、客户端模型、`IdentityBackend.agents`、`IdentityEnvelope.agents`、全部测试假实现与 #219 证据统一更名为 `AgentSummary` | `backend/identity/src/store.ts`、`IdentityApi.kt`、测试与 219 证据 |
| C1 | Standards | #219 证据仍写「本目录尚未登记进索引表」，而 `7cd5597d1b` 已登记 | 删除该条；全量门禁的去向改为指向本目录 | [219-agent-list](../219-agent-list/README.md) |
| C2 | Spec | #221 证据给 `GatewayPage` 写了没有测试守着的「不传时行为不变」，并把已实现的过渡断言写成「中间帧一致性未自动化」 | 改为事实陈述（仍走可选参数默认值；本票未为它加页面测试）；补 overlay 接缝、`FairyScreenOpenHeight` 与逐帧用例的说明，把中间帧改成实际做到的程度 | [221-content-boundary](../221-content-boundary/README.md) |
| C3 | Standards | 收口缺证据目录与索引登记 | 新增本目录与 `index/18-closeout-219-221.json`，用 `node scripts/evidence-index.ts` 生成索引表 | 本目录、`evidence/README.md` |
| C4 | Standards | #220 证据未说明两处 `--no-verify` 已在收口补跑 | 补一句并指向本目录 | [220-empty-session](../220-empty-session/README.md) |
| D | Spec | #220 缺页面级用例：假后端 `create` 固定返回新 id，没有覆盖「新建会话返回已存在空会话」 | 假后端 `create` 改为可配置；新增页面用例：从抽屉点「新建会话」，断言 `selectedId` 为已存在的 `other`、会话数不增、primary 仍为 `main`、页面目标进入 `other`、抽屉内该会话只有一行 | `FairyPagesTest.kt` |

结论：Spec 轴的 A2/A3/D 是「页面行为没有可执行断言」，Standards 轴的 A1/B/C1/C3/C4 是复用、命名
与证据准确性问题；以上均已在所属模块修正，没有在集成分支之外打补丁，也没有遗留未修项。

## 收口门禁实测

以下命令都在本 worktree 的代码 tip `2cc857a9a1` 上执行。

```sh
$ npm run clean && npm run build
# 两条命令 exit 0；build 为 node scripts/tsc.ts --fresh

$ npm test
ℹ tests 311
ℹ suites 7
ℹ pass 311
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 100039.187676

$ cd android
$ ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --rerun-tasks
# BUILD SUCCESSFUL in 3m 9s（137 tasks executed）
# JUnit XML 合计：37 个套件 / 227 tests / 0 failures / 0 errors / 0 skipped
# :app:lintDebug 与 :app:assembleDebug 均成功，debug APK 完成打包

$ npm run combo:verify
ourfairy        main                 based on main     2cc857a9a1a36f99  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1  d1b6099ae716870a  d1b6099ae716870a  ok
android source  -                    460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified

$ npm run backend:doctor
# 12 项 ok：isolated home、node version、corepack pnpm pin、combo combination、dsh CLI build、
# product build、product packages、profile project linked、bundle packages、plugin compatibility、
# native capabilities、model double
doctor: all checks passed

$ OURFAIRY_PORT=18080 npm run backend:probe
ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)
```

probe 用 `OURFAIRY_PORT=18080` 而不是默认的 3080：本机上 3080 已被正在运行的 DSH Web GUI 占用，
而 bundle 的 webserver 行按该环境变量选端口。探针仍在同一个隔离 `OURFAIRY_HOME` 上启动真实后端，
未改服务代码或配置。

## 已知边界与未执行项

- **#220 的 create 读取成本（已知边界，未优化）**：`create()` 在 per-owner 的 `_exclusively` 内先读
  primary 的会话事件判断是否为空；primary 有内容时再从 `list()` 末尾向前逐个读取 ordinary 会话事件，
  直到找到空的那个。因此每次 create 至少多一次会话日志读取，最坏与普通会话数成正比。本收口没有加
  缓存或「空会话索引」：那会让「空」出现第二份权威，且票面未要求。
- **未连接 Android 物理设备**：没有真机验收。Android 结论仅来自 Robolectric/JVM 测试、`lintDebug`
  与 `assembleDebug`；「构建成功」不等于真机运行验收。
- **未调用真实模型或云服务**：doctor 的 `model double` 为 `not configured (keyless startup only)`；
  probe 只验证组合启动与 24 个服务、51 行组合，不验证真实模型回复。
- 两处收口提交（代码修复与本文档/索引）都走 pre-commit 门禁，没有使用 `--no-verify`；
  `evidence/README.md` 的索引表由 `node scripts/evidence-index.ts` 从 `index/*.json` 生成，
  `node scripts/evidence-index.ts --check` 通过。
