# #291 主页待机台词气泡退场时下方组件随高度平移动画

日期：2026-11-01。票面：<https://github.com/eafen405/OurFairy/issues/291>。
分支 `agent/standby-dialog-exit-animation-18434fdb132b`，基线 `347c966ed423`（`main`）。
改动只涉及 Android 首页控制台的待机台词气泡（`FairyCaption`）及其相邻布局；未改后端、数据、
接口、主题 token、其它页面或交互。

## 问题与改法

待机台词气泡出现在 Fairy 屏幕下方时，把信息卡与按钮向下顶开；台词播完
（`FairyInteraction.captionFinished()`）后 `caption` 变为 `null`，页面直接把它移出组合，下方
组件在下一帧瞬移回原位。

`FairyConsolePage` 现在用 `AnimatedVisibility` 让气泡在 `CAPTION_SIZE_MS`（200 ms，与气泡自身
`animateContentSize` 同一时长，取自 `FairyCaption.kt` 的唯一常量）内 `fadeOut` +
`shrinkVertically(shrinkTowards = Alignment.Top)` 退场：气泡保持最后一句参与退场，高度连续收缩，
后面的 `ConsoleInfoCard`、主按钮与两个次级按钮随布局连续上移。`allowSpatialTransitions == false`
（Reduced Motion / 系统关闭动画）时退出为 `ExitTransition.None`，与窗口开合等空间动效一致。
出现、打字机、点击推进、台词选择与记忆均未改动。

## 验证

### 红

在基线 `347c966`（只保留新的页面用例）上运行：

```sh
cd android && ANDROID_HOME=<sdk> ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest.an ending idle line folds the console below it instead of snapping' \
  --no-configuration-cache --console=plain
# FairyPagesTest > ... FAILED
# java.lang.AssertionError: 退场第一帧台词仍在组合中
# 1 test completed, 1 failed
```

### 绿

同一用例在改动上通过；Reduced Motion 用例也通过：

```sh
cd android && ANDROID_HOME=<sdk> ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest.an ending idle line folds the console below it instead of snapping' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest.reduced motion removes the idle line without moving the console' \
  --no-configuration-cache --console=plain
# BUILD SUCCESSFUL
```

客户端完整门禁（本机 Java 21、Android SDK 37.2）：

```sh
cd android && ANDROID_HOME=<sdk> ./gradlew test lintDebug
# BUILD SUCCESSFUL in 5m 51s，134 actionable tasks: 68 executed, 66 up-to-date
```

用例断言的是用户可见行为：退场第一帧台词仍在组合中、下方组件的 top 不回到无台词位置；中途 top
严格位于起点与终点之间；结束后回到无台词位置。Reduced Motion 下同一时刻台词已移除且下方组件不
产生中间位移。

### 截图

Robolectric `captureToImage()`，`zh-rCN-w411dp-h891dp`，同一用例、同一随机种子（`Random(11)`）、
同一帧时间点。基线 `347c966` 与改动后同一场景：

- 基线 `347c966`：
  - [台词在屏](screens/baseline-home-idle-exit-line.png)：气泡把信息卡与按钮顶下。
  - [结束后 16 ms](screens/baseline-home-idle-exit-16ms.png)：气泡已不在，卡片已回到无台词位置。
  - [结束后 66 ms](screens/baseline-home-idle-exit-66ms.png)：与上一张相同，说明是瞬移而不是动画。
- 改动后 `d2e69d7`：
  - [台词在屏](screens/fixed-home-idle-exit-line.png)：与基线同一起点。
  - [结束后 66 ms](screens/fixed-home-idle-exit-66ms.png)：气泡高度正在收起，卡片位于起点与终点之间。
  - [退场结束](screens/fixed-home-idle-exit-settled.png)：卡片回到无台词位置。

两组都是 JVM/Robolectric 渲染，不是真机帧；截图只呈现单帧，连续性由上面的位置断言固定。

## 提交

- `d2e69d70425a` `fix(#291): 待机台词退场时收起高度，下方组件随平移动画回位`（代码与用例）
- 本目录、截图与证据索引随后续 docs 提交加入。

## 未执行

- 未连接设备或模拟器：真机观感、帧率、横屏和更小屏宽下的退场未验收。
- `npm test` 与 `npm run combo:verify` 未在本机通过：环境没有 `combo.json` 锁定的 dsh 检出
  （`/home/eafen405/projects/deepseek-harness` 及其固定提交），backend 套件还依赖本机不存在的
  `bwrap` 与 `pdftoppm`。`OURFAIRY_DSH_DIR` 指向已安装 dsh 包时 `combo:verify` 报 dsh 行
  `MISMATCH`（checkout missing）；这是环境缺项，不是本次改动引入的漂移。本次没有改 backend 代码。
