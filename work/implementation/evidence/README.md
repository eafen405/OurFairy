# 实施证据索引

每张实施票与每轮阶段整合在 `work/implementation/evidence/<slug>/` 留下一份 README：改了什么、
实际跑了哪些命令、结果如何、哪些没有执行。本文件是这些目录的入口。

结论、实际命令与输出摘要写在各自的 `README.md`；原始运行输出（`*.log`、JUnit XML、APK JSON 等）
不入库，重放时按 README 记录的命令在当时的 fixed commit 上执行。2026-10-17 之前合并的目录仍带
原始输出，其后新增的证据按 `work/implementation/CONVENTIONS.md` §5 执行。冻结的源码快照
（`*.patch`、`*.diff`、`mcode-*/` 下的 `*.kt`）与可复跑脚本（`*.sh`、`*.mjs`）仍随目录保留。

规格小节由 `npm run evidence:index` 生成：`index/` 下每个描述文件是一张 spec 的小节，新增 spec
加一个文件再跑一次生成即可，不要手改这些表格（并行 spec 分支此前都在同一处冲突）。

## 基线

| 目录 | 内容 |
| --- | --- |
| [00-android-recon](00-android-recon/README.md) | rikkahub fork 本机构建可用性侦察（票 #26 前置） |
| [01-baseline](01-baseline/README.md) | 票 #24：可启动后端与可复现集成基线 |
| [02-session-format](02-session-format/README.md) | 票 #25：会话归属与投递的正式记录格式（dsh 侧） |

## 实施票

| 目录 | 内容 |
| --- | --- |
| [03-identity](03-identity/README.md) | #26 邀请码注册、登录与单 APK 身份入口 |
| [04-owned-sessions-backend](04-owned-sessions-backend/README.md) · [04-owned-sessions-android](04-owned-sessions-android/README.md) | #27 本人多会话、固定主会话与重启恢复 |
| [05-remote-chat-backend](05-remote-chat-backend/README.md) · [05-remote-chat-android](05-remote-chat-android/README.md) | #28 远程对话、完整回复与显式停止 |
| [06-reconnect-backend](06-reconnect-backend/README.md) · [06-reconnect-android](06-reconnect-android/README.md) | #29 断线继续执行与持久历史补齐 |
| [07-space-execution](07-space-execution/README.md) | #30 私有/公有文件空间与受限脚本 |
| [08-group-spaces](08-group-spaces/README.md) | #31 对话建群、群主管理与群组文件访问 |
| [09-attachments-backend](09-attachments-backend/README.md) · [09-attachments-android](09-attachments-android/README.md) | #32 附件上传、获准读取与原件下载 |
| [10-conversation-search](10-conversation-search/README.md) | #33 本人会话检索与按区间读取 |
| [11-text-delivery](11-text-delivery/README.md) | #34 跨用户文字投递与单次送达恢复 |
| [12-file-delivery](12-file-delivery/README.md) | #35 跨用户文件投递与收件附件资格 |
| [13-jobs](13-jobs/README.md) | #36 后台任务活动卡、输出与双停止 |
| [14-activity](14-activity/README.md) | #37 统一活动投影 |
| [15-notifications](15-notifications/README.md) | #38 账号级接收与持久通知消费 |
| [16-asr](16-asr/README.md) | #39 认证后端 ASR 与可编辑录音草稿 |
| [17-pdf-text](17-pdf-text/README.md) | #40 PDF 按页文字 |
| [18-pdf-vision](18-pdf-vision/README.md) | #41 PDF 指定页读图 |
| [19-presentation](19-presentation/README.md) | #42 Fairy 视觉与完整回复呈现 |
| [20-gateway](20-gateway/README.md) | #43 法厄同配置网关与首版入口收束 |

## 最终验收

| 目录 | 内容 |
| --- | --- |
| [21-integration](21-integration/README.md) | #44 首版版本组合、真实云服务与整体验收（含 [75 条故事矩阵](21-integration/user-stories.md)） |
| [22-device](22-device/README.md) | #45 vivo S50 实机验收（未执行，等待目标设备） |
| [74-presentation](74-presentation/README.md) | #74/#75–#80 长回复呈现性能：测量入口入库，设备基线未建立，未做性能改动（[#45 交接](74-presentation/handoff.md)） |
| [122-perf-restore](122-perf-restore/README.md) | #122 裁剪后的客户端恢复测量入口接线（裁剪随同合入；未跑设备基线） |

## 投影性能（spec #72）

| 目录 | 内容 |
| --- | --- |
| [72-projection-perf](72-projection-perf/README.md) | spec #72 证据索引：逐票记录（#88 基线与 3 份基线 JSON、#89 投影单元……），含重放命令与未执行项 |

## 架构收敛票

| 目录 | 内容 |
| --- | --- |
| [arch-47-bundle-readme](arch-47-bundle-readme/README.md) | #47 bundle README 不再自带行清单 |
| [arch-48-product-sources](arch-48-product-sources/README.md) | #48 产品源码覆盖与安装陈旧判定 |
| [arch-49-search-owner-read](arch-49-search-owner-read/README.md) | #49 search 经公开 read 解析归属 |
| [arch-50-owner-codec](arch-50-owner-codec/README.md) | #50 `user:<shortId>` 编码收敛到唯一 codec |
| [arch-51-chat-runtime](arch-51-chat-runtime/README.md) | #51 有名字的 live-session runtime |
| [arch-52-identity-interfaces](arch-52-identity-interfaces/README.md) | #52 identity 暴露的 32 个裸 store 成员收窄为按领域 interface，不拆库 |
| [arch-53-projection-fold](arch-53-projection-fold/README.md) | #53 会话投影对同一日志的折叠次数 2 → 1，输出语义不变 |
| [arch-54-space-scope-contributors](arch-54-space-scope-contributors/README.md) | #54 SpaceScope 贡献者注册机制 |
| [arch-55-activity-trust](arch-55-activity-trust/README.md) | #55 客户端快照可信度只答一次 |
| [arch-56-notification-backlog](arch-56-notification-backlog/README.md) | #56 跨会话通知积压合并 |
| [arch-57-test-seam](arch-57-test-seam/README.md) | #57 测试 seam 收敛 |
| [arch-58-sessions-snapshot](arch-58-sessions-snapshot/README.md) | #58 会话集快照单一权威，账号发布时同步绑定 receiver |
| [arch-59-chat-read-decision](arch-59-chat-read-decision/README.md) | #59 `RemoteChatBackend.read` 去留 |
| [arch-60-foreground](arch-60-foreground/README.md) | #60 前台事实单一读取 |
| [arch-61-attempt-row-key](arch-61-attempt-row-key/README.md) | #61 attempt 行 key 约定 |
| [arch-62-interface-width](arch-62-interface-width/README.md) | #62 接口宽度收敛 |
| [arch-63-chat-store-tests](arch-63-chat-store-tests/README.md) | #63 Android 测试走 ChatSyncStore interface，覆盖事件 fixture 收敛 |
| [arch-64-executable-claims](arch-64-executable-claims/README.md) | #64 可执行声称检查 |
| [arch-66-session-events](arch-66-session-events/README.md) | #66 会话事件单次安全读取 |
| [arch-67-projection-exports](arch-67-projection-exports/README.md) | #67 projection 多余导出 |
| [arch-68-receive-state](arch-68-receive-state/README.md) | #68 删掉 RemoteReceiveState 的五个纯转发方法，调用方直接用 OwnedSessionState |
| [arch-70-closeout](arch-70-closeout/README.md) | #70 地图 #69 收口：两仓版本组合固定与 final 组合的全量验证 |
| [arch-272-http-surface](arch-272-http-surface/README.md) | #272 38 个产品 HTTP 地址的 SURFACE 清单与表驱动栅栏测试 |
| [arch-273-speech-policy](arch-273-speech-policy/README.md) | #273 speech 字段词汇、默认值与规则收进随包 policy |
| [arch-274-pdf-global-layer](arch-274-pdf-global-layer/README.md) | #274 PDF 工具改由 global layer 注册，preset restriction 决定继承面 |
| [arch-275-append-once](arch-275-append-once/README.md) | #275 `ourfairyChatRuntime.appendOnce`：live/cold 写入协议收回 chat，delivery `settle` 一次调用、只保留两个注入，facade 5 → 2 |
| [arch-276-archive-store-tests](arch-276-archive-store-tests/README.md) | #276 SessionArchiveStore 的 store 级用例：版本拒绝、归档幂等与列表过滤 |
| [arch-277-mount-routes](arch-277-mount-routes/README.md) | #277 `SURFACE` 成为挂载来源：`dsh-http` 的 `mountRoutes` seam、7 个 row 的注册收敛与 fake-carrier 用例 |
| [arch-278-delivery-cold-concurrency](arch-278-delivery-cold-concurrency/README.md) | #278 投递冷写与 resume 并发：`/chat/read` 6 轮、`/chat/observe` 5 轮、两发送者 3 轮同冷 primary，只读日志文件下的冷写失败与同身份重试（只加测试） |
| [arch-279-agent-capabilities](arch-279-agent-capabilities/README.md) | #279 用「是否用户会话」与「是否有 owner」替代 9 处 maintenance preset 判断，`MAINTENANCE_PRESET` 回到 memory 私有 |
| [test-reliability-2026-11-05](test-reliability-2026-11-05/README.md) | 构建/测试互斥、真实并行构建验证、语音与技能取消握手、临时目录隔离 |
| [302-context-engineering](302-context-engineering/README.md) | #302 采用 #249 的《绝区零》权威人格与昵称身份段；主会话记忆政策去重、complete 替换守卫，记忆/技能子代理 complete 隔离与恢复/深创提示冲突修复；最终 665/665 与 Android test/lint，真实模型复验未执行 |

## 插件生态（规格 #73）

| 目录 | 内容 |
| --- | --- |
| [96-bundle-authority](96-bundle-authority/README.md) | #96 bundle 成为产品包集合的唯一权威 |
| [97-boundary-doc](97-boundary-doc/README.md) | #97 并行传输例外与保留产品实现的书面边界 |
| [98-compat](98-compat/README.md) | #98 产品包声明明确 dsh 兼容范围并由 doctor 校验 |
| [99-delivery](99-delivery/README.md) | #99 投递成为独立产品行，chat 只暴露窄运行时服务 |
| [100-groups](100-groups/README.md) | #100 群组工具成为独立产品行 |
| [101-scoped-rows](101-scoped-rows/README.md) | #101 文件系统、sandbox、bash、工作目录 provider 各自成行 |
| [102-config](102-config/README.md) | #102 产品行声明 Config 并在加载期以行名和字段失败 |
| [103-model](103-model/README.md) | #103 共享模型初始声明只保留在 bundle，探针读取 `agentDefaultModel` |
| [104-bundle-only](104-bundle-only/README.md) | #104 只声明 bundle 的 profile 可安装、启动并服务认证后的产品请求 |
| [105-overlay](105-overlay/README.md) | #105 经 profile overlay 证明投递/群组/scoped provider 行可寻址、可替换，以及非法 config 的加载期失败 |
| [106-closeout](106-closeout/README.md) | #106 版本组合、最终两轴评审、证据索引与子票收口 |

## 传输层拆包（规格 #131）

| 目录 | 内容 |
| --- | --- |
| [138-http-package](138-http-package/README.md) | #138 产品传输信封落地 `@ourfairy/dsh-http`，identity 路由改名 `./routes`，bundle 挂行 |
| [139-consumers-core](139-consumers-core/README.md) | #139 chat、gateway、sessions 改依赖新包（sessions 保留 `/owner`） |
| [140-consumers-attachments-speech](140-consumers-attachments-speech/README.md) | #140 attachments、speech 改依赖新包 |
| [141-contract-closeout](141-contract-closeout/README.md) | #141 删除 identity 的 `./http` 兼容出口，证据索引与全量门禁 |

## 原生能力收敛（规格 #71）

| 目录 | 内容 |
| --- | --- |
| [81-pdf-subprocess](81-pdf-subprocess/README.md) | #81 PDF worker 经原生 subprocess 服务，bwrap 网络显式化 |
| [82-native-rows](82-native-rows/README.md) | #82 原生模型重试与大工具结果 spill |
| [83-spill-read](83-spill-read/README.md) | #83 被 spill 的结果由本会话只读取回，其他会话与用户被拒绝 |
| [84-history-seam](84-history-seam/README.md) | #84 dsh fork 暴露 Host 可调用的 assistant 基线与事件 cursor 接缝 |
| [85-history-adapter](85-history-adapter/README.md) | #85 断线重连/live 历史改用原生 assistant 基线与事件 cursor |
| [86-upgrade-review](86-upgrade-review/README.md) | #86 原生能力升级依赖记录、保留实现理由与 doctor 缺项检查 |
| [87-closeout](87-closeout/README.md) | #87 版本组合、最终验收、评审处理与 #71 交接 |

## 客户端合仓（规格 #123）

| 目录 | 内容 |
| --- | --- |
| [123-client-merge](123-client-merge/README.md) | #123 客户端合仓：快照导入、来源校验、构建与测试证据 |

## 仓库环境

| 目录 | 内容 |
| --- | --- |
| [repo-environment-2026-10-22](repo-environment-2026-10-22/README.md) | CI runner、dsh 测试路径与启动失败等待修复 |

## 业务库公开面收敛（规格 #132）

| 目录 | 内容 |
| --- | --- |
| [143-public-surface](143-public-surface/README.md) | #143 store 公开面从 24 个方法收窄到 19 个：删四个零生产调用的方法，`readDelivery` 转私有 |
| [144-schema-modules](144-schema-modules/README.md) | #144 五组 DDL 常量搬进 `src/schema/` 下的领域模块，存下的 schema 一字不变 |
| [145-closeout](145-closeout/README.md) | #145 证据索引登记、两轴复核（Standards + Spec）、可执行声称检查与全量门禁 |

## inject 对齐（规格 #133）

| 目录 | 内容 |
| --- | --- |
| [133-inject-truth](133-inject-truth/README.md) | #151/#152/#153 chat 的 inject 与实际依赖对齐：声明收敛、README 传输契约/运行时语义分节、合并树门禁与夹具归属收口 |

## 组合层分组（规格 #134）

| 目录 | 内容 |
| --- | --- |
| [134-bundle-groups](134-bundle-groups/README.md) | #159–#162 组合层显式化内核与插件：收口记录与零语义变化对照；逐票证据见 [#159](134-bundle-groups/01-native-group-aware.md)、[#161](134-bundle-groups/02-bundle-groups.md)、[#160](134-bundle-groups/03-absence-attribution.md) |

## 原生语义漂移守卫（规格 #135）

| 目录 | 内容 |
| --- | --- |
| [135-native-semantic-guards/163-job-status](135-native-semantic-guards/163-job-status/README.md) | #163 任务状态未知值显式化为 0，pinned dsh `JobStatus` 的增删在测试期失败 |
| [135-native-semantic-guards/164-route-save](135-native-semantic-guards/164-route-save/README.md) | #164 路由保存只覆盖手机可编辑的五个字段，草稿省略的字段从结果中删除 |
| [135-native-semantic-guards/165-job-stop-outcome](135-native-semantic-guards/165-job-stop-outcome/README.md) | #165 `/chat/jobs/stop` 只映射产品认识的原生 `kill` 结果，未知结果 5xx 且点名 |
| [135-native-semantic-guards/166-selection-native-entry](135-native-semantic-guards/166-selection-native-entry/README.md) | #166 选型写入改走原生 `agentDefaultModel.saveSelection`，不再直接 mutate settings 行 |
| [135-native-semantic-guards/167-idempotent-resend](135-native-semantic-guards/167-idempotent-resend/README.md) | #167 同一 `requestId` 连续重发只产生一条消息（只加断言，无生产改动） |
| [135-native-semantic-guards/168-input-modalities](135-native-semantic-guards/168-input-modalities/README.md) | #168 输入模态从 pinned dsh 的运行时导出导入，网关不再有本地字面量 |
| [135-native-semantic-guards/169-upgrade-checklist](135-native-semantic-guards/169-upgrade-checklist/README.md) | #169 六处守卫写进 dsh 升级复核入口，引用清单在测试改名/删除时失败 |
| [135-native-semantic-guards/135-review-fixes](135-native-semantic-guards/135-review-fixes/README.md) | spec #135 集成分支两轴评审的修复：未落实的顺序声称与未构造的启动失败声称都换成会失败的检查，并补票面行为缺口 |

## 包清单真实性（规格 #136）

| 目录 | 内容 |
| --- | --- |
| [136-closeout](136-closeout/README.md) | #148–#150：peer 与 license 声明对齐、内核包 README、`files` 存在性检查 |

## 启动器拆分（规格 #137）

| 目录 | 内容 |
| --- | --- |
| [137-launcher-split](137-launcher-split/README.md) | spec #137 证据索引：组合层独立成零 spawn 模块、统一错误契约与 bundle manifest 准入规则单份（#155–#158），含合并 tip 门禁与可执行声称复核 |

## dsh 同步到上游 rc.2（规格 #182）

| 目录 | 内容 |
| --- | --- |
| [182-dsh-rc2-merge](182-dsh-rc2-merge/README.md) | spec #182 证据索引：三条 fork 独有接缝的上游等价物裁决、真合并 17 处冲突取舍、四条必需构建、冲突面测试、产品侧改接与组合锁（#185–#191） |

## TypeScript 全量迁移（规格 #205）

| 目录 | 内容 |
| --- | --- |
| [206-ts-infra](206-ts-infra/README.md) | #206 T1：构建链（tsconfig solution、链接农场、dsh 自带 tsc）、hash 守卫（files 条目零文件硬失败）、测试门禁四模式与 http 试点 |
| [207-ts-identity-sessions](207-ts-identity-sessions/README.md) | #207 T2：identity 与 sessions 迁 .ts（包内原子）、strict 标注与类型边界、test-support 夹具的 noEmit 工程与类型剥离路线 |
| [208-ts-spaces-attachments](208-ts-spaces-attachments/README.md) | #208 T3：spaces 与 attachments 迁 .ts（包内原子）、pdf worker 搬到包根 assets/ 并随包发布、文件权限与沙箱行为不变 |
| [209-ts-chat](209-ts-chat/README.md) | #209 T4：chat 迁 .ts（包内原子，1400 行最大包）、投影单元的 SessionProjectionStateMap 声明、test-support 夹具的 noEmit 工程与类型剥离路线、运算符与字面量的机械复查 |
| [210-ts-remaining](210-ts-remaining/README.md) | #210 T5：delivery、gateway、groups、search、speech、probe 迁 .ts（包内原子）、投递消息源扩展的单一权威与 Events 声明、运算符与字面量的机械复查 |
| [211-ts-scripts](211-ts-scripts/README.md) | #211 T6：scripts 十二个脚本迁 .ts（源码直跑、noEmit 叶子工程、相对 import 带 .ts 说明符）、研究文档索引补三行、全量门禁（293/293、combo:verify、doctor、probe）与工作树清理 |

## 工具调用呈现（#213）

| 目录 | 内容 |
| --- | --- |
| [213-tool-calls](213-tool-calls/README.md) | #213：投影的 messages 增加工具名（只名字，不含参数与输出），客户端按序渲染为可见条目；stateVersion 4 重折历史 |

## Fairy 首页（#222）

| 目录 | 内容 |
| --- | --- |
| [222-fairy-console](222-fairy-console/README.md) | #222：Quiet 分组信息卡与 Signal Dock 次级入口；当前会话显示与导航同源，全部会话直接显示现有列表 |

## 空会话唯一（#220）

| 目录 | 内容 |
| --- | --- |
| [220-empty-session](220-empty-session/README.md) | #220：create 复用已存在的空会话（primary 优先，否则 createdAt 最新的空 ordinary）；日志没有消息事件即视为空，客户端生产代码零改动 |

## 代理人名册（#219）

| 目录 | 内容 |
| --- | --- |
| [219-agent-list](219-agent-list/README.md) | #219：只读 /identity/agents 仅返回用户编号与用户名；客户端设置页折叠组展示同行代理人，含自己 |

## Fairy 动态内容边界（#221）

| 目录 | 内容 |
| --- | --- |
| [221-content-boundary](221-content-boundary/README.md) | #221：眼屏展开时正文顶部随 350ms 进度让位 176dp；眼屏/HUD 绘制与收起态布局不变 |

## 集成收口（#219/#220/#221）

| 目录 | 内容 |
| --- | --- |
| [219-221-closeout](219-221-closeout/README.md) | #219/#220/#221 集成分支收口：两轴 review 修复（共享过渡常量、overlay 接缝与逐帧断言、AgentSummary 更名、#220 页面用例）、全量门禁、doctor 与 probe；真机未执行 |

## 消息呈现顺序（#223/#224）

| 目录 | 内容 |
| --- | --- |
| [223-message-position](223-message-position/README.md) | #223/#224：投影消息携带稳定数字 position，Android 按首次出现位置恢复顺序，保留现有内容合并与消费保障 |

## #233 Android 呈现：attempt 行身份由后端事实派生

| 目录 | 内容 |
| --- | --- |
| [234-presentation-identity](234-presentation-identity/README.md) · [235-reading-regression](235-reading-regression/README.md) · [233-closeout](233-closeout/README.md) | 234 — T1 呈现接口：attempt 行身份由后端事实派生 · 235 — T2 阅读过渡回归：后端事实驱动行身份 · 233 — T3 收口：attempt 行身份由后端事实派生 |

## Profile 安装恢复与模板复用（规格 #229）

| 目录 | 内容 |
| --- | --- |
| [230-install-recovery](230-install-recovery/README.md) · [231-template-reuse](231-template-reuse/README.md) · [229-closeout](229-closeout/README.md) | spec #229 证据索引：#230 fake corepack 确定性安装恢复与 linked 校验、#231 真实安装发布模板后跨 home 复制/缓存闭环与损坏模板失败、#232 两轴评审处置与最终全量门禁（318 pass，combo verify 三行 ok） |

## #237 流式正文分帧呈现

| 目录 | 内容 |
| --- | --- |
| [237-stream-refresh](237-stream-refresh/README.md) | #237 流式正文分帧呈现 |

## 客户端内更新（#238）

| 目录 | 内容 |
| --- | --- |
| [238-in-app-update](238-in-app-update/README.md) | #238：设置内 APK 下载、版本检查、未知来源授权与系统安装入口 |

## Fairy 记忆与上下文治理（规格 #240）

| 目录 | 内容 |
| --- | --- |
| [241-absolute-compaction-threshold](241-absolute-compaction-threshold/README.md) | #241 dsh `compaction-basic` 接受可选绝对 `thresholdTokens`：与窗口比例阈值、扣除输出预留与余量后的容量取最小值，schema 声明 volatile 故保存即热生效，未配置时既有解析不变（dsh `d80522d276`） |
| [244-memory-crud](244-memory-crud/README.md) | #244 长期记忆 CRUD 与双层检索（独立 SQLite 与版本化迁移、五个记忆工具、20 条/8000 字符预算与显式截断、按调用会话的查询门禁、编号不复用与物理删除）；印象、维护与设置见后续票；#240 收口复核把同一 8000 字符预算作为 `memory_add`/`memory_edit` 的写入上限，拒绝会被每次检索整条省略、任何会话都无法再改/删/切换的孤儿行 |
| [245-impression](245-impression/README.md) | #245 每位用户一份印象：按装配求值的系统提示 section 只注入本人、`/impression/read|edit` 以登录凭据定归属且先读后改、Fairy 工具按调用会话门禁、8000 Unicode 字符拒绝而非截断、无定时失效；客户端设置入口与读成功后才可编辑的多行整份编辑页，无长期记忆浏览器 |
| [242-native-auto-compaction](242-native-auto-compaction/README.md) | #242 真实 v1 profile 挂载 token meter、compaction-basic（500000 绝对阈值 / 16000 保留）、工具结果裁剪与图片 offload，保留 spill 且不挂 command-compact；真实 profile + Loader 与模型替身证明阈值压缩后继续回复（工具配对与近期原文保留）、裁剪、offload、溢出恢复和冷恢复，压缩摘要不写长期记忆；设置入口 #243 未做 |
| [246-session-memory-maintenance](246-session-memory-maintenance/README.md) | #246 每个源会话的动态维护门槛（默认 15、每满 6 小时减 1、最低 1）与静默准入：原生轻量模型子会话零父上下文、parentSession 指向源会话、只注册五个记忆工具；材料只含封口区间用户消息、Fairy 回复、附件名与记忆变更调用；完成按持久 turn/end 判定（零写入也推进），失败恢复同一子会话，重启按持久水位与时间重算；maintenance_state 增加 cut_seq（schema v2）；配置 volatile 读取，设置 UI 属 #247 |
| [243-compaction-settings](243-compaction-settings/README.md) | #243 自动压缩触发阈值成为部署设置：网关读写 `compaction-basic` 行的 volatile `thresholdTokens`（整 token 100000–900000，含边界；非整数、越界与多余字段 400 `gateway/invalid-compaction`，不截断/不 clamp，保留预算仍由 16000 固定）；真实 profile + Loader 与产品会话证明保存后下一次压力检查生效（900000 不触发、100000 修剪超长工具结果）、重启保留、切模型不改、匿名 401/普通代理人 403；Android 新增「上下文 → 自动压缩 → 阈值」独立嵌套组与可复用 Material 3 数值控件（滑块与直接输入同一 K 草稿、单位、范围、忙态、可见错误、写后重读），控件留给 #247 复用；100000–900000 只在网关校验：原生 `compaction-basic` schema 只约束正整数，这是规格 §6「拥有者 schema 也校验范围」的有意偏差，#240 复核记录在证据与 bundle 注释中，未改 dsh |
| [247-maintenance-settings](247-maintenance-settings/README.md) | #247 记忆维护数值成为部署设置：网关读写 `memory` 行的 volatile `maintenanceTurns`/`maintenanceDecayHours`（线协议 `triggerTurns` 5–50、`decayHours` 3–24，含边界；缺失、非整数、越界与多余字段 400 `gateway/invalid-maintenance`，不 clamp）；一次保存写两项、服务端校验、匿名 401/普通代理人 403；真实 profile + Loader 与产品会话证明保存后下一次维护评估用新值（6 回合搁置区间在 15 不触发、保存 5 后触发；10 回合 + 15 小时搁置在 6 小时衰减门槛 13 不触发、保存 3 后门槛 10 触发）、保存不重置持久水位、重启保留并用新 5 回合阈值维护新会话；Android 新增「记忆 → 维护」独立嵌套组，两项复用 #243 的 Material 3 数值控件（各自草稿、共同校验与保存、单位回合/小时、忙态与可见错误），字符串 en/zh 同步、无新依赖；真实模型语义质量仍属 #248 |
| [248-memory-integration-acceptance](248-memory-integration-acceptance/README.md) | #248 记忆增量集成与真实模型验收：`npm run acceptance:memory` 用真实 v1 profile + 真实 MiniMax-M3.1-Flash（拒绝回环替身，主/子会话都从各自 session log 核对路由）跑 11 条质量样本、67 项检查全过（明确记忆、稳定偏好、寒暄不写、易变观察不写、事实更新、失效删除、普通/私密切换、跨用户层隔离与印象、维护零写入推进/不重复、印象先读后写/注入/超长；复核加强 invalidate 后该例 7/7，当前全量应为 69 项）；维护门槛经真实 `/gateway/maintenance` 从 15/6 降到 5/3；真实运行暴露的会话摘要、用户画像、IP/位置推断、时间限定观察、元记忆与待办写入，以有 owner 的 `ourfairy:memory-policy` 段、`memory_add` 描述与维护子会话策略修复（`memory-policy` 测试固定接线，前后样本在证据目录）；`npm test` 381/381、`combo:verify` 三行 ok、Android 387 tests + lint 0 errors、dsh compaction-basic 158 + config catalog 15；真实 500K 压缩、真机与默认 15/6 真实节奏未执行；复核轮 dsh 另跑 typecheck 5/5 与 check:ci:static 59/64（5 个既有 fork 漂移失败），dsh 全量测试与覆盖率未跑 |

## 发布与 fairybox 部署

| 目录 | 内容 |
| --- | --- |
| [release-2.5.8](release-2.5.8/README.md) | `main` 合并 #240 与 Fairy 视觉令牌重做后发布 2.5.8 / versionCode 193：合并前 `npm test` 381/381、`combo:verify` 三行 ok、Android `test lintDebug` 通过；APK 读取实际产物确认 versionCode 193、arm64、内嵌 `https://85.137.246.15:38518/ourfairy`、与旧包同签名，公网下载 SHA-256 一致；fairybox 用 `ourfairy-backend.service` 更新到 app `02dce245b6` + dsh `d80522d276`（dsh 构建产物本地构建后 rsync，服务器不跑 `tsc -b`），doctor 通过、真实 MiniMax 一轮完成、`/gateway/read` 出现 compaction 500000 与 maintenance 15/6、`/impression/read` 200；真机内更新全流程未复测 |
| [release-2.5.9](release-2.5.9/README.md) | `main` `009521b40e` 发布 2.5.9 / versionCode 194（范围 #251–#255 与仓库清扫批次）：版本提交过完整门禁（`npm test` 430/430、`combo:verify` 三行 ok、Android `test lintDebug` 3m20s 通过）；APK 读取实际产物确认 versionCode 194、arm64、与 2.5.8 同签名（`406a2d5c…1d8e`），三份产物 SHA-256 与服务器逐字一致、公网下载 8,683,631 字节一致；fairybox app `d4dbd5d939`→`009521b40e`（dsh 仍 `d80522d276`，服务器只构建产品包），doctor 全过、真实 MiniMax 一轮返回 OK、`/gateway/read` 有 compaction 500000 与 maintenance 15/6、`/impression/read` 200、公网 401 与下载页 200；旧 APK 与旧下载页备份在 `backup-20261029`，真机内更新全流程未复测 |
| [release-2.5.10](release-2.5.10/README.md) | `main` `9a590b4632` 发布 2.5.10 / versionCode 195（#256–#259）：版本提交只改版本常量，全量 `npm test` 重跑被隔离 home 的 corepack/pnpm 下载阻塞，未把阻塞写成通过（同代码 `722108db77` 为 430/430），Android `test lintDebug` 477/477、lint 0 errors，`assembleRelease` 成功；APK 版本 195、与 2.5.9 同签名（`406a2d5c…1d8e`），三份产物 SHA-256 与服务器逐字一致、公网 arm64 8,700,019 字节一致；fairybox app `009521b40e`→`9a590b4632`（后端源码未变，未重建/重启），combo 三行 ok、服务 active/NRestarts=0、下载页 `main@9a590b46` 200；旧 APK 与旧下载页备份在 `backup-20261031`，真机内更新全流程未复测 |

## 会话管理（规格 #250）

| 目录 | 内容 |
| --- | --- |
| [251-session-titles](251-session-titles/README.md) | #251 挂载原生会话标题两行：五个 `/sessions/*` 路由都带标题、`/sessions/list` 一次批量折叠，没有 `session/title` 事件的老会话按首条人类消息派生只读兜底（不写日志、不调模型） |
| [252-session-rename](252-session-rename/README.md) | #252 改名只经原生标题服务写入并钉住用户标题，新增 `/sessions/rename`（`open` 关补生成 → 改名 → `barrier` 落盘），客户端行内改名入口与标题栏显示会话名 |
| [253-session-archive](253-session-archive/README.md) | #253 删除复用归档：归档表自持 SQLite、`list(owner, { archived })` 是唯一过滤点、主会话拒绝归档（`sessions/primary-not-archivable`），客户端 `AlertDialog` 二次确认；不提供物理删除 |
| [254-archived-sessions](254-archived-sessions/README.md) | #254 归档的另一半：新增 `/sessions/restore`（未归档则 409 `sessions/not-archived`），客户端归档视图只填归档流、不出主会话也不给物理删除 |

## 仓库环境清扫（本地票集 CLEAN-01～CLEAN-09）

| 目录 | 内容 |
| --- | --- |
| [repo-cleanup](repo-cleanup/README.md) | CLEAN-01～CLEAN-08：related 门禁读取测试文件自写的 `@covers backend/<package>` 声明（12 个套件，delivery/speech/memory/groups/search 选择从 0–1 个变为 3–5 个）；`specs:status` 用一条 `specOfDirectory` 规则从 `published.json.parent` 或 README 父规格声明识别命名票目录、按 ref 树判定副本（#240 copies MISSING→ok，同时多出 #23 一行）；文档入口补登 #240 规格、术语覆盖记忆上下文、无状态头按目录档位、domain.md 换真实路径，并补登 14 个漏登证据目录（改为描述文件派生）；基准 history/observer 数量收敛到 `scripts/bench-workload.ts`、门禁 cell 由笛卡尔积派生；记忆维护 15/6、5–50、3–24 收敛到 `backend/memory/src/maintenance-policy.ts` 并由记忆 Config、运行期校验与网关共同消费（网关经包导出子路径运行时导入）；删除三处 Android 快照残留（423→422 tests）；本机回收 1,400,108,172 B 可再生产物。最终门禁 `npm test` 425/425、`combo:verify` 三行 ok、Android `test lintDebug` 422 tests/0 failures（集成 worktree 从零产物冷构建）、`evidence-index --check` current；未推送、未合 main，Spec 轴评审因两次中断未完成。CLEAN-09 追加：19 个既有套件补 30 行 `@covers` 声明（声明文件 12 → 27），补齐 attachments/chat/gateway/groups/identity/delivery/sessions/search/speech 的单向关联（attachments 4→12、chat 14→20、gateway 2→7、groups 4→8、identity 9→11、delivery 4→6、sessions 4→6、search 3→5、speech 2→4、memory 7→8），逐包探针脚本随目录保留 |

## Android 目的地拓扑（规格 #257）

| 目录 | 内容 |
| --- | --- |
| [257-263-destination-catalog](257-263-destination-catalog/README.md) | #263 建立静态目的地 catalog：`ui/destination/FairyDestination.kt` 声明 route / access / restore / page 四项，`FairyDestinations.kt` 是唯一一张表；首页、设置、网关、印象的装配、准入与恢复都改读它，`contentKey` 换成可进 Bundle 的 String，印象页首次获得冷启动恢复（首页、设置、印象）。完整性靠对 `Screen` 的穷尽 `when` 在编译期强制登记，未引入 kotlin-reflect |
| [257-264-migrate-all](257-264-migrate-all/README.md) | #264 把登录、注册、会话、会话列表四个剩余目的地并入同一张表：`page` 变为非空并接收 `Screen`（会话页从 key 取 sessionId），`assembles()` 与 `RouteActivity` 的第二条 entry 分支删除，`NavEntry` 构造移入 `entryOf`；删除 `IdentityAccessPolicy` / `IdentityDestination` / `toIdentityDestination` 与两个手抄映射测试，`IdentityScope` 保留为身份事实；通知落点改用 `resumedStack(CONVERSATION_ROUTE, sessionId)`；`FairyPagesTest` 的三块手抄 `when` 与两个装配 helper 改为经 catalog 装配。表驱动测试覆盖八个目的地 × 四种身份（含未登录但残留 admin 位）、八条恢复策略与完整性 |
| [257-review](257-review/README.md) | spec #257 收口两轴评审（Standards + Spec）与修复：`destinationOf` 改为持有穷尽 `when` 直接返回目的地，把「登记一次」变成构造期保障；删掉两处自证断言并把恢复期望改为写死的表；`FairyPagesTest` 剩余的自建导航器改走 catalog；设计记录补写 §9。后端全量 `npm test` 因 profile 安装取包超时未取绿，`main` 上同样复现 |

## Android Fairy 互动：统一存在感、反应与台词编排（规格 #256）

| 目录 | 内容 |
| --- | --- |
| [260-unified-presence](260-unified-presence/README.md) | #260 新建进程级 `FairyInteraction` deep module（纯 Kotlin，装配层注入 `SystemClock::uptimeMillis` 与 `Random.Default`）统一 Fairy 当前表现：对话页私有的六分支 `fairyWindow()` 收进 `window(facts)`，首页按 `selectedId ?: primarySessionId` 只观察当前会话（缺省回退主会话），页面不再各自合成 presence；活动未知沿用 `RemoteChatSnapshot.activity` 的既有答案（unknown ≠ quiet，module 拿不到原始事件）；`RemoteReceiveState.chats` 内存 map 改为可观察 `runtimes: StateFlow<Map<String, RemoteChatState>>`，首页能跟随当前会话运行时的出现/退役；`Impression`/`Gateway` 的 presence 调用收口；新增 20 个纯 JUnit 用例与 5 个页面接线用例 |
| [261-interaction-continuity](261-interaction-continuity/README.md) | #261 屏幕待机、台词选择与最近台词记忆收进同一 module：`tick()`/`touch(): Boolean`/`captionFinished()`/`pageExit()`，45s 首句、60–90s 下一句、180s 待机由 module 判定，待机只在控制台进入而状态跨页保留（对话页呈现同一 `asleep` 并经 module 唤醒，GLOSSARY 同步）；`FairyUiMemory` 实现窄接口 `FairyLineMemory` 成为唯一记忆；按「原来零调用方 → 已删」删除 `chatPool`/`CHAT_AVOID`、`FairyCaption(compact)`、`sleepNow`、整条 `drowsy`/`snaps` 路径与无生产者的 `FairyWindowState.eye`；对话页首次拥有 `FairyEyeController`；32 个 module 用例 + 2 个页面用例（待机跨页、离页不补播） |
| [262-fairy-reactions](262-fairy-reactions/README.md) | #262 真实事件触发反应：本地发送经 `sent(requestId)` 只给短暂注意反应、不伪造后端 THINKING；Fairy 输出/投递/完成经 `fairyFacts()` 的 `newestFairyOutput().seq`/`delivery`/`completed`，用只增的 `(sessionId,seq)`、`(episodeId,seq)`、`(episodeId,finishedSeq)`、`requestId` 去重，活动未知时不算事件；`foregrounded(context, facts)` 以运行时当前快照为基线、不补播后台积压的事件；`FairyEyeReactions` 把 SENT/OUTPUT/DELIVERY/COMPLETED 映射到既有眼睛；删除零调用方 `attend`/`startle`，`glanceAt`/`blink` 接真实事件，`speechPulse` 改由 module 生产、SPEAKING 新输出才脉冲；53 个 module 用例 + 4 个页面用例（含 ActivityScenario 前后台与 Reduced Motion） |
| [256-review-fixes](256-review-fixes/README.md) | #256 收口两轴评审修复：页面改渲染 module 快照的 `window`（同一上下文无事实的过渡帧沿用上一页表现，换会话/登出仍为未知）；`pageExit` 结算 caption/reaction/speechPulse 并按呈现号忽略过期离页；回前台无事实时保持未观察直到第一份事实到达；待机中的视线反应当下播放、不排队到醒来；`retryPending()` 返回是否真正受理、panel 只在受理时上报；抽出 `FairyPageHost` 共用眼睛/待机同步/生命周期/手势/反应接线；恢复「存在感」词条并删除 #257 词；页面 seam 补可见结果、可注入眼睛与手势断言；最终 Android `test lintDebug assembleDebug` 52 suites/427 tests/0 failures/0 lint errors、3 个 debug APK，根 `npm test` 430/430；真机验收未执行 |

## Android 会话导航：统一会话列表浮层与当前会话事实（规格 #258）

| 目录 | 内容 |
| --- | --- |
| [265-shared-session-overlay](265-shared-session-overlay/README.md) | #265 会话列表抽屉提升为控制台与对话页共用的 `ui/identity/SessionListOverlay.kt`：状态持有 `DrawerState` 与 `CoroutineScope`，`open()`/`close()` 直接驱动抽屉，`isOpen` 由抽屉派生，没有第二份布尔状态；控制台「全部会话」与无当前会话时的「进入会话」就地打开浮层、不导航，`CURRENT SESSION` 改显示同一 `owned` 快照行的 `displayTitle`，未命名会话与列表共用「新会话」占位；对话页改用同一浮层，旧 `Screen.Sessions` 暂留兼容 |
| [266-archive-follow-state](266-archive-follow-state/README.md) | #266 归档跟随收进 `OwnedSessionState`：`SessionsSnapshot.archivedSelectionId` 只在归档当前会话且选择确实移动时发布，页面只响应该事实，删除 `standing` 闩锁与列表差分；跟随后消费、恢复命名会话、显式选择与账号切换清除，refresh/rename 保留，过期/无权/拒绝归档不发布；控制台浮层补齐归档视图、恢复、改名、停止回复与首页/设置入口，控制台行（含当前行）一律进入会话，对话页重选当前会话仍只关闭 |
| [267-retire-sessions-destination](267-retire-sessions-destination/README.md) | #267 删除 `Screen.Sessions`、catalog 条目与空会话对话页装配：`FairyConversationPage` 只接受真实 `sessionId`，七个目的地仍由同一张表驱动；旧 `route="sessions"` 按未知路由回退 `[Home]`（`FairyLastLocationTest` 与零网络 `SessionsColdStartTest` 固定），冷启动不打开浮层、不显示错误页；`android/GLOSSARY.md` 新增「会话列表浮层」 |
| [258-review](258-review/README.md) | spec #258 收口两轴评审修复：标题栏改传 `OwnedSession.displayTitle`，控制台、列表行与标题栏共用同一条未命名占位并补窄屏大字长标题用例；`archivedSelectionId` 增加页面消费与恢复清除，消除归档后恢复会话又被弹回主会话的路径；`SessionsSnapshot.session(id)` 收拢行查询；浮层参数改名 `standingSessionId` 并记录两个入口的重选语义；按「声称须可执行」删除或收窄 grep 无法落实的结构声称 |

## Android 会话接收（规格 #259）

| 目录 | 内容 |
| --- | --- |
| [259-receive-decoupling](259-receive-decoupling/README.md) | #269 提醒欠账改为按账号与会话键读取持久 ChatSyncRecord，无活运行时也能发现与消费（消费规则只在 ChatSyncStore 一处，ChatSyncKey 只保留一种规范形态），停止观察不消费，绑定在首个投影前保持“未回答”；#268 新增 6 会话组合负载（5 个 200 条历史 + 1 个 232,703 字符 / 128 字符 / 20 ms 流式）经生产 RemoteReceiveState/RemoteChatState 记录连接、堆、接收至状态/帧与主线程指标，结果独立命名为 multi-session，宿主测试钉住声明与 #74 stream 正文；#270 没有同设备多会话数据，未做运行时释放或调度改动；设备三轮基线与真机通知未执行 |

## 自投落点跟随发起会话（规格 #280）

| 目录 | 内容 |
| --- | --- |
| [282-self-delivery-text](282-self-delivery-text/README.md) | #282 自投文字落发起会话：落点判定收进无依赖的 `delivery/src/target.ts` 纯函数，`index.ts` 在 prepare 前判定一次并把结果记为 `deliveries.session_id`（重试/恢复沿用记录）；自投且发起会话存在、属于发送者、未归档时不再解析或创建主会话。会话服务新增唯一布尔读 `canHostDelivery`，归档事实经 archive-store 新单行 `isArchived` 取得，不枚举归档列表。实测发现基线的同会话写入会被 `SessionQueues` 误判为「调用链已持有」（chat `send` 的 async 上下文带进回合），改为按条目是否已结束判定：已结束条目可重入、运行中仍立即拒绝；否则「自投回写发起会话」必然抛错。工具描述、GLOSSARY 主会话/投递消息、delivery/chat/sessions README 同步。真实启动器行为用例覆盖自投落发起会话、回执即落点、归档后回落主会话，跨用户用例保持通过 |
| [283-file-landing](283-file-landing/README.md) | #283 自投文件随落点（characterisation，生产代码无改动）：新用户填满主会话后开普通会话 A，在 A 写私有空间文件并自投文字+文件；断言 A 中一条普通 Fairy 消息带正确附件清单、一条 delivery/message 事件、主会话无副本；从 A 下载原件 200 且字节一致，同消息同索引从主会话与另一会话均 404。落点已在 prepare 前记录，settle 把文字与附件清单写进该记录会话，因此文件路径无需额外规则 |
| [284-retry-landing](284-retry-landing/README.md) | #284 自投重试与启动恢复沿用首次落点（characterisation，生产代码无改动）：`deliveries` UPDATE 触发器只作故障注入（按本条唯一文本），同一 callId 重试仍只有一条消息并留在首次记录的会话，发起会话在重试前归档也不改判，落点差异不参与同身份冲突（内容差异仍拒绝）；启动恢复改用既有 `failFlush` 故障：归档发起会话、不带故障层重启后无工具调用，消息仍出现在记录的归档会话而不在主会话。全部断言走回执与投影，不读投递表行 |
| [280-review](280-review/README.md) | #280 两轴复审修订：Standards 轴 3 硬 + 4 判断、Spec 轴 2 缺 + 2 越界 + 2 疑似错误。已修：删除 `canHostDelivery` 不可执行的返回声称与 target.ts「唯一落点权威」措辞；落点纯规则直接返回会话 id，删掉重复的自投判定与未要求的「跳过 primary()」；#284 用例改为外部断言（触发器只作故障注入，启动恢复走既有 failFlush），补队列重入交错用例，修正客户端主会话注释，撤回归档注释里的循环理由。F5（三处归档 SQL）记录不修理由；S1（无发起会话纯函数覆盖）按票面认可保留；最终门禁由收口在最终 tip 复核。两轴报告原文与逐项处置见目录 README |
| [285-landing-notifications](285-landing-notifications/README.md) | #285 Android 提醒按落点会话发送：`publishBacklog()` 不再把所有欠账合并成一条、优先主会话，而是对 `owedRecords()` 逐条 `publish(key, preview)`，每条都指向内容真正所在的会话；单条发布被拒只丢该落点的一次声音（消费先于尝试，不重放），其他落点照常尝试。前台/关闭接收/停止观察的抑制与追平门保持不变；`AndroidRemoteNotifications` 的 URI tag 已让多会话通知共存，未改。定向测试新增三会话错峰 3 条提醒、仅非主会话欠账不改指、单条拒绝不吞其他落点；真机通知未验收 |

## 附件打开：去处判定与图片预览（规格 #281）

| 目录 | 内容 |
| --- | --- |
| [287-attachment-route](287-attachment-route/README.md) | #287 附件去处判定与图片预览：去处收进 `ui/identity/RemoteAttachmentDestination.kt` 的无依赖纯函数 `remoteAttachmentDestination(mime, name)`（IMAGE / TEXT / EXTERNAL / SAVE_AS），可信 MIME 优先（去参数、转小写），`application/octet-stream` 或缺失时按后缀判定，图片进应用内全屏。预览缓存 `attachmentPreviewFile` 位于 `cacheDir/attachment-preview/`，文件名是（会话, 消息, 序号）三个坐标的 SHA-256 摘要，不含显示名、路径分隔符无法逃出子目录；`cacheAttachment` 与原另存为共用同一次认证下载，先写同目录 `.part` 再 `renameTo`，同坐标已有完整文件直接复用，因此一次打开下载调用恒为 1，失败或 epoch 不符的迟到下载不落最终文件。面板 `onDownload` 收敛为一个 `when`：IMAGE 解析缓存并打开复用的现有 `ImagePreviewDialog`（缩放、保存读本地绝对路径，不重新下载），`DisposableEffect` 在预览离开组合时删除缓存文件，关闭回原消息位置；TEXT、EXTERNAL、SAVE_AS 本票按票面刻意保留另存为，各占相邻分支供 #288/#289 替换。收口 `cd android && ./gradlew test lintDebug --rerun-tasks`：`BUILD SUCCESSFUL in 3m 13s`，577 tests、0 failures/errors/skips，lintDebug 通过（新增文件无告警，两条既存告警未修）；真机手势、返回键关闭与 SAF 另存未人工验收。无数据库、wire、manifest 与依赖变更 |
| [288-text-preview](288-text-preview/README.md) | #288 附件文本预览：TEXT 去处由另存为改为应用内只读全屏预览，与图片共用同一次认证缓存下载（`cachePreview`：`attachmentPreviewFile` + `state.cacheAttachment`），面板只调用唯一入口 `remoteAttachmentDestinationFor(mime, name, bytes)`；文本按附件记录的 `bytes` 超过 `TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024` 改判 `EXTERNAL`，不在应用内展开（今天落回另存为，#289 落地后自动成为外派）。`RemoteAttachmentText.kt` 无 UI 依赖：`decodeRemoteAttachmentText` 严格 UTF-8 → 严格 GB18030（`CharsetDecoder` 均 `CodingErrorAction.REPORT`），两者都不成立返回 `Undecodable`、界面显示「无法解码」，不返回替换字符也不抛异常；`remoteAttachmentTextLayout` 按后缀或 MIME 判定排版，`.md`/`.markdown`/`text/markdown` 为 Markdown（`text/plain` 兜底压不过 `.md` 后缀），`.txt`、代码后缀与无后缀文本为纯文本。预览层 `RemoteAttachmentTextPreview.kt` 全屏 `Dialog`，在 `Dispatchers.IO` 读取解码，Markdown 复用现有 `parseMarkdown` + `MarkdownBlock` 这对与 `MessageBody` 相同的解析/渲染入口，纯文本/代码用 Fairy token 等宽字体 `telemetryFontFamily`、`SelectionContainer` 可选择并保留原文换行缩进；关闭时经抽出的共享 `DeleteCachedPreviewOnDispose(path)` 只删除该缓存文件，图片与文本共用。EXTERNAL/SAVE_AS 保持原有另存为。收口 `cd android && ./gradlew test lintDebug --rerun-tasks`：`BUILD SUCCESSFUL in 5m 33s`，593 tests、0 failures/errors/skips，lintDebug 通过；真机手势、返回键关闭与大文本滚动未人工验收。未改 wire、数据库、manifest、依赖，也未新增解析/渲染依赖 |
| [289-external-open](289-external-open/README.md) | #289 附件外派系统应用：EXTERNAL 去处与图片、文本共用同一份 `cachePreview` 缓存下载，一次打开至多下载一次，随后以 FileProvider `${applicationId}.fileprovider` 的 `content://` URI 启动裸 `ACTION_VIEW`（`ui/identity/RemoteAttachmentHandoff.kt` 的 `externalAttachmentIntent`），带 MIME、`ClipData` 里的原始显示名与读授权（`FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK`）；不用 `Intent.createChooser`，因为 AOSP chooser 对零目标有可见的空状态、总是能解析，会掩盖「没有接收方」，回落永远不可达。`launchExternalAttachment` 接缝捕获 `ActivityNotFoundException` 后写入既有 `attachmentNotice`（「没有能打开该文件的系统应用，已改为另存为」），并以 `PendingDownload.cached` 记住已缓存文件、打开原 `ACTION_CREATE_DOCUMENT` 另存为，SAF 回调直接导出这份缓存字节而不再下载，所以一次打开下载调用仍恒为 1。FileProvider 暴露面只加一条 `<cache-path name="attachment-preview" path="attachment-preview/" />`，`RemoteAppUpdateTest` 的路径清单把既有 `app-update/` 加这一条钉成精确清单。缓存布局由 #287 的摘要命名文件改为「坐标目录 + 清洗后的原始显示名叶子」：`attachmentPreviewFile(..., name)` 替换分隔符与控制字符、拒绝 `.`/`..`、限长 120，坐标目录仍只由（会话, 消息, 序号）的 SHA-256 决定；本条取代 #287 条目对文件名的描述。外派交接后不删除文件（接收方可能仍在读），下一次外派打开由 `sweepAttachmentPreviews(keep = file)` 清扫其它坐标目录；图片与文本预览继续由共享的 `DeleteCachedPreviewOnDispose` 在关闭时删除自己的缓存。收口 `cd android && ./gradlew test lintDebug`：`BUILD SUCCESSFUL in 2m 13s`（`134 actionable tasks: 11 executed, 123 up-to-date`），JUnit XML 合计 604 tests、0 failures/errors/skips（app 532、ui 20、highlight 52），lintDebug 通过（新增 `RemoteAttachmentHandoff.kt` 与其两个测试无告警，两条既存告警未修）；真机解析器/多应用选择界面、真实 PDF/Office 查看器打开缓存文件与设备「没有应用可处理」行为未人工验收。无数据库、wire、manifest 与依赖变更 |
| [281-review](281-review/README.md) | #281 两轴复审修订：以 `integration/spec-281` @ `5e329acb6e` 为基线，按 Standards 轴（3 条 HARD：复用优先、声称须可执行、声称≠命名检查；6 条 JUDGEMENT：Duplicated Code、接缝泄漏、Mysterious Name、文案、重复测试设置、cheap）与 spec 轴的 2 条规格细节（MIME 两处权威、Markdown 判定重复）逐项处置。① 新增共享 `ui/identity/LocalFileHandoff.kt`，安装包与外派交接共用同一份 FileProvider URI + 裸 `ACTION_VIEW` + 读授权/NEW_TASK + ANFE 处理，删除 `RemoteAttachmentHandoff.kt` 与两处旧函数，各自缺失文案仍留在调用方；② 新增 `attachmentMimeFor(mime, name)`：可信 MIME 去参数、转小写后优先，否则走唯一 `SUFFIX_MIMES` 表，路由与外派都用这一有效类型，`application/octet-stream` 的 `.docx`/`.pdf` 因此按 Word MIME/`application/pdf` 交接给系统应用；③ Markdown 的 MIME 与后缀表收进 `RemoteAttachmentDestination.kt` 单一来源，`RemoteAttachmentText.kt` 只读同一组常量，不再自带一份；④ `RemoteChatState.saveCachedAttachment(expectedEpoch, cached, save)` 独占「查 epoch → 保存 → 写唯一 `ATTACHMENT_SAVED`／既有 `description()`」这段职责，面板缓存分支只调用它，不再自建 try/catch 与另一套错误文案；⑤ 删除生产 composable 的测试专用 `launchExternal` 参数，测试改用 Robolectric 真实 `startActivity`（`requireActivityResolution()` + `registerActivityFor` 注册假查看器，无查看器用例走真实路径抛 `ActivityNotFoundException`，回落目标用真实 `CreateDocument` 注册）；⑥ 删除 `RemoteAttachmentDestination` 中不可强制的「唯一判定」KDoc，类型路由 `destinationFor` 转私有，`remoteAttachmentOpenDestination` 成为唯一公开入口，名称可读出 2 MiB 展开规则；⑦ `android/GLOSSARY.md` 与 `android/README.md` 更正缓存与另存为的关系、删去重复路由表并指向 GLOSSARY 作为词汇权威，测试引用改到真正固定该行为的测试；⑧ 无接收方文案改为取消安全的「没有能打开该文件的系统应用，请选择保存位置」；⑨ 新增测试辅助 `clearFileProviderCache()`，四个测试类的 `@Before` 共用；⑩ `startAttachmentDownload` 的 `keep` 更名 `keepCompletedFile` 以说明保留的是下载完成文件还是 `.part`。明确保留：缓存布局仍是「坐标目录 + 清洗后的原始显示名叶子」，因为外派要求查看器看到真实文件名与后缀（#289 已取代 #287 的摘要命名）；外派交接后不删文件、下一次外派打开时由 `sweepAttachmentPreviews` 清扫其余坐标目录，因为接收方可能仍在读该文件；坚持裸 `ACTION_VIEW` + ANFE 回落而非 `Intent.createChooser`，因为 AOSP chooser 对零目标总可解析，回落将不可达。收口 `cd android && ./gradlew test lintDebug`：JUnit XML 合计 612 tests、0 failures/errors/skips（app 540、ui 20、highlight 52），lintDebug 通过且新增文件无告警；`npm test` 473 pass（17 suites）；`npm run combo:verify` → `combo: combination verified`。真机解析器与多应用选择界面、真实 PDF/Office 查看器打开 FileProvider URI、设备真实 ANFE 与 SAF 保存目标未人工验收。无数据库、wire、manifest 与依赖变更 |

## 合并提交门禁（#286）

| 目录 | 内容 |
| --- | --- |
| [286-merge-hook](286-merge-hook/README.md) | #286 `.githooks` 补 `pre-merge-commit`，与 `pre-commit` 同样委托 `scripts/precommit.ts`；实测发现 Git 2.53 在 `pre-merge-commit` 运行之后才写 `MERGE_HEAD`，因此钩子显式传 `--merge` 要求全量门禁（`isMerging` 保留给冲突合并后的 `git commit`）。结构测试从 `core.hooksPath` 取实际目录，固定两个入口都存在、可执行并委托到同一脚本，另有 `--print --merge` 判定测试。真实合并未用 `--no-verify`：钩子输出 `pre-commit: full gate`、474/474、combo verified；README「提交前钩子」同步。 |

## Fairy Skill 系统与工作流学习（规格 #295）

| 目录 | 内容 |
| --- | --- |
| [296-skill-runtime](296-skill-runtime/README.md) | #296 原生 `skill`/`skill-filesystem`（`includeDefaultRoots:false`、仅部署 bundled 根、`watch:false`）/`tool-skill` 与产品行 `@ourfairy/dsh-skill-creator` 一起挂载；技能包验证与规范化清单（POSIX 排序、全文件 SHA-256、可执行位、拒绝符号链接/非普通文件/作者主机路径）、独立 `skill.sqlite`（WAL、版本化迁移、`BEGIN IMMEDIATE`、同作用域名唯一）、每用户选择池（个人优先遮蔽共有、禁用个人后共有回归、归档/禁用派生状态与动作作用域）、每 Agent 的 `ourfairy-skills` provider（`agent.ctx.inject(['skills'])`，激活时复核清单哈希）、只读版本资源贡献、`/skills/list|detail|preference`、部署 seed 与 bundled Skill Creator；聊天投影新增 role 3 kind 1 `加载了skill:xxx` 行（按 tool call id 去重、冷恢复一次、失败/目录/`/name` 文本不产生）；Android Skills 页与激活行。真实启动器/模型替身 + Robolectric；真实模型与真机未执行。 |
| [297-create](297-create/README.md) | #297 `skill_manage` list/inspect/create/review（仅用户会话）；按 `focus` 从持久日志取本轮/指定 turn 的步骤与工具调用作为来源；候选经 `tmp/` 隔离写入 `candidates/`，由 bwrap 一次性环境按代表场景真实执行（系统记录命令、退出码、输出摘要与环境，超时/中止，不写共享 env 根，跑完删除）；审核包与确定性四块 `display`（整条结果 <7600 字符，全文按 `expand` 有界展开）；审核状态机（要求修改产生新草稿/新哈希，旧批准与验证不沿用）、并发批准只发布一次、首次个人批准默认启用；`/skills/review-open` 以系统上下文注入候选引用，聊天 role 3 kind 2 审核行；记忆维护与记忆策略补「工作流→Skill、稳定事实→记忆、不双写」；Android 待审入口/审核面板/设置角标。 |
| [298-sharing](298-sharing/README.md) | #298 技能地址安装（GitHub tree/blob 解析到固定 commit 后取 commit tarball、`github:` 简写、直接 `.tar.gz/.tgz`；严格 tar 读取拒绝路径逃逸、符号链接、硬链接、设备/FIFO 与超限，外部内容只进 `tmp/` 后走同一候选/验证/审核路径，并记录地址、固定版本、摘要与许可证；zip 明确拒绝）；共有提案按当次用户回合的显式共享措辞记录提议者与同意，共有候选仅提议者与法厄同可见、仅法厄同批准，普通用户不能批准，共有批准不写入任何人的启用偏好；个人/共有归档与恢复权限、内容/历史/偏好保留、目录与只读资源移除及在线失效；`/skills/archive|restore`、`reviewResults` 与客户端一次性提醒（复用既有通知通道/账本，无后端推送）；Android 归档/恢复、动作作用域与提醒。GitHub 网络用本地替身。 |
| [299-evolution](299-evolution/README.md) | #299 技能修订候选（必须给出可验证目标收益；完整重写；父版本/目标收益/来源；未变化场景复用旧验证、变化场景重跑并标注复用来源）；核心正文 >110% 时审核展示旧/新字符数与百分比并要求本人在展示后独立回复「确认增长」，后端按同会话、同用户、精确文本、位于最近一次 inspect 之后校验消息引用，模型布尔、伪造、乱序、跨会话与旧哈希均拒绝；批准在单个事务内复核状态/哈希/归档/当前指针/增长确认并原子切换，保留启用偏好、审核期旧版继续可用、历史版本不进入目录与只读资源；`pendingRevision` 派生；回滚以历史干净内容形成新的待审候选；Android 待审修订/增长提示。 |
| [300-learning](300-learning/README.md) | #300 后台学习：schema v2 三表（检测水位/冻结切点/认领、不可变复用信号与撤销行、所有者+任务键唯一创建认领）；1 秒 tick 的用户会话检测（阈值、静默、冻结切点、零信号推进水位、失败恢复同一子会话、完成只看持久 turn/end + 一次结构化提交）；有界材料投影；无 owner 的检测子会话只注册 `submit_signals`，任务键复用/语法与撤销；模糊证据一次独立审查，不确定不触发；两个独立会话达到门槛后原子认领，创建子会话只拥有有界证据读取/候选提交/验证执行/无改进工具，复用同一 Skill Creator、候选与验证路径；创建失败只重试认领；客户端复用既有待审提醒；`scripts/skill-acceptance.ts` 与 `npm run acceptance:skill`（`--plan` 无凭据运行，真实模型样本与调用/token 记录）。真实模型验收 2026-11-03 在 MiniMax-M3.1-Flash 上执行：8 个样本全量 8/8 通过（light 10 次 / deep 12 次，input 167,369 / output 56,774 token），验收中发现并修正了纯辅助工具区间误报（检测措辞 + 无工具/无可撤销信号的前置检查）与三个验收脚本缺陷（`maxEvents` 上限、turn 预算、同区间多信号的撤销匹配）。 |
| [295-review](295-review/README.md) | #295 两轴复审修复与真实模型验收后续：共有技能可由法厄同创建修订与回滚、修订必须关联证据、移除模型可自填的 `license`；聊天 role 3 审核行按 `skill_manage` callId 配对（`stateVersion` 7），bash 伪造同形 JSON 不产生行；提醒只对后台候选与法厄同可见的共有提案；客户端文案入 stringResource；学习子会话装配/完成/重试去重为 `learning-child.ts`；`skill_learning_state` 去掉从未写入的 `deleted_at`（对齐 `maintenance_state`）；包根导出收窄；多个 skill 套件补 `OURFAIRY_MEMORY_MAINTENANCE_TURNS=50`。真实模型验收的最终全量与修复记录见本目录与 #300 证据。 |

## Fairy Skill 系统：#295 对抗性 review 与修复轮

| 目录 | 内容 |
| --- | --- |
| [295-adversarial-review](295-adversarial-review/README.md) | 实现后六视角对抗性 review（基线 `origin/main` 8a54c46、dsh d80522d2）：开发者/可维护性、并发可靠性、Fairy 模型侧体验、用户与 Android、红队安全完整性、外部成熟实现对照。合并报告含 P0/P1/P2 分级、现状锚定、交叉验证的真实问题（审核自批/外部内容注入链、创建无限重试、信号与水位非原子、revision 复用绕过、待审入口不触发回合、后台提醒默认不可见、面板信息过度暴露、bundled 元技能名可遮蔽、SSRF/来源卫生等）、需要法厄同拍板的决策清单、值得保留的设计与原始报告索引。原始六份报告不入库（运行时输出按惯例放 work/tmp）。 |
| [295-fix-round](295-fix-round/README.md) | 2026-11-03 修复轮：按用户拍板（审核按来源分级——个人显式创建验证后可直批，其余来源与共有候选必须带展示后用户消息证据 `approvalMessageId`；不默认关网；不做 Fairy 自禁用）修复 review 的 P0/P1。落地：来源分级批准与 schema v3（approval_message_id、growth 确认 partial unique、learning attempts、revokes 索引）、不可信内容围栏、revision 内容变化强制真跑、bundled 名称保留、发布崩溃对账与启动恢复、创建 claim attempts 上限/指数退避/terminal、检测 give-up 持久化、信号+水位单事务、验证失败不 settle、settle 前重查信号、child 丢失恢复、tick 单飞与事件驱动、拒绝历史去重、安装 SSRF/重定向私网与元数据拒绝、来源卫生扩展、memory watch 谓词对齐、文件热路径去 description 读盘、bundled 正文压缩与 7700 正文上限；`/skills/review-open` 现在真正触发一次审核回合。Android 仅完成 JDK/SDK/Gradle 环境准备（`./gradlew test lintDebug` 通过）。已知限制见目录 README（DNS rebinding、旧 7701–8000 正文兼容、terminal pending 草稿、give-up 重开成本、1:N 全局准入留 #110）。 |

## Fairy Skill 系统：#295 Android 修复轮（E1–E4 + E7）

| 目录 | 内容 |
| --- | --- |
| [295-android-ux](295-android-ux/README.md) | 2026-11-03 Android 修复与体验优化轮（基于修复轮分支 `fix/295-android-ux`，基线 `origin/fix/295-adversarial-review` ac93251）。按用户拍板：范围 P1（E1 待审入口呈现/验证、E2 后台候选提醒、E3 审核展示、E4 技能面板）+ 低风险 P2 的 E7（错误码本地化 + 真实后端 envelope golden），E5/E6 与后端语义改动不做，通知门控选「技能提醒与后台接收开关解耦、技能渠道可用性为唯一门」。落地：技能页按后端派生 state 四组折叠（默认只展开进入目录）+ 首句/96 字符描述截断 + 本地名称搜索 + 头部 `pendingCount`；设置页进入即读一次待审计数并在折叠组头显示徽标；审核展示按后端 `buildReviewDisplay` 固定前缀分区（来源/适用与收益（候选自述）/验证摘要与折叠命令、阻断性 ⚠ 警告常显/审核方式/默认折叠的版本-hash-expand 详情，未识别行原样兜底）+ 候选命令「由候选提供」注记；技能提醒发布门从后台接收开关改为技能渠道可用性，补 controller→notifier 真接线与 Robolectric 生产组合测试，保持先记账后抑制不补发/前台抑制/同集合不重复等反骚扰语义；错误码只映射真能到达页面的 7 个 code（未知 code 原文兜底）并加真实 envelope golden 契约测试。两轴 review 后收口修复：审核面板文案入 stringResource（13 个 `skills_review_*` key，en/zh 集合一致）、技能池行渲染去重、E7 去除 `skills/integrity` 死映射、后端 display 组装层 `singleLine()` 把候选/模型文本换行规范为行内空格（防候选文本用换行伪造 `来源：`/`⚠`/`审核方式：` 固定前缀行，display 注入测试 11/11 + 关联回归 57/57）。门禁：Android `./gradlew test lintDebug` 696 tests / 0 failure、lint 0 error；后端 `npm test` 全量 + `npm run combo:verify` + `node scripts/evidence-index.ts --check` 全绿。未做：E5/E6、`/skills/detail` 接线、真机/模拟器/connected 测试、真实后端 E2E；无 push 通道下技能提醒仍只在生命周期观测点与服务内 60s 轮询发布（App 持续后台且后台接收关闭时靠 in-app 待审计数），后端 display 与通知标题仍硬编码中文。 |

## #225 会话读取 seam（完整页操作与任务身份访问）

| 目录 | 内容 |
| --- | --- |
| [225-page-read](225-page-read/README.md) · [225-task-lookup](225-task-lookup/README.md) · [225-closeout](225-closeout/README.md) | #225 T1/T2/T3：页读取收进 runtime.page，任务访问收进 work 单元窄查找并返回原生 JobId；收口修复两轴 Standards 发现，在最终 tip 跑全量门禁 |

## Fairy 电费账单（规格 #317）

| 目录 | 内容 |
| --- | --- |
| [317-bill](317-bill/README.md) | #318–#324 新增产品行 `@ourfairy/dsh-bill`（`plugins` 组）：从全部会话日志（含无归属的维护/学习子会话、归档会话）派生 token 四桶的日/月/累计与 30 天序列，按 `Asia/Shanghai` 切分，按持久化修订号做进程内缓存且未落盘会话一律不缓存，悬挂回合不计入；`GET /bill` 只要求认证、一次返回同一次聚合的全部数字（丁尼与 token 各一份）；请求尾部追加一段电费读数（上一回合结算值 + 本日万丁尼档位），每个新回合的首个 pre-step 重读聚合并按回合固定，因此闲置期间其他会话的消耗与上海零点都进入下一回合、同一回合内不变，仅挂用户会话，并附只读工具 `electricity_bill`；聊天投影消息行新增 `turn` 与 `usage`（输入/缓存/输出），只在回合最后一条 Fairy 行、且回合结束后出现，分页与重连后仍在；Android 账单页（三档总量 + 手绘 30 柱 + 空/失败状态）与每条回复的 token 小字。汇率 1 丁尼 = 3000 token 是单一命名常量，客户端只解码不换算。最重的声称由行为测试固定：相邻请求的消息前缀、读数在一回合内恒定、新轮刷新日累计与跨上海零点；类型检查、组合校验与后端全量 753 项、Android `test lintDebug`（742 单测 0 失败）在锁定组合 dsh `ae2adffd8d67` 上通过；真实模型与真机未执行，详见该目录 README。 |

## 界面微调（#215/#217/#218/#239/#255/#290/#291/#292）

| 目录 | 内容 |
| --- | --- |
| [ui-215](ui-215/README.md) | #215 聊天正文与屏幕左右边缘留出留白（Fairy 正文 34dp、用户正文 32dp；360dp Robolectric 断言；真机未执行） |
| [ui-217](ui-217/README.md) | #217 启动图标替换为 Fairy 徽记（五档密度、adaptive 前景/单色层与旧版位图；真机未执行） |
| [ui-218](ui-218/README.md) | #218 长按消息复制正文，含流式进行中的行；保留查看全文与 toast（真机未执行） |
| [239-idle-caption](239-idle-caption/README.md) | #239 待机台词气泡改在 Fairy 屏幕下方向下展开（411dp Robolectric 断言与前后截图；真机未执行） |
| [255-fairy-eye-highlight](255-fairy-eye-highlight/README.md) | #255 Fairy 眼睛高光随瞳孔移动、围绕移动后的瞳孔中心缩放，内侧 70% 保持原亮度、外侧 30% 渐隐（`FairyEyeTest` 固定几何；真机未执行） |
| [290-swipe-nav](290-swipe-nav/README.md) | #290 主页左划进入当前会话/共享列表、会话页右划回首页；会话页顶栏改为齿轮与 Fairy 小屏回首页，会话列表标题与底栏图标，7 条文案「后端」→「服务端」（Robolectric 断言；真机手势未执行） |
| [291-caption-exit](291-caption-exit/README.md) | #291 待机台词气泡退场时高度连续收起，下方卡片与按钮随平移回位；`FairyCaptionSlot` 保留最后一句，Reduced Motion 瞬时（411dp Robolectric 断言；真机未执行） |
| [292-tool-collapse](292-tool-collapse/README.md) | #292 工具调用默认只显示最新一次，箭头展开该步全部调用；单工具无箭头，流式增长保持收起（Robolectric 8 用例；真机未执行） |

## Triage 修复

| 目录 | 内容 |
| --- | --- |
| [146-147-triage](146-147-triage/README.md) | #146 假模型分块解码致 8000 码点断言偶发 8001；#147 store 文件头错引 AGENTS.md |
| [177-179-triage](177-179-triage/README.md) | #177 合并 chat 幂等重复用例；#178 恢复安装隔离断言；#179 证据索引改为生成 |
| [214-stream-rate](214-stream-rate/README.md) | #214 分环节测量、SSE 压缩与共享合并、背压和接收积压回归；vivo S50 限速真机验证 |

## 阶段整合与评审

| 目录 | 内容 |
| --- | --- |
| [stage-71-73](stage-71-73/README.md) | #71/#72/#73 与 #123 的集成合并：冲突取舍、全量、doctor 与组合校验 |
| [stage-t5-t6](stage-t5-t6/README.md) · [review-t5-t6](review-t5-t6/README.md) | T5–T6 整合与两轴评审 |
| [stage-t7-t9](stage-t7-t9/README.md) · [review-t7-t9](review-t7-t9/README.md) | T7–T9 整合与两轴评审 |
| [stage-t10-t12](stage-t10-t12/README.md) · [review-t10-t12](review-t10-t12/README.md) | T10–T12 整合与两轴评审 |
| [stage-t13-t15](stage-t13-t15/README.md) · [review-t13-t15](review-t13-t15/README.md) | T13–T15 整合与两轴评审 |
| [stage-t16-t19](stage-t16-t19/) · [review-t16-t19](review-t16-t19/) · [review-t16-t19-fix](review-t16-t19-fix/README.md) | T16–T19 整合、评审与修复 |
| [review-24-26](review-24-26/README.md) · [review-24-26-backend](review-24-26-backend/evidence.md) | #24–#26 阶段评审 |
| [review-arch-map69](review-arch-map69/README.md) · [review-arch-map69-fixes](review-arch-map69-fixes/README.md) | 地图 #69 最终两轴 code-review（四份逐字报告）与逐条评审项的修复/记录不修 |
| [fixes-290-291-292](fixes-290-291-292/README.md) | #290/#291/#292 小修批次：三票 octopus 合入 `e59587b62b`；#291 选本地 slot 版并关闭重复 PR #294；合并提交走全量门禁（474 npm tests、628 Android tests、combo verified） |
| [retro-guardrails](retro-guardrails/README.md) | 复盘修复验证 |

## 阅读顺序

按票号读交付证据，按阶段读整合与评审结论。两者合起来回答「这条行为在哪个提交上、用什么
命令验证过」；未执行项（真机、真实云服务、性能验收）在各 README 末尾单列。
