# 阶段审查问题修复与最终组合检查

原始两轴报告在上级目录，结论保持不变：Standards 1 项 P3，Spec 0。P3 已由单一实现代理在 dsh `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee` 修复：沿用 jobs 品牌位置定义 JobGeneration、复用 MessageId；运行时及 wire 内容保持原有语义。修复方详细证据见 `../type-fix/README.md`。

最终集成 OurFairy `a9b86711c0300efce17b0a347f6e48ed003a9cac`、dsh `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`、Android `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6`：

- `npm test`：102/102。
- 真实 profile 任务与活动选定场景：2/2。
- 认证后端 SSE/持久投递捕获：1/1。
- `npm run combo:verify`、独立 home 的 `backend:doctor`、`git diff --check`：通过。
- 根 dsh 窄生产项目 typecheck 与普通 host tsdown jobs/tool-jobs 构建通过，ignored 产物已对齐。

首次最终 SSE 调用使用原始脚本硬编码的旧票 helper，按旧 combo 正确拒绝新原生提交。只将该 import 指向当前 root 的 helper 后成功；原失败和单行适配 patch 均归档。`capture-backend.mjs` 使用相对路径，可在新 checkout 根目录复跑：

```sh
mkdir -p /tmp/ourfairy-final-capture
T15_FIXTURE_DIR=/tmp/ourfairy-final-capture node work/implementation/evidence/review-t13-t15/final/capture-backend.mjs
```

以上使用真实 profile/Loader、本地 HTTP/SSE、JSONL/SQLite 和受限子进程；云模型是受控替身。没有重复构建未变 APK。官方云模型、设备/Doze/强停、APK 连接真实后端、性能和全产品验收未执行。原有 16 个 dsh 脏路径仍未暂存且 post-T13 哈希逐项相同；Android 原有 `.worktrees/` 保留。

正常推送与远端核验在本证据正常提交后执行，原文位于 `/tmp/stage1315-review-fix-integration/`；精确最终 refs 由 Lead 在 tracker 及阶段交接记录。未增加第二轮整批审查。
