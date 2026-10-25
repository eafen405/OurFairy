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
| [arch-54-space-scope-contributors](arch-54-space-scope-contributors/README.md) | #54 SpaceScope 贡献者注册机制 |
| [arch-55-activity-trust](arch-55-activity-trust/README.md) | #55 客户端快照可信度只答一次 |
| [arch-56-notification-backlog](arch-56-notification-backlog/README.md) | #56 跨会话通知积压合并 |
| [arch-57-test-seam](arch-57-test-seam/README.md) | #57 测试 seam 收敛 |
| [arch-59-chat-read-decision](arch-59-chat-read-decision/README.md) | #59 `RemoteChatBackend.read` 去留 |
| [arch-60-foreground](arch-60-foreground/README.md) | #60 前台事实单一读取 |
| [arch-61-attempt-row-key](arch-61-attempt-row-key/README.md) | #61 attempt 行 key 约定 |
| [arch-62-interface-width](arch-62-interface-width/README.md) | #62 接口宽度收敛 |
| [arch-64-executable-claims](arch-64-executable-claims/README.md) | #64 可执行声称检查 |
| [arch-66-session-events](arch-66-session-events/README.md) | #66 会话事件单次安全读取 |
| [arch-67-projection-exports](arch-67-projection-exports/README.md) | #67 projection 多余导出 |

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

## #233 Android 呈现：attempt 行身份由后端事实派生

| 目录 | 内容 |
| --- | --- |
| [234-presentation-identity](234-presentation-identity/README.md) · [235-reading-regression](235-reading-regression/README.md) · [233-closeout](233-closeout/README.md) | 234 — T1 呈现接口：attempt 行身份由后端事实派生 · 235 — T2 阅读过渡回归：后端事实驱动行身份 · 233 — T3 收口：attempt 行身份由后端事实派生 |

## Profile 安装恢复与模板复用（规格 #229）

| 目录 | 内容 |
| --- | --- |
| [230-install-recovery](230-install-recovery/README.md) · [231-template-reuse](231-template-reuse/README.md) · [229-closeout](229-closeout/README.md) | spec #229 证据索引：#230 fake corepack 确定性安装恢复与 linked 校验、#231 真实安装发布模板后跨 home 复制/缓存闭环与损坏模板失败、#232 两轴评审处置与最终全量门禁（318 pass，combo verify 三行 ok） |

## 界面微调（#215/#217/#218）

| 目录 | 内容 |
| --- | --- |
| [ui-215](ui-215/README.md) | #215 聊天正文与屏幕左右边缘留出留白（Fairy 正文 34dp、用户正文 32dp；360dp Robolectric 断言；真机未执行） |
| [ui-217](ui-217/README.md) | #217 启动图标替换为 Fairy 徽记（五档密度、adaptive 前景/单色层与旧版位图；真机未执行） |
| [ui-218](ui-218/README.md) | #218 长按消息复制正文，含流式进行中的行；保留查看全文与 toast（真机未执行） |

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
| [retro-guardrails](retro-guardrails/README.md) | 复盘修复验证 |

## 阅读顺序

按票号读交付证据，按阶段读整合与评审结论。两者合起来回答「这条行为在哪个提交上、用什么
命令验证过」；未执行项（真机、真实云服务、性能验收）在各 README 末尾单列。
