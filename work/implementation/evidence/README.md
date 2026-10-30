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

## Android Fairy 互动：统一存在感、反应与台词编排（规格 #256）

| 目录 | 内容 |
| --- | --- |
| [260-unified-presence](260-unified-presence/README.md) | #260 新建进程级 `FairyInteraction` deep module（纯 Kotlin，装配层注入 `SystemClock::uptimeMillis` 与 `Random.Default`）统一 Fairy 当前表现：对话页私有的六分支 `fairyWindow()` 收进 `window(facts)`，首页按 `selectedId ?: primarySessionId` 只观察当前会话（缺省回退主会话），页面不再各自合成 presence；活动未知沿用 `RemoteChatSnapshot.activity` 的既有答案（unknown ≠ quiet，module 拿不到原始事件）；`RemoteReceiveState.chats` 内存 map 改为可观察 `runtimes: StateFlow<Map<String, RemoteChatState>>`，首页能跟随当前会话运行时的出现/退役；`Impression`/`Gateway` 的 presence 调用收口；新增 20 个纯 JUnit 用例与 5 个页面接线用例 |
| [261-interaction-continuity](261-interaction-continuity/README.md) | #261 屏幕待机、台词选择与最近台词记忆收进同一 module：`tick()`/`touch(): Boolean`/`captionFinished()`/`pageExit()`，45s 首句、60–90s 下一句、180s 待机由 module 判定，待机只在控制台进入而状态跨页保留（对话页呈现同一 `asleep` 并经 module 唤醒，GLOSSARY 同步）；`FairyUiMemory` 实现窄接口 `FairyLineMemory` 成为唯一记忆；按「原来零调用方 → 已删」删除 `chatPool`/`CHAT_AVOID`、`FairyCaption(compact)`、`sleepNow`、整条 `drowsy`/`snaps` 路径与无生产者的 `FairyWindowState.eye`；对话页首次拥有 `FairyEyeController`；32 个 module 用例 + 2 个页面用例（待机跨页、离页不补播） |
| [262-fairy-reactions](262-fairy-reactions/README.md) | #262 真实事件触发反应：本地发送经 `sent(requestId)` 只给短暂注意反应、不伪造后端 THINKING；Fairy 输出/投递/完成经 `fairyFacts()` 的 `newestFairyOutput().seq`/`delivery`/`completed`，用只增的 `(sessionId,seq)`、`(episodeId,seq)`、`(episodeId,finishedSeq)`、`requestId` 去重，活动未知时不算事件；`foregrounded(context, facts)` 以运行时当前快照为基线、不补播后台积压的事件；`FairyEyeReactions` 把 SENT/OUTPUT/DELIVERY/COMPLETED 映射到既有眼睛；删除零调用方 `attend`/`startle`，`glanceAt`/`blink` 接真实事件，`speechPulse` 改由 module 生产、SPEAKING 新输出才脉冲；53 个 module 用例 + 4 个页面用例（含 ActivityScenario 前后台与 Reduced Motion） |
| [256-review-fixes](256-review-fixes/README.md) | #256 收口两轴评审修复：页面改渲染 module 快照的 `window`（同一上下文无事实的过渡帧沿用上一页表现，换会话/登出仍为未知）；`pageExit` 结算 caption/reaction/speechPulse 并按呈现号忽略过期离页；回前台无事实时保持未观察直到第一份事实到达；待机中的视线反应当下播放、不排队到醒来；`retryPending()` 返回是否真正受理、panel 只在受理时上报；抽出 `FairyPageHost` 共用眼睛/待机同步/生命周期/手势/反应接线；恢复「存在感」词条并删除 #257 词；页面 seam 补可见结果、可注入眼睛与手势断言；最终 Android `test lintDebug assembleDebug` 52 suites/427 tests/0 failures/0 lint errors、3 个 debug APK，根 `npm test` 430/430；真机验收未执行 |

## 界面微调（#215/#217/#218/#239/#255）

| 目录 | 内容 |
| --- | --- |
| [ui-215](ui-215/README.md) | #215 聊天正文与屏幕左右边缘留出留白（Fairy 正文 34dp、用户正文 32dp；360dp Robolectric 断言；真机未执行） |
| [ui-217](ui-217/README.md) | #217 启动图标替换为 Fairy 徽记（五档密度、adaptive 前景/单色层与旧版位图；真机未执行） |
| [ui-218](ui-218/README.md) | #218 长按消息复制正文，含流式进行中的行；保留查看全文与 toast（真机未执行） |
| [239-idle-caption](239-idle-caption/README.md) | #239 待机台词气泡改在 Fairy 屏幕下方向下展开（411dp Robolectric 断言与前后截图；真机未执行） |
| [255-fairy-eye-highlight](255-fairy-eye-highlight/README.md) | #255 Fairy 眼睛高光随瞳孔移动、围绕移动后的瞳孔中心缩放，内侧 70% 保持原亮度、外侧 30% 渐隐（`FairyEyeTest` 固定几何；真机未执行） |

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
| [retro-guardrails](retro-guardrails/README.md) | 复盘修复验证 |

## 阅读顺序

按票号读交付证据，按阶段读整合与评审结论。两者合起来回答「这条行为在哪个提交上、用什么
命令验证过」；未执行项（真机、真实云服务、性能验收）在各 README 末尾单列。
