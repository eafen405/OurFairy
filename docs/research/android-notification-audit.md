> 2026-10-20 状态：现行。本文记录 2026-10-14 的判断，不描述当前实现。

# Android / vivo 通知结论审计

审计日期：2026-10-14。对象：`domestic-android-notification-vivopush-revival.md` 与 `docs/decisions/.tmp-q4-brief.md`。本审计独立读取 Android Developers 官方中国镜像正文、vivo 开放平台 `webapi/doc/info?id=…` 正文，不以旧研究的引用互相证明。未修改旧研究、未实机测试、未注册开发者账号。

## 影响当前决策的纠正

### 1. Force Stop 与 Android 13 Task Manager Stop 混淆（明确错误）

旧研究 §2.4 / §5.4 及 brief 声称 Android 15 stopped state 下 jobs/alarms 仍可运行。该描述属于 **Android 13+ 通知抽屉 Task Manager 的 Stop**：官方逐项写明移除整应用进程、移除 FGS 通知，同时保留 scheduled jobs 和 alarms。[官方 Stop 文档](https://developer.android.google.cn/develop/background-work/services/fgs/handle-user-stopping?hl=en)

**设置 Force Stop** 进入 package `FLAG_STOPPED`，官方 Android 15 说明要求通过用户直接或间接操作解除 stopped state；并取消所有 pending intents。不能据 Task Manager Stop 文档承诺设置强停后轮询回退仍执行。旧研究“只有主动重新打开应用”也过窄：官方列出的解除方式包括 sharesheet 等间接用户交互。[Android 15 stopped state](https://developer.android.google.cn/about/versions/15/behavior-changes-all?hl=en#stopped-state)

普通系统内存回收既不同于 Force Stop，也不同于 Task Manager Stop；WorkManager 的持久任务跨进程重启/设备重启保留，但执行仍服从调度约束、Doze 等条件，不能称为“完全不影响执行时间”。[WorkManager 官方说明](https://developer.android.google.cn/topic/libraries/architecture/workmanager?hl=en)

**决策影响：**“进程被杀”不能作为单一状态定义通知保证。至少拆为普通回收、用户 Task Manager Stop、设置 Force Stop；服务端事件仍可持久保存，及时通知是否出现与之后是否可补取是不同问题。

### 2. Doze 维护窗口含义写反；遗漏可用网络豁免（明确错误与过度绝对化）

旧研究 §2.2 / §5.2 写“进入 Doze 维护窗口后暂停网络”。官方相反：Doze 平时暂停网络，**maintenance window 暂时退出 Doze，执行 pending syncs/jobs/alarms，并允许网络访问**；窗口结束才再次限制网络。[Doze 官方说明](https://developer.android.google.cn/training/monitoring-device-state/doze-standby?hl=en#understand_doze)

“前台服务连接不能豁免”应改为“仅持有 FGS 不自动获得 Doze 网络豁免”。同一官方文档 `Support for other use cases` 明确：部分豁免名单中的应用可在 Doze/App Standby 中使用网络及持有 partial wake locks；仍有其他限制。可用 `isIgnoringBatteryOptimizations()` 检查是否豁免。vivo 自有后台管理是否与该名单同一含义，未核实。

**决策影响：**可以判断普通、未豁免后台长连接没有持续及时收信保证，但不能把所有用户配置下长连接都断言为“平台物理冻结”。锁屏也不等于已经进入 Doze。

### 3. dataSync 6h/24h 限制存在，但 brief 缺前提且超时处理不准确

官方规定：在 **Android 15+ 设备、应用 target Android 15/API 35+ 的常规条件下**，应用在后台时 `dataSync` 与 `mediaProcessing` 类型各有 24h 内累计 6h 预算，同一类型的多个服务共享预算。用户将应用带回前台会重置计时。官方还提供在 Android 15 设备对低 target 应用启用兼容性开关进行测试的方式。[FGS timeout 官方正文](https://developer.android.google.cn/develop/background-work/services/fgs/timeout?hl=en)

到限时回调 `Service.onTimeout(int, int)`，此时服务不再被视为 FGS；**应用应在几秒内调用 `stopSelf()`**，否则抛内部 `RemoteServiceException`，不是一句“系统主动正常停止”可以概括。该类型超时文档明确描述 crash；不能混写成“ANR/Crash”。旧研究引用的 `DEFAULT_SERVICE_TIMEOUT = 20*1000 * HW_TIMEOUT_MULTIPLIER` 是另一个普通服务执行超时常量，无法证明 dataSync 的 6h 预算。本轮没读取到 AOSP 原文，不对其具体配置默认值作新的源码断言。

**决策影响：**长期后台 dataSync 不能承诺全天运行；但 6h 不是所有 Android 版本、所有 FGS 类型、所有网络连接的统一上限。应确认目标设备 Android 版本、客户端 targetSdk、实际服务类型及超时回调；“后台收信服务”职责本身也不证明 dataSync 类型选择合理。

### 4. 未上架不能正式推送，不等于完全不能收到推送

直接读取 [vivo FAQ id=156](https://dev.vivo.com.cn/documentCenter/doc/156)：“应用未上架时，或者应用审核状态为审核中，推送权限为【受限】可以接入 vivo 推送，测试推送能力”；测试每天每应用 1000 条、无设备频控、`pushMode=1`；只能发送当前联网设备。FAQ 同时写“应用不存活状态下，可以收到 vivo 推送平台的消息”，但未单独明确所有测试状态组合。

[消息限制 id=695](https://dev.vivo.com.cn/documentCenter/doc/695) 再次确认受限测试 API 能力。[FAQ](https://dev.vivo.com.cn/documentCenter/doc/156) 也确认正式线上能力要求上架。

旧 brief 用 ✗ 和“物理边界”把政策资格与技术能力混为一谈。正确结论是：**正式线上推送目前不满足资格；文档存在受限测试路径，其是否向本项目主体开通、是否适合长期个人使用、进程结束时能否测试送达，均未实证。**“自用签名 APK = 受限权限”也缺实际注册/控制台状态证据，签名方式本身不等于已获测试资格。

**决策影响：**不能在没有账号/设备验证的情况下排除一切 vpush 可能性，也不能据测试额度把其当可正式长期运行的承诺。

### 5. 新发现：本地通知也受 vivo 分类/备案影响（此前严重遗漏）

旧研究虽引用 [本地通知分类管理 id=930](https://dev.vivo.com.cn/documentCenter/doc/930)，却未吸收正文。该官方指南明确：

- 所有正在使用或计划发送本地通知的应用需分类管理。
- 未备案渠道默认按运营消息、静默提醒处理；仅用户下拉通知栏时展示，**不触发悬浮、锁屏、响铃、震动等强提醒**（常见问题 2）。
- 系统消息渠道需要提交渠道 ID/name/场景备案，审核通过后生效；同一 CHANNEL_ID 不得发送不同二级分类。
- 已被管控的渠道后来备案为系统消息不会直接恢复提醒；文档称重装触发重建时才按最新备案重判（常见问题 11）。

[分类 id=359](https://dev.vivo.com.cn/documentCenter/doc/359) 独立确认：本地通知默认运营，系统消息需先完成渠道申请；运营默认仅下拉栏展示，系统默认支持强提醒。本地通知“消息数量限制”表填“待定”，不是“完全由产品策略决定”的依据。

**适用范围限制：**以上是当前 vivo 开放平台官方通用规则。“所有正在使用或计划发送本地通知的应用”是指南的原文范围，不是本轮对所有自用 APK 行为的实测结论。正文没有明确具体 OriginOS/机型 rollout、未接入 vivo SDK 的 APK 是否同样检测、已上架与侧载应用是否完全一致，也未证明用户手动调整能否覆盖未备案限制。指南申请流程要求注册开发者、创建应用和申请推送，但该行政流程不能单独证明客户端执行控制必然依赖 SDK。备案规则涵盖系统/运营分类；文档说未备案默认运营静默，并不说未备案通知完全无法发出。本轮不能宣称已证实 vivo S50 对本 APK 一定如此，应把这些作为目标机验收缺口。即便如此，旧 brief 将“授权 POST_NOTIFICATIONS/用户设置”视作本地锁屏横幅的充分条件，证据不足，必须把渠道分类与实际 ROM 行为纳入决策。

### 6. “本地通知没有平台级频控”过于绝对

Android 官方明确：Android 8.1/API 27+ 同一应用的通知**声音最多每秒一次**，同秒通知可都显示但只第一条发声。[Build notification 官方 Note](https://developer.android.google.cn/develop/ui/views/notifications/build-notification?hl=en)

这不是 vpush 每日两条额度，也不是通知内容被丢失；但足以反驳“没有平台级频控/完全由产品决定”的笼统表述。vivo 当前本地通知数量限制写“待定”，并有分类展示规则，不能套用 vpush 的 2 条/天数字到本地通知。

## 复核后可以保留的事实（需保持限定）

- [vivo id=695](https://dev.vivo.com.cn/documentCenter/doc/695)：一般运营消息每用户每日 2 条；符合新闻资质的新闻类 5 条。系统消息每用户接收数量无限制，但**应用每日总量默认仍受 20 倍通知开启有效用户数额度约束**；IM 可申请提升，其他五类可走模板不限量，不能只用“系统消息不限量”概括。
- 同页：运营服务器发送/手机接收时段 7:00–23:00，系统消息不受时段限制；运营时段外发送返回 10071，且不会再下发，并非自动等到早晨送达。
- 同页：非 vivo 官方渠道安装默认关闭的是运营消息接收权限，系统消息默认允许；不能将侧载安装本身等同所有 vpush 不可用。
- [vivo FAQ id=156](https://dev.vivo.com.cn/documentCenter/doc/156)：只支持文本通知、不支持透传；vpush 不支持自定义 channelid；锁屏/横幅要用户开启。通知展示可携带点击数据，**“无透传消息类型”不能推导成“通知无法携带任何 payload/定位参数”**。
- [vivo 分类 id=359](https://dev.vivo.com.cn/documentCenter/doc/359)：IM 定义真实用户间私聊/群聊，排除官方号、AI 机器人或商家批量推送的私信/广告。OurFairy 的 AI 主动消息是否符合具体类别需单独判断，不能把一对一 AI 消息未经审核自动归为 IM，也不能把上述例外扩大成官方明文禁止所有 AI 消息。

## 未被本轮证明的项目事实

1. vivo S50 上具体 Android/OriginOS 版本、设备设置和厂家杀进程策略。
2. OurFairy 实际 Android targetSdk/FGS 类型与签名发布配置；本仓库根未搜索到 gradle 配置，不能以仓库 fork 来源替代确认。
3. 当前推送账号资格、测试权限、是否上架、在此台实机上的 regid 与通知渠道备案状态。
4. 未备案渠道被用户手动开启后是否恢复强提醒、普通回收后服务是否自动重启、OEM 一键清理与 AOSP 三类停止的对应关系。
5. 官方源码全球站本轮连接超时，未验证旧文所引具体 AOSP 常量或服务优先级句子；未据记忆将其升级为已核实结论。

## 读取来源与方法

Android 全球站连接超时后，改读 `developer.android.google.cn` 官方镜像，上述 Android 链接对应正文均已下载并直接提取，不需要 Google 服务运行在用户手机上。vivo 使用 `https://dev.vivo.com.cn/webapi/doc/info?id=156/359/695/930` 分别获取 `data.content` 后直接读取。未拿到正文或未实测的事项已另列；所有纠正据本轮读取到的第一方正文，不据旧研究转述。
