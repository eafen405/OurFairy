# 实施证据索引

每张实施票与每轮阶段整合在 `work/implementation/evidence/<slug>/` 留下一份 README：改了什么、
实际跑了哪些命令、结果如何、哪些没有执行。本文件是这些目录的入口。

结论、实际命令与输出摘要写在各自的 `README.md`；原始运行输出（`*.log`、JUnit XML、APK JSON 等）
不入库，重放时按 README 记录的命令在当时的 fixed commit 上执行。2026-10-17 之前合并的目录仍带
原始输出，其后新增的证据按 `work/implementation/CONVENTIONS.md` §5 执行。冻结的源码快照
（`*.patch`、`*.diff`、`mcode-*/` 下的 `*.kt`）与可复跑脚本（`*.sh`、`*.mjs`）仍随目录保留。

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
