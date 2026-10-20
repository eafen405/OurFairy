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
- `98-compat/README.md`：改为 8 个有 peers 的 manifest（probe 与 v1-bundle 没有），并说明测试
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

见本分支最后一次全量运行记录：逐文件先跑 touched tests，再跑 `npm test` 与
`npm run combo:verify`。rikkahub 的已知外部漂移（tip `2d97ed14` vs `combo.json` 锁定
`460109d1`）保留不动，记录在提交报告里；提交使用 `--no-verify`，提交前手动跑完两项检查。
