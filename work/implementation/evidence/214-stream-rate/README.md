# #214 流式回复推进速率

日期：2026-10-24。票面见 [实施约定](../../../tickets/214-stream-rate.md)。
开工代码基点：`b5bde93504cd9e6c67da1c73de678b832cfbb033`。

## 结论与范围

在 vivo S50（ADB 型号 `V2528A`，SDK 36）上，用真实产品启动器、HTTP/SSE、Android
`RemoteChatApi`、`RemoteChatState` 和 `RemoteTranscript` 重现了“生成快、滚动流畅、正文慢”。
外部模型是固定分片替身；没有调用真实付费模型。以下单位是 **UTF-16 字符/秒，不是模型 token/秒**。

未限速的旧版真机基线约为模型 85.90、SSE 85.89、客户端应用 86.73、帧采样 86.62 字符/秒，
没有重现慢速。对同一设备的 SSE 下载施加 128 KiB/s 的固定限速后，旧版模型与服务端 SSE 仍约
98 字符/秒，但设备收到、应用及提交后帧采样都降至 2.20 字符/秒。这里的限速是复现条件，
不是对用户实际网络带宽的测量。

| 环节 | 修复前 | 最终修复后 |
| --- | ---: | ---: |
| 模型文本片段边界 | 98.31 | 98.43 |
| 产品 SSE 观察者 | 98.34 | 98.51 |
| 限速后发往设备的 SSE | 2.20 | 98.51 |
| Android 接收状态应用 | 2.20 | 98.45 |
| Compose 提交后下一帧采样 | 2.20 | 98.12 |

旧版在 90 秒测量期限内仅到 193/512 字符，仍为运行态；最终版到达 512/512，接收状态和帧采样
均为终态 `replyStatus=0`。每阶段速率取递增 attempt 文本的首末采样差，终态完整字符数另行检查。
上述修复后的运行态帧采样最后一份是 511 字符，随后终态帧为 512 字符，并非丢失最后一个字符。

主导损失位于 **重复完整快照的网络传输与发送积压**：限速后的设备到达、应用、呈现速率基本一致，
而模型和本机 SSE 观察者持续约 98 字符/秒。旧版回归也证明，TCP 读者暂停后，256 个模型片段
会被重放成 259 个有正文的旧快照；Android 的慢消费者则逐个处理全部 200 个快照。

## 实现

- 在既有 `SessionRuntime.publish` 共享发布点合并运行态片段：32 ms 发布窗口，各观察者继续共享
  同一轮发布，保留各自的冻结事件窗口；闲置/终态取消等待中的定时发布。
- `observe.ts` 集中每条 SSE 连接的 gzip、背压、心跳和关闭清理。旧路由中的流写出闭包没有可复用的
  压缩/背压生命周期入口；独立内部模块把这些资源留在一处，`index.ts` 仍负责装配。
- 接受 gzip 的客户端使用标准 HTTP 内容编码，每次写入采用 `Z_SYNC_FLUSH`；未请求 gzip 或明确
  `gzip;q=0` 时仍发送明文。写端背压期间只保留最新待发完整快照。
- Android `RemoteChatApi.observe` 合并尚未消费的累计快照，避免在慢应用环节重放旧状态；消息原文、
  generation、恢复截点、正式消息与停止/失败结算仍由现有模型处理。

只加入 gzip 和背压的中间测量约为 51.83 字符/秒，仍落后于约 96.87 的生成速率，设备端接收
512 个运行态快照。最终版共享发布后接收 128 个运行态快照，正文推进追上生成，压缩传输总量为
325,641 字节。因此保留发布合并，而不把压缩单独作为完成依据。

没有数据库结构变更，也没有新增业务状态。HTTP JSON、SSE `event: projection`/`data:` 形状、
投影字段、原始正文及分页语义沿用原协议；压缩通过 `Accept-Encoding` 协商，响应增加相应内容编码。

## 测量入口与重放

原有 `PresentationBenchmarkActivity` 驱动的是合成后端，不能覆盖本票发现的网络积压。因此新增仅
perf 变体包含的 `StreamingRateActivity`，复用生产 HTTP 适配器、接收状态、主题与正文组件。
它记录状态应用与 Compose 提交后下一帧的 version、revision、累计字符数；不增加生产日志或接口。

`measure.mjs` 复用仓库测试启动器和已锁定 dsh 的外部模型替身，代理记录真实文本 delta；另开产品
SSE 观察者作为服务端参考，对设备流按字节限速。各段分别使用本地单调时钟，只比较各段内部速率，
没有把两台设备的时间戳直接相减。回传接口只存在于本机测量进程，独立于产品服务。

实测参数由脚本输出的 `params` 记录：40 轮历史，每轮与测量回复均为 512 字符，测量回复每片 1
字符、间隔 10 ms，设备下载限制 131,072 字节/秒。原始 JSON/log/APK 均未入库。

构建独立包（复用 perf 优化配置，使用调试签名及 `.streambench` 后缀）：

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:assemblePerf \
  -I ../work/implementation/evidence/214-stream-rate/isolated-perf.gradle \
  -Pourfairy.identityEndpoint=https://measurement.invalid --offline --console=plain
```

安装与测量（在仓库根执行；`ADB` 指向能够访问该手机的 adb 或包装脚本）：

```sh
"$ADB" install -r -t android/app/build/outputs/apk/perf/app-arm64-v8a-perf.apk
node work/implementation/evidence/214-stream-rate/measure.mjs \
  --adb "$ADB" --reply-chars 512 --download-kib 128 \
  --label final-shared --out /tmp/ourfairy-214-shared-final.json
```

本次手机由 Windows USB 驱动识别；WSL 的 Linux ADB 设备列表为空，改用 Google 官方 Windows
platform-tools 的 ADB，独立端口 5041。Windows ADB 安装 Linux 路径的 APK 时，路径用
`wslpath -w` 转换；测量脚本使用的包装入口为：

```sh
#!/bin/sh
exec /path/to/windows/adb.exe -P 5041 "$@"
```

基线重放：在开工基点的独立 worktree 中，只从交付提交取本目录测量文件、perf manifest 与
`StreamingRateActivity.kt`；保留基点的生产后端和 `RemoteChatApi`，按根 README 准备本地 SDK/
Google Services 输入，构建后运行同一组参数。基线预期因 90 秒仍未到达终态退出非零，同时保留
分环节 JSON。不要在正在提供服务的工作树中回退源码。

无设备时可运行服务端测量，但它不能代替真机证据：

```sh
node work/implementation/evidence/214-stream-rate/measure.mjs \
  --host-only --label host --out /tmp/ourfairy-214-host.json
```

## 已执行验证

- 原有 `npm run bench:projection -- --label 214-before --out /tmp/ourfairy-214-before.json`：
  40/160 轮历史、1/2 观察者、各两次运行；旧版单帧约 195–196 KB，发帧 p50 约 14.9–15.1 ms，
  不支持“本机服务端本身只能每秒推进几个片段”的判断。
- Android 定向回归先红后绿：旧版慢消费者处理 200/200 帧；合并后一次记录为 2/200，保留
  `finalVersion=200`。`RemoteChatApiTest` 19 项与 `RemoteChatStateTest` 9 项通过；覆盖完整原文、
  完成/停止/失败正文、SSE framing、取消、恢复与账号隔离。
- `node --test tests/chat-stream-backpressure.test.mjs tests/chat-multi-observer.test.mjs`：最终 3/3
  通过。暂停 TCP 读者的回归由旧版 259 帧降至一次实现记录的 60 帧；另覆盖 gzip 开流时即能读到
  完整帧、拒绝 gzip、共享版本一致及重连后的一致性。
- 高速模型片段逐一发送的回归先失败（258 个 revision），共享发布合并后通过。
- `npm run typecheck`、多次 `npm run build` 通过。
- `:app:assemblePerf` 构建成功；在用户授权的 vivo S50 上实际安装独立包并执行上述测量。

- 最终 `npm test`：294/294 通过，0 失败、0 跳过；评审修补后重跑约 82.34 秒。
- 最终 `npm run combo:verify`：产品分支基于 `main`、锁定 dsh 提交与 Android 来源声明三项通过。
- 最终 Android `./gradlew test lintDebug assembleDebug -Pourfairy.identityEndpoint=https://measurement.invalid
  --offline --console=plain`：`BUILD SUCCESSFUL`，约 2 分 22 秒。单测、静态检查与 APK 构建均实际执行；
  真机测量是前文独立记录的另一个验证环节。
- Android JUnit 汇总：app 203、highlight 53、ui 20，共 276 项，0 失败、0 错误、0 跳过。

## 两轴评审

Standards 指出 1 项测试覆盖缺口：10 ms 模型片段本身会被共享发布窗口合并，可能掩盖写端背压
退化。将独立背压用例改为 40 ms 片段（超过 32 ms 发布窗口）后，生产实现为 61/256 个正文帧，
测试通过。仅在隔离的 `/tmp` 产品副本中移除 `observe.ts` 的 `!writable ||` 保护、保留共享发布，
得到 256/256 帧，同一 `a stalled reader replayed` 断言失败；真实生产源文件未为此修改。
复跑命令仍为 `node --test tests/chat-stream-backpressure.test.mjs`。

Standards：上述 1 项覆盖缺口已修复，无遗留编码标准违规或需单列的判断性异味。
Spec：无缺失、越界或错误实现发现；人工核对两份原始真机 JSON 的参数、速率及终态字符数。

## 未执行项

未调用真实模型供应商，未重放用户的私有生产会话，也未以 Firebase/Crashlytics 运行结果作证。
数据证明了固定负载下的主导损失与同一真机/链路条件下的修复效果，不将合成模型的字符速率称作
真实供应商 token 速率。
