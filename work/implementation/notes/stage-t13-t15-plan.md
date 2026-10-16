# T13–T15 阶段计划

用户授权处理 T13/#36、T14/#37、T15/#38；按前轮方式完成阶段性两轴 code-review、发布收尾后停止，不继续后续票。

## 入口与范围

从 `work/implementation/CONVENTIONS.md` 进入，按需读本地票面 `work/tickets/ourfairy-v1/{13-jobs,14-activity,15-notifications}.md` 与父规格 `docs/specs/ourfairy-v1.md`。
已批准的测试接缝在父规格的「Testing Decisions / 主要测试接缝」：真实 profile/Loader 和经过认证的会话 Interface；真实受限进程；Android 公共投影及平台 Adapter。复用这些接缝，不另立测试运行模型。

GitHub 原生依赖是开工门槛。Lead 本轮查得链为 #36 → #37 → #38：#36 open、blocked_by=0；#37 与 #38 各 blocked_by=1。只对当前已解除阻塞的票开工；后继票在前票关闭后重新查实时状态。

## 固定审查基点

| 仓库 | 基线提交 |
| --- | --- |
| OurFairy | ecd345327225100e252d665039e9ad668ea4c3bb |
| dsh | 173e155a85305db378dd92b1fa057ac6e6dea86e |
| rikkahub | b0911d34bdbe6ee8f559167ede41da95a9f082f8 |

`ecd3453` 是已经完成的 retro 工作；本轮 staged review 只看它之后的产品增量。基线检查与已有脏文件哈希见 `work/implementation/evidence/stage-t13-t15/README.md`。

## 执行与交付

每票在对应仓库独立 worktree 实施；复用既有 jobs、同步与通知能力，明确范围的小任务优先委派 mcode，复杂生命周期和权限由经验子代理负责。实现者合入最新集成 tip 后交付，由指定 merger 合入并更新版本组合。

当前尚未决定新增产品数据结构。需要变更时由实现负责人先说明需求、复用缺口及具体变化，Lead 告知用户后实施；本计划不预设结构。

三票完成后，用独立子代理做一次 Standards + Spec 两轴 code-review，修复所属模块的实际问题。最终集成状态运行 `npm test` 与 `npm run combo:verify`，保留原始证据，区分替身、构建与真实服务/设备结果。按已授权 tracker 流程发布并清理本阶段 worktree 后停止。
