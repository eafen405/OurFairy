## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

把本轮采用的每项原生能力写成一份可复核的升级依赖记录：依赖的 dsh 包/服务/行、依赖的行为、对应兼容性测试、上游变化时的处理方式。同时书面记录两项**明确保留**的产品实现（附件上传、任务输出/停止）及其理由，避免下次审查重复讨论。缺失的必需服务/行/导出要在 doctor 或启动时以明确错误失败，而不是静默降级。

## Acceptance criteria

- [ ] 记录覆盖 PDF(subprocess 服务)、重试(llm-retry 行 + provider retryPolicy)、spill(spill-local/spill-policy 行)、历史/跟随(Host 导出)，每项给出包/服务/行与对应的可执行兼容性测试
- [ ] 附件上传与 jobs 输出/停止的保留理由写入模块 README 或架构说明：可续传 chunk、过期、原件下载、耐久 task fold 是产品需求，原生 fileUploads/jobController 不提供
- [ ] doctor（或启动）在所需行/服务缺失时报明确的失败并命名缺项，附一条会因缺失而失败的测试
- [ ] 不新增重复清单：行清单仍指向 bundle 文件这一唯一权威

## Blocked by

- [PDF worker 改由原生 subprocess 服务启动](https://github.com/eafen405/OurFairy/issues/81)
- [挂载原生重试与 spill 行](https://github.com/eafen405/OurFairy/issues/82)
- [在 dsh fork 暴露 Host 可调用的历史/跟随接缝](https://github.com/eafen405/OurFairy/issues/84)
- [产品历史/跟随适配原生接缝](https://github.com/eafen405/OurFairy/issues/85)
