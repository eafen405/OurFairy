# 仓库环境修复（2026-10-22）

范围：CI runner 装配、测试依赖路径、profile 文件隔离与启动失败等待。基线 `379d29c`；dsh 仍锁
`42133b30ad953649b6929078deda84d73cd89e1f`。本轮不改产品接口或数据结构。

## CI 失败与修复

原失败运行：<https://github.com/eafen405/OurFairy/actions/runs/39719886678>，job `119630679747`。
用 `gh api repos/eafen405/OurFairy/actions/jobs/119630679747/logs` 读取原始日志：

- runner 没有可用的 bubblewrap；workflow 安装 bubblewrap、处理 Ubuntu 的用户命名空间限制，
  并实际运行一次隔离命令。探测失败会直接中止该步骤。
- 模型替身、`sharp` 与 PDF worker 的 `cordis` 都从本机的绝对 dsh 路径解析。
  后两项同样是路径错误，日志没有支持“依赖未安装”的证据。本轮没有额外增加依赖安装命令。
- 测试共用的 `dshDir` 复用 `scripts/combo.mjs` 的 `repoPath()`；各套件与 peer resolver 使用该值。
  `tests/dsh-checkout.test.mjs` 将副本的 canonical dsh 路径改为不存在的位置，再通过环境变量
  选择实际检出，实际加载模型替身、sharp 并解析 cordis。

## 远端首轮复核

`345087d` 的运行 `39750416559`：沙箱探测、四条 dsh 构建均通过；全量 241/249，剩余 8 处失败。
其中 4 处 PDF 渲染失败含 `renderer-unavailable`，runner 没有 `/usr/bin/pdftoppm`；workflow 补
`poppler-utils` 并打印版本。另 3 处原生重试与 1 处真实投影快照失败，给断言补充公开 `turn/end`
失败编码以继续定位，没有更改预期或跳过用例。

复核时将锁定 dsh 独立检出、离线按锁安装并完成四条构建；LLM、pi-ai、重试、agent loop、mock
server、Cordis 六个核心产物与原本地构建逐文件 SHA256 相同。pi-ai 官方 1.0.2 发布包应用仓库补丁后
也与本地缓存逐文件相同。单个重试接口用例在 Node 24.18.0、24.21.0（这次 CI 实际版本）、24.22.0
均通过；Node 24.22.0 + 干净 dsh + GitHub 环境标记 + 两核并发的 4 个失败文件共 19/19 通过。
这些对比当时未复现远端剩余 4 处失败，后续定位见下一节。

## 剩余重试失败的根因

`f5a8b20` 的运行 `39757165090` 为 245/249，PDF 已全部通过；仍有 3 处原生重试与 1 处真实投影
失败。错误编码分别为 `RATE_LIMIT`、`SERVER`、`TRANSPORT`，但没有原生重试事件。

临时诊断提交 `e98b18c` 的运行 `39759715005` 给出了关键对照：同一 runner 上，单跑网关重试
用例在未加诊断、加诊断时都通过；紧随其后的全量仍是相同 4 处失败。实际加载的上述六个核心
产物 SHA256 与本地一致，单例的正常策略与监听器也可达。临时诊断在本次修复中移除。

根因是 pnpm 11.28.5 对 `file:` 目录依赖默认使用硬链接。`native-capabilities.test.mjs`
为检查 doctor，从安装后的 bundle 中删除 `llm-retry` 行；当源文件与安装目录在同一文件系统时，
它们可共享 inode，该写入同时删除了仓库源文件及其他 profile 中的重试行。后续启动实际没有挂载
重试插件，故错误分类正确却没有恢复。本机原检出和临时 home 的布局掩盖了这一问题。

最小复现只需在同一个临时仓库中依次运行两个现有测试，不需要并发或改变 dsh：

```sh
node --test --test-name-pattern='doctor passes on the shipped composition' tests/native-capabilities.test.mjs
node --test --test-name-pattern='a route saved from the phone' tests/gateway.test.mjs
```

反馈循环在修复前连续两次失败：doctor 用例通过，网关用例实际请求只有 `['rate_limit']`，
应为 `['rate_limit', 'success']`，与 CI 相同。安装文件与源文件的 `dev`、`ino` 相同，链接数为 2。
本机封装命令和输出留在忽略目录 `work/tmp/repo-env/`：`.repro-retry-interaction.mjs`、
`repro-retry-interaction-red.log`、`repro-retry-interaction-red-repeat.log`。本地原检出设备号为 2096，
临时目录为 72；同盘复现中的源与安装文件设备号均为 72，解释了原布局为何没有暴露硬链接传播。

启动器现在显式使用 `--package-import-method copy`；安装方式也纳入现有内容哈希，使旧的安装戳失效。
固定 pnpm 的 hoisted linker 在普通 install 乃至 `--force` 后仍可能保留旧的本地文件内容，最小
单包实验也复现了这一点。因此仅在内容哈希失效或显式 `--reinstall` 时重建该 profile 的
`node_modules`，保留锁文件、下载存储和用户配置；哈希命中仍直接复用。

新增回归测试 `tests/product-sources.test.mjs` 的
`installed product files are isolated from their source and sibling profiles`，把源和两个 profile
置于同一文件系统，检查安装副本的修改不传播到源或另一个 profile，源修改在重装前不可见、重装后
真正进入副本。它在修复前失败；修复后该文件 4/4 通过，原始双测试反馈循环也通过。

## 启动失败与耗时归因

`start` 原先只等待 `report.ok === true`。probe 已写出失败报告并退出后，启动器仍一直等到
`readyTimeoutMs`。本轮以失败报告或子进程退出结束等待；原超时继续约束没有终态的启动。
失败分支仍杀进程组、删除运行状态，并保留报告与日志指针。

可执行检查：`tests/start-readiness.test.mjs` 覆盖失败报告、报告前退出与运行状态清理；
`tests/row-addressability.test.mjs` 的两个非法配置用例继续检查失败行与字段，并检查返回的失败原因。
新增失败报告用例在修复前实际失败，stderr 为 `did not report ready within 5000ms`；修复后通过。

本机同轮测量（Node v24.18.0；模型、网络使用替身，后端与内核隔离真实执行）：

| 阶段 / 用例 | 结果 | 耗时 |
| --- | --- | --- |
| 路径修复后、等待修复前的全量 | 247/247 | 102.506 秒 |
| 非法 identity 配置（修复前全量内） | 通过，但等满截止时间 | 32.957 秒 |
| 非法 spaces 配置（修复前全量内） | 通过，但等满截止时间 | 32.988 秒 |
| 非法 spaces 配置（修复后定向运行） | 通过 | 3.497 秒 |
| 新增失败报告 + 退出用例 | 2/2 | 6.920 秒 |
| 修复后最终全量 | 249/249 | 83.159 秒 |
| 非法 identity 配置（修复后全量内） | 通过 | 3.564 秒 |
| 非法 spaces 配置（修复后全量内） | 通过 | 3.494 秒 |

两次 30 秒等待是用例耗时之和，不能直接当作全量墙钟节省；并行运行时 gateway 等用例仍可能是
关键路径。交接中 2 分 30 秒至 3 分 45 秒和本轮 102.5 秒的差异也说明负载会影响总时长。

## 缓存实验决定

撤回未提交的 profile 模板缓存实验。交接中的 A/B 已表明它未改善全量测试；本轮选择保持现有
单 home 的内容哈希安装复用，不新增共享模板与过期清理机制。原补丁和未跟踪测试已保存在忽略目录
`work/tmp/repo-env/` 供本机复查，不是交付依赖。

## 验证命令

```sh
node --test tests/dsh-checkout.test.mjs tests/pdf-worker-cancel.test.mjs tests/model-double.test.mjs tests/projection-units.test.mjs
node --test tests/start-readiness.test.mjs tests/row-addressability.test.mjs
node --test tests/product-sources.test.mjs
npm test
npm run combo:verify
npm run specs:status -- --offline
```

定向路径/依赖检查 19/19，通过；新增启动终态检查 2/2，通过。前一阶段 `npm test` 249/249、
0 失败、0 跳过，用时 83.159 秒；`npm run combo:verify` 三项均通过。
profile 隔离修复后的完整提交门禁为 250/250，0 失败、0 跳过，用时 83.340 秒，组合校验三项通过。
原始日志留在忽略目录 `work/tmp/repo-env/`，不入库。远端验证使用专用修复分支的 `check` workflow。

## 范围外状态

- `specs:status --offline` 仍报告 #132/#135/#137 未推送，相对落地分支分别领先 32/50/33 个提交；
  本轮不替这些产品分支做发布或合并决定。
- 7 个遗留 worktree 保留；协作约定不允许自行移除他人的 worktree。
- dsh 检出仍在锁定提交，但现有未提交改动共 14 处（10 份文档、4 处代码/测试），多于交接中的
  8 份文档；本轮不修改、暂存或提交它们。
- origin 当前使用 HTTPS；本机 `core.hooksPath` 为 `.githooks`。这两项是本地配置事实，不改组合锁。
