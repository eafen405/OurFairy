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

## 阶段整合与评审

| 目录 | 内容 |
| --- | --- |
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
