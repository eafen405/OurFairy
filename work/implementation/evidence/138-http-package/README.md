# 138-http-package — 票 #138 证据

## 改了什么

新包 `backend/http`（`@ourfairy/dsh-http`，0.1.0，`private: true`）：

- `package.json`：非空 `description`；`exports` 为 `.` / `./http` / `./locale/*.json`；`files` 为
  `src`、`README.md`、`locale/*.json`；**无 `peerDependencies`**（不依赖 identity 或任何产品包）。
- `src/index.mjs`：插件行 `name = 'ourfairy-http'`、`inject = []`、空 `apply()`。
- `src/http.mjs`：从 identity 搬入的传输信封 —— 模块私有 `MAX_BODY_BYTES`、`headerOf`、
  `bearerToken`、`carriesBody`、`readJsonBody`、`sendJson`、`postHandler`。
  `readJsonBody(request, HttpError, codePrefix)` 与 `postHandler({ ..., HttpError, codePrefix })`
  的这两个参数改为**必传**：`IdentityError` 默认值与 `'identity'` 前缀已删除，新包不 import 任何产品包。
- `locale/en.json`：非空 `meta.title` / `meta.description`。
- `README.md`：包是什么、`./http` 导出什么、行为何为空的、为何不依赖 identity。

identity 侧：

- `src/http.mjs` → `src/routes.mjs`（`git mv`），只留 `IDENTITY_PATHS` 与 `identityHandlers`，
  `@module` 标签与 import 改为 `@ourfairy/dsh-http/http`。
- `src/http.mjs` 变成临时兼容出口，内容只有
  `export { bearerToken, postHandler, sendJson } from '@ourfairy/dsh-http/http'`（收口票 #141 删除）。
- `src/index.mjs` 从 `@ourfairy/dsh-http/http` 取 `bearerToken`、从 `./routes.mjs` 取路由。
- `package.json`：`exports` 增 `./routes`，`./http` 保留指向兼容文件，`./owner` 不动；
  `peerDependencies` 增 `"@ourfairy/dsh-http": "^0.1.0"`。

bundle 侧：`package.json` 的 `dependencies` 首位增 `"@ourfairy/dsh-http": "file:../http"`；
`cordis.patch.yml` 在 `identity` 行之前增 `http` 行（带同风格段注释），identity 行 config 未动。

五个消费包（chat、gateway、sessions、attachments、speech）、`docs/architecture/dsh-ecosystem-boundary.md`
与 `tests/` 均未改动：它们继续 import `@ourfairy/dsh-identity/http`，由兼容出口解析到新包。

## 实际命令与结果

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `node --test --test-name-pattern="every product package ships a description and an exported English locale" tests/plugin-compatibility.test.mjs` | 新包落地后 | 1 pass（metadata 断言覆盖新包） |
| `node --test --test-name-pattern="the bundle rows, its declared packages, and the installed profile agree" tests/bundle-packages.test.mjs` | 只加 `dependencies`、未加行时 | **red**：`declares @ourfairy/dsh-http, but no bundle row mounts it` |
| 同上 | 加 `http` 行后 | 1 pass |
| `node --test tests/plugin-compatibility.test.mjs` | 全部改完后 | 4 tests / 4 pass |
| `node --test tests/plugin-compatibility.test.mjs tests/bundle-packages.test.mjs tests/bundle-only-profile.test.mjs tests/identity-http.test.mjs tests/gateway.test.mjs tests/owned-sessions.test.mjs` | 合并集成分支后、最终树 | 41 tests / 41 pass / 0 fail |
| `npm test`（pre-commit hook 内，提交 8956e80 时） | 最终树 | 234 tests / 234 pass / 0 fail |
| `npm run combo:verify`（同上） | 最终树 | `combo: combination verified`（ourfairy 行 based on integration tip） |
| `node scripts/ourfairy-backend.mjs doctor --json`（全新 `OURFAIRY_HOME`） | 最终树 | exit 0；`bundle packages` ok，`plugin compatibility` ok，`product packages` ok |
| `node scripts/ourfairy-backend.mjs probe --report ...`（同一 home，keyless、`OURFAIRY_PORT=0`） | 最终树 | exit 0，`ok: true`，0 failures；`http` 行 `disabled=false fiber=active` |

doctor 的 `bundle packages` detail（节选，完整串含 16 行）：

```
11 declared package(s) mounted by 16 row(s): conversation-search:@ourfairy/dsh-search,
http:@ourfairy/dsh-http, identity:@ourfairy/dsh-identity, sessions:@ourfairy/dsh-sessions, ...
```

`plugin compatibility`：`13 installed product package(s) compatible with dsh 0.2.1-alpha.2`，其中含
`@ourfairy/dsh-http@0.1.0`。

## Red / green 说明

本票的验收接缝是既有测试，未新增测试文件。唯一按「先红后绿」观察的是 bundle 对账接缝：
只声明 `dependencies`、不加 `cordis.patch.yml` 行时，`bundle packages` 以包名失败（上方 red 行）；
补上 `http` 行后同一条断言转绿。新行是否真的 active 由 `probe` 报告独立证明（见上表最后一行），
不靠 doctor 的静态对账推断。

行为未变由既有断言承担：`tests/identity-http.test.mjs`、`tests/gateway.test.mjs`、
`tests/owned-sessions.test.mjs` 原样通过（最终树 41/41 那一行包含三者）。

## 未执行项与说明

- 未 push、未合入集成分支、未改 `combo.json`、未评论或关闭 issue。
- `git merge integration/spec-131`：`Already up to date.` —— 集成分支 tip 仍是 `b9f7d28`，期间没有别的票合入。
- 未新增测试断言。若后续需要「新包不出现 `IdentityError`/`identity` 默认值」的可执行检查，那是收口票
  #141 的范围（届时兼容出口删除，遗留 import 会在加载期直接失败），本票只按票面搬移与去默认值。
- 未做真机/客户端验收：本票只涉及后端包边界与组合行。
