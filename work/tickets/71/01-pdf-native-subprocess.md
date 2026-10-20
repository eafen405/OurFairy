## Parent

[#71 后端原生能力收敛：PDF 进程、模型重试、spill 与会话历史复用](https://github.com/eafen405/OurFairy/issues/71)

## What to build

Fairy 解析 PDF 时，worker 进程由 dsh 原生 subprocess 服务启动，而不是产品自己 `node:child_process.spawn`。超时、取消、输出上限与进程回收只有一套语义。PDF 的 bwrap 参数构造仍只有一个函数，并显式声明不共享网络；spaces 的脚本执行保持现有可联网决定。页码、文本预算、渲染页数、临时目录清理、错误码与模型可见结果形状全部不变，现有 PDF 测试逐条保持通过。

## Acceptance criteria

- [ ] `pdf_info` / `pdf_read_pages` / `pdf_render_pages` 的 worker 经 `ctx.subprocess.spawn` 启动；`backend/attachments/src/pdf.mjs` 不再导入 `node:child_process`
- [ ] 取消信号、超时、stdout 上限与进程回收由 subprocess 服务承担，PDF 模块只保留自己的资源预算与结果映射；现有 PDF 测试（页码/截断/错误码/原件下载/临时清理）全绿
- [ ] bwrap argv 只由一处构造，带显式「是否共享网络」参数；PDF 传不共享网络，spaces 传共享网络
- [ ] 一条窄测试断言 PDF 的 bwrap argv 不含 `--share-net`（端到端无法观察网络隔离，这是必要补充 seam，不是第二套运行模型）
- [ ] 进程被取消或超时时，PDF 仍返回既有数字状态与错误码，不泄漏子进程

## Blocked by

None (can start immediately).
