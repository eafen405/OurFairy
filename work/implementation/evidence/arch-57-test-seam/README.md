# #57 测试 seam：去掉启动器私有布局与生产源码切片

## 前提核对

票面四条问题在 `integration/ourfairy-v1` @ `bd7359c` 复核成立（行号已漂移，用 `grep` 定位）：

- `dsh-home/profiles/ourfairy/cordis.patch.yml` 由测试直接拼写：不只是票面列的四个文件，
  `tests/spaces.test.mjs`（#54 新加）也属于同一 seam，一并纳入。改动前共 **8 处 / 5 个文件**：
  owned-sessions 2、text-delivery 2、spaces 2、jobs 1、file-delivery 1。
- `--allow-drift` 推导重复 3 份：`owned-sessions:37`、`identity-http:26`、`conversation-search:9`。
- `tests/attachment-download-abort.test.mjs:10-18` 读生产源码文本切片 + `new Function` 重建下载闭包。
- 顺带核实：`START` 的 `--patch` 是 dsh CLI 的公开、可重复 overlay 参数（`apps/cli/src/args.ts:170`，
  “extra patch-list overlay applied after the profile layer (repeatable)”），overlay 在 profile 用户层之后应用
  （`apps/cli/src/profile-boot.ts:186-207`）。所以“给运行中的 profile 加一行”本就有受支持入口，只是启动器没有透出。

## 改了什么

1. **启动器透出 `--patch <path>`（可重复）**（`scripts/ourfairy-backend.mjs`）
   - `probe` / `start` 在探测 overlay 之后按 argv 顺序追加测试 overlay，直接交给 dsh 的 `--patch`。
   - `start --json` 摘要与 state、`probe` 报告新增 `overlaysApplied`，可直接看出这一轮挂了哪些 overlay
     （`boot-product` 报告早就有同名字段）。
   - 非 overlay 启动命令（`boot-product`/`stop`/`status`/`doctor`）带 `--patch` 时**报错**而不是静默忽略；
     `boot-product` 的契约就是“无 overlay 的产品启动”。
   - 辅助函数：`bootPatches(options)` / `patchArgs(options)`；`parseArgv` 增加 `patches`。
2. **attachments 导出下载响应工厂**（生产代码）
   - 新增 `backend/attachments/src/download.mjs`：`createDownloadResponder({ attachments })`，
     内容与原先 `apply` 内的闭包逐行一致（close→abort、写满等 drain、finally 释放 iterator）。
   - `backend/attachments/src/index.mjs` 改为 `createDownloadResponder(ctx)` 注册同一个工厂，并 re-export。
     新文件在 `files: ["src"]` 之下，自动进入 profile 安装与 staleness hash（#48 的机制）。
3. **helper 扩接口**（`tests/helpers/backend.mjs`），每个新入口都写明消费者：
   - `startArgs(overlays)`：`['start','--json', ...(--allow-drift if OURFAIRY_DSH_DIR), ...('--patch', path)]`。
     消费者：owned-sessions、identity-http、conversation-search、jobs、text-delivery、file-delivery、spaces、
     attachments、pdf、groups、reconnect、remote-chat、speech（所有 `start`）。
   - `writeOverlay(home, rows, name)`：写测试 overlay 并返回路径。消费者：owned-sessions(2)、jobs、
     text-delivery(2)、file-delivery、spaces。
   - `startedPort(run)`：端口发现与失败断言。消费者：上列除 lifecycle 外全部；`lifecycle.test.mjs` 保留
     自己的 summary 断言（它验的是启动器摘要形状：pid/ready/唯一端口，不只是端口号）。
   - `httpJson(port, path, {method, token, body, expect})`：`node:http` JSON 客户端（不经全局 fetch，
     免被 `NODE_USE_ENV_PROXY` 改道）。消费者：identity-http、owned-sessions（两者原各自 20 行手写客户端）；
     `expect:false` 返回原始响应。
   - `registerUser(port, adminToken, name, password)`：邀请→注册一条流程。消费者：jobs 的 before、
     text-delivery、file-delivery、spaces、conversation-search、attachments、pdf、groups、reconnect、
     remote-chat（各文件保留一行 `user()` 别名以不动调用点）。
4. **测试改造**
   - 5 个文件不再写 profile 私有路径，改为 `writeOverlay(...)` + `startArgs([overlay])`；
     原来的 `writeFileSync(layer,'[]\n')` 复位也随之删除（不传 overlay 即不复位）。
   - `attachment-download-abort` 直接 `import { createDownloadResponder } from '../backend/attachments/src/download.mjs'`
     并传入 fake `{ attachments: { readFileStream } }`；断言语义原样保留（responseClosed / handlerSettled / sourceClosed）。
   - `baseline-boot` 新增一条：`boot-product --patch` 必须失败并点名允许的命令（6 条，原 5 条）。
   - 行为覆盖：这些改造后的测试本身就是“经 helper/`--patch` 加行后行为生效”的可观察覆盖——jobs 的
     `completionDelivery: quiet`（断言 `delivery === 'quiet-context'`）、text/file-delivery 的故障注入、
     owned-sessions 的持久化 fixture 与 resume-empty fixture、spaces 的 scope contributor，全部依赖 overlay 真的挂上。

## 提交（分支 `arch/57-test-seam`）

- `fc044cb` refactor(attachments): export the download responder as a factory
- `38c67d0` test(seam): mount test rows through the launcher, not the profile layout
- merges：`aa28229`（bd7359c→09d2a89）、`643b1c7`（09d2a89→06e16db，含 rikkahub pin 18964827）、
  之后分支已被集成分支快进合入（`4ee6b39` = Merge arch/57-test-seam）
- FINAL_SHA = `4ee6b39b153db194961a7c91fa5eb0b26f3c43e0`（= 集成分支 tip，已含本票两个提交）

## 命令与证据（原始日志同目录）

| 命令 | 结果 |
| --- | --- |
| `npm test`（基线，合并前） | 115 pass / 0 fail（`baseline-npm-test.log`） |
| `node --test tests/attachment-download-abort.test.mjs`（red） | ERR_MODULE_NOT_FOUND：`download.mjs` 不存在（`red-download-factory.log`） |
| 同上（green） | 1 pass（`green-download-factory.log`） |
| `node --test --test-name-pattern="configured quiet completion" tests/jobs.test.mjs`（red） | `ourfairy-backend: unknown flag --patch`（`red-patch-overlay.log`） |
| 同上（green） | 1 pass，4.7s（`green-patch-overlay.log`） |
| 定向：owned-sessions + text-delivery + file-delivery + attachment-abort | 21 pass（`green-targeted-1.log`） |
| 定向：identity-http + spaces + conversation-search | 23 pass（`green-targeted-2.log`） |
| 定向：jobs 全文件 | 9 pass（`green-targeted-3.log`） |
| 定向：baseline-boot（含新增拒绝用例） | 6 pass（`green-baseline-boot.log`） |
| `npm test` 全量（helper 迁移后） | 116 pass / 0 fail（`full-npm-test.log`） |
| `npm test` 全量（再扩 helper 消费者后） | 115 pass / 1 fail（`full-npm-test-2.log`）——唯一失败是 `lifecycle`
  的 doctor 报“not based on integration/ourfairy-v1”：集成分支期间从 bd7359c 前进到 09d2a89，非本票改动 |
| merge 09d2a89 后 `npm test` | 117 pass / 1 fail（`full-npm-test-3.log`）——同一 doctor 检查改为报 rikkahub
  checkout 已到 18964827、combo.json 仍锁 fcba0647；该 pin 属另一张票（#60）的 merger，本票不改 combo.json。
  `combo-verify-pinned-rikkahub.log` 留证：即使把 rikkahub 路径指到含 fcba0647 的 worktree，combo.mjs 仍读共享分支
  tip，故该失败确为跨仓中间态 |
| merge 06e16db（其 combo.json 已 pin 18964827）后 `npm test` 全量 | **118 pass / 0 fail**（EXIT:0） |
| 分支被集成分支快进合入后（FINAL_SHA 4ee6b39）`npm test` | 118 pass / 1 fail（`full-npm-test-final.log`）：
  `groups` 在 `start` 时 ENOENT `backend/identity/src/staleness-probe.mjs`——该文件由同跑的
  `product-sources.test.mjs` 临时创建并在 `after` 删除，两文件并行时被误删；**并发 flake，非本票改动**。
  单独跑 `groups`（`recheck-groups.log`）4 pass，全量复跑 `full-npm-test-final-2.log` **118 pass / 0 fail，EXIT:0** |
| `npm run combo:verify`（最终） | 3 仓全 ok，exit 0（`combo-verify.log`） |
| merger 在合入后的集成分支 tip 4ee6b39 上复跑 | `npm test` 118 pass / 0 fail、`combo:verify` 3 仓 ok
  （`merger-npm-test.log`、`merger-combo-verify.log`） |

## 收敛后的可度量事实

- 测试里拼写 `dsh-home/profiles/ourfairy/cordis.patch.yml` 的处数：**8 → 0**（5 个文件）。
- 各自推导 `--allow-drift` 的处数：**3 → 0**（仅 helper 内 1 处）。
- 直接解析 `listeningPorts` 的测试：**11 → 1**（仅 `lifecycle.test.mjs`，它断言摘要形状而非端口）。
- 手写邀请→注册流程：**11 → 0**（10 个文件保留一行 `user()` 别名，内部调 `registerUser`）。
- `['start', '--json']` 字面量：**13 → 2**（剩余两处是 `lifecycle` 的 `['start']`，它用默认 3080 的显式 env）。
- 手写 `request()` 实现：**12 个文件 → 10 个文件**仍自带传输实现；identity-http / owned-sessions 收敛为
  一行委托 `httpJson`，其余 10 个保留自己的 `fetch`/`node:http` 封装（返回形状各异，见下），未统一。
- 生产源码文本切片：**1 → 0**。

## 未做 / 范围外

- **仍有 10 个测试文件手写 `request()`**：其中 8 个是 `fetch` 封装（jobs/text-delivery/file-delivery/spaces/
  conversation-search/groups/attachments/pdf），返回形状各不相同（`json` vs `{status, body}`，附件/PDF 还要
  multipart 与自定义头），reconnect/remote-chat 是返回 `{status, body}` 的 `node:http` 封装。把它们统一成
  `httpJson` 需要改动大量调用点与返回形状，属于票面明确不建议的“为覆盖率全量重写”，未做；helper 已有
  `httpJson` + `registerUser` 承载新测试所需的 seam，消费者见上。
- `tests/lifecycle.test.mjs` 仍保留自己的 `start`/summary 解析：它验的是启动器摘要形状（pid、ready、唯一端口），
  与端口发现不同，未迁移。
- `doctor` 在集成分支/组合 pin 前进时会失败（本票执行中遇到两次，均为跨票中间态），按 CONTEXT 先 merge 再复跑，
  最终 06e16db 上全绿；两次失败日志都保留在证据目录。
- 未发现其他票面相关问题；未改 `combo.json`、未 push、未合入集成分支、未评论 issue。
