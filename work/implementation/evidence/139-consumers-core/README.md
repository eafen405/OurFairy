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

未改：三个包的 `inject` 数组（chat 的 `identity` 已无 `ctx.identity` 调用，是残留，清理归 #133；
gateway 与 sessions 仍实际调用 `ctx.identity`，属运行期服务依赖）、identity 包、bundle、
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
| `git merge integration/spec-131`（开工后与交付前多次） | 交付前 | 开工时 fast-forward 到 `fc6475a`（#138）；交付前 tip 已移到 `e57827e`（#140 合入），合并干净、无冲突 |
| `npm test`（直接运行与 pre-commit hook 内；合并 #140 后再跑一次） | 最终树 | 每次完整运行均 234 tests / 234 pass / 0 fail（最终合并树 105 s） |
| `npm run combo:verify`（同上） | 最终树 | `combo: combination verified`；ourfairy 行 `ok (worktree is based on the integration tip)` |
| `COREPACK_ENABLE_NETWORK=0 OURFAIRY_HOME=$(mktemp -d) node scripts/ourfairy-backend.mjs doctor --json` | 最终合并树 | exit 0；11 项 check 全 ok，其中 `bundle packages` ok（11 declared package(s) mounted by 16 row(s)，含 `http:@ourfairy/dsh-http`），`plugin compatibility` ok（13 installed product package(s) compatible with dsh 0.2.1-alpha.2） |

## Red / green 说明

本票是依赖边界重构、无新行为，票面指定接缝就是既有验收测试，因此未新增测试文件，也未新增断言
（含结构性 / 私有 import 断言）。

改动前先跑一遍五个验收文件确认基线是绿的（37/37），改完后同一条命令仍 37/37：`postHandler` 的
行为（fence、方法检查、body 上限、错误信封）由这些既有断言覆盖，`tests/plugin-compatibility.test.mjs`
的 peer 范围/元数据断言与 `tests/bundle-packages.test.mjs` 的「声明/挂载/已安装」对账覆盖已声明
peer 的形状与安装集合——不覆盖 peer 改向本身（见下）。

`@ourfairy/dsh-http` 的 peer 范围不参与 `evaluatePluginCompatibility` 判定（该函数只看
`@deepseek-ai/dsh*` 前缀的 peer）。`tests/plugin-compatibility.test.mjs` 断言的是「每个已声明的
peer 都是显式 caret 范围」（不校验 peer 指向哪个包）与「每个产品包具备 description/locale」；
`tests/bundle-packages.test.mjs` 对账「声明 = 挂载 = 已安装」，也不涉及 peer 身份。这些断言都不
校验 peer 指向哪个包：manifest 若仍写 `@ourfairy/dsh-identity` 也会通过，因此**peer 改向本身
没有专门断言**。它的证据是结构性的：`grep -rn "@ourfairy/dsh-identity" backend/chat backend/gateway backend/sessions`
只剩 sessions 的 `/owner` 导入与 peer 行（见上）；改后的包仍能被安装（doctor 的 `bundle packages`
把 `http` 对进已安装集合）并加载（全量 `npm test` 通过）。

## 未执行项与说明

- 未 push、未合入集成分支、未改 `combo.json`、未评论或关闭 issue。
- 未做真机/客户端验收：本票只涉及后端包边界。
- 环境说明（不影响本票改动）：本机到 npm registry 的 corepack 下载会间歇性挂起；期间 #140 的整套
  测试并发运行、系统负载一度 >20（最高约 44）。高负载期间的几次全量运行各出现过与本票无关的失败：
  `tests/speech.test.mjs` 报 `speech/timeout`、`tests/pdf.test.mjs` 报 `resource-limit`、
  `tests/conversation-search.test.mjs` 的文本预算断言得到 8001 而非 8000。三者单独重跑均通过，
  负载回落后完整 `npm test` 恢复 234/234；这三个包本票均未改动。
- 环境说明：`copyProductRepo` 的测试（bundle-packages、plugin-compatibility、product-sources 等）在
  `COREPACK_ENABLE_NETWORK=0` 下会失败，因为副本只复制 `backend/scripts/combo.json/package.json`，
  不含 `.corepack` 缓存；全量门禁因此用网络或 corepack shim（`COREPACK_HOME` 指向共享缓存）运行。
  本票未改测试辅助或启动器。
- 未新增断言。若认为「chat/gateway 不得再出现 identity import」需要可执行检查，那是 #141 收口票的
  范围（届时 identity 的 `./http` 兼容出口删除，遗留 import 会在加载期直接失败）；本票按票面只搬移
  import 与 peer，并在报告里提出。
