# Android 客户端

客户端是产品的前端壳：语义由后端定义，它只负责呈现与提交。凡是与产品共享的概念，定义在根
[GLOSSARY.md](../GLOSSARY.md)；本文只收客户端独有、且需要说清才能开工的词。

客户端代码给后端事实一律加 `Remote` 前缀。后端有、客户端不呈现的能力（空间、群组、长期记忆、
检索、PDF 读页），是本版的边界，不是遗漏。

## Language

**Fairy 当前表现**（`FairyPresence`，规格中亦称存在感）：
Fairy 窗口显示的"此刻在做什么"，取值为待机、思考、说话、连接中、离线。由连接状态与会话活动
合成，是呈现层的事实，不回写后端。
_Avoid_: 状态、运行状态

**Fairy 互动**：
由本机操作、会话活动或投递消息引起的 Fairy 当前表现、眼部反应与台词；不回写后端，也不改变
Fairy 的 active、wandering、sleeping 状态。
_Avoid_: 后端活动、Fairy 状态

**当前会话**：
客户端最近选择、未选择时回退主会话的会话；只决定默认呈现与进入目标，不改变主会话地位。
_Avoid_: 主会话、选中会话

**待机**（`asleep`）：
Fairy 屏幕的休眠表现：控制台约三分钟无操作、且没有台词在播时进入，点击唤醒。它由 Fairy 互动
module 持有，跨页保留并在两页的眼屏上呈现；指屏幕，不指 Fairy。
_Avoid_: 睡着、sleeping（后者是 Fairy 的状态）

**后台接收**（`RemoteReceiveState`）：
应用不在前台时仍保持会话同步的开关，以及实施它的服务。关闭后客户端不再观察会话，提醒随之停止。
_Avoid_: 后台运行、推送

**提醒**：
一次会话活动最多只发出一条通知的记账：先记下欠着，再由接收侧统一发出。它与"投递消息"不是同一件事
——投递是 Fairy 发出的内容，提醒是本机对它的通知。
_Avoid_: 通知、推送

**通知定位**（`RemoteNotificationTarget`）：
一条通知指向的坐标：后端端点、用户编号、会话。只有当前账号与当前端点能接纳它，其余一律忽略。
_Avoid_: 深链接、跳转

**目的地**（`FairyDestination`）：
客户端导航中可独立到达、并参与身份准入与冷启动恢复的页面。每个目的地在 catalog 里登记一次，
页面装配、准入与恢复策略都读那一处；浮层不是目的地。
_Avoid_: 页面、路由、屏幕

**会话列表浮层**（`SessionListOverlay`）：
控制台与会话页共用的会话列表。打开、关闭与选择都发生在当前页面上，不进入返回栈，也不改变
冷启动恢复位置。
_Avoid_: 会话列表页、会话列表目的地

**目的地 catalog**（`FairyDestinations`）：
进程内静态的目的地表。它拥有目的地词汇、页面装配、身份准入与恢复策略；不扫描、不远程配置，
新增目的地靠对 `Screen` 的穷尽 `when` 在编译期强制登记。生产路由、通知落点与页面测试读同一份表。
_Avoid_: 路由表、导航图、插件注册

**冷启动恢复**（`FairyLastLocation` + `DestinationRestore`）：
上一次运行记下的目的地坐标，在下一次冷启动、凭据被接纳之后重开的返回栈。哪些目的地可恢复、
恢复到哪个栈由 catalog 声明；凭据页永远不是恢复位置。
_Avoid_: 断点续传、自动登录

**附件去处**（`RemoteAttachmentDestination`）：
点会话附件后去哪里：图片预览、文本预览、外派系统应用、另存为。唯一路由入口是
`remoteAttachmentOpenDestination(mime, name, bytes)`：有可信 MIME 时以 MIME 为准（去参数、转小写），
`application/octet-stream` 或缺失时才由后缀推定有效类型（`attachmentMimeFor`），未知后缀为
`application/octet-stream`；文本超过 2 MiB 不在应用内展开，转外派。外派交给系统应用的类型与路由
读取的类型都是这个有效类型，因此 `octet-stream` 的 `.docx` 以 Word 文档类型交接。文本预览内
Markdown 与纯文本的取舍由 `remoteAttachmentTextLayout(mime, name)` 给出：有效类型为 `text/markdown`
或后缀属于 `MARKDOWN_SUFFIXES` 时为 Markdown，其余为等宽纯文本。卡片只上报点击，不自己猜类型。
外派是真正的交接：先把原件缓存到 `attachment-preview/`，再用 FileProvider 的 `content://` URI 以
`ACTION_VIEW` 直接交给系统解析（多个应用匹配时由系统解析器让用户选择），附临时读授权。外派不套
`Intent.createChooser`：AOSP 的 chooser activity 对零目标也会正常解析，因而吞掉「没有接收方」这个
信号；裸 `ACTION_VIEW` 在没有匹配 activity 时抛 `ActivityNotFoundException`，据此回落到另存为并
复用已缓存的同一份字节。四类结果、2 MiB 上限与有效类型由 `RemoteAttachmentDestinationTest` 固定，
Markdown 取舍由 `RemoteAttachmentTextTest` 固定，面板去向由 `RemoteAttachmentPreviewTest` 固定，
外派的意图、有效 MIME 与回落由 `RemoteAttachmentHandoffTest` 与 `RemoteAttachmentExternalTest` 固定。
_Avoid_: 文件类型判断、MIME 猜测

**附件预览缓存**（`attachmentPreviewFile`）：
应用缓存 `attachment-preview/` 子目录里按（会话、消息、附件序号）坐标目录派生的预览文件；坐标
只决定目录，目录里的文件名是清洗后的原始显示名，好让系统查看器显示原名。图片、文本与外派共用
面板 `cachePreview` 下载的这份字节；同一附件重复打开复用它。普通另存为写入独立临时文件后导出，
不经过这份预览缓存；只有外派没有接收方、回落到另存为时才复用缓存里的同一份字节，不二次下载。
图片与文本预览关闭时由共享的 `DeleteCachedPreviewOnDispose` 删除该文件，已另存的文件不受影响。
外派给系统应用的文件不在交接后立即删除，下一次外派打开时清扫其余坐标目录。
缓存路径由 `RemoteAttachmentPreviewFileTest` 固定；一次下载、复用与过期 epoch 由
`RemoteAttachmentStateTest` 固定；关闭清理由 `RemoteAttachmentPreviewTest` 固定；外派清扫由
`RemoteAttachmentHandoffTest` 与 `RemoteAttachmentExternalTest` 固定。
_Avoid_: 下载目录、缩略图缓存、临时下载

