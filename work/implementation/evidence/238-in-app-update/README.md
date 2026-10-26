# #238 客户端内 APK 更新入口

Worktree `.worktrees/238-in-app-update`，分支 `ticket/238-in-app-update`，基线 `main` @ `38278c5a27`。
票面副本：`work/tickets/238/README.md`。本文记录当前工作树证据；最终门禁结果在收口时补齐。

## 范围与实现

- `data/remote/RemoteAppUpdate.kt` 提供 `download(): Flow<AppUpdateStatus>`。实现从身份端点 origin 请求固定 arm64 APK，使用 `.part` 暂存、Content-Length 与 ZIP 检查、applicationId 和数值 versionCode 判定，并只在更高版本时给出安装文件。
- `ui/identity/RemoteAppUpdate.kt` 提供手动检查、进度、取消、失败重试、同版/旧版结果、未知来源授权和用户确认安装。下载使用页面协程作用域。
- `FairySettingsPage.kt` 新增「更新 / UPDATE」折叠组，当前版本来自 `BuildConfig.VERSION_NAME`；底部 BUILD 文案改为真实版本。
- manifest 声明安装权限与不导出的 FileProvider，`file_paths.xml` 只暴露 `cacheDir/app-update/`。
- `versionCode` 调整为 192，`versionName` 调整为 2.5.7；没有新增第三方依赖、后端接口或自动发布步骤。
- `android/README.md` 记录现有人工发布通道、完整下载成本、arm64 和同签名约束。

## 测试先行记录

公开接缝是 `RemoteAppUpdate.download(): Flow`、更新面板/内容以及系统 Intent，没有直接测试私有下载函数。

1. 更高版本主路径测试先因生产类不存在而在 `compileDebugUnitTestKotlin` 红灯；最小实现后通过，覆盖 origin 根路径、进度和 Ready。
2. 空身份端点测试先以断言失败红灯，随后显式转成更新错误并通过。
3. 同版重试清理旧 APK 测试先在残留断言红灯，随后清理旧目标文件并通过。
4. 取消用例中途暴露过测试启动时序问题：`launch` 后线程立即被锁等待阻塞，下载协程尚未启动。修正为先 `yield`，并用 OkHttp `canceled` 事件观察真实取消；最终传输使用 `callbackFlow + enqueue + awaitClose`，取消与暂存清理通过。中间红灯不作为平台缺陷证据。
5. 子代理补齐旧版、HTTP 状态、缺失/超大/不符长度、坏 ZIP、不可读包和包名不符负路径；这些行为在现有实现下直接通过，没有为制造红灯删实现。
6. 设置测试先因缺少 `updateContent` 接缝编译红灯；接入折叠组与真实版本后通过。UI 的安装、授权、取消、重试、缓存丢失和不自动安装由子代理按同样循环完成。

## 已运行的聚焦验证

均在 worktree 的 `android/` 下运行，使用 `ANDROID_HOME=/home/eafen405/Android/Sdk`。

```bash
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteAppUpdateTest' --console=plain
```

- `BUILD SUCCESSFUL`；JUnit XML：12 tests，0 failures，0 errors，0 skipped。
- 覆盖正常/旧版/同版、HTTP 与长度失败、坏 ZIP、包身份、取消和暂存清理。

```bash
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAppUpdateTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAppUpdateTest' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest' --console=plain
```

- `BUILD SUCCESSFUL in 19s`；没有使用子代理临时排除 FairyPagesTest 的 init script。

```bash
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteAppUpdateTest' --console=plain
```

- 增加离开 Compose 内容即取消的用例后 `BUILD SUCCESSFUL`；JUnit XML：17 tests，0 failures，0 errors，0 skipped。

这些是 JVM/Robolectric 与本地 HTTP 替身证据，不是设备验收。

## 可执行声称对照

| 声称 | 失效时失败的检查 |
| --- | --- |
| 身份端点的 `/ourfairy` 前缀不会进入 APK 下载路径 | `data.remote.RemoteAppUpdateTest.newer package downloads from the origin root and reports progress` |
| 只有更高版本返回 Ready；同版/旧版不留下安装文件 | 同类的 newer、current、older 用例 |
| HTTP、长度、ZIP 和包身份失败不留下暂存文件 | 同类负路径用例与 `assertNoDownloadedFiles` |
| 主动取消会取消真实 OkHttp Call 并清理 `.part` | 同类 cancelling 用例，含 `EventListener.canceled` |
| 下载完成不自动安装；安装需用户点击并经过权限检查 | `ui.identity.RemoteAppUpdateTest` 的 checking、installing 与 permission 用例 |
| 离开更新内容会取消下载 | `ui.identity.RemoteAppUpdateTest.leaving the update content cancels its download` |
| FileProvider 不导出、只暴露更新缓存且安装 URI 可解析 | `ui.identity.RemoteAppUpdateTest` 的 manifest、file paths、install intent 用例 |
| 设置页显示真实版本并可打开更新组 | `ui.fairy.FairyPagesTest.settings exposes the current version and app update entry` |

## 待收口与未执行

- 最终 Android 全量、release 构建、根全量与组合校验待运行；结果在收口时补入。
- 尚未执行真机或模拟器上的未知来源授权、系统安装器和实际覆盖安装。
- 未上传 APK、未修改 fairybox、未 push、未关闭 GitHub issue。
