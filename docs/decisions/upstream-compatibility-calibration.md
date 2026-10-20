# 上游兼容与模型接入：设计校准

2026-10-18，方向确认完成。本文保留用户取舍、调查依据及后续验证项。产品行为已纳入[父规格](../specs/ourfairy-v1.md)，对应的网关与集成票面已修订。

2026-10-20 拓扑说明：客户端已并入本仓库 `android/`，产品组合只剩本仓库与 dsh 的锁定提交；本文以下章节记录的是并入之前「三个仓库」时期的调查与结果，按原样保留。

## 方向与推进顺序

保留现有产品模块及已验证的投递实现，按 [ADR-0001](../adr/0001-upstream-extension-policy.md) 评估具体上游升级的成本。现有证据支持在认证连接和任务事件上复用新版能力；自定义供应商与模型沿 dsh 原生适配器、配置和凭据接缝实现。

建议先以固定的 `0.2.1-rc.2` 验证有限的认证、任务及旧日志兼容适配，验证通过后更新实际版本组合；再实施[法厄同配置网关](../../work/tickets/ourfairy-v1/20-gateway.md)，随后执行[整体验收](../../work/tickets/ourfairy-v1/21-integration.md)和[真机验收](../../work/tickets/ourfairy-v1/22-device.md)。本次只有文档修订与调查，实际升级、网关代码和真实服务验收均待执行。

## 用户已确认

- 上游优先级、允许必要的小型通用补丁，以及接缝与公共调度器的成本约束，已记录为 [ADR-0001](../adr/0001-upstream-extension-policy.md)。
- 权限隔离、数据可靠性等必要保障保留；其他原规格行为若有具体证据表明显著增加长期维护成本，可以重新讨论。
- MiniMax 作为后端共用模型选项，由法厄同切换。用户持有官方订阅，认为购买于国内站；具体套餐及该账号的接口可用性尚未核实。
- 自定义供应商与模型复用 dsh 的 `@deepseek-ai/dsh-llm-pi-ai`。配置网关沿用 [术语表](../../GLOSSARY.md) 的定义，指法厄同的对话及系统配置入口；代理人使用对话入口。用户采纳推荐范围：法厄同管理共用供应商、模型及现有 ASR 连接配置，插件安装、启停和装配由部署维护。
- 共用模型切换对所有会话生效：每个会话从下一轮回复开始使用新模型，正在执行的回复继续用原模型完成。实现需覆盖一轮回复中的多次模型请求及工具调用。
- 投递语义：Fairy 在来源会话完成模型调用，经工具把结果送到接收会话；接收会话执行保存、渲染和通知这一输出操作，不因投递启动新的模型调用。后续用户回复时，投递内容属于既有会话历史。

## 已查源码事实

调查采用 [combo.json](../../combo.json) 当时锁定的 dsh 产品提交 `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`，对照研究上游 `d743267388641bc76f17c45ce8b4c231aed1d32c`；OurFairy 为 `902bc11a0f12fe936bde430b1b11ba06719b0d06`。本节为静态源码调查，实际运行证据见下文。

- 身份、邀请、授权、空间规则及投递协调已经主要在 OurFairy 中实现。源码入口：[身份](../../backend/identity/src/index.mjs)、[会话](../../backend/sessions/src/service.mjs)、[空间](../../backend/spaces/src/index.mjs)、[投递](../../backend/delivery/src/index.mjs)。
- dsh fork 的改动涉及会话归属 header、正式投递消息、第二凭据接入、任务持久事实和中文子串搜索。正式投递扩大了 assistant 消息来源类型，涉及模型回放、查询及导出等消费者。依据：[消息来源类型](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/llm/llm/src/message.ts)、[会话表面](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/core/session/src/surface.ts)、[凭据接入](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/client/connection/src/rpc-host.ts)、[任务完成接线](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/jobs/tool-jobs/src/index.ts)。
- 上游会话表面使用有限事件集合，自定义事件能否被保存与能否进入模型历史是不同能力。依据：[原上游表面投影](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/surface.ts)、[事件兼容规则](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/known-event-types.ts)。外置方案需要分别验证持久化、授权、模型历史和恢复。
- 产品使用显式 [bundle](../../backend/v1-bundle/cordis.patch.yml)。维护成本也包含随上游核对装配和配置联动，不能仅以 Git 补丁数量衡量。

## 上游版本与模型接入事实

- 本次查询的官方最新发行版为 [0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)，发布于 2026-10-17，提交为 `687f282e8625c6b8d11ff58211a90524be2e4317`；当前产品基于 `0.2.1-alpha.2`。在 [rc.1 到 rc.2](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.1...dsh-v0.2.1-rc.2) 的比较中，Flash 1017 相关最终变更是客户端标识，LLM 适配器没有净变化。这个较窄区间的事实不代表 alpha.2 到 rc.2 的整体升级已验证。
- 当前 [llm-pi-ai](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/llm/llm-pi-ai/README.md) 的 `providers` 配置支持自定义路由、协议、端点、凭据引用及模型清单，支持原生 settings 更新；存在接入 MiniMax 的原生接缝。具体管理入口应优先复用这些配置定义及凭据机制。
- 国内官方 [M Plan 接入说明](https://platform.minimaxi.com/docs/m-plan/other-tools.md) 使用订阅 Key、`MiniMax-M3.1-Flash-Preview` 和 `https://api.minimax.cn/anthropic`。当前本地 pi-ai 目录的中国默认端点和模型清单较旧，具体接线须按实际套餐核对。[FAQ](https://platform.minimaxi.com/docs/m-plan/faq.md) 区分订阅 Key 与按量 Key，并将 M Plan 定位为个人交互；本次未核实用户账号的套餐权益与多人后端共用适用性。
- [MiniMax 官方 Anthropic 接口说明](https://platform.minimaxi.com/docs/api-reference/text-anthropic-api.md) 列出 M3.1/M3 的图像与工具能力，不能把旧 M2 的仅文本能力当作整个供应商的限制。实际图片工具结果与扫描 PDF 链路仍需联调。
- 原生 [selectModel](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/api/session-controller/src/commands.ts) 支持既有会话的模型选择。修改共用默认配置与切换所有旧会话是不同操作；按本轮已定规则衔接既有会话的具体接缝仍需核对。

以上为源码与官方文档核对，未进行真实模型调用。接入现成 provider 是值得先验证的路径。

### 已定切换行为的实现依据

固定产品提交与官方 rc.2 的核心选模及 turn 循环契约一致。原生 `selectModel` 的选择按后续 step 生效；一轮回复在工具调用后还可能继续请求模型，因此直接调用该命令可能在本轮中途切换。原生 [`installModelSelection`](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/core/agent/src/model-selection.ts#L78) 与 [`turn/start` 生命周期](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/core/agent-loop/src/agent.ts#L299) 提供了产品侧接线的候选：每轮开始读取共用选择，在该轮内保持固定。原生 turn 包含多个模型 step 和工具调用；`running` 状态可连续覆盖多个 turn，等待整个 Agent idle 会推迟切换。

当前产品在 [resume](../../backend/chat/src/runtime.mjs) 时取得共用默认值，尚未实现每轮跟随共用选择。后续应以“首请求 → 工具暂停 → 修改共用选择 → 同轮续请求 → 下一轮”验证既定行为，并覆盖既有及冷恢复会话。附件能力检查也需与实际执行选择相符。这些是待实施验证的接线建议，本轮未修改运行时代码。

### 配置权威与在途回复

原生 [settings](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/settings/settings/src/index.ts) 通过 configEditor 保存 profile；[agent-default-model](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/core/agent-default-model/src/index.ts) 提供共用选择的读取与保存；[credentials](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/credentials/credentials/src/index.ts) 及 credentials-local 保存后端凭据。产品可在法厄同授权后调用这些同进程服务，并限定字段、命名空间及凭据引用，配置管理无需直接开放完整 owner `/api`。实施须检查真实装配含配置编辑能力。

轮次内固定 provider/model 名称只解决共用选择切换。`llm-pi-ai` 在每次请求准备时读取路由配置，端点、协议或模型定义在工具续步前被修改，仍会影响原回复。因此采用最小的在用限制：会影响在途回复所用路由的修改、删除或重载明确提示稍后重试；配置操作与新回复开始的竞争由对应生命周期内协调。凭据及配置失败反馈、插件重载影响仍需通过网关票验证。

`providers` 在 [配置定义](https://github.com/eafen405/deepseek-harness/blob/fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee/packages/llm/llm-pi-ai/src/config.ts) 中声明为 volatile。正常 settings 修改可热更新，同一 adapter 原子替换路由集合，单独修改未使用的路由不会先卸载其他路由。整插件重载、上下文或装配变化则覆盖全部路由；覆盖整个字典时被省略的路由也须计入影响范围。

本轮没有业务数据库结构改动方案；配置沿用原生持久化。父规格中主会话定位也已按 [现有实现](../../backend/sessions/src/service.mjs) 校正为用户编号确定标识、原生日志核对归属。

## 投递验证与上游合并演练

2026-10-18 执行 `node --test tests/text-delivery.test.mjs`，**6/6 通过**。测试使用真实产品装配和本地模型替身，覆盖冷会话投递、生成中投递、后续模型历史、重启及幂等恢复、并发投递、持久化失败和通知出口失败。冷会话及生成中投递均断言模型请求只来自发送会话。首次运行因沙箱禁止本机端口监听而未完成；允许回环监听后原命令通过。源码与断言见 [delivery/src/index.mjs](../../backend/delivery/src/index.mjs) 和 [text-delivery.test.mjs](../../tests/text-delivery.test.mjs)。

在 `/tmp/ourfairy-dsh-upgrade-probe.git` 的隔离 bare 仓库内执行：

```sh
git merge-tree --write-tree --messages \
  fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee \
  687f282e8625c6b8d11ff58211a90524be2e4317
```

双方共同基线为 `d743267388641bc76f17c45ce8b4c231aed1d32c`。输出包含 **15 个冲突路径**：

| 类别 | 路径及含义 |
| --- | --- |
| Connection：4 个 | `packages/client/connection/src/{index,rpc-host,rpc}.ts`、`tsconfig.host.json`；上游 Peer/API 连接调整与产品第二凭据接入相遇 |
| Session 事件清单：1 个 | `packages/core/session/src/known-event-types.ts`；产品 `jobs/lifecycle`、`jobs/report` 与上游 `job/registered`、`job/settled` 在同位置新增 |
| 文档与生成物：10 个 | persistence catalog、历史格式目录、schema、web-server 文档及生成的 api-catalog |

投递相关的消息来源、会话表面、模型回放及持久化实现没有产生文本冲突。消费者适配中也存在很小的变更，例如用量统计识别非模型来源、导出附件识别投递事件；不能由涉及文件数直接推断维护成本过高。现有证据支持保留投递实现，优先调查实际发生冲突的 Connection 接缝。

本次未在产品仓库落地合并，未编译或运行合并后的版本。合并演练只提供文本冲突证据；当前组合的投递测试通过不代表升级组合运行兼容。

### Connection 冲突的进一步核对

官方 rc.2 已提供 [`createPeer`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/peer.ts) 及可扩展 principal 类型，Peer 自带 scope、signal 与 dispose，HTTP/RPC 传递 Peer、Gateway 随 Peer 结束流的接线也已进入上游。产品原有的独立 PrincipalPeer 和身份反查存在复用新版接口的空间。

不过 [`admit`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/rpc-host.ts#L129) 仍只接受原生浏览器/API cookie；创建 Peer 不等于产品 Bearer 凭据通过网络准入。新版 exact `/api` Fetch 路径还要求 owner 身份，产品普通用户不能映射成 owner。

当前 [chat](../../backend/chat/src/index.mjs) 与 [sessions](../../backend/sessions/src/http.mjs) 直接注册产品 HTTP 路径，独立认证并复用 `connection.fence`。下一步应结合网关实际管理范围，明确哪些操作需要原生 `/api`，再确定最小准入补丁；新版已经提供的 Peer 生命周期应优先复用。以上是静态核对结论，尚未实现或验证补丁收缩。

### 任务事件复用

官方 rc.2 的 [`job/registered`、`job/settled`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/jobs/jobs/src/types.ts) 已记录任务归属、种类、时间、创建工具调用及终态；[jobs-local](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/jobs/jobs-local/src/index.ts) 采用 UUID 任务标识，并在通知实时订阅者前记录生命周期。这为复用官方任务事实、收缩产品 generation 接线提供了依据。

[tool-jobs 的完成路径](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/jobs/tool-jobs/src/index.ts) 仍未记录实际 followup/inject/不报告/失败决定，也缺少 jobId 与入队 messageId 的关联。产品 [history](../../backend/chat/src/history.mjs) 和 [activity](../../backend/chat/src/activity.mjs) 依赖这些事实衔接任务结束、报告消费和取消，避免提前静默。升级应优先复用官方生命周期，仅在现有报告交付职责处保留缺少的决定及消息关联；具体删除项须验证旧会话读取、未知状态和实际失败恢复。

本轮还执行了仓库要求的检查：

- `npm run combo:verify`：版本组合通过（当时的三个仓库形态）。
- `node --test tests/docs.test.mjs`：文档相对链接检查通过。
- `npm test`：**115/122 通过，7 个失败**。PDF 套件 5 个失败，其中前两项返回 `worker-unavailable`，后续页结果断言失败；远程对话的停止/待处理输入场景 1 个失败；语音替身成功请求返回 `speech/timeout`，1 个失败。原始输出位于本机 `/tmp/ourfairy-calibration-full-test.log`。这些失败尚未归因，本轮未修改相关业务代码；全量运行中的 6 个投递测试全部通过。

后续串行复查执行：`node --test --test-concurrency=1 tests/pdf.test.mjs tests/remote-chat.test.mjs tests/speech.test.mjs`，**15/15 通过**，先前 7 项失败未复现。当前环境可运行实际 PDF worker、隔离进程和页面渲染。上轮原始 `/tmp` 日志已随环境清理，保留其已记录的结果；不能仅由此次串行通过断言先前失败的原因。复跑未修改业务代码、测试或依赖。

本轮最终再次执行 `npm test`，**122/122 通过**（26.62 秒），日志 `/tmp/ourfairy-calibration-final-npm-test.log`；`npm run combo:verify` 当时的三仓组合通过。先前失败在此次全量运行也未复现，未据此修改业务代码或放宽测试。

## 后续实施与验证项

- 采用已定手机网关范围，以实际原生入口需求确定 Connection 的最小产品补丁，复用新版 Peer 能力。
- 以官方任务事件和标识适配产品投影，保留实际报告决定及消息关联；验证现有日志兼容和缺失事实处理。
- MiniMax 的实际接入方式、输入能力及 PDF/图片阅读验证；共用模型按已定回复时机切换的实现接缝。
- 明确升级组合的构建和行为验证范围，并据此修订受影响的规格与剩余实施票。
- 保留最终全量检查结果；若 PDF、停止回复或语音的先前失败再次出现，按具体失败捕获并定位原因。

本轮修订对应 GitHub 父规格 #23、配置网关 #43 及整体验收 #44；真机票 #45 的原有验收要求继续适用。历史路线与前端决议已增加当前规格的指针。
