# OurFairy Android

Fairy 的 Android 客户端，使用 Kotlin、Jetpack Compose 和 Material 3 Expressive。首页互动、远程会话和分组配置共用 Fairy 的主题与动画。

客户端负责身份、会话呈现、附件上传下载、录音转写、后台接收和通知。会话执行及系统配置由 OurFairy 后端提供。正文复用 Markdown、代码高亮、表格、公式、图片和 Mermaid 呈现。

## 构建

使用 JDK 21 和 Android SDK，SDK 版本由 Gradle 配置指定。将 SDK 路径写入未提交的 `local.properties`：

```properties
sdk.dir=/path/to/Android/Sdk
```

```bash
./gradlew assembleDebug
./gradlew test lintDebug
./gradlew assembleRelease -Pourfairy.identityEndpoint=https://your-backend.example
```

Debug 的默认后端为 `http://10.0.2.2:3080`；真机使用可访问的后端地址覆盖 `ourfairy.identityEndpoint`。Release 要求显式配置地址，签名读取 `local.properties` 中的 `storeFile`、`storePassword`、`keyAlias` 和 `keyPassword`。

CI 的后端地址来自仓库变量 `OURFAIRY_IDENTITY_ENDPOINT`，签名来自现有的 `KEY_BASE64` 和 `SIGNING_CONFIG` secrets。

## 应用内更新

用户在「设置 → 更新」中手动点「检查更新」。客户端从身份端点的 origin 下载 `/downloads/ourfairy-v1-arm64-release.apk`，不继承 `/ourfairy` 等路径前缀；部署其它 origin 时也要在该 origin 的根路径提供这个文件。当前没有独立版本清单，所以每次检查都会先下载完整 APK，再判定版本，不是先查询少量更新元数据。下载跟随更新页面的生命周期，离开页面或主动取消都会中断，重试从头下载。

下载完成后，客户端检查 ZIP 结构、applicationId 和数值 `versionCode`，只把更高版本交给用户确认安装；同版提示已最新，更低版本不安装。Android 的未知来源授权和系统安装器处理后续安装。下载、版本和取消行为分别由 `app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAppUpdateTest.kt` 与 `app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteAppUpdateTest.kt` 固定。

发布仍然是人工操作，客户端不会替操作者上传或发布：

1. 在 `app/build.gradle.kts` 严格递增 `versionCode`，并更新用于展示的 `versionName`。
2. 用 `local.properties` 的既有签名配置和实际后端地址执行 `./gradlew assembleRelease -Pourfairy.identityEndpoint=https://your-backend.example`。
3. 将 arm64 产物重命名为 `ourfairy-v1-arm64-release.apk`，替换 fairybox 上 `/var/www/ourfairy-v1/` 的同名文件，保留既有 applicationId 与签名配置。

当前发布通道只提供 arm64 APK；x86_64 设备或模拟器需要另行提供并接入对应包，不能把这个 arm64 入口视为已经覆盖它们。

## 会话附件

会话里附件点击的去处由 `app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteAttachmentDestination.kt` 的 `remoteAttachmentOpenDestination(mime, name, bytes)` 决定：图片进应用内全屏预览，文本进应用内只读预览（超过 2 MiB 转外派），PDF/Office 交给系统里能打开它的应用，其余另存为。文本只读预览严格按 UTF-8 → GB18030 解码，两者都不成立时显示「无法解码」。有可信 MIME 时以它为准；`application/octet-stream` 或缺失时由后缀推定有效类型，外派也使用这个有效类型。术语与完整规则以 [客户端词汇表](GLOSSARY.md) 的「附件去处」为准。

图片、文本与 PDF/Office 都经现有会话鉴权下载接口写入应用缓存 `attachment-preview/` 子目录：（会话、消息、附件序号）决定一个坐标目录，目录里的文件名是清洗后的原始名，接收方看到的是原名而不是摘要。面板的 `cachePreview` 让图片、文本与外派共用这一份缓存字节。图片交给现有全屏图片查看器，文本交给只读预览，两者关闭时由共享的 `DeleteCachedPreviewOnDispose` 删除自己的缓存文件；已另存的文件不受影响。PDF/Office 用 FileProvider 的 `content://` URI 以 `ACTION_VIEW` 直接交给系统解析（有多个应用匹配时由系统解析器让用户选择），并附临时读授权。外派不套 `Intent.createChooser`：系统 chooser 对零目标也会正常解析，「没有接收方」就无法被识别，回落另存为也不会发生。系统没有能接收它的应用时回落到另存为，复用缓存里的同一份字节，不二次下载；普通另存为仍写入独立临时文件后导出，不读预览缓存。外派给系统应用的文件不在交接后立即删除（接收方可能仍在读），下一次外派打开时清扫其余预览缓存。FileProvider 只暴露 `app-update/` 与 `attachment-preview/` 两个缓存子目录（`app/src/main/res/xml/file_paths.xml`），不暴露整个 cache，安装包目录的既有暴露不变。

去向、2 MiB 上限与有效类型由 `app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteAttachmentDestinationTest.kt` 固定，Markdown 取舍由同目录 `RemoteAttachmentTextTest.kt` 固定；面板点击（图片、Markdown、纯文本、无法解码、超限外派、PDF 外派、未知类型另存为）、一次下载与关闭后回到原会话由同目录 `RemoteAttachmentPreviewTest.kt` 固定；外派意图、有效 MIME、无接收方回落与缓存清理由 `RemoteAttachmentExternalTest.kt` 与 `RemoteAttachmentHandoffTest.kt` 固定；缓存路径由 `RemoteAttachmentPreviewFileTest.kt` 固定，一次下载、复用与过期 epoch 由 `app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAttachmentStateTest.kt` 固定；`file_paths.xml` 的暴露清单与 provider 的未导出、授权属性由同目录 `RemoteAppUpdateTest.kt` 固定。词汇以 [客户端词汇表](GLOSSARY.md) 的「附件去处」与「附件预览缓存」为准。

## 源码入口

- `app`：Fairy 页面、远程会话和 Android 平台接入。
- `ui`：Markdown 解析、表格和网页内容呈现。
- `highlight`：代码高亮。
- `app:baselineprofile`：启动测量与 profile 生成。

应用启动装配在 `RikkaHubApp.kt` 和 `di/`，导航在 `RouteActivity.kt`。`data/remote/` 维护会话归属、发送确认、同步水位和通知记账；`ui/identity/RemoteTranscript.kt` 承接消息呈现与阅读位置。

产品规格、术语和版本组合由本仓库根文档管理，见 [README.md](../README.md)。客户端运行组成见 [fairy-client-runtime.md](docs/references/fairy-client-runtime.md)；页面范围与阅读行为见 [fairy-client-ui.md](docs/references/fairy-client-ui.md)。

## 来源与许可证

客户端派生自 [RikkaHub](https://github.com/rikkahub/rikkahub)，以快照方式并入本仓库，来源提交记录在 [ourfairy-source.json](ourfairy-source.json) 与根 [combo.json](../combo.json) 的 `androidSource`，由 `npm run combo:verify` 比对。调研基线不是来源，见 [研究基线](../docs/research/README.md)。遵循仓库中的 [AGPL-3.0 许可证](LICENSE)。Fairy 视觉实现包含 Fairybot 的 MIT 许可代码，声明位于 [FAIRYBOT_MIT.txt](app/src/main/assets/licenses/FAIRYBOT_MIT.txt)。各依赖保留其原许可证。来源与取上游修复的规则见根 [README.md](../README.md) 的「来源与许可证」。
