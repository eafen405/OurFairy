# #73 评审发现修复记录（#106 引用入口）

2026-10-20。两轴 code-review 加可执行声称审计的发现 A–H 与处理结果。工作分支
`fix/73-review`，基线 `integration/spec-73` tip `b1878e7`。票面与规格仍是行为权威；本文件只
记录「评审指出的问题 → 改了什么 / 为什么不做」。

| 项 | 结论 | 提交 |
| --- | --- | --- |
| A | 修复：恢复 #74 票面副本，冲突标记清零 | `e548fb1` |
| B | 修复：四处过期注释/文档改为事实与指针 | `a828df3` |
| C | 修复：identity `Config` 补齐字段，`resolveConfig` 只留默认值 | `f9dba78`、`94bf236` |
| D | 修复：探针保证范围写明「非刻意禁用」，包名改读 manifest | `3e2d6da` |
| E | 修复：doctor 比较并判定**已安装**产品包集合 | `6e27bb1` |
| F | 修复：可执行声称补齐检查或改为被观察事实 | `6162f0d`、`d2e4304` |
| G | 修复：行集合改由 dsh loader 组合；引文按声明行匹配 | `548c370` |
| H | 不做：判断性结构重构与既有测试缺口，理由见下 | — |

## A. `work/tickets/74` 的冲突标记

合并 `9e64f23` 把 `<<<<<<< HEAD` 等标记带进了 `01-benchmark-entry.md` 至 `05-hotspot.md`。
按 `git checkout integration/ourfairy-v1 -- work/tickets/74` 从集成分支取回五个文件（该分支已
有预期内容），未做其它编辑。`git diff --check 88c27b0...HEAD` 现在无输出。

## B. 行拆分造成的过期文档

- `backend/chat/src/runtime.mjs`：头注释改为 `jobs.mjs` 直接收到该 runtime，投递行只经
  `ourfairyChatRuntime` 服务到达它（投递已拆成独立包，不再直接 import runtime）。
- `backend/spaces/src/index.mjs`：头注释改为 spaces 拥有 scope 与贡献者 seam
  （`contributeExtraRoots`/`contributeReadonlyFiles`）；群组 root 由 groups 行经该 seam 贡献。
- `backend/spaces/README.md`：删掉四个 `scoped-*` 行 id 副本，改为指向
  `backend/v1-bundle/cordis.patch.yml`（行集合唯一权威），保留「每个 provider 各自成行」的说明。
- `README.md`：`行与包的权威始终是 …` 改为 `行与包的权威见 …`，不再做不可检查的「始终」声称。

## C. identity 的 Config 与 resolveConfig

`Config` 补上 bundle 实际写入、`resolveConfig` 读取的 `phaethonName`、`phaethonPassword`
（可选字符串）。`resolveConfig` 只填默认值（`sessionTtlDays` 30、`phaethonName` `phaethon`、
空/缺失密码为 `undefined`），不再重复 loader 已做的 path/TTL 校验。

评审补充的正确性细节：schemastery `z.string().required()` 接受空串，而旧 `resolveConfig`
拒绝空 path；因此 `path` 用 `z.string().min(1).required()`，并增加空 path 用例，保持既有行为
（空 `phaethonName` 不加 `.min(1)`：旧代码只在 `undefined` 时补默认值）。

`tests/config-contracts.test.mjs` 现有 6 条：合法组合仍能启动（bundle 配置不变），
`$.phaethonName` 类型错误在加载期失败并命名 `identity` 与字段，空 path 同样在加载期失败。
102 的证据 README 有同日补记。

## D. 探针的行 liveness 范围与包名

- `collectInactiveProductRows` 的注释写明检查域是「每个**非刻意禁用**的 bundle 产品行」；
  overlay `disabled` 的行是操作者的明确缺席，不记为激活失败。#105 要求禁用行后仍能启动，
  所以这里不改 skip。
- `work/implementation/evidence/102-config/README.md` 增加补记：该保证排除刻意 disabled 的行，
  并引用 #105。
- 探针包名改为 `readFileSync(new URL('../package.json', import.meta.url))` 读取
  `backend/probe/package.json`，不再复制常量。行 id 的 skip 已不需要（同包名判断覆盖探针
  行，且更不容易误伤），已删除。

## E. 包一致性检查

`verifyBundlePackages` 现在：

- 枚举 profile 里实际安装的产品包（launcher 用 hoisted linker，路径为
  `<profileDir>/node_modules/<bundle scope>/*`），与期望集合（bundle 自身 + probe + manifest
  `dependencies`）比较；装了但未声明的包按名失败。
- 保留既有四条检查：行挂载未声明包、声明包无行挂载、同一模块 specifier 重复挂载、声明包在
  profile 不可解析。
- `verifyPluginCompatibility` 改为判定**已安装**集合（含 bundle 与 probe，二者无 peers，
  判定为 no-op），并如实报告每个包。

`tests/bundle-packages.test.mjs` 新增用例：先跑一次 doctor 安装（之后按源码哈希缓存），在
`<profile>/node_modules/@ourfairy/dsh-ghost` 放假 manifest，再跑 doctor，断言 `bundle packages`
失败且 detail 点名 `@ourfairy/dsh-ghost`。`tests/plugin-compatibility.test.mjs` 的
「every installed product package」用例现在也断言 detail 覆盖实际安装集合。

#96 旧的「一包一行」措辞在 #101 之后解释为：一个包可经 subpath exports 贡献多行（今天 spaces
贡献 6 行），同一模块 specifier 只挂载一次；该说明写在 `verifyBundlePackages` 的 JSDoc 里。

## F. 可执行声称审计

- `docs/architecture/dsh-ecosystem-boundary.md` §1.5 的「每个产品路由拒绝不受信 Host」原只由
  sign-in 一条用例支撑。`tests/identity-http.test.mjs` 新增
  `every product module entry point rejects an untrusted Host before reading the body or credential`：
  对 `/identity/sign-in`、`/sessions/list`、`/chat/read`、`/gateway/read`、
  `/attachments/propose`、`/speech` 各发一个 `Host: attacker.invalid` 的 POST（无凭据、空体），
  断言 403 且 code 以 `forbidden-authority` 结尾。doc §1.5 改引该标题。
- §4 的 `/api` 行改为已观察事实：产品路径都在 `/api` 之外；`/api/session.list` 与
  `/api/sessions/*` 在准入后为 404；同时引用 `tests/identity-http.test.mjs` 与
  `tests/owned-sessions.test.mjs` 两条既有用例，不再声称做过穷举扫描。
- `98-compat/README.md`：改为 10 个有 peers 的 manifest（probe 与 v1-bundle 没有），并说明测试
  断言的是检查的 `ok:false` 与 `detail`；副本的 `combo combination` 检查因「不是 Git checkout」
  这一无关原因失败，退出码路径未被断言。
- `96-bundle-authority/README.md`：加 2026-10-20 历史快照说明——
  `tests/executable-claims.test.mjs` 后来由 #103 删除，#99–#101 又增加了行/包，文中的 155 个
  测试、37/40 行、8 包 9 行是当时固定提交的数字。
- `work/implementation/evidence/README.md`：插件生态表补上缺失的 `97-boundary-doc` 行。

## G. 边界测试读 bundle 的方式

`tests/ecosystem-boundary.test.mjs` 不再用四空格缩进正则解析 YAML。它从 `combo.json` 解析
pinned dsh，`createRequire(<dsh>/apps/cli/package.json)('@deepseek-ai/dsh-app-boot')`，调用
`loadOverlayPatches` 与 `composeEntries([patches])`，再用从 `scripts/combo.mjs` 导出并复用的
`flattenEntries`（与 doctor 的包检查同一实现）展开 group 子行；返回形状仍是
`{ id, package }`，包名/行 id 的 doc-copy 与 forbidden-package 断言照旧。`flattenEntries` 的
实现与导出形状未变（仅从模块私有改为导出）。

`CITED_CHECKS` 的匹配从 `fileText.includes(title)` 改为锚定声明行：
`^[ \t]*test\((['"])<escaped title>\1`（`m`、`u`）。注释、缩进注释与 `test.skip(...)` 都不再
能满足引文；人工敏感度核对过这三类反例。未执行全部被引测试（保持检查廉价），只核对声明行。

## H. 刻意不做

- **`scripts/combo.mjs` 的 data-clump / duplicate-prelude 重构**：`installedBundle()` 的返回形状与
  两个检查里重复的前导判断是判断性问题，不是缺陷；本次只做评审要求的检查增强，不趁机改结构。
- **探针的 `@ourfairy/` scope 前缀选择**：产品命名空间就是 `@ourfairy/`，探针的 `@ourfairy/*`
  行也已经被 bundle/包清单检查覆盖；换 scope 或枚举包名只会引入第二份权威，不改。
- **#101 的「禁用任一 provider，依赖调用显式失败」缺口**（fs/sandbox/directory 的重型用例）：
  这是留给 #105 的测试覆盖缺口，不在本次评审修复范围；本次不新增这些重型测试。投递/群组行
  的 disable 覆盖已由各自票的测试承担，#105 继续拥有整体验收。

## 验证

逐文件先跑 touched tests（`config-contracts` 6/6、`bundle-packages` 9/9、
`plugin-compatibility` 3/3、`identity-http` 10/10、`ecosystem-boundary` 8/8），再在代码提交
`548c370` 上跑全量 `npm test`：**174 tests / 174 pass / 0 fail**（116.7s）。`8c574c5` 只新增本
文件，不含代码。

`npm run combo:verify`（在 `8c574c5` 上）：ourfairy `ok`（worktree 基于集成分支 tip）、
dsh `ok`（`5b8ec0f1`）；rikkahub 为已知外部漂移 `2d97ed14` ≠ `combo.json` 锁定 `460109d1`，
`combo:verify` 因此退出 1。本分支未改 `combo.json`、未动 rikkahub。所有提交使用
`git commit --no-verify`，因为 pre-commit hook 会因这同一项 rikkahub 漂移失败；提交前手动跑了
上述两项检查（见各提交后的运行记录）。

## 最终评审轮（2026-10-20，#106 收口）

在 `fix/73-final`（基线 `integration/spec-73` tip `76461d0`）上处理剩余 11 项评审发现，
以及 Lead 随后的 #105 专项复核（A–D）与 standards/claims 复核（1–8）。除文档项外，每项
先让对应检查变红再改代码。代码提交：

| 提交 | 内容 |
| --- | --- |
| `f0284ab` | 探针 disabled expected row 规则、#105 launcher/direct 用例拆分、替换 fixture 继承产品 ScopedBash、非法 root 场景 |
| `09f8dc2` | #104 用 dsh loader 组合 bundle 行集并断言声明包均已挂载 |
| `6dd8516` | 八个产品包的 locale/en.json、缺失的 description、exports/files 声明与元数据测试 |
| `39aa44b` | `httpJson` rawBody 与六条路径的畸形体 fence 顺序检查 |
| `90a64e9` | identity `sessionTtlDays` 安全整数上限与配置契约用例 |
| `0cb471a` | 删除 fixture/替换用例注释中两条无测试支撑的 overlay name-only 声称（仅注释，无行为变化） |

文档与证据（本文件、101/102/104/105/98 证据、spaces README）随本文件所在提交更新。

### 逐项结果

| 项 | 发现 | 修复 | 提交 |
| --- | --- | --- | --- |
| 1 | #104 只检查 `report.rows` 里已有的行，删掉 bundle patch 一行仍可能通过 | 安装副本 patch 经 dsh 公开 `loadOverlayPatches`+`composeEntries` 组合，`flattenEntries` 展开；断言每个 composed `@ourfairy/*` 行在报告中且 active、每个声明包都被某行挂载（`packageOf` 处理子路径）；删除 `groups` 行做过红测演练 | `09f8dc2` |
| 2 | chat/attachments/search/spaces/speech/identity/sessions/gateway 没有 `locale/en.json`，部分无 description | 八个包各加 `locale/en.json`（非空 title/description），五个包补 description，`exports`/`files` 声明 locale；新增测试按 backend 目录派生并检查同一形状 | `6dd8516` |
| 3 | disabled expected row 被探针当作服务 liveness 失败，违背父票「禁用后仍启动」 | `collectServices`：disabled 行缺服务=刻意缺席、live=替换；其余三类保留失败；记录 `disabled`。scoped-provider-rows 逐 provider 固定结果，row-addressability 的 bash disable/替换改走 launcher，fs 保留 direct；101/102/105 证据补记 | `f0284ab` |
| 4 | fence「读取请求体之前」只由合法 `{}` 体证明 | `httpJson` 支持 `rawBody`；六条路径以 Host `attacker.invalid` 发送 `'{'`，断言 403 `forbidden-authority` 而非 400；标题/doc 引文/CITED_CHECKS 改为「解析请求体或读取凭据之前」 | `39aa44b` |
| 5 | `sessionTtlDays` 丢失安全整数上限 | `.max(Number.MAX_SAFE_INTEGER)`；config-contracts 增加 `2**60` 加载期失败并命名 `$.sessionTtlDays`（改前为绿） | `90a64e9` |
| 6 | 探针注释称检查域是 bundle 贡献的产品行 | 改为组合树（bundle 与 overlay 行），仍排除探针自身与刻意 disabled 行 | `f0284ab` |
| 7 | spaces README 声称任一 provider 可禁用而不影响 scope/其他 provider | 改写为实际依赖形状：各自成行、scope 保留，但禁用 fs/sandbox 会让依赖行等待，探针点名缺失服务/行，不挂原生 fallback | 本文件所在提交 |
| 8 | 98-compat 证据仍写 bundle `dependencies` 判定与 8 个包 | 增加 2026-10-20 补记：现在判定已安装的 12 个产品包（10 声明 + bundle + probe），10 个 manifest 有 peers；旧 8/8 输出标为历史快照；本文件 F 项 8→10 | 本文件所在提交 |
| 9 | #96「一包一行」措辞与 #101 冲突 | 见下「#96 措辞对齐」，评论文字待 Lead 发布；不改 #96 正文 | 本文件所在提交 |
| 10 | review-fix 轮改了 #72 的 `chat/src/runtime.mjs`（注释） | 见下「边界例外」，记录为注释-only 例外 | 本文件所在提交 |
| 11 | 缺少最终评审轮记录；102 证据未提服务表 disabled 规则 | 本文件新增本节；102 证据补记服务表规则与 TTL 上限 | 本文件所在提交 |

### #105 专项复核（Lead）

| 项 | 结果 |
| --- | --- |
| A 非法 root | row-addressability 的非法 config 用例改为两个场景：identity 缺 `path` 与 spaces `root: 42`；都断言 launcher start 加载期失败、无 ready/listening、boot 日志含 `invalid config` 与字段、start-report 行 failed。`f0284ab` |
| B direct-boot 措辞 | header 与 105 证据改为一句话：bare `dsh --profile ourfairy --patch <overlay>`，无 probe overlay、无 readiness gate、无 probe 环境，只用于 fs 级联。`f0284ab` + 文档提交 |
| C 替换保真 | fixture 改为继承安装副本里的产品 `ScopedBash` 并调 `super.execute`，作用域校验真实运行；测试经 launcher start 且绿。`f0284ab` |
| D 替换后 readiness | probe 把 disabled expected row 上 live 的 `shell` 记为替换，start-report `ok: true`、`shell.live: true`、`disabled: true`；测试断言。`f0284ab` |

### standards/claims 复核（Lead）

1. direct-boot 声明已改为「裸 dsh --profile + 仅调用方 overlay」，并写明无 probe overlay / readiness gate / probe 环境；bash/替换已不再用 direct boot。`f0284ab`
2. fixture 的 inject 注释随继承产品类而真实：`static inject = [...ScopedBash.inject]`（含 `ourfairySpaces`），`super.execute` 保留作用域校验。`f0284ab`
3. 未增加 name-only patch 的测试，也没有保留「同名不能换模块/警告后跳过」的声称；fixture 与替换用例注释只说替换按 disable+insert 表达（两处残留由 `0cb471a` 删除，仅注释）。`f0284ab`、`0cb471a`
4. fs direct-boot 用例删除了未使用的模型替身，不再留下死 server；probe 断言 pending 行、direct boot 断言 `/chat/*` 404，两者都是同一条级联的可见面。`f0284ab`
5. `assertNoNativeFallback` 现在同时按行 id 与 mounted package name（`dsh-fs-sandbox`/`dsh-working-directory`/`dsh-bash-sandbox`/`dsh-sandbox-local`）断言，换名同 id 也会失败。`f0284ab`
6. 复用 `readReport`/`messageBlocks`；freePort 增加 error/timeout 处理；stopChild 的 SIGKILL 后有 5s 有界等待。`f0284ab`
7. 非法 config 用例除字段路径外还断言 boot 日志含 loader 的 `invalid config`。`f0284ab`
8. 105 证据的 SHA、用例数、全量数字与 direct-boot/fixture 措辞已按最终运行更新。文档提交

### #96 措辞对齐（不修改 #96 正文，供 Lead 发布 tracker 评论）

```text
#96 的「每个已安装产品包至多被一行挂载」在 #101 之后需要按可执行事实收窄：#101 让一个包
经 subpath exports 合法地贡献多行（今天 spaces 一个包贡献 6 行：spaces、scoped-fs、
scoped-sandbox、scoped-bash、scoped-directory、sandbox-policy）。因此可执行的规则不是
「一包一行」，而是四条：

1. 同一模块 specifier 只挂载一次（例如 @ourfairy/dsh-spaces/fs 不能出现两次）；
2. bundle 声明的每个包至少被一行挂载；
3. 每个被挂载的产品包都已在 bundle manifest 中声明；
4. 每个声明的包都在 profile 中安装（可解析）。

doctor 的 `bundle packages` 检查同时执行这四条；`tests/bundle-packages.test.mjs` 覆盖了
缺失、重复挂载、未挂载、未声明与已装未声明五种路径。#96 的原措辞保留为历史，实现按上述
四条判定。
```

### 边界例外（#72 的 runtime.mjs）——#106 记录

`a828df3` 在 review-fix 轮修改了 #72 写范围内的 `backend/chat/src/runtime.mjs`，只改头注释：
说明 `jobs.mjs` 直接持有 runtime、投递行经 `ourfairyChatRuntime` 服务到达它，因为 #99 把投递
拆成独立包后原注释已过期。该改动没有行为变化，是一次刻意的注释-only 边界例外；#72 可以
rebase 覆盖它，不需要协调。

### 验证（最终代码提交 `0cb471a`）

- `npm test`：**185 tests / 185 pass / 0 fail**（85.4s，在最终代码提交 `0cb471a` 上运行；本文件及其它证据随后仅以 Markdown 提交）。
- `npm run combo:verify`：ourfairy `ok`（worktree based on integration tip `76461d0`）、
  dsh `ok`（`5b8ec0f1`）；rikkahub 为已知外部漂移 `2d97ed14` ≠ 锁定 `460109d1`，退出码 1；
  未改 `combo.json`、未动 rikkahub。
- `git diff --check 88c27b0...HEAD`：无输出（文档提交后复核）。
- 所有提交使用 `git commit --no-verify`：pre-commit 会跑 `npm test` + `combo:verify`，
  后者必然因 rikkahub 漂移退出 1；提交前已在最终代码树上手动跑完两项检查，结果与命令记录在
  本节与各证据 README。
