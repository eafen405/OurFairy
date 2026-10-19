## Parent

[#74 Android 长回复呈现性能：设备基线、热点定位与受控优化](https://github.com/eafen405/OurFairy/issues/74)

## What to build

测量入口必须能从干净检出复现：benchmark 源码、固定负载样本与构建变体全部纳入版本控制，仓库里不再有"只在某人工作区存在"的测量代码。构建产物与 release 同优化配置、同签名方式，并可从干净检出直接产出可安装 APK；host 基线测试指向实际存在的样本位置，普通 release/debug 构建不携带测量入口。

## Acceptance criteria

- [ ] benchmark 源集（测量 Activity、可重放合成后端、固定负载资产）与构建变体进入版本控制，干净检出可执行 `:app:assembleBenchmark` 并产出可安装 APK
- [ ] 测量入口只存在于 benchmark 变体；release APK 的清单中不含测量 Activity
- [ ] host 基线测试读取的样本路径在检出中存在，测试通过
- [ ] 证据记录构建命令、产物 SHA256 与签名类型

## Blocked by

None (can start immediately).
