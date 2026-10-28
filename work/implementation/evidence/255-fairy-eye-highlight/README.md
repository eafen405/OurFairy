# #255 Fairy 眼睛高光随动

基线：`main` @ `d4dbd5d939`；分支：`ticket/255-fairy-eye-highlight`；worktree：`.worktrees/255-fairy-eye-highlight`。

## 改动

- `FairyEmblem.kt` 的右下白色高光改为以移动后的瞳孔中心计算，和瞳孔共享 `gaze` 位移；高光半径及相对瞳孔的偏移继续随 `pupil` 缩放，白色 Q 外圈保持固定。
- 新增 `FairyEyeTest.kt`，固定高光随 gaze 移动、且缩放围绕移动后的瞳孔中心这一几何行为。
- 未改眼睛状态机、颜色、眨眼、其他页面、数据库或接口。

## 验证

针对性测试先因 `fairyEyeHighlightCenter` 不存在而编译失败，实现后通过：

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests me.rerere.rikkahub.ui.fairy.FairyEyeTest
```

最终门禁在 worktree 最终树执行：

```sh
npm test
npm run combo:verify
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug
```

- `npm test`：381 tests / 381 pass / 0 fail / 0 skipped。
- `npm run combo:verify`：OurFairy、dsh、Android source 三行 `ok`。
- Android：`BUILD SUCCESSFUL`，`test` 与 `lintDebug` 均完成。
- `git diff --check`：通过。

## 未执行

- 真机或模拟器动画观感验收未执行；`adb devices` 探测 30 秒未返回后已取消。上述结果证明几何行为、JVM/Robolectric 测试与 lint，不等同于设备视觉验收。
- 未提交、未推送、未关闭 issue。
