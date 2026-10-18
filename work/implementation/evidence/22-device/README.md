# 票 #45 证据：vivo S50 后台通知与长回复实机验收

状态：**未执行**。本票阻塞于 [#44](https://github.com/eafen405/OurFairy/issues/44) 的首版版本组合，
需要目标 vivo S50 设备、真实后台/通知设置与人工操作。

本目录在 #44 交付设备交接说明后创建，用于接收真机证据；在此之前不声称任何真机行为已通过。
模拟器、JVM 测试或构建成功都不能替代本票要求的实机记录。

## 已就绪的前置

- 版本组合与 release 构建：见 [21-integration](../21-integration/README.md) 第 1–2 节。
- 构建、后端地址、管理员/代理人准备、通知与性能采集步骤：见
  [21-integration/device-handoff.md](../21-integration/device-handoff.md)。
- 呈现票的固定负载与测量脚本：见 [19-presentation/measurements.md](../19-presentation/measurements.md)。

## 未执行的具体原因

本轮没有可用的 vivo S50 设备，也没有 adb 连接；`androidToolchain` 只提供 SDK 与构建工具。
因此本票要求的设备/系统版本记录、前台抑制、后台提醒、锁屏/断网/回收、积压合并、
帧耗时与内存测量全部**未运行**，本票不能关闭，父规格也不能据此声称完成。
