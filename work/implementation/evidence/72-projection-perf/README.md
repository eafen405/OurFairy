# #72 后端投影性能：证据索引

本目录是 spec [#72](https://github.com/eafen405/OurFairy/issues/72) 各票的证据入口。每张票的
「做了什么、实际命令、结果、未执行项」写在自己的 `ticket-*.md` 里；本文件只做索引与状态。

基线（改造前）在 `integration/ourfairy-v1` @ `d9fa037` / `bc44f78` 上测得；改造后的票在
`integration/spec-72` 上合入。两边的比较只在同机、同脚本、同参数下成立。

| 票 | 内容 | 证据 | 状态 |
| --- | --- | --- | --- |
| #88 | 固定负载基准与改造前同机基线 | [ticket-88-baseline.md](ticket-88-baseline.md)（含 3 份基线 JSON） | 已合入 `integration/ourfairy-v1` @ `02ffa1b` |
| #89 | transcript / tasks+activity 注册到原生 registry | [ticket-89-units.md](ticket-89-units.md) | 已合入 `integration/spec-72` |
| #90 | 观察者共享与 read/observe 切换 | [ticket-90-read-observe.md](ticket-90-read-observe.md) | 已合入 `integration/spec-72` |
| #91 | 分页在固定截点取值 | [ticket-91-page-cut.md](ticket-91-page-cut.md) | 已合入 `integration/spec-72` |
| #92 | 冷启动重建与 live 状态边界 | [ticket-92-cold-restart.md](ticket-92-cold-restart.md) | 已合入 `integration/spec-72` @ `470624b` |
| #93 | 多观察者共享与多会话隔离 | [ticket-93-isolation.md](ticket-93-isolation.md) | 已合入 `integration/spec-72` @ `c674e6f` |
| #94 | 改造后基准与相对门槛 | [ticket-94-benchmark-after.md](ticket-94-benchmark-after.md) | 已写（待 #95 收口） |
| #95 | 契约文档、全量验证与子票收口 | `ticket-95-closeout.md` | 待写 |

## 重放

```bash
# 单个票的定向测试：命令在各票 README 里
# 全量（#95 的最终验证）
npm test
npm run combo:verify
npm run backend:doctor

# 投影基准（#88 / #94）
node scripts/bench-projection.mjs --out /tmp/projection.json
```

## 未执行项（spec 级，逐票另有记录）

- 没有真实云服务：全程模型替身。
- 没有 Android 设备：本 spec 的验收全在后端，客户端呈现性能不在此。
- 没有多用户并发隔离测量：只有单进程内多会话与多观察者。
- 没有长时内存曲线：只有单次负载的 RSS 采样与 `VmHWM`。
