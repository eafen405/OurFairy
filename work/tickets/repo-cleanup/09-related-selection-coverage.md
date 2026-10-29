## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-09。承接 CLEAN-01 的遗留缺口。

## What to build

让 related 门禁按包选中"经 launcher/HTTP 驱动该包、但正文既不 import 也不提包路径"的既有行为套件：为这些套件补上它们自己文件里的 `@covers backend/<package>` 声明，使改该包源码时这些套件真的会跑。

## Current evidence

CLEAN-01 给选择器加了第二类关联信号：测试文件自写的 `@covers backend/<package>` 行（`scripts/precommit.ts`）。但只给 delivery、speech、memory、groups、search 五个包补了声明（那是该票的写范围），其余包仍存在单向关联——套件驱动该包、却不会被该包的源码改动选中。

实测（`relatedTests`，2026-10-29，`main` @ `bfaecd5a91`）：

- `backend/attachments/src/index.ts` 只选中 `attachment-download-abort`、`config-contracts`、`pdf-worker-cancel`、`product-sources`；而 `tests/attachments.test.mjs` 打的是 `/attachments/propose`、`/attachments/chunk`、`/attachments/complete`、`/attachments/download`，不会被选中。
- `backend/gateway/src/service.ts` 只选中 `gateway-service`、`gateway`；而 `tests/gateway-maintenance-settings.test.mjs` 打 `/gateway/read`、`/gateway/maintenance`，`tests/gateway-compaction-settings.test.mjs` 打 `/gateway/read`、`/gateway/compaction`、`/gateway/selection`，都不被选中。
- 同类单向关联还出现在 delivery、identity、search、memory（例如 `conversation-search` 打投递面、`file-delivery` 打 identity 与 attachments）。

`scripts/precommit.ts` 的说明在 CLEAN-01 收口时已改为机制事实（选择器读正文直接引用 + 文件自写的 `@covers` 行，是否写这行由套件自己决定，不声称覆盖完整），所以本票不是修一句假话，而是补齐关联本身。

## Scope

- `tests/**` 中需要补声明的既有行为套件（只加头部声明行，不改测试逻辑）。
- `tests/precommit.test.mjs`：为新增的包补选择用例。
- 必要时改 `scripts/precommit.ts` 的注释（若"哪些包已覆盖"的措辞需要更新）。

不新增「包→测试」清单，不引入新的选择机制，不改产品代码。

## Acceptance criteria

- [ ] 先按包实测现状：对每个 `backend/<pkg>/` 写一个 `relatedTests` 探针，列出"该包源码改动选中了哪些套件"，以及"哪些套件打该包的 HTTP 路由/工具但没有被选中"。把清单写进交付证据，作为改动前后对照。
- [ ] 对每个确认的单向关联补 `@covers backend/<pkg>` 声明；`backend/attachments/` 的改动至少选中 `attachments.test.mjs`，`backend/gateway/` 至少选中 `gateway-maintenance-settings.test.mjs` 与 `gateway-compaction-settings.test.mjs`。
- [ ] 区分真关联与假阳性：只在套件真的通过产品 HTTP 路由或模型工具调用该包时补声明；正文只是把工具名当夹具字符串的（如 `model-double` 的工具列表）、以及所有套件都会走的公共面（`/identity`、`/sessions`、`/chat`）不算，逐个在证据里说明取舍。
- [ ] 每个新增包的选择数量不超过 `FULL_TEST_LIMIT`（45）；超过则该包退回 `full` 并在证据里记录，不靠删声明规避。
- [ ] 四模式、`FULL_AUTHORITY`、每档 `combo:verify`、Android 命令不变。
- [ ] 注释与证据只声称"这些套件现在会被选中"，不声称"所有此类套件都已覆盖"——机制无法证明完整性。

## Verification

```bash
npm run build
node --test tests/precommit.test.mjs
```

最终全量门禁按仓库协议在收口时跑一次（`npm test`、`npm run combo:verify`、Android `test lintDebug`）。

## Blocked by

无（CLEAN-01 已合入 `main`）。

## Out of scope

不改产品代码、不改测试断言、不追求"自动发现缺声明"的机制、不给没有行为关联的套件凑声明、不动 CI 触发规则。
