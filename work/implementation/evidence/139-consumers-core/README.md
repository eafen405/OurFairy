# 139-consumers-core — 票 #139 证据

## 改了什么

三个只用到传输信封的产品包改依赖 `@ourfairy/dsh-http`：

- `backend/chat/src/index.mjs`：`postHandler` 改从 `@ourfairy/dsh-http/http` 导入。
- `backend/gateway/src/http.mjs`：同上。
- `backend/sessions/src/http.mjs`：同上；`backend/sessions/src/service.mjs` 的
  `ownerOf` 仍从 `@ourfairy/dsh-identity/owner` 导入，未改。

peer 声明：

- `backend/chat/package.json`：`@ourfairy/dsh-identity` → `@ourfairy/dsh-http`（`^0.1.0`）。
- `backend/gateway/package.json`：同上。
- `backend/sessions/package.json`：增 `@ourfairy/dsh-http`，保留 `@ourfairy/dsh-identity`。

未改：三个包的 `inject` 数组（仍注入 `identity`；清理归 #133）、identity 包、bundle、
attachments/speech（归 #140）、`tests/`、`docs/architecture/dsh-ecosystem-boundary.md`。

改后边界（`grep -rn "@ourfairy/dsh-identity" backend/chat backend/gateway backend/sessions`）：

```
backend/sessions/src/service.mjs:13:import { ownerOf } from '@ourfairy/dsh-identity/owner'
backend/sessions/package.json:22:    "@ourfairy/dsh-identity": "^0.1.0"
```

chat 与 gateway 零命中；sessions 只剩 `/owner` 导入与其 identity peer 行。

## 实际命令与结果

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `git merge integration/spec-131`（开工前） | 基线 `b9f7d28` | fast-forward 到 `fc6475a`（含 #138 的合并与 `backend/http`） |
| `node --test tests/gateway.test.mjs tests/owned-sessions.test.mjs tests/remote-chat.test.mjs tests/plugin-compatibility.test.mjs tests/bundle-packages.test.mjs` | 改动前基线 | 37 tests / 37 pass / 0 fail |
| 同一条命令 | 改动后 | 37 tests / 37 pass / 0 fail |
| `git merge integration/spec-131`（开工后与交付前多次） | 交付前 | 均 `Already up to date.`；tip 仍 `fc6475a`，期间未再移动 |
| `npm test`（直接运行与 pre-commit hook 内） | 最终树 | 最终两次完整运行均 234 tests / 234 pass / 0 fail |
| `npm run combo:verify`（直接运行与 pre-commit hook 内） | 最终树 | `combo: combination verified`；ourfairy 行 `ok (worktree is based on the integration tip)` |
| `COREPACK_ENABLE_NETWORK=0 OURFAIRY_HOME=$(mktemp -d) node scripts/ourfairy-backend.mjs doctor --json` | 最终树（证据提交只动本 README） | exit 0；11 项 check 全 ok，其中 `bundle packages` ok（11 declared package(s) mounted by 16 row(s)，含 `http:@ourfairy/dsh-http`），`plugin compatibility` ok（13 installed product package(s) compatible with dsh 0.2.1-alpha.2） |

## Red / green 说明

本票是依赖边界重构、无新行为，票面指定接缝就是既有验收测试，因此未新增测试文件，也未新增断言
（含结构性 / 私有 import 断言）。

改动前先跑一遍五个验收文件确认基线是绿的（37/37），改完后同一条命令仍 37/37：`postHandler` 的
行为（fence、方法检查、body 上限、错误信封）由这些既有断言覆盖，`tests/plugin-compatibility.test.mjs`
的 peer 范围/元数据断言与 `tests/bundle-packages.test.mjs` 的「声明/挂载/已安装」对账覆盖 manifest 改动。

`@ourfairy/dsh-http` 的 peer 范围不参与 `evaluatePluginCompatibility` 判定（该函数只看
`@deepseek-ai/dsh*` 前缀的 peer），所以 peer 改向的可执行证据来自
`tests/plugin-compatibility.test.mjs` 的「显式 semver 范围」与「每个产品包具备 description/locale」
两条断言，以及 `tests/bundle-packages.test.mjs` 的已安装集合对账——三者都原样通过。

## 未执行项与说明

- 未 push、未合入集成分支、未改 `combo.json`、未评论或关闭 issue。
- 未做真机/客户端验收：本票只涉及后端包边界。
- 环境说明（不影响本票改动）：本机到 npm registry 的 corepack 下载会间歇性挂起；期间另一票的整套
  测试并发运行、系统负载一度 >20。一次全量运行中 `tests/speech.test.mjs` 因负载报 `speech/timeout`，
  单独重跑 2/2 通过，随后全量重跑 234/234 通过；speech 包本票未改。
- 环境说明：`copyProductRepo` 的测试（bundle-packages、plugin-compatibility、product-sources 等）在
  `COREPACK_ENABLE_NETWORK=0` 下会失败，因为副本只复制 `backend/scripts/combo.json/package.json`，
  不含 `.corepack` 缓存；全量门禁因此用网络或 corepack shim（`COREPACK_HOME` 指向共享缓存）运行。
  本票未改测试辅助或启动器。
- 未新增断言。若认为「chat/gateway 不得再出现 identity import」需要可执行检查，那是 #141 收口票的
  范围（届时 identity 的 `./http` 兼容出口删除，遗留 import 会在加载期直接失败）；本票按票面只搬移
  import 与 peer，并在报告里提出。
