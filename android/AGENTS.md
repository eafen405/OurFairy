# OurFairy Android

这是 OurFairy 的 Android 客户端，位于本仓库 `android/` 目录，与后端同处一个提交版本。产品规格、术语与版本组合参见仓库根的 [AGENTS.md](../AGENTS.md)、[CODING_STANDARDS.md](../CODING_STANDARDS.md)、[GLOSSARY.md](../GLOSSARY.md) 与 [README.md](../README.md)；客户端专有的词另见 [客户端词汇表](GLOSSARY.md)，版本组合的权威是 [combo.json](../combo.json)。

## 实现

- 围绕首页互动、会话对话、分组配置实现产品能力。代码是否保留以当前产品用途和维护收益判断。
- `data/remote/` 中的 `AccountSession`、`OwnedSessionState` 和 `RemoteReceiveState` 管理身份、会话归属与接收；页面订阅其状态。会话激活包含回复、后台任务及投递输出。
- `ChatSyncStore` 的持久消费水位、待确认发送和通知记账用于重连恢复；消息正文来自远程会话。
- 修改呈现时保留原文及最终格式语义：输出期间可显示纯文本，结束、停止和错误后的正文使用 Markdown；阅读位置由会话呈现维护。
- 装配与依赖以 `settings.gradle.kts`、`app/build.gradle.kts` 和 `di/` 为准。新增依赖须对应当前功能。

## 界面

根主题是 `ui/fairy/FairyAppTheme.kt` 的 Material 3 Expressive 主题。沿用 Fairy 视觉、现有窗口和折叠配置组，使用 expressive motion 与整行点击区域。颜色、形状和字体角色统一由 `ui/fairy/FairyTokens.kt` 提供；玻璃面板、信号按钮和状态标签分别复用 `InstrumentPanel`、`SignalButton`、`StatusChip`。普通面板使用 4–6dp 圆角与弱内描边，光效只用于 Fairy 核心、主按钮及实时状态。Fairy 本体与动画使用 `fairyBlue` / `fairyGlow` / `fairyLink` 的原有蓝色身份；仪器焦点、主按钮和实时状态使用独立的 `signal`，不得用 `signal` 替换本体动画色。

显示偏好只由 `data/datastore/DisplayPreferences.kt` 的 `DisplayPreferencesStore` 管理，界面入口在 `ui/identity/RemoteDisplayPreferences.kt`。按当前页面需要扩展本地偏好。

## 验证

```bash
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug assembleDebug
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew assembleRelease -Pourfairy.identityEndpoint=https://your-backend.example
```

测试通过、APK 构建和设备验收分别报告。涉及包体时读取实际 APK 和 merged manifest；比较时说明构建类型、ABI 和源码基线。

## 文案

现有字符串用 `stringResource`。未要求本地化时，优先实现功能。需要 `locale-tui` 操作时读取 `locale-tui-localization` skill。
