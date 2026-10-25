# #222 Fairy 首页：安静的信息层级与独立会话入口

日期：2026-10-24。票面见 [实施约定](../../../tickets/222-fairy-console.md)。开工基线为
`integration/spec-205` 的 `8701eff036`；它也是选定原型 `56bc9974` 的直接父提交。

## 结论与范围

- 首页采用 Quiet 的信息分组和安静层级，并吸收 Signal Dock 的独立全部会话入口；生产代码没有原型方案或切换器。
- `currentSessionId = selectedId ?: primarySessionId` 只派生一次，同时驱动信息卡和主按钮。会话标识按现有
  `SessionsSnapshot` 中的不透明 ID 呈现；没有虚构 session name 字段或新增状态副本。
- 身份卡使用真实用户名、`#shortId`、ADMIN／AGENT；会话数量使用 `owned.sessions.size`。全部会话与设置是独立次级操作。
- 背景、扫描线、信息卡和按钮样式均在首页局部实现；全局 Fairy token、H.D.D 字标、Fairy 渲染器、台词、待机／唤醒、
  动画和共享 `SlantKey` 未改。
- `Screen.Sessions` 原来在非空会话时立即转回当前对话。为让“全部会话”真正显示现有列表，
  `FairyConversationPage` 的 `sessionId == null` 分支现在打开原有 drawer，不再替换路由。非空会话 ID 的打开、
  composer、会话选择及其他页面未改；没有新增路由或导航状态。
- 未改后端、数据库、会话归属、固定主会话、通知、持久化或全局主题。

## 行为验证与 red-green

测试接缝为既有 `FairyPagesTest` Compose／Robolectric 页面边界，使用真实 `AccountSession`、
`RemoteReceiveState` 和测试后端；没有新增截图框架或私有组件结构断言。

- 最近选择用例先因页面仍显示 `main`、不显示 `other` 而失败；改为同一 `currentSessionId` 驱动显示与导航后通过。
- 全部会话用例先因没有“全部会话”操作而失败；加入操作及上述 null-session 列表修复后，测试实际断言现有列表的
  关闭按钮、主会话和 `other` 均可见，且路由保持 `Screen.Sessions`，不是只检查回调参数。
- 其余覆盖：默认主会话与 composer、空会话回退列表、真实数量 0／2、ADMIN 与 AGENT、用户名与编号、设置、
  既有会话列表和对话行为。

```sh
cd android
FAIRY_UI_SCREENSHOTS=../work/tmp/fairy-console-222 \
ANDROID_HOME=/home/eafen405/Android/Sdk \
./gradlew :app:testDebugUnitTest --tests me.rerere.rikkahub.ui.fairy.FairyPagesTest
```

最终 `FairyPagesTest`：10/10 通过，0 失败。

## 截图与人工视觉审查

上述命令在设置 `FAIRY_UI_SCREENSHOTS` 时生成截图；PNG 留在 `work/tmp/fairy-console-222/`，不作为仓库证据文件提交，
也没有逐像素 golden。重跑时使用同一命令即可。

- `home.png`：411×891、中文环境，默认主会话。人工看到单一 H.D.D／Fairy 舞台／分组卡／高亮主按钮／双次级按钮层级，
  背景与普通信息卡无旧式强 bevel，真实数量同时显示为卡内 `2` 与操作标签 `2 SESSIONS`。
- `home-selected.png`：411×891，最近选择 `other`；信息卡显示 `other`，同一行为测试断言主按钮进入 `other`。
- `home-narrow-long.png`：320×640、font scale 1.3、长用户名与长会话 ID。人工看到两处文本以 `…` 截断，编号、权限、
  计数保持可见，主按钮和双次级按钮可达；自动断言另检查文本语义节点不越过视口，并通过滚动后点击验证导航。

这关闭了 Spec 评审提出的唯一轻微缺口：语义边界断言本身不能区分换行、裁剪与省略；本票的可见省略由上述截图
人工检查确认，未添加脆弱 golden。

## Android 全量门禁

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug assembleDebug
```

`BUILD SUCCESSFUL`（3m36s）：`test`、`lintDebug`、`assembleDebug` 均成功；debug APK 实际完成打包。

## 仓库全量门禁

在 Android 门禁结束后串行执行，避免两套重型启动／构建任务争用资源：

```sh
npm test && npm run combo:verify
```

- `npm test`：300/300 通过，0 失败、0 取消、0 跳过；`pretest` 已先执行 `npm run build`。
- `npm run combo:verify`：`combo: combination verified`；OurFairy 基线、dsh 锁定提交和 Android 来源声明三行均 ok。

## 两轴评审与处理

- Standards 初轮提出一条硬性「声称须可执行」问题：测试注释把帧推进写成必要性声称，但只有启用帧推进的用例。
  已删除该注释，保留测试设置本身；复核无剩余硬性标准或可执行声称问题。另两条重复代码为判断项：安静主按钮与共享 Settings 按钮样式职责不同；
  两处测试选择设置仅五行，按本项目规模不另建抽象。
- Spec 初轮只提出上述「可见截断缺少明确验证」的轻微缺口，已由 `home-narrow-long.png` 的人工审查补齐；
  其余需求未发现缺失、错误或范围扩张。评审明确核对并接受了 null-session 分支是让现有 `Screen.Sessions`
  真正显示列表所需的最小修复。

## 未执行项

- 未连接 Android 物理设备，未做真机验收。以上是 Robolectric 行为／截图、静态检查、构建和仓库替身测试证据，
  不把其中任何一项写成真机结论。
- 未调用真实模型或云服务；本票为现有账号／会话状态的 Android 呈现与导航改动。
