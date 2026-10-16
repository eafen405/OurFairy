T18 已完成：沿 T17 的同一附件资格/受控进程接口，以现有 Poppler 按选择页真实渲染，原生图像存储和官方 provider 工具结果序列化贯通；保留页码与原件下载，不扩大用户权限，不默认读完整 PDF。无数据库或 dsh 改动。

[实现与实际检查](https://github.com/eafen405/OurFairy/blob/d189d85bda0b6d0230b3fb96215e5d40f878a8a2/work/implementation/evidence/18-pdf-vision/README.md)，[官方 Flash 真实调用交接](https://github.com/eafen405/OurFairy/blob/d189d85bda0b6d0230b3fb96215e5d40f878a8a2/work/implementation/evidence/18-pdf-vision/flash-smoke.md)。渲染与网络替身通过，尚未调用真实官方云模型。

已沿用现有集成分支发布本批组合：OurFairy `d189d85bda0b6d0230b3fb96215e5d40f878a8a2`（`integration/ourfairy-v1`），Android `771bffd1424da0f8537507caec028e77d0b8b7bc`（`product/ourfairy-v1`），dsh `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`（本批无改动）。

最终正常提交钩子完整 `npm test` 109/109、`npm run combo:verify` 通过；Android 全量 JVM 测试 515/515 和测试签名 release 构建通过。两轴审查确认的长回复阅读位置 P2 已修复并复查，最终源码与受审快照一致。[阶段审查闭环](https://github.com/eafen405/OurFairy/blob/d189d85bda0b6d0230b3fb96215e5d40f878a8a2/work/implementation/evidence/review-t16-t19/resolution.md)。

真实硅基账号/手机麦克风、官方云图像理解及 vivo S50 帧耗时/内存/视觉连续性仍在最终集成与真机票验收，各票已提供可执行联调入口。关闭本票不表示整个首版验收完成。本批收尾后停止，不推进 T20。
