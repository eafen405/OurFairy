# #74 Android 长回复呈现性能：设备基线、热点定位与受控优化

本目录按票 #75–#80 记录。每一节只写实际执行过的命令与结果；未执行项单列，不写成通过。

## 票 #75 测量入口入库（进行中）

### 事实起点

- #42 的入口虽已入库（`cee4098c`、`6861fc3`），但测量 Activity 直接构造 `RemoteChatMessage`，
  绕过生产接收状态 `RemoteChatState`；流式默认 20,000 字符 / 32 字符每片，与 `measurements.md`
  记录的 232,703 字符 / 128 字符每 20 ms 不一致；结果没有"最新版本是否已应用并呈现"的字段。
- 主检出里未提交的 `app/src/benchmark/` 不是任何已注册源集，实测不参与编译（APK 中无
  `SyntheticChatBackend`）；`benchmarkRelease` 是 baselineprofile 插件自动生成的 build type，
  未签名。因此不能作为可复现入口。

### 本轮改动

- 测量源码、固定负载与清单从 `app/src/main` 移到 `app/src/perf`；`main` 不再含测量 Activity。
- 新增 `perf` build type：从 `release` 派生，保留 release 的优化与签名，版本名加 `-perf`。
  沿用 release 的包名，因为 Firebase 配置只声明了 `me.rerere.rikkahub`，改名会让
  `processPerfGoogleServices` 失败；代价是它不能与 release 同时安装（测量前需卸载）。
- host 基线测试改读 `src/perf/assets/presentation/workload.md`，与设备负载同一文件。
