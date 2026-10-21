# 140-consumers-attachments-speech — 票 #140 证据

## 改了什么

`@ourfairy/dsh-attachments` 与 `@ourfairy/dsh-speech` 的传输函数改从新包取，peer 声明相应改向。
共 4 个源文件各改 1 行，另加本证据 README；无新增测试、无 `inject` 改动：

- `backend/attachments/src/index.mjs`：`postHandler, sendJson` 的 import 从
  `@ourfairy/dsh-identity/http` 改为 `@ourfairy/dsh-http/http`。
- `backend/speech/src/index.mjs`：`sendJson` 的 import 同样改向 `@ourfairy/dsh-http/http`。
- `backend/attachments/package.json`：`peerDependencies` 去掉 `"@ourfairy/dsh-identity": "^0.1.0"`，
  增 `"@ourfairy/dsh-http": "^0.1.0"`（原位置替换，其余 peer 未动）。
- `backend/speech/package.json`：同样替换。

未改：`backend/speech/src/service.mjs`（其中 `sendJson` 只出现在 `@param` 类型注释里，描述的是
`createSpeechHandler` 的入参，不是模块 import，原样读通）；两个包的 `inject` 数组（`speech` 仍注入
`identity` 用于 `ctx.identity.authenticateRequest`，`attachments` 仍注入 `identity`）——`inject`
清理属票 #133。identity、bundle、chat、gateway、sessions、`tests/`、
`docs/architecture/dsh-ecosystem-boundary.md` 均未触碰。

改后 `grep -rn "@ourfairy/dsh-identity" backend/attachments backend/speech` 无输出（exit 1）。

## 实际命令与结果

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `grep -rn "@ourfairy/dsh-identity" backend/attachments backend/speech` | 改动前 | 4 处命中：两个 import、两个 peer（本票的结构性红） |
| `node --test tests/attachments.test.mjs tests/speech.test.mjs` | 改动前（基线） | 8 tests / 8 pass |
| `grep -rn "@ourfairy/dsh-identity" backend/attachments backend/speech` | 改动后 | 无输出，exit 1（验收标准「import 为零」） |
| `node --test tests/attachments.test.mjs tests/speech.test.mjs tests/plugin-compatibility.test.mjs tests/bundle-packages.test.mjs` | 改动后 | 21 tests / 21 pass / 0 fail |
| `git merge integration/spec-131` | 提交前 | `Already up to date.`，集成分支 tip 仍为 `fc6475a` |
| `npm test`（pre-commit hook 内，提交 `1971f14`） | 最终树 | 234 tests / 234 pass / 0 fail |
| `npm run combo:verify`（同上） | 最终树 | `combo: combination verified`（ourfairy 行 based on integration tip `fc6475a`） |
| `OURFAIRY_HOME=$(mktemp -d) node scripts/ourfairy-backend.mjs doctor --json` | 最终树 | exit 0；11 项检查全 ok |

doctor 中与本票相关的两项：

```
bundle packages         ok | 11 declared package(s) mounted by 16 row(s): conversation-search:@ourfairy/dsh-search,
                             http:@ourfairy/dsh-http, identity:@ourfairy/dsh-identity, sessions:@ourfairy/dsh-sessions, ...
plugin compatibility    ok | 13 installed product package(s) compatible with dsh 0.2.1-alpha.2:
                             @ourfairy/dsh-attachments@0.1.0, ..., @ourfairy/dsh-http@0.1.0, @ourfairy/dsh-identity@...
```

两个迁移包同时出现在 `plugin compatibility` 的已判清单里，说明替换后的 peer 面（`dsh-http` 0.1.0）
被真实安装并被 dsh 判过；`bundle packages` 仍把 `http` 行与其声明对上。

## Red / green 说明

本票是依赖边界重构，无新行为，按票面要求**未新增测试文件或结构断言**；接缝是既有验收测试
（`attachments`、`speech`、`plugin-compatibility` 的 peer/元数据、`bundle-packages` 的
声明/挂载/安装对账）。唯一按「先红后绿」观察的是本票自己的验收标准：改动前 grep 命中 4 处，
改动后为零；行为未变由既有 8 个附件/语音断言与全量 234 个测试原样通过承担。

## 未执行项与说明

- 未 push、未合入集成分支、未改 `combo.json`、未评论或关闭 issue。
- 未编辑 `work/implementation/evidence/README.md`：按票面，证据索引由收口票 #141 注册。
- 未新增断言。「两包对 identity 的 import 为零」目前没有常驻的可执行检查（`plugin-compatibility`
  只校验 peer 形状，不校验 import 图）；若需要常驻门禁，应作为收口票 #141 的范围另议——本票只按票面
  搬移 import 与 peer。
- 未做真机/客户端验收：本票只涉及后端两个产品包的模块 import 与 manifest peer。
- 环境说明：收口复跑时 corepack 取 pnpm 出现网络停滞，最终门禁统一以 `COREPACK_ENABLE_NETWORK=0`
  离线执行。复制仓库的测试会拿到一个空的 per-copy `COREPACK_HOME`，因此复跑 `npm test` 时在 `PATH`
  前加了一个把 `COREPACK_HOME` 指向共享 `.corepack` 的 corepack 包装脚本；仓库代码、测试与上述结论
  均未因此改动。
