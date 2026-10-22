> 2026-10-20 状态：日期化记录，已被 [Android / vivo 通知审计](android-notification-audit.md) 取代。本文记录 2026-10-14 的判断，不描述当前实现。

# vivo S50（不依赖 Google）通知通道能力边界 — 事实层

> **2026-10-14 复核纠正：本文为保留的旧研究，部分结论错误，不应直接作为决策依据。** Force Stop 与 Task Manager Stop、Doze 维护窗口、FGS 超时前提、vpush 测试资格和本地通知限制的纠正见[Android / vivo 通知审计](android-notification-audit.md)。旧文遗漏的本地通知分类规则对当前设备的影响尚需实测。

研究日期：2026-10-14。本文件仅事实层，不做产品取舍。覆盖 OurFairy 在 vivo S50 / 国内网络 / 自用签名 APK、不依赖 Google 服务前提下，所有可用于"主动消息到达用户"的通道的能力边界。结论用"可/不可"措辞保持谨慎。

前置事实已在 [`docs/research/domestic-android-background-delivery.md`](domestic-android-background-delivery.md) 汇总（事实点 L7-L11、L15-L25、L27、L39-L54）。本文件围绕"通道 × 手机状态"的交集做纵深核查，不复述该文件中已确立的事实。

---

## 1. vivo 推送通道（vpush）：上架与未上架的分界线

来源均为 vivo 开放平台公开文档正文（通过 `webapi/doc/info?id=…` 取得，已在本研究内直读）。

### 1.1 未上架 / 受限权限的状态

- **[常规使用问题 / 1.2](https://dev.vivo.com.cn/documentCenter/doc/156)**（vivo webapi id=156，"一、应用接入与上架"第 2 问）原文：
  > "应用必须上架才具备线上推送能力，上架后才可以给线上用户推送。应用未上架时，或者应用审核状态为审核中，推送权限为【受限】可以接入 vivo 推送，测试推送能力；一旦应用审核通过上架，审核状态自动变为【已通过】，推送权限为【正式】。"
- **[vivo 推送接入流程](https://dev.vivo.com.cn/documentCenter/doc/281)**（id=281，"二、登录 vivo 推送平台启用推送"）原文：
  > "若要使用 vivo 推送平台进行推送，开发者的应用必须要在开放平台通过审核上架后，才会通过消息推送服务审核。"
- **[vivo 推送使用指南](https://dev.vivo.com.cn/documentCenter/doc/151)**（id=151，"一、测试推送 / 2.(2) 推送权限"）：
  > "受限权限：不可在推送运营平台推送任何类型消息，使用 API 可推送测试消息，不可推正式消息。"
- **[消息限制说明 / 五、下载安装渠道限制规则](https://dev.vivo.com.cn/documentCenter/doc/695)**（id=695）：
  > "自 2025 年 2 月 17 日起，平台陆续对非 vivo 官方渠道下载安装的应用接收运营类消息进行规范调整，通过非 vivo 官方渠道下载安装的应用，将默认关闭接收运营消息的权限。"（注：表格同节中"非 vivo 官方渠道 × 系统消息 = 允许"，仅运营消息被默认关闭）
- **测试额度**（id=156，"五、推送频率 / 2"）：
  > "测试消息每个应用每天限制 1000 条，不受频控限制。发送测试消息时注意填写 pushMode=1。"
- **测试设备限制**（id=156，"八、在线诊断 / 2"）：
  > "不能，测试消息只能发送当前联网的设备。"
- **推送引擎版本 / 最低 Android**（[客户端 SDK 集成指南](https://dev.vivo.com.cn/documentCenter/doc/365)，id=365）：
  > "vivo 推送服务 SDK 支持的最低 Android 版本为 Android 6.0。"
  > "安卓 9 以上版本均默认支持，包括 iQOO 等子品牌"（id=156，"九 / 2"，vivo 推送支持哪些机型和系统版本）。

### 1.2 已上架 / 正式权限的可用形态

- **通道作用**（[vivo 推送产品说明](https://dev.vivo.com.cn/documentCenter/doc/180)，id=180，"三、2 通知栏展示"）：
  > "消息通过 vivo 推送系统通道下发，**不需要应用驻留后台**。客户端收到这类消息后，会直接在通知栏展现。用户点击弹出通知后，客户端 SDK 会将消息中携带的数据传递给应用，由应用决定下一步的动作。"
- **FAQ 同义复述**（id=156，"一 / 5"）：
  > "应用不存活状态下，可以收到 vivo 推送平台的消息。"
- **送达率宣传**（id=180，"二、1 系统级通道"）：
  > "设备联网的情况下，有效推送的送达率能达到 99.9% 以上。" — 此为供应商产品说明数字，未在本项目实测。
- **消息有效期**（id=180，"四、2 自定义消息有效期"）：
  > "消息有效期最长 1 天。如果应用没有单独设置一条消息的有效期，vivo 推送的默认有效期是 1 天。"
- **运营推送时段**（id=156，"四、推送时间 / 1"）：
  > "目前 vivo 手机接收的消息为 7:00-23:00，服务器允许推送时间为 7:00-23:00，**系统消息不受此时间限制**。"
- **消息类型限制**（id=156，"七、6 vivo 推送支持哪些消息类型"）：
  > "**仅支持文本通知，暂不支持透传消息**。"
- **自定义渠道**（id=156，"七、3"）：
  > "vivo 推送目前固定支持系统/运营渠道，**不支持自定义渠道，不支持设置 channelid**。"
- **横幅/锁屏通知支持**（id=156，"七、4"）：
  > "支持锁屏通知，横幅/悬浮通知，但是不支持默认开启，需要用户手动开启。"
- **regid 失效场景**（id=180，"三、3 推送方式"）：
  > "设备超过 14 天没有和 vivo Push 服务器建立长连接"则失效；卸载、清数据、调用 `turnOffPush` 也会失效。
- **运营/系统消息分类**（[消息分类说明](https://dev.vivo.com.cn/documentCenter/doc/359)，id=359）：
  - 系统消息下设 6 个二级分类：`IM`（即时消息，仅限真实聊天场景）、`ACCOUNT`（账号与资产）、`TODO`（日程待办）、`DEVICE_REMINDER`（设备信息）、`ORDER`（订单与物流）、`SUBSCRIPTION`（订阅提醒；要求"应用内支持用户主动订阅，订阅按钮默认关闭"）。
  - 运营消息下设 4 个二级分类：`NEWS`、`CONTENT`、`MARKETING`、`SOCIAL`。
  - "运营消息"对单设备默认 2 条/天频控；"系统消息-即时消息"可通过工单申请不限量；其他 5 类系统消息通过模板不限量。
  - "未接入消息分类，将默认为运营消息，受运营消息规则管控。"

### 1.3 对本场景的事实结论（vivo vpush）

- 我们目标设备（vivo S50，国内自用 APK）目前不具备"正式"推送资格，仅为"受限"——测试资格仅对开发联调有效。
- 即便后续完成上架：vpush 通道只能送"文本通知"，不能送透传 payload；通知文本最多标题 40 字符、正文 100 字符（id=156，"七、11"）；不支持自定义通知 channelid；通知类别决定可送达时段（运营 7:00-23:00；系统消息不受时段限制）。
- vpush 的能力点是"应用不存活也能展示通知"，但代价是通知内容受 40/100 字符上限与"即时消息仅限真实聊天场景"的语义约束；不符合分类会被"严格处罚"（id=359，"三、运营监管及处罚"）。

---

## 2. 自有前台服务通道（Notification + Foreground Service）：能力与版本约束

### 2.1 平台层定义

- **[Foreground service types 官方文档](https://developer.android.com/develop/background-work/services/fgs/service-types)**：Android 14+（targetSdk 34+）要求在 manifest 声明前台服务类型，并按类型申请权限；非该类型调用会被拒绝。
- **[Android 14 FGS 类型要求行为变更](https://developer.android.com/about/versions/14/changes/fgs-types-required)**：Android 14 起，前台服务必须显式声明 `foregroundServiceType`；不指定类型将抛 `MissingForegroundServiceTypeException`。
- **[Foreground service timeouts 官方文档](https://developer.android.com/develop/background-work/services/fgs/timeout)**：超时机制存在；不同类型有不同限制。
- **[Service.java 源码（Android 主干）](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Service.java)** 中 `onTimeout(int startId, @ForegroundServiceType int fgsType)` 的 JavaDoc 明确：
  > "Note: time limits are restricted to a rolling 24-hour window — for example, if a foreground service type has a time limit of 6 hours, that time counter begins as soon as the foreground service starts. This time limit will only be reset once every 24 hours or if the app comes into the foreground state."
  - 这与之前报告中提到的"Android 15 / targetSdk 35+ 的 `dataSync` 服务有 24 小时累计 6 小时的时间限制"对应；具体到 `dataSync` 与 `mediaProcessing` 类型，[ActivityManagerConstants.java 主干](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/am/ActivityManagerConstants.java) 的键包含 `KEY_DATA_SYNC_FGS_TIMEOUT_DURATION`、`KEY_MEDIA_PROCESSING_FGS_TIMEOUT_DURATION`、`KEY_SHORT_FGS_TIMEOUT_DURATION` 等，并通过 `DeviceConfig` 可调；基线默认值见 `DEFAULT_SERVICE_TIMEOUT = 20*1000 * Build.HW_TIMEOUT_MULTIPLIER`（设备相关倍乘）。
- **[Service 进程优先级](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Service.java)** `ProcessLifecycle` 节说明：服务被 start 后，其宿主进程优先级"低于任何可见进程，但高于不可见进程"，"长期运行的服务被杀的概率会持续增加，并且在足够长的情况下被保证会被杀"。

### 2.2 Doze / App Standby 对前台服务的影响

- **[Optimize for Doze and App Standby 官方文档](https://developer.android.com/training/monitoring-device-state/doze-standby)**：进入 Doze 维护窗口后，系统暂停普通网络访问、推迟 jobs、syncs、普通 alarms。**WorkManager 也不提供持续即时联网**（同节"Use WorkManager and JobScheduler"）。
- **电池优化豁免**：官方称其为"部分豁免"——Doze 中可用网络、保留部分 wake lock，**其他限制仍存在**（同节"Support other use cases"）。

### 2.3 后台启动前台服务的限制

- **[Restrictions on starting a foreground service from the background](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)**：在后台启动前台服务受"background FGS start"限制；targetSdk 31+ 必须满足一组允许条件（用户可见 Activity、白名单 broadcast、`PendingIntent` 等），否则抛 `ForegroundServiceStartNotAllowedException`。
- **[Service.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Service.java)** `startForeground` JavaDoc 显式 throw 列表：
  - `ForegroundServiceStartNotAllowedException`（targetSdk 31+，受后台启动限制时）；
  - `MissingForegroundServiceTypeException`（targetSdk 34+，manifest 无类型）；
  - `InvalidForegroundServiceTypeException`（targetSdk 34+，类型不合法或为 `FOREGROUND_SERVICE_TYPE_NONE`）；
  - `SecurityException`（缺少对应类型权限）。

### 2.4 对本场景的事实结论（自有 FGS）

- 仅靠 OurFairy 自己的 `dataSync` 前台服务（targetSdk 35+）：
  - 不能假设它能持续运行 6 小时以上——每 24 小时窗口累计上限 6 小时，到时回调 `Service.onTimeout()`，平台给少量宽限秒数（[`DEFAULT_FGS_CRASH_EXTRA_WAIT_DURATION = 10_000`](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/am/ActivityManagerConstants.java)）后未自行停止即视为 crash，应用会被 ANR/Crash。
  - Android 14+ 还要求选一个 `foregroundServiceType`；`dataSync` 类型需 `FOREGROUND_SERVICE_DATA_SYNC` 权限。
- 应用切到后台后进程仍可持有连接，但长时间闲置或锁屏进入 Doze 后，普通网络访问被冻结（直到维护窗口）。这是 SSE/WebSocket 在国产 ROM 上没有"持续在线"保证的平台原因。
- 用户从设置强制停止（`Settings → Apps → Force Stop`）后，`PackageManager` 处于 stopped state，**直到用户主动重新启动应用前**，任何后台组件均不会拉起；这是 [Android 15 stopped state](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state) 行为变更的明确语义。已安排的 jobs/alarms 不受影响，可继续运行——但已注册的长连接（前台服务/广播）已不在了。

---

## 3. vivo / 国产厂商的后台"省电策略"叠加层

vivo 公开文档（截至本研究）未提供 iManager（"高耗电提醒 / 后台高耗电"开关）的官方对外说明文档；该机制位于系统设置内"电池 → 后台高耗电"或 iManager 内，受具体 OriginOS 版本与机型策略影响。本研究内**未能取得官方文档正文**，以下三条为面向应用层的可观察事实，不描述触发阈值：

- **国产 ROM 普遍的后台机制**：自前台服务可承载"用户可感知的持续任务"，但与"应用界面可见性"是两件事；该机制本身受厂商进一步约束（白名单、自启动管理等）。具体到 vivo 是否、何时、如何在系统层暂停一个未在白名单内的 `dataSync` 前台服务的网络，**vivo 官方未发布对应公开文档**。
- **"高耗电提醒"是用户可见的系统机制**，意味着 vivo 在系统层对长时间高耗电的应用给出提示并允许用户一键关闭；这等价于"非用户主动关闭"的另一类进程结束路径。
- **用户配置项"允许后台运行"**：在 vivo 上对应用单独存在允许/禁止后台运行开关；该开关在 vivo 的实机行为对长连接与前台服务的实际影响，需在目标 ROM 实测，**官方文档未给出文字定义**。

> 现有 `docs/research/domestic-android-background-delivery.md` L17-L23 的"必须区分的手机状态"表已记录了这些机制的存在与一般后果，但未将其量化为具体秒/分钟数字；本研究的核查同样未获得量化数字，**仅证实这些机制在 vivo 上存在**（来自 Android 平台通用文档 + 国内 ROM 通用结论），**未获得 vivo 自身文档的量化定义**。

---

## 4. 应用内通知 / 锁屏弹出的能力边界

### 4.1 应用内通知（In-app notification）

- **当前应用在前台运行时**，通过 `NotificationManagerCompat.notify` 投递通知；用户进入应用时由应用自己绘制（不需要通知 API）。这条与平台无关，不受 Doze / 厂商省电策略影响。来源：[**Android 通知权限官方文档**](https://developer.android.com/develop/ui/views/notifications/notification-permission) 与 [本地通知分类管理指南（vivo）](https://dev.vivo.com.cn/documentCenter/doc/930)（id=930）的链接在 id=359 第三节"3.2 发送本地通知"中引用）。
- **应用切到后台但未被杀**：用户从最近任务切回能看到系统通知；通知展示权限受 Android 13+ 的 `POST_NOTIFICATIONS` 运行时权限控制。来源：[**Android 通知权限官方文档**](https://developer.android.com/develop/ui/views/notifications/notification-permission)。
- **vivo 侧**：[id=156 "七、15 通知授权弹窗是什么"](https://dev.vivo.com.cn/documentCenter/doc/156)："自 2021 年 8 月起发布的新机型，通知开关默认关闭，并新增通知授权弹窗机制，将通知选择权交由用户，由系统弹窗询问是否允许应用发送通知。Android 13 以下系统：采用系统自研通知授权弹窗……Android 13 及以上系统：遵循 Google 原生通知权限规则……"

### 4.2 锁屏弹出 / 横幅 / 悬浮通知

- **vivo vpush 支持锁屏通知、横幅/悬浮通知**（[id=156 "七、4"](https://dev.vivo.com.cn/documentCenter/doc/156)）："支持锁屏通知，横幅/悬浮通知，但是不支持默认开启，需要用户手动开启。"
- **本地通知**（应用进程内 `Notification.Builder`）：通知渠道的锁屏可见度、横幅可见度由用户在系统设置里逐项开启；与 vivo 系统推送通道无关。
- **横幅（heads-up）**：默认行为由通知重要性级别（`IMPORTANCE_HIGH`）决定；可被用户在系统通知设置里关闭。

### 4.3 对本场景的事实结论

- 通知能否在锁屏展示、横幅弹出、响铃、悬浮，均受**用户通知设置**最终决定——平台与厂商都无法绕过用户授权。
- vivo 通知渠道支持自定义（应用端），但**vivo vpush 通道不支持自定义 channelid**（id=156）；这意味着 vpush 通道的通知渠道只能从 vivo 提供的"系统/运营"两类中选择，无法按应用需要分类。

---

## 5. OurFairy 实际场景与上述限制的交集

以下逐项描述 OurFairy 拟使用的"自有前台服务保持连接接收服务端消息" + "通知呈现"在 vivo S50 上的能力边界。**只描述机制，不评价结果**。

### 5.1 应用切到后台、进程仍存活

- **平台层**：可行。前台服务是承载"用户可感知的持续任务"的机制；它可以维持网络长连接。来源：[Foreground services overview](https://developer.android.com/develop/background-work/services/fgs)、[Service.java JavaDoc](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Service.java) 的 `ProcessLifecycle` 节。
- **vivo 层**：本应用前台服务不会被立即杀，但长时间后台可能进入 vivo 的省电策略判定范围（无量化定义，参见 §3 证据空白）。
- **Doze 影响**：进入 Doze 后普通网络访问被冻结，前台服务持有的长连接**不能豁免**。来源：[Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)。

### 5.2 锁屏后

- 锁屏不等于进程被杀；锁屏超过一段时间进入 Doze 维护窗口后，长连接可能因系统网络冻结而暂时无法收发。通知**仍能在通知中心展示**（锁屏可见度由用户设置决定）。
- vivo 推送通道在锁屏场景**不需要应用驻留后台**（[id=180 "三、2"](https://dev.vivo.com.cn/documentCenter/doc/180)），但仅适用于已上架、正式权限的应用。

### 5.3 应用被普通进程回收

- Android 在低内存下会回收低优先级进程；`Service.java` JavaDoc 明示"长期运行的服务被杀的概率会持续增加"。连接断开后，应用下次拉起时会**从零重新建立连接**。
- 应用被回收**不影响** vivo vpush 通道对通知的送达（[id=180 "三、2"](https://dev.vivo.com.cn/documentCenter/doc/180)）。
- 应用被回收**不影响**已安排的 `WorkManager` / `AlarmManager` / 普通广播的执行——这些机制可作为"轮询回退"被调度。

### 5.4 用户从设置强制停止应用

- 应用进入 stopped state；**直到用户主动重新打开应用**前，组件都不会拉起。
- Android 15 行为变更：[Stopped state](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state) 明确：`pendingIntent` 等被取消；jobs/alarms 仍可运行。
- 该状态属于用户**明确表达**意图，本研究不主张绕开。

### 5.5 通知授权未授予 / 被用户关闭

- Android 13+ 没授予 `POST_NOTIFICATIONS`：应用侧通知不会展示。
- vivo 自 2021 年 8 月起的新机型**通知开关默认关闭**，首次进入应用时由系统弹窗询问（[id=156 "七、15"](https://dev.vivo.com.cn/documentCenter/doc/156)）。
- vivo vpush 通道的通知送达"不受用户通知权限影响"这一说法**文档未给出**；诊断问题清单（[id=151 "五 / 3"](https://dev.vivo.com.cn/documentCenter/doc/151)）明确"对应的 app 是否打开了通知权限"是排查的第一步。

### 5.6 设定"逐个事件类"以限频推送

- 我们的状态是"断网后补取"——即服务端持久化、重连同步。这意味着**每个事件类（agent 完成、用户状态变化、提醒触发）都对应一条可选推送**。
- **vivo vpush** 对"运营消息"默认 2 条/天频控（id=359，"一、每日推送数量限制规则"）；"系统消息-即时消息"可通过工单申请不限量；其他 5 类系统消息通过模板不限量。
- **本地通知（应用进程内）**没有平台级频控，但用户感知与"通知疲劳"由产品自己管理。
- **自有通知**不经过 vpush；频控完全由产品策略决定，但 24 小时窗口 6 小时 `dataSync` 服务上限决定了**我们的连接 / 服务运行窗口**的物理边界。
- 在"逐个事件类"上做频控**不是平台要求**（自有通知），但：
  - 若改用 vpush，受其分类频控约束；
  - 即便自有通知，仍受"高耗电提醒"用户反馈路径影响（用户可能一键关闭应用）。

---

## 6. 证据空白（明确不引用未核实内容的边界）

本节为避免在事实层越界，列出本研究**未能取得官方文档量化证据**的事项。任何对它们的引用应回到工程实测：

1. **vivo OriginOS 后台省电策略对未在白名单内的 `dataSync` 前台服务的具体行为**：vivo 公开文档未给出。来源：搜索 dev.vivo.com.cn 仅返回动态空壳，公开正文接口（webapi）也未提供对应文档。
2. **"高耗电提醒"机制触发阈值 / 时间窗**：同上，无公开正文。
3. **vivo S50 实机在前台服务 + 长连接场景下，进入 Doze 后何时唤醒**：仅知道平台规则（维护窗口），**不知道 vivo 实机调度参数**。
4. **vivo S50 的 Android 版本 / targetSdk 默认值**：文档说明"安卓 9 以上版本均默认支持"，但具体到 S50 的 OriginOS 5/6 对应的 Android 14/15 行为需实机确认。
5. **vivo vpush "受限"权限是否对自用签名 APK 同样开通**：文档只说"未上架或审核中"为受限；个人开发者注册路径未在公开文档中给出明确答复（参见 [`docs/research/domestic-android-background-delivery.md` L45](domestic-android-background-delivery.md)）。

---

## 7. 已读取的资源索引

- 本地：`/home/eafen405/projects/OurFairy/docs/research/domestic-android-background-delivery.md`（事实基线）
- 本地：`/home/eafen405/projects/OurFairy/docs/research/android-notifications.md`（通知 API 能力基线）
- vivo webapi 取得正文（已读取）：
  - [id=180 vivo 推送产品说明](https://dev.vivo.com.cn/documentCenter/doc/180)
  - [id=156 常规使用问题（FAQ）](https://dev.vivo.com.cn/documentCenter/doc/156)
  - [id=281 vivo 推送接入流程](https://dev.vivo.com.cn/documentCenter/doc/281)
  - [id=695 消息限制说明](https://dev.vivo.com.cn/documentCenter/doc/695)
  - [id=359 消息分类说明](https://dev.vivo.com.cn/documentCenter/doc/359)
  - [id=365 客户端 SDK 集成指南](https://dev.vivo.com.cn/documentCenter/doc/365)
  - [id=151 vivo 推送使用指南](https://dev.vivo.com.cn/documentCenter/doc/151)
- Android Developers 文档（来源页面本身 JS 渲染，主体正文未能直接抽取；以 AOSP 源码 + 既有引用作为对应替代）：
  - [Foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
  - [Foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout)
  - [Android 14 FGS types required](https://developer.android.com/about/versions/14/changes/fgs-types-required)
  - [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
  - [Notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- AOSP 主干源码（已直接读取）：
  - [Service.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/app/Service.java) — `onTimeout` / `startForeground` 抛异常列表 / 24 小时滚动窗口 / 进程生命周期
  - [ActivityManagerConstants.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/am/ActivityManagerConstants.java) — FGS 超时常量、设备配置键、基础服务超时 `20*1000 * HW_TIMEOUT_MULTIPLIER`

---

## 8. 已知未覆盖的事项

- 未注册 vivo 开发者账号，未登录后台，未验证 OurFairy 主体能否注册/上架（与 [`domestic-android-background-delivery.md` L71](domestic-android-background-delivery.md) 一致）。
- 未编译 OurFairy 应用，未运行 vivo S50 实机测试。
- 未核实目标发行的 `targetSdk` 与签名策略。
- 系统/厂商策略可能变更，实施时应复核（与 [`domestic-android-background-delivery.md` L71](domestic-android-background-delivery.md) 一致）。
- 本研究**未对华为、小米、OPPO、腾讯移动推送等其他国产厂商做对照核查**（与 [`domestic-android-background-delivery.md` L69](domestic-android-background-delivery.md) 一致）。vivo S50 之外设备的兼容性不在本文档范围。
