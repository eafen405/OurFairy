# #122 在裁剪后的客户端恢复测量入口接线

父票：[#74](https://github.com/eafen405/OurFairy/issues/74)。本票只做恢复与接线，不改测量协议、五档参数或指标定义。

## 事实起点

裁剪（用户确认的 ica 改造，无独立 spec；深色单一主题经用户确认允许）把客户端裁到 OurFairy 功能面后：

- `app/src/perf/**` 与 `create("perf")` 被删除；
- 工作区留下一个**未跟踪、未接入任何 source set** 的 `app/src/benchmark/`（4 文件，484 行），是 #75 之前的草稿：`terminalEmitNanos` 仍赋版本号、无 `latestVersionApplied`、结果文件不分 runId、`stream` 用 20,000 字符；
- `RemotePresentationBaselineTest` 指向不存在的 `src/debug/assets/presentation/workload.md`；
- 主检出 index 与工作区不一致，裸 `git add -A` 会顺手提交 #75 交付的删除。

## 改动

rikkahub `460109d1`（`product/ourfairy-v1`）：

- 删除未接线的 `app/src/benchmark/` 草稿，不保留第二份测量权威。
- 恢复 `create("perf")`：从 `release` 派生，保留 R8 优化、release 签名与**同一包名**，版本名加 `-perf`；`matchingFallbacks += "release"`。
- 把 `PresentationBenchmarkActivity` 接到裁剪后的入口：`FairyAppTheme` 取代已删除的 `RikkahubTheme`/`LocalSettings`/`LocalNavController`/`Navigator`/`rememberUserSettingsState`；测量显式使用默认显示偏好，使轮次可比。
- `RemotePresentationBaselineTest` 改读 `src/perf/assets/presentation/workload.md`，与设备负载同一文件。

裁剪本身（10 个模块、192→37 行 Manifest、`app/src/main/java` 486→86 个 `.kt`）随同一次提交进入集成分支；本文档只对其中与测量入口相关的部分负责。

## 实际执行的命令与结果

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assemblePerf :app:testDebugUnitTest --tests '*RemotePresentation*' \
  -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=8 --parallel \
  -Pourfairy.identityEndpoint=https://example.invalid
./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=https://example.invalid
./gradlew :app:testDebugUnitTest -Pourfairy.identityEndpoint=https://example.invalid
```

| 检查 | 结果 |
| --- | --- |
| `:app:assemblePerf` | `BUILD SUCCESSFUL`，产出 arm64-v8a / x86_64 / universal 三个 APK |
| `:app:assembleRelease` | `BUILD SUCCESSFUL` |
| 全部 `:app:testDebugUnitTest` | **202 项，failures=0 errors=0**（含新增 `FairyPagesTest`、`DisplayPreferencesTest`、`ClientStartupTest`、`RemoteTranscriptViewportTest`） |
| `RemotePresentationTest` | 4 项通过 |
| `RemotePresentationBaselineTest` | 1 项通过；输出 `PRESENTATION_HOST_BASELINE chars=232703 samples=91.9,98.5,116.2,132.7,266.1,267.9,388.4 medianMs=132.723173 p95Ms=388.42664` |

隔离与签名（实测，非推断）：

| APK | 清单含 `PresentationBenchmarkActivity` | 含 `assets/presentation/workload.md` | 签名 SHA-256 | APK SHA256 前 16 |
| --- | --- | --- | --- | --- |
| `app-x86_64-release.apk` | 0 | 0 | `406a2d5c…1d8e` | `01d8a2bf700191b7` |
| `app-x86_64-perf.apk` | 1 | 1 | `406a2d5c…1d8e` | `6c79aae69a121ec2` |

两者同签名（既有测试签名 `CN=Fairy, O=Fairybot`，非生产发布身份），perf 走 R8（`minifyPerfWithR8`）。

## 与 #75 记录的差异

- 宿主解析基线数值变高（#75 记录 median 156.9 ms / p95 502.0 ms；本轮 median 132.7 ms / p95 388.4 ms）。机器与样本相同，差异来自宿主负载，**不是**性能结论；#74 的判定仍要求设备侧多轮数据。
- 测量 Activity 的主题入口从 `RikkahubTheme` 换成 `FairyAppTheme`（固定深色），因此呈现测量的配色与裁剪后的产品一致，旧轮次数字不可与本轮直接比较。

## 未执行项

- 目标设备与模拟器上的五档多轮基线：**未执行**（#78 仍在等设备，已标 `ready-for-human`）。
- 性能改动：无（#79 已按问题判据判定未命中）。
- `:app:lintDebug`：未作为本票门槛执行。
