## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

被原生 spill 的完整结果，模型仍能用 `read` / `grep` 按 locator 取回。产品的 fs 是会话范围受限的：spill 文件不在 spaces 根内，当前会被 `FS_PERMISSION_DENIED` 拒绝。让当前会话只读地看到它自己的 spill 目录，不扩大到其他会话、其他用户或整机。

## Acceptance criteria

- [ ] 同一会话内，模型对被 spill 的 locator 执行 `read` 成功，内容与完整工具结果一致；`grep` 可检索其中文本
- [ ] 其他会话/用户对该 locator 的读取被拒绝，拒绝信息不冒充成功
- [ ] 读取权限只来自「当前会话的 spill 目录」这一窄贡献，不新增可写根、不放开 `DSH_HOME` 整体
- [ ] 现有 spaces、附件、PDF 的权限测试不回归

## Blocked by

- [挂载原生重试与 spill 行](https://github.com/eafen405/OurFairy/issues/82)
