# 父规格 75 条用户故事与承接票

本表由 `docs/specs/ourfairy-v1.md` 的故事列表与 `work/tickets/ourfairy-v1/README.md` 的「用户故事覆盖」逐条对照生成，不是另抄一份故事正文。每条故事指向承接它的实施票与对应证据目录；交付验收的实际命令、结果与未执行项在 [21-integration README](README.md)。

| # | 用户故事 | 承接票与证据 |
| --- | --- | --- |
| 1 | 作为法厄同，我希望生成邀请码，以便邀请指定的人加入。 | #26 [03-identity](../03-identity/README.md) |
| 2 | 作为受邀代理人，我希望通过邀请码注册并登录，以便拥有自己的身份和会话。 | #26 [03-identity](../03-identity/README.md) |
| 3 | 作为用户，我希望拥有按注册顺序分配的简短用户编号，以便 Fairy 能明确指定投递对象。 | #26 [03-identity](../03-identity/README.md) |
| 4 | 作为法厄同，我希望自己的用户编号为 1，并由 Fairy 称呼为“主人”，以便身份与既定角色一致。 | #26 [03-identity](../03-identity/README.md)、#28 [05-remote-chat-backend](../05-remote-chat-backend/README.md) |
| 5 | 作为用户，我希望在同一个 APK 中看到符合自身身份的入口，以便无需维护不同客户端。 | #26 [03-identity](../03-identity/README.md)、#43 [20-gateway](../20-gateway/README.md) |
| 6 | 作为法厄同，我希望在网关管理共用供应商、模型和 ASR 连接配置，并让所有会话从下一轮回复采用选定模型，以便维护系统且不打断正在执行的回复。 | #43 [20-gateway](../20-gateway/README.md) |
| 7 | 作为代理人，我希望通过对话使用 Fairy，以便不必接触系统管理配置。 | #26 [03-identity](../03-identity/README.md)、#43 [20-gateway](../20-gateway/README.md) |
| 8 | 作为用户，我希望系统管理者也不能凭管理身份读取我的个人内容，以便管理与个人隐私分别受到约束。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md) |
| 9 | 作为用户，我希望共享模型配置时仍保持自己的上下文独立，以便他人的对话不混入我的会话。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md) |
| 10 | 作为用户，我希望切换账号或重新连接后内容仍属于正确身份，以便旧请求和迟到事件不会显示到另一个账号。 | #26 [03-identity](../03-identity/README.md)、#29 [06-reconnect-backend](../06-reconnect-backend/README.md) |
| 11 | 作为用户，我希望创建、列出并切换自己的多个会话，以便分开处理不同事情。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md) |
| 12 | 作为用户，我希望每个会话始终归属于创建它的用户，以便重启或恢复不会改变访问范围。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md) |
| 13 | 作为用户，我希望拥有固定主会话并能随时返回它，以便找到 Fairy 向我投递的内容。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md) |
| 14 | 作为用户，我希望新建或使用其他会话不改变主会话，以便投递入口保持稳定。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md) |
| 15 | 作为用户，我希望从手机向后端 Fairy 发送消息并接收回复，以便执行能力不受手机本地运行环境限制。 | #28 [05-remote-chat-backend](../05-remote-chat-backend/README.md) |
| 16 | 作为用户，我希望应用切后台或网络断开后后端继续执行，以便工作不会因连接变化被取消。 | #29 [06-reconnect-backend](../06-reconnect-backend/README.md)、#36 [13-jobs](../13-jobs/README.md) |
| 17 | 作为用户，我希望显式停止当前回复，以便控制本轮处理，而不误停独立运行的后台任务。 | #28 [05-remote-chat-backend](../05-remote-chat-backend/README.md)、#36 [13-jobs](../13-jobs/README.md) |
| 18 | 作为用户，我希望重新连接后恢复已经保存的历史和当前状态，以便接着阅读而不重复或漏掉内容。 | #29 [06-reconnect-backend](../06-reconnect-backend/README.md) |
| 19 | 作为用户，我希望 Fairy 能搜索我自己的其他会话，以便找回相关讨论。 | #33 [10-conversation-search](../10-conversation-search/README.md) |
| 20 | 作为用户，我希望搜索结果带会话标识、原事件位置和命中消息片段，以便继续准确读取上下文。 | #33 [10-conversation-search](../10-conversation-search/README.md) |
| 21 | 作为用户，我希望 Fairy 按指定事件区间读取本人会话并排除工具结果，以便获取相关对话内容。 | #33 [10-conversation-search](../10-conversation-search/README.md) |
| 22 | 作为用户，我希望他人即使知道我的会话标识也无法读取、控制或订阅它，以便编号不会成为访问凭据。 | #27 [04-owned-sessions-backend](../04-owned-sessions-backend/README.md)、#33 [10-conversation-search](../10-conversation-search/README.md) |
| 23 | 作为用户，我希望 Fairy 保持部署提供的游戏人格与简洁回复风格，并与外部材料区分来源，以便聊天中的改写要求、文件或检索内容不会变成系统配置。 | #28 [05-remote-chat-backend](../05-remote-chat-backend/README.md) |
| 24 | 作为用户，我希望 Fairy 能使用我的私有空间、公有空间和我所属的群组空间，以便在获准范围内工作。 | #30 [07-space-execution](../07-space-execution/README.md)、#31 [08-group-spaces](../08-group-spaces/README.md) |
| 25 | 作为用户，我希望公有空间的文件可以直接共享使用，以便协作时无需逐文件设置权限。 | #30 [07-space-execution](../07-space-execution/README.md) |
| 26 | 作为用户，我希望通过对话和交付物参与文件工作，以便无需直接管理后端空间目录。 | #30 [07-space-execution](../07-space-execution/README.md) |
| 27 | 作为法厄同，我希望通过与 Fairy 对话创建群组并指定群主，以便组织共享文件范围。 | #31 [08-group-spaces](../08-group-spaces/README.md) |
| 28 | 作为群主，我希望通过 Fairy 添加和移除自己群组的成员，以便管理协作范围。 | #31 [08-group-spaces](../08-group-spaces/README.md) |
| 29 | 作为普通群组成员，我希望只有有资格的管理者能改变成员关系，以便其他成员不能借工具或提示词取得管理权。 | #31 [08-group-spaces](../08-group-spaces/README.md) |
| 30 | 作为用户，我希望文件工具与脚本执行遵守同一空间范围，以便换一种工具也不会绕过权限。 | #30 [07-space-execution](../07-space-execution/README.md)、#31 [08-group-spaces](../08-group-spaces/README.md) |
| 31 | 作为用户，我希望 Fairy 能联网并安装工作所需依赖，以便完成实际任务，同时保持文件范围约束。 | #30 [07-space-execution](../07-space-execution/README.md) |
| 32 | 作为用户，我希望改变工作目录不会扩大可访问范围，以便目录设置不会影响权限规则。 | #30 [07-space-execution](../07-space-execution/README.md) |
| 33 | 作为用户，我希望让 Fairy 向指定用户编号投递文字和可选文件，以便明确交付我选择的内容。 | #34 [11-text-delivery](../11-text-delivery/README.md)、#35 [12-file-delivery](../12-file-delivery/README.md) |
| 34 | 作为用户，我希望一次明确投递无需再次进行分享审批，以便授权后的交付能够完成。 | #34 [11-text-delivery](../11-text-delivery/README.md)、#35 [12-file-delivery](../12-file-delivery/README.md) |
| 35 | 作为发送方用户，我希望投递只包含指定内容，以便不会隐式复制本会话其他上下文。 | #34 [11-text-delivery](../11-text-delivery/README.md)、#35 [12-file-delivery](../12-file-delivery/README.md) |
| 36 | 作为收件用户，我希望投递进入固定主会话并显示为普通 Fairy 消息，以便直接阅读和继续回应。 | #34 [11-text-delivery](../11-text-delivery/README.md) |
| 37 | 作为收件用户，我希望投递本身不启动新的推理，以便 Fairy 等待我的响应。 | #34 [11-text-delivery](../11-text-delivery/README.md) |
| 38 | 作为收件用户，我希望以后回复时 Fairy 能看到已收到的投递历史，以便对话能够延续。 | #34 [11-text-delivery](../11-text-delivery/README.md) |
| 39 | 作为用户，我希望网络重试或进程故障后的恢复不会重复插入同一次投递，以便消息历史保持一致。 | #34 [11-text-delivery](../11-text-delivery/README.md) |
| 40 | 作为用户，我希望投递附件准备失败时不会被告知完整送达，以便送达结果可信。 | #35 [12-file-delivery](../12-file-delivery/README.md) |
| 41 | 作为用户，我希望系统提醒失败不会撤销已保存消息，以便重连后仍能读到它。 | #34 [11-text-delivery](../11-text-delivery/README.md) |
| 42 | 作为用户，我希望选择并上传附件，在取得有效引用后发送，以便手机文件能交给后端处理。 | #32 [09-attachments-backend](../09-attachments-backend/README.md) |
| 43 | 作为用户，我希望有资格的收件会话能下载收到的原始文件，以便获取完整交付物。 | #32 [09-attachments-backend](../09-attachments-backend/README.md)、#35 [12-file-delivery](../12-file-delivery/README.md) |
| 44 | 作为用户，我希望不能用其他人的附件引用读取文件，以便存储去重不会变成越权通道。 | #32 [09-attachments-backend](../09-attachments-backend/README.md)、#35 [12-file-delivery](../12-file-delivery/README.md) |
| 45 | 作为用户，我希望 Fairy 启动长脚本后可以继续处理对话，以便无需等待整个任务结束。 | #36 [13-jobs](../13-jobs/README.md) |
| 46 | 作为用户，我希望通过活动卡及详情查看任务状态和输出，以便了解进展。 | #36 [13-jobs](../13-jobs/README.md) |
| 47 | 作为用户，我希望单独停止后台任务，以便结束指定工作而不混淆“停止回复”。 | #36 [13-jobs](../13-jobs/README.md) |
| 48 | 作为用户，我希望任务结果回到原会话，以便工作和结果保持关联。 | #36 [13-jobs](../13-jobs/README.md) |
| 49 | 作为用户，我希望同会话仍有后台任务时保持激活，以便状态反映仍未完成的工作。 | #37 [14-activity](../14-activity/README.md) |
| 50 | 作为用户，我希望任务结束与实际结果报告连成同次活动，以便不会因短暂状态间隙重复提醒。 | #37 [14-activity](../14-activity/README.md) |
| 51 | 作为用户，我希望不同会话独立计算活动，以便一个长任务不阻止其他会话结束时提醒。 | #37 [14-activity](../14-activity/README.md)、#45 [22-device](../22-device/README.md) |
| 52 | 作为用户，我希望任务输出缺失或服务器重启后的未知状态被如实说明，以便不误以为日志完整或任务已成功。 | #36 [13-jobs](../13-jobs/README.md)、#45 [22-device](../22-device/README.md) |
| 53 | 作为用户，我希望应用在前台时统一不弹系统通知，以便使用任何页面时都不被重复打扰。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 54 | 作为用户，我希望后台静默会话收到投递并输出时提醒一次，以便及时注意新内容。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 55 | 作为用户，我希望同次活动结束时不再次重复提醒，以便投递的输出和静默不会造成双重打扰。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 56 | 作为用户，我希望后台工作最终结束且本次活动尚未提醒时收到一次通知，以便知道结果可以查看。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 57 | 作为用户，我希望重连后每个会话的积压合成一条提醒，以便不会逐条重放历史通知。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 58 | 作为用户，我希望不同会话使用独立通知位置，点击后进入对应会话，以便快速定位内容。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 59 | 作为用户，我希望第一次启用后台提醒时得到必要设置指引，拒绝后仍可从设置进入，以便自主决定且不被反复弹窗。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 60 | 作为用户，我希望能看到接收状态及系统限制，以便理解锁屏、断网或进程停止时提醒可能延迟。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 61 | 作为新设备用户，我希望首次同步旧历史后建立当前通知基线，以便不会为全部旧消息补发通知。 | #38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 62 | 作为用户，我希望普通断线沿有效消费记录补齐，而记录无法恢复时采用明确的初始化规则，以便恢复行为可预期。 | #29 [06-reconnect-backend](../06-reconnect-backend/README.md)、#38 [15-notifications](../15-notifications/README.md)、#45 [22-device](../22-device/README.md) |
| 63 | 作为用户，我希望用语音转写得到可编辑文字草稿，以便核对后再发送消息。 | #39 [16-asr](../16-asr/README.md) |
| 64 | 作为用户，我希望取消、识别失败或切换输入归属时不会把迟到文字写入错误草稿，以便输入内容可靠。 | #39 [16-asr](../16-asr/README.md) |
| 65 | 作为用户，我希望语音识别可用性和错误被清楚反馈，以便不会把无密钥、超时等情况当成成功转写。 | #39 [16-asr](../16-asr/README.md) |
| 66 | 作为用户，我希望 Fairy 按页读取文字型 PDF 并保留页码，以便定位回答所依据的原文。 | #40 [17-pdf-text](../17-pdf-text/README.md) |
| 67 | 作为用户，我希望扫描页、图表和复杂排版可以按需转为页面图片读取，以便 PDF 阅读覆盖已确认范围。 | #41 [18-pdf-vision](../18-pdf-vision/README.md)、#45 [22-device](../22-device/README.md) |
| 68 | 作为用户，我希望长 PDF 按需选择页面并保留原件，以便控制处理成本并继续追问或下载。 | #40 [17-pdf-text](../17-pdf-text/README.md)、#41 [18-pdf-vision](../18-pdf-vision/README.md) |
| 69 | 作为用户，我希望损坏、加密或超限文件的读取结果明确，以便不把不完整内容误认为全文成功。 | #40 [17-pdf-text](../17-pdf-text/README.md)、#41 [18-pdf-vision](../18-pdf-vision/README.md) |
| 70 | 作为用户，我希望保留 Fairy 眼睛动效、回复面板及视觉方向，以便客户端保持熟悉的体验。 | #42 [19-presentation](../19-presentation/README.md) |
| 71 | 作为用户，我希望在设备本地调整深浅色和字体显示，以便阅读符合自己的偏好。 | #42 [19-presentation](../19-presentation/README.md) |
| 72 | 作为用户，我希望长回复不会越长越落后，也能在流式期间顺畅滚动，以便及时阅读已经收到的内容。 | #42 [19-presentation](../19-presentation/README.md)、#45 [22-device](../22-device/README.md) |
| 73 | 作为用户，我希望输出期间可先阅读原始纯文本，而结束后完整呈现代码、表格、公式和 Markdown，以便及时性与最终格式都得到满足。 | #42 [19-presentation](../19-presentation/README.md)、#45 [22-device](../22-device/README.md) |
| 74 | 作为用户，我希望停止、错误和恢复历史时也保留完整已收正文并正确收尾，以便不丢最后内容或永久停在未完成格式。 | #42 [19-presentation](../19-presentation/README.md)、#45 [22-device](../22-device/README.md) |
| 75 | 作为用户，我希望流式转完整格式时阅读位置连续，以便不会突然跳动、闪空白或重新播放旧内容。 | #42 [19-presentation](../19-presentation/README.md)、#45 [22-device](../22-device/README.md) |

计数：75 条故事；承接票 22 张。
