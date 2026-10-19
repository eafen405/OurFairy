## Parent

[#74 Android 长回复呈现性能：设备基线、热点定位与受控优化](https://github.com/eafen405/OurFairy/issues/74)

## What to build

在固定配置的模拟器上用同一 APK、同一负载建立可复现基线：每档至少 3 轮，报告 p50、p95、帧耗时 p95、超出刷新预算的帧比例、终态格式呈现延迟、堆内存起止与积压状态。所有数字明确标注为模拟器方向性参考，不是 vivo S50 结论。基线、门槛与原始材料交给 #45。

## Acceptance criteria

- [ ] 五档各 ≥3 轮的原始指标、运行命令与设备条件写入证据目录
- [ ] 证据明确区分模拟器与真机，不把模拟器数字写成 vivo S50 结果
- [ ] 给出相对同机基线的回归门槛
- [ ] 未执行项（无真机等）逐条记录

## Blocked by

- [测量结果回答最新快照是否已应用并呈现](https://github.com/eafen405/OurFairy/issues/77)
