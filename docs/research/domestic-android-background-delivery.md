> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# 国内 Android 后台消息通道核查

研究日期：2026-10-14。用于「确定后端最小装配：选用、替换与新增插件」的事实核查，不构成产品决策。用户已明确：手机断线不取消后端执行，显式停止才取消；首版需要后台消息，不能依赖 Google 服务；首批实际设备为 vivo S50。

## 当前可以据此做什么判断

无需 Google 的前台服务长连接可以提供应用切后台后的消息收取，但不能仅凭前台服务承诺 Doze、厂商省电或进程回收后的即时提醒。后端继续执行、保存结果和客户端恢复后补取，可以独立于即时通知通道设计。[Android Doze 文档](https://developer.android.com/training/monitoring-device-state/doze-standby)支持前半句；后半句是针对已确认需求的架构建议。

vivo 系统推送有应用不驻留后台时展示通知的能力，但正式推送要求应用审核通过并上架。不能把「使用 vivo S50」直接等同于「自用签名 APK 已可接入正式 vivo 推送」。未上架的受限测试能力也不等于正式服务。[vivo 产品说明](https://dev.vivo.com.cn/documentCenter/doc/180)、[常规使用问题](https://dev.vivo.com.cn/documentCenter/doc/156)、[接入流程](https://dev.vivo.com.cn/documentCenter/doc/281)。

UnifiedPush 可避免 Google 依赖并支持自托管，但需要手机上另一个 distributor 应用；以 ntfy 为例，非 Google 的接收方式仍依靠前台长连接。它解决协议与共享接收通道问题，不能据此宣称自动获得 vivo 系统推送的后台能力。[UnifiedPush distributor 文档](https://unifiedpush.org/users/distributors/)、[ntfy 手机文档](https://docs.ntfy.sh/subscribe/phone/)。

## 必须区分的手机状态

| 状态 | 已核实的平台事实 | 对首版的含义 |
| --- | --- | --- |
| 应用切到后台，接收进程与连接仍在 | 前台服务可承载用户可感知的持续任务；它与应用界面可见性不同 | 可以在适当服务声明与权限下继续收取，仍须验证 vivo 实机省电策略 |
| 长时间锁屏进入 Doze | Android 暂停普通网络，推迟 jobs、syncs、普通 alarms；WorkManager 也不提供持续即时联网 | SSE/WebSocket 协议本身不能豁免限制 |
| 用户授予电池优化豁免 | 平台称其为部分豁免：可以在 Doze 中使用网络和持有部分 wake lock，其他限制仍存在 | 可以成为小规模自用的配置前提，不能称为永久存活保证 |
| 应用进程普通回收 | 本应用长连接随进程结束；vivo 官方说通知栏消息不要求应用驻留后台，并在 FAQ 说应用不存活仍可收到 | 自有接收服务必须恢复才能重新联网；符合条件的 vivo 推送可单独展示通知 |
| 用户从设置强制停止 | Android 的 stopped state 需要直接或间接用户操作解除；Android 15 会取消相应 pending intents | 不将用户明确停止应用纳入即时提醒保证；恢复后补取持久化消息 |
| Android 13+ 从活动应用列表停止前台服务应用 | 平台会移除整个应用进程；这与设置中的强制停止并非同一操作，已安排 jobs/alarms 仍可能运行 | 必须分别验证，不把所有「停止」混成一个状态 |
| 手机断网 | 当前网络通道不能送达；这不要求服务端取消任务 | 服务端保存结果，重连同步；具体推送通道的过期与离线保存另查 |

来源：[Doze / App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)、[用户停止前台服务应用](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping)、[Android 15 stopped state](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state)、[vivo 产品说明](https://dev.vivo.com.cn/documentCenter/doc/180)、[vivo FAQ](https://dev.vivo.com.cn/documentCenter/doc/156)。表中的架构含义是本报告推论，未做实机验证。

前台服务还存在版本约束。Android 14+ 要声明合适类型与相应权限；Android 15、targetSdk 35+ 的 `dataSync` 服务有后台累计每 24 小时 6 小时的时间限制，不能直接沿用旧客户端的 `dataSync` 声明作为永久接收器。具体是否采用 `specialUse` 或其他类型，应根据真实用途和发行方式评估；本报告不替实现选择类型。[官方服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)、[官方超时限制](https://developer.android.com/develop/background-work/services/fgs/timeout)。

## 三类方案比较

| 方案 | Google 服务 | 应用登记 / 用户配置 | 优点与限制 |
| --- | --- | --- | --- |
| OurFairy 自有前台服务 + SSE/WebSocket | 不需要 | Android 服务与通知权限；按实机情况设置电池优化豁免、允许后台活动等 | 最贴近旧 Fairybot，可少引入一个服务；本应用接收进程结束后没有独立接收者，不能保证锁屏即时性 |
| vivo 系统推送 | 官方流程未要求 Google 服务；使用 vivo 系统通道 | vivo 开发者账号、创建应用、申请 push、SDK、APPID/key/secret；正式能力需审核通过上架 | 应用不驻留后台仍可显示通知；受平台资格、消息类型、额度、有效期及通知授权约束 |
| UnifiedPush + 自托管 ntfy | 可以完全不需要；需选非 Google distributor，例如 ntfy 的 F-Droid 构建 | 手机安装并选择 distributor，OurFairy 集成 UnifiedPush 客户端与注册流程；部署可达 push server | 手机接收通道可由独立应用共享；额外应用与部署成本，ntfy 的无 Google 模式仍维持前台长连接，未验证其在 vivo S50 上的后台时效 |

来源：[Android Doze](https://developer.android.com/training/monitoring-device-state/doze-standby)、[vivo 接入流程](https://dev.vivo.com.cn/documentCenter/doc/281)、[UnifiedPush 开发者介绍](https://unifiedpush.org/developers/intro/)、[distributors](https://unifiedpush.org/users/distributors/)、[ntfy 手机文档](https://docs.ntfy.sh/subscribe/phone/)。前台服务复用建议以现有 [Android 通知研究](android-notifications.md)及当前票提供的旧 Fairybot 前台服务 + SSE 事实为背景，本次未重新审计旧代码。

## vivo S50 相关的明确前提

以下为实际取得的 vivo 官方正文，不是搜索摘要：

- [《常规使用问题》](https://dev.vivo.com.cn/documentCenter/doc/156)第一节第 2 问原文：**「应用必须上架才具备线上推送能力，上架后才可以给线上用户推送。」** 同节说明：未上架或审核中，推送权限为「受限」，可以接入测试；审核通过上架后为「正式」。
- [《推送接入流程》](https://dev.vivo.com.cn/documentCenter/doc/281)原文：**「若要使用vivo推送平台进行推送，开发者的应用必须要在开放平台通过审核上架后，才会通过消息推送服务审核。」** 该流程要求开发者注册、创建应用、申请 push，获取 APPID/key/secret、集成 SDK、测试后上传含 push 的 APK 并完成审核上架。
- 同一接入流程在账号注册步骤链接到「企业开发者注册」；[开发者注册常见问题](https://dev.vivo.com.cn/documentCenter/doc/60)主要描述营业执照、法定代表人及组织资质。**本次未获得「个人无企业资质可直接申请」的明确官方证据，也不据缺少说明断言所有个人接入均被禁止。**
- [《客户端 SDK 集成指南》](https://dev.vivo.com.cn/documentCenter/doc/365)要求配置申请得到的 appid/app key，说明通知点击后的 Intent 接入。本次读取的正文没有确认必须另登记 SHA-256/MD5 签名指纹等细则；不把其他厂商的证书登记要求套到 vivo。Android APK 本身的签名与推送平台是否要求登记签名是两个问题。
- [《产品说明》](https://dev.vivo.com.cn/documentCenter/doc/180)原文：**「消息通过vivo推送系统通道下发，不需要应用驻留后台。客户端收到这类消息后，会直接在通知栏展现。」** 用户点击后 SDK 才把携带数据交给应用。[FAQ](https://dev.vivo.com.cn/documentCenter/doc/156)明确仅支持文本通知，暂不支持透传消息；不能将该通道当成后台完整数据同步或 agent 执行接口。
- [FAQ](https://dev.vivo.com.cn/documentCenter/doc/156)第五节和 [《消息限制说明》](https://dev.vivo.com.cn/documentCenter/doc/695)规定，受限应用通过 API 发送测试消息，每应用每天 1000 条，填写 `pushMode=1`。FAQ 在线诊断第 2 问原文：**「不能，测试消息只能发送当前联网的设备。」** 这是设备连接条件，**不等于应用进程必须在前台或存活**。接入流程同时要求勿向正式用户发送测试消息，不能用受限测试资格代替正式分发方案。
- [FAQ](https://dev.vivo.com.cn/documentCenter/doc/156)说运营消息允许推送时间为 7:00–23:00，系统消息不受该时段限制；系统消息下的部分分类要求消息模板及适配，即时消息仅限真实聊天场景。**尚未验证 Fairy 主动消息应如何归类和是否可获相应资格。**
- [《产品说明》](https://dev.vivo.com.cn/documentCenter/doc/180)的消息有效期最多一天，默认一天。因此平台推送也不能替代 OurFairy 的持久化消息与恢复补取。
- [FAQ](https://dev.vivo.com.cn/documentCenter/doc/156)建议用 SDK 的 `isSupport()` 确认系统支持，文档说 Android 9+ 默认支持并包括 iQOO；本次未实际运行 vivo S50 的 SDK 或核实其系统/推送引擎版本。

vivo 宣传的送达率与时效数字来自供应商产品说明，没有本项目实测支持，不作为首版可靠性承诺。通知授权、横幅和锁屏展示仍是独立的用户设置。[产品说明](https://dev.vivo.com.cn/documentCenter/doc/180)、[FAQ](https://dev.vivo.com.cn/documentCenter/doc/156)。

## 可供当前决策票使用的建议，尚未定案

后端装配可以先明确：手机断线不取消执行；结果与通知事件先持久化；客户端恢复后按游标补取；即时提醒通道不承担唯一的数据保存职责。设备登记、发送提醒与失败重试可放在推送适配接口后，为正式 vivo 通道或其他无 Google 通道保留接入位置。这不要求现在登记厂商账号或部署推送服务。

如果首版采用小规模自行安装 APK，可先考虑自有前台服务长连接、通知权限、实机必要的后台配置与恢复补取；把 vivo S50 的锁屏/Doze/普通进程回收表现列为实施验收条件。它可满足尽力提供后台消息的目标，不能自动满足「本应用被回收后仍及时提醒」的更强要求。

如果首版必须在 OurFairy 进程不存活时仍收到系统通知，vivo 正式推送需先确认可完成账号、上架审核与消息分类资格。UnifiedPush + ntfy 是无需 Google 的另一条路线，但同样要接受额外 distributor 应用与其后台配置、实机验证；它不是已验证的可靠性捷径。

用户已经给出设备品牌；当前不必追问系统版本才推进后端装配。若需要继续二选一，唯一值得问的产品信息是：**首版自行安装、配置后台权限后尽力提醒是否足够，还是必须把应用进程被回收后的独立提醒也纳入首版。** 这句话是建议的问题，不是替用户答复；更不包含强制停止后的即时提醒保证。

## 核查范围与缺口

实际读取 Android Developers、UnifiedPush、ntfy 的官方正文。vivo 页面最初只返回动态站点空壳，读取公开网页脚本定位到其公开 `/webapi/doc/info?id=…` 后，成功取得上述文档正文与标题。文档入口链接供人工阅读，公开正文接口只用于此次核查。

原计划比较少数国内厂商代表；用户提供 vivo S50 后将范围集中到 vivo，没有完整审计华为、小米、OPPO 等平台。曾尝试访问它们及腾讯移动推送页面，部分返回动态空壳或不相关文档，没有把这些结果作为接入资格证据。搜索引擎结果仅用于找入口，没有作为事实来源。

未注册厂商开发者账号，未登录后台，未验证 OurFairy 实际主体能否注册/上架，未编译应用，未运行 vivo S50 实机测试，未核实目标发行的 targetSdk 和签名策略。未研究 root、系统签名、设备管理员等特殊权限路线。系统/厂商策略可能变更，实施时应复核。
