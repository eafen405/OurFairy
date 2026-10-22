> 发布权威：[#155](https://github.com/eafen405/OurFairy/issues/155)。本文件是工作副本。

## Parent

[#137 启动器拆分：组合层独立成零 spawn 模块，并修正 doctor 的错误契约](https://github.com/eafen405/OurFairy/issues/137)

## What to build

修正启动器的错误契约：启动器内部的失败改为抛出 `Error`，由 CLI 边界统一加既有前缀写 stderr 并退出；
`doctor` 的逐检查 `try/catch` 因此能真正把失败记成失败项，`doctor --json` 在任一检查失败时仍输出完整 JSON 报告。

本票只改错误契约，不动模块结构（拆分在下一票）。消息文本逐字保留，既有依赖这些文本的断言必须原样通过。

## Acceptance criteria

- [ ] 启动器内部的失败路径（argv 用法、`--patch` 准入、隔离 home 拒绝、dsh 检出缺失、profile 安装失败等）改为抛出 `Error`，不再在内部调用 `process.exit`
- [ ] CLI 边界统一捕获，输出 `ourfairy-backend: <message>` 到 stderr 并以既有非零码退出；用法错误（`--help`/无命令）的退出码不变
- [ ] 错误消息文本逐字不变：`--patch applies to probe and start only…`、`already running with pid …`、`dsh checkout missing at …`、`refusing OURFAIRY_HOME=…`、`profile install failed in …`
- [ ] `doctor --json` 在 dsh 检出缺失时输出含 `dsh CLI build` 失败项的完整 JSON，并以非零码退出；stderr 不再出现无 JSON 的猝死
- [ ] 新增断言：`doctor --json` 在 `OURFAIRY_DSH_DIR` 指向不存在路径时仍打印可解析的 JSON，且 `dsh CLI build` 项为失败、消息点名该路径
- [ ] `tests/lifecycle.test.mjs`、`tests/baseline-boot.test.mjs` 既有断言原样通过
- [ ] 证据落在 `work/implementation/evidence/137-launcher-split/01-error-contract.md`

## Blocked by

None (can start immediately).
