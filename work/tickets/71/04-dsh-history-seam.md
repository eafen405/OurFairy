## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

在 dsh fork 中把会话历史/跟随的**原生算法**以 Host 可调用的公开接缝暴露出来：assistant 流基线（活动 attempt 的累计正文）与事件流 gap repair，而不是把 Client/Typert/Remote controller 引入产品。产品只依赖这个窄导出，不复制原生算法；导出以 fork 内可测试的公开形式提供，并在 dsh 升级复核时检查其存在。

## Acceptance criteria

- [ ] dsh fork 以公开、受支持的包导出暴露「Host 可调用」的 assistant 流基线与 follow/gap-repair，供产品导入；不导出整个 Client/Remote controller，不要求 Typert/Gateway
- [ ] dsh 侧契约测试：连续帧得到累计正文；乱序/缺口帧被识别并重新打开 follow；`startedAfterSeq` 与耐久 seq 对齐；测试在 fork 集成分支上可重复运行
- [ ] 新导出有简短 README/注释说明它依赖的包与行为，以及上游出现等价公开接缝时应替换掉它
- [ ] 不改变 dsh 现有导出与行为；现有相关 dsh 测试不回归

## Blocked by

None (can start immediately).
