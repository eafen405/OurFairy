# #74 → #45 交接：长回复呈现性能的基线、门槛与未完成项

本文件是 #74 交给 [#45 vivo S50 后台通知与长回复实机验收](https://github.com/eafen405/OurFairy/issues/45)
的指针。它**不**声称任何设备性能已通过；#45 仍需在目标设备上按同一协议复验。

## 1. 可直接使用的入口

| 项 | 位置 |
| --- | --- |
| 测量 Activity（只在 `perf` 变体） | `app/src/perf/java/me/rerere/rikkahub/ui/identity/PresentationBenchmarkActivity.kt` |
| 合成后端与五档参数（唯一声明） | `app/src/perf/java/me/rerere/rikkahub/ui/identity/SyntheticChatBackend.kt`（`PresentationWorkload`） |
| 固定负载样本 | `app/src/perf/assets/presentation/workload.md` |
| 采集脚本 | `scripts/measure-presentation.py` |

## 2. 五档负载（改动即产生新基线）

| 场景 | 历史条数 | 正文字符 | 片段字符 | 间隔 ms |
| --- | --- | --- | --- | --- |
| history | 200 | 0 | 0 | 0 |
| single | 0 | 232,703 | 232,703 | 0 |
| format | 0 | 3,635 | 3,635 | 0 |
| stream | 0 | 232,703 | 128 | 20 |
| burst | 0 | 232,703 | 128 | 0 |

long 正文 = `workload.md` 重复 64 次并以换行连接（232,703 UTF-16 字符）；历史正文取样本前
240 字符。

## 3. 构建与运行

```bash
cd /home/eafen405/projects/rikkahub            # product/ourfairy-v1
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assemblePerf \
  -Pourfairy.identityEndpoint=https://<后端地址> \
  -Dorg.gradle.jvmargs="-Xmx8g -Dfile.encoding=UTF-8" --max-workers=8 --parallel
# 产物：app/build/outputs/apk/perf/app-arm64-v8a-perf.apk
```

`perf` 与 release 同优化、同签名、**同包名**，所以不能与 release 同时安装：测量前先卸载正式版，
测完再装回。签名是既有测试签名（`CN=Fairy, O=Fairybot`），不是生产发布身份。

```bash
python3 scripts/measure-presentation.py \
  --adb "$ANDROID_HOME/platform-tools/adb" --serial <设备> \
  --rounds 3 --out /tmp/ourfairy-presentation-74
```

`--scroll` 可在 stream 期间交替滑动，用于复验"用户滚动优先"。脚本每轮读设备端
`/data/data/<pkg>/files/presentation-<scenario>-<runId>.json`（需要 root），logcat 只作回退。

## 4. 每轮必须记录的条件

脚本自动写 `device.json`：型号、指纹、SDK、刷新率、`wm size`、`wm density`、字体缩放。
还需人工补记：构建 SHA、APK SHA256、签名类型、字体家族与字号设置。

## 5. 门槛（必须由**同机**基线产生）

本票没有产出基线，因此**没有门槛数值**。#45 的第一轮 vivo S50 数据即基线。之后按 #74 规定的
默认回归门槛比较：

- 同一档负载的 p95 连续 3 轮中至少 2 轮高于基线 p95 的 1.2 倍，且 p50 同向变化；
- 若基线噪声明显更大，可在证据中说明后调整，但不得为了让结果通过而放宽。

工程触发线（决定是否继续定位，不是产品毫秒承诺）：持续超刷新预算帧比例明显高于同机其他场景；
帧耗时 p95 超过两个刷新周期；终态格式延迟随正文长度增长；已接收版本持续增加而最新版本未应用。

## 6. 结果怎么读

`latestVersionApplied=true` 才说明最新快照已应用并呈现；`unappliedAtEnd=1` 表示积压未收敛。
`terminalPresented=false` 表示在 60 s 报告截止内终态文档没有到达一帧，`terminalRichPresentedMs=-1`
就是这个意思，不是"很快"。`receiveToState*` 是接收合并/排序的耗时，`receiveToFrame*` 含解析与布局。

## 7. 未完成项（不要在 #45 里当成已通过）

- vivo S50 上的任何一轮：**未执行**（本轮无设备）。
- 模拟器上的三轮基线：**未完成**（软件渲染下 `single`/`history` 单轮超时，随后模拟器挂死）。
- 基线数值与回归门槛：**未产生**。
- 热点判定：**未命中判据**，因此没有性能改动；#74 未做任何接收/呈现内部优化。
- 方向性参考（模拟器，不可冒充真机）：

  | 场景 | receiveToFrameP95 | 终态呈现 |
  | --- | --- | --- |
  | format（3,635 字符） | 745–2,752 ms | 11,100–24,870 ms |
  | single（232,703 字符） | 32,162–37,589 ms | 60 s 内未呈现 |
  | history（200 条） | 1,093–2,158 ms | 不适用 |

  以上为 swiftshader 软件渲染、无 KVM 的 Android 34 模拟器（540x1200/210dpi），只说明该环境
  撑不住满负载。

## 8. #45 复验时要同时确认的行为

这些由现有测试覆盖，性能改动不得使其回退：最后增量不丢、终态完整 Markdown/代码/表格/公式、
只改"已结束"状态也触发最终格式、停止/错误/恢复历史保留正文并收尾、重连突发不重放旧快照、
阅读位置锚定与用户滚动优先。
