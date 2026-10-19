# #74 Android 长回复呈现性能：设备基线、热点定位与受控优化

本目录按票 #75–#80 记录。每一节只写实际执行过的命令与结果；未执行项单列，不写成通过。

状态：**测量入口已修正并入库；设备基线未建立；未做性能改动。**
目标设备 vivo S50 本轮不可用；固定配置模拟器在满负载下崩溃，未产出可用的三轮基线。

## 票 #75 测量入口入库

### 事实起点

- #42 的入口虽已入库（`cee4098c`、`6861fc3`），但测量 Activity 直接构造 `RemoteChatMessage`，
  绕过生产接收状态 `RemoteChatState`；流式默认 20,000 字符 / 32 字符每片，与 `measurements.md`
  记录的 232,703 字符 / 128 字符每 20 ms 不一致；结果没有"最新版本是否已应用并呈现"的字段。
- 主检出里未提交的 `app/src/benchmark/` 不是任何已注册源集，实测不参与编译（APK 中无
  `SyntheticChatBackend`）；`benchmarkRelease` 是 baselineprofile 插件自动生成的 build type，
  未签名。因此不能作为可复现入口。

### 改动

- 测量源码、固定负载与清单从 `app/src/main` 移到 `app/src/perf`；`main` 不再含测量 Activity。
- 新增 `perf` build type：从 `release` 派生，保留 release 的优化与签名，版本名加 `-perf`。
  沿用 release 的包名，因为 Firebase 配置只声明了 `me.rerere.rikkahub`，改名会让
  `processPerfGoogleServices` 失败；代价是它不能与 release 同时安装。
- host 基线测试改读 `src/perf/assets/presentation/workload.md`，与设备负载同一文件。

### 实际执行的命令与结果

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assemblePerf :app:assembleRelease :app:testDebugUnitTest --tests '*RemotePresentation*' \
  -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=8 --parallel \
  -Pourfairy.identityEndpoint=https://example.invalid
```

- `BUILD SUCCESSFUL`；`assemblePerf` 产出 arm64-v8a / x86_64 / universal 三个 APK。
- `RemotePresentationTest` 4 项、`RemotePresentationBaselineTest` 1 项，`failures=0 errors=0`。
- `PRESENTATION_HOST_BASELINE chars=232703` 输出在测试 XML 日志里（7 个样本）。这是宿主解析
  基线，不是设备结论。

隔离验证（实测，不是推断）：

| APK | 清单含 `PresentationBenchmarkActivity` | 含 `assets/presentation/workload.md` |
| --- | --- | --- |
| `app-x86_64-release.apk` | 0 | 无 |
| `app-x86_64-perf.apk` | 1 | 有 |

签名：`apksigner verify --print-certs` → V2，`CN=Fairy, O=Fairybot`，SHA-256 `406a2d5c…1d8e`
（既有测试签名，不是生产发布身份）。

## 票 #76 五档负载唯一化并驱动生产接收状态

- 五档参数集中声明在 `PresentationWorkload`（`app/src/perf/.../SyntheticChatBackend.kt`）：

  | 场景 | 历史条数 | 正文字符 | 片段字符 | 间隔 ms |
  | --- | --- | --- | --- | --- |
  | history | 200 | 0 | 0 | 0 |
  | single | 0 | 232,703 | 232,703 | 0 |
  | format | 0 | 3,635 | 3,635 | 0 |
  | stream | 0 | 232,703 | 128 | 20 |
  | burst | 0 | 232,703 | 128 | 0 |

  232,703 字符与 128 字符/20 ms 取 #42 证据记录的值；此前入口的 20,000/32 已移除。
- 合成后端按 SSE 路由的投影形状发帧，经生产 `RemoteChatState` 的快照进入 `RemoteTranscript`；
  原始事件从 seq 0 连续覆盖（接收状态拒绝有缺口的区间）。
- 每次结果都带 `historyMessages`/`replyChars`/`chunkChars`/`intervalMillis`，参数不同即不可比。

## 票 #77 结果回答"最新快照是否已应用并呈现"

新增字段与含义：`received`/`observed`/`superseded`、`latestVersionApplied`（最后提交版本 == 最后发出
版本）、`latestAppliedVersion`/`latestEmittedVersion`、`unappliedAtEnd`、`terminalPresented` 与
`terminalRichPresentedMs`、`receiveToStateP50/P95Ms`、`receiveToFrameP50/P95Ms`、`frameP95Ms`、
`overRefreshBudgetRatio`、`heapStartBytes`/`heapEndBytes`、`consumedThrough`/`initialized`/`failure`。

- 终态等待有明确截止（60 s）；超时记 `terminalPresented=false` 与 `-1`，不写一个好看的小数字。
- 脚本按 runId 读设备端结果文件（每次运行一个文件），logcat 只作回退；两条通道都拿不到才判失败。
- 脚本记录设备型号、指纹、SDK、刷新率、尺寸、密度、字体缩放，并保留 `gfxinfo framestats` 与
  `meminfo`。

实测中修掉一处真实缺陷：`terminalEmitNanos` 曾被赋成版本号（`publish()` 的返回值）而不是时间戳，
导致 `terminalRichPresentedMs` 报出 5,582,695 ms 的荒谬值。修复后同一量级回到 11,100 ms 左右。

## 票 #78 模拟器基线：未完成

### 实际发生的事

固定配置模拟器：AVD `fairy-test`，x86_64，Android 34，物理 1080x2400/420dpi（测量时覆盖为
540x1200/210dpi），`hw.lcd.vsync=60`，swiftshader 软件渲染，无 KVM（WSL2 无 `/dev/kvm`），
4 GB 内存 / 4 核。真实 GPU 与硬件加速都不可用。

已取得的单轮方向性数据（**模拟器，不是 vivo S50，也不是基线**）：

| 场景 | latestVersionApplied | receiveToFrameP95 | terminalPresented | 备注 |
| --- | --- | --- | --- | --- |
| format | true | 745–2,752 ms | true（11,100–24,870 ms） | 3,635 字符 |
| single | true | 32,162–37,589 ms | false（60 s 内未呈现） | 232,703 字符 |
| history | true | 1,093–2,158 ms | n/a（无回复） | 200 条历史 |
| stream | 无完整轮次 | — | — | — |
| burst | 无完整轮次 | — | — | — |

未完成的原因，按发生顺序：

1. 单轮 `single`（232,703 字符）在软件渲染下首帧即需 30–38 秒，终态格式 60 秒内未呈现；
   `history`（200 条）单轮超过 300 秒。
2. 把超时放宽到 600 秒重跑，模拟器在 `history` 一轮中挂死（模拟器日志：
   `detected a hanging thread 'QEMU2 main loop'. No response for 20906 ms`、
   `'QEMU2 CPU2 thread'. No response for 29445 ms`），adb 设备消失，后续 14 轮全部失败。
3. 增加"轮次间等待设备"与"超时保留已产出结果"后重启模拟器（4 GB / 4 核）再次尝试，
   用户要求停止模拟器路线。

因此**没有**三轮基线、没有门槛、没有可比分布。模拟器数字只作方向性参考：它足以说明该环境
无法承担满负载测量，不能说明 vivo S50 的行为。

### 未执行项（逐条）

- 目标设备 vivo S50 上的任何一轮：未执行（无设备、无 adb 连接）。
- 模拟器上五档各 ≥3 轮：未完成（见上）。
- 系统帧统计与内存转储作为完整原始材料：仅零星单轮采集，未构成基线。
- 回归门槛：未产生（门槛必须由同机基线产生）。

## 票 #79 热点判定：未命中判据，未做改动

规格的问题判据要求"重复运行可复现"，且须命中"随历史或长度单调恶化 / 终态格式缺失或延迟随长度
增长 / 持续超预算或积压不收敛"之一。本轮没有同条件多轮数据（见 #78），因此：

- **不满足任何一条判据**，按用户确认的口径（严格按判据），**不做性能改动**。
- 未做增量排序、行身份复用、事件保留限制或滚动调度改动；接收/呈现模块的对外接口、消息身份、
  顺序、阅读位置与最终格式规则均未改变。
- 既有行为测试保持通过（见 #75）；没有为了让改动通过而修改断言。

已经观察到、留作线索但**未**据此改代码的事实：

- 软件渲染下 `receiveToFrameP95` 与消息体积强相关（3,635 字符约 1–3 秒，232,703 字符约 32–38 秒）；
  这既可能是渲染管线，也可能是模拟器本身，无法在此环境分离。
- 每次快照仍会重建完整消息顺序与整份呈现行（`RemoteChatState.orderedMessages()`、
  `RemoteTranscriptPresentation.update()`），活动会话仍保留原始事件。这些仍是待验证假设。

## 票 #80 组合与收口

见 [handoff.md](handoff.md)（交给 #45 的基线、门槛与未完成项）与 `combo.json` 更新。
