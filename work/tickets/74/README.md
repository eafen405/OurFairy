# #74 实施票与任务图

父票：[#74 Android 长回复呈现性能：设备基线、热点定位与受控优化](https://github.com/eafen405/OurFairy/issues/74)。

状态：6 张票已发布为 #74 的原生子议题（#75–#80），全部带 `ready-for-agent` 与原生 blocked-by。
#75–#77 已实现并合入；#78 因设备缺失未完成；#79 未命中判据、未做改动；#80 收口。

## 现状核对（2026-10-19）

- #42 已交付：五档固定负载、`scripts/measure-presentation.py`、`PresentationBenchmarkActivity`、
  host 解析基线测试，均已入库（`cee4098c`、`6861fc3`）。
- 但入口不满足本票要求：#42 的 Activity 直接构造 `RemoteChatMessage`，**没有经过生产接收状态**
  `RemoteChatState`；默认负载（流式 20,000 字符、32 字符/片）与证据记录的
  （232,703 字符、128 字符/20 ms）不一致；结果没有"最新快照是否已应用并呈现"的明确字段。
- 主检出里那批**未提交**的 `frontend-v1` 模块裁剪改造（删 `ai/`、`web/`、`document/` 等模块）
  与本票无关：#74 把客户端迁移与视觉改造列为范围外。本票只沿用其中"独立 perf 源集"的思路，
  不纳入该改造。

## 已发布实施票

1. **[#75](https://github.com/eafen405/OurFairy/issues/75) 测量入口入库并可干净构建** — 阻塞于：无
   - 交付：`perf` 源集 + 固定负载资产 + 从 release 派生的同优化/同签名变体；干净检出
     `:app:assemblePerf` 产出可安装 APK；release 不含测量入口；host 基线测试指向真实样本。
   - 状态：已实现并合入 rikkahub `product/ourfairy-v1`。
   - 本地副本：[01-benchmark-entry.md](01-benchmark-entry.md)

2. **[#76](https://github.com/eafen405/OurFairy/issues/76) 五档负载唯一化并驱动生产接收状态** — 阻塞于：#75
   - 交付：一份权威参数；可重放合成后端经 `RemoteChatState` 驱动五档；参数写进每次结果。
   - 状态：已实现并合入。
   - 本地副本：[02-fixed-workloads.md](02-fixed-workloads.md)

3. **[#77](https://github.com/eafen405/OurFairy/issues/77) 测量结果回答最新快照是否已应用并呈现** — 阻塞于：#76
   - 交付：received/observed/superseded、最新版本是否已应用、终态呈现截止、分阶段指标、设备条件采集。
   - 状态：已实现并合入。
   - 本地副本：[03-applied-state.md](03-applied-state.md)

4. **[#78](https://github.com/eafen405/OurFairy/issues/78) 固定配置模拟器五档三轮基线（方向性）** — 阻塞于：#77
   - 交付：同机三轮基线与门槛，标注为方向性参考。
   - 状态：**未完成**。软件渲染下 `single`/`history` 单轮超时，随后模拟器挂死；用户要求停止模拟器路线。
   - 本地副本：[04-emulator-baseline.md](04-emulator-baseline.md)

5. **[#79](https://github.com/eafen405/OurFairy/issues/79) 按问题判据定位热点并做受控优化** — 阻塞于：#78
   - 交付：命中判据才有改动；未命中记录数据与不改动结论。
   - 状态：**未命中判据，未做改动**（没有可复现的多轮数据）。
   - 本地副本：[05-hotspot.md](05-hotspot.md)

6. **[#80](https://github.com/eafen405/OurFairy/issues/80) 版本组合、证据与 #45 交接收口** — 阻塞于：#79
   - 交付：`combo.json` 更新、证据索引、#45 交接、按 tracker 关闭父票。
   - 状态：已完成。
   - 本地副本：[06-closeout.md](06-closeout.md)

`published.json` 记录发布后的 issue 编号与数据库 id，`publish.py` 是实际发布脚本（幂等，父票
正文/标题/状态在发布前后断言不变）。
