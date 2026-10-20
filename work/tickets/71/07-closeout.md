## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

把本轮改动纳入版本组合并收口：更新 `combo.json` 锁定的 dsh fork 提交，登记证据目录，运行 `npm test`、`backend doctor`、`combo verify`，按 issue tracker 的方式逐票关闭，并报告未执行项。父票 #71 的正文、标题与状态不被修改。

## Acceptance criteria

- [ ] `combo.json` 反映本轮合并后的 dsh fork 提交，`npm run combo:verify` 通过
- [ ] 证据目录记录实际命令、输出摘要、替身与真实服务的分界、未执行项
- [ ] `npm test` 与 `npm run backend:doctor` 在最终集成状态通过
- [ ] 每张子票按 tracker 方式关闭；父票不被关闭或修改

## Blocked by

- [PDF worker 改由原生 subprocess 服务启动](https://github.com/eafen405/OurFairy/issues/81)
- [挂载原生重试与 spill 行](https://github.com/eafen405/OurFairy/issues/82)
- [被 spill 的结果仍可用 read/grep 取回](https://github.com/eafen405/OurFairy/issues/83)
- [在 dsh fork 暴露 Host 可调用的历史/跟随接缝](https://github.com/eafen405/OurFairy/issues/84)
- [产品历史/跟随适配原生接缝](https://github.com/eafen405/OurFairy/issues/85)
- [升级依赖记录与明确保留的产品实现](https://github.com/eafen405/OurFairy/issues/86)
