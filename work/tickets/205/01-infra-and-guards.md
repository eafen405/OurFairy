> 发布权威：[#206](https://github.com/eafen405/OurFairy/issues/206)。本文件是工作副本。

## Parent

[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)

## Blocked by

- 无

## Scope

把 #199/#200/#202 的路线落成可复用的基础设施，并完成 `backend/http` 的 `.ts` 迁移（#203 试点 diff 作底稿）。

## Steps

- **构建**：`tsconfig.base.json`（strict + dsh 额外档位）、根 `tsconfig.json` solution、`backend/http/tsconfig.json`；`scripts/link-types.mjs`（combo.json 驱动的根 `node_modules` 农场）、`scripts/tsc.mjs`（用 dsh 的 TypeScript 6.0.3）；`npm run build`（link-types + 清 dist + `tsc -b`）、`typecheck`、`pretest`、`clean`；`.gitignore` 加 `/node_modules/`、`backend/*/dist/`。
- **安装链守卫（#200）**：`productSources` 对 `files` 条目展开为 0 文件时抛错（包 + 条目 + 补救命令）；launcher 新增 `buildProducts` 并在 `installProfile` 首行调用；doctor 新增 `product build` 检查；`OURFAIRY_SKIP_BUILD=1` 让测试内 launcher 跳过重复构建。
- **测试基建（#202）**：`tests/helpers/dsh-peers.mjs` 的 `@ourfairy` anchor 改用 `productPackageDirs()` 全产品包；`copyProductRepo` 补根 `tsconfig.base.json`/`tsconfig.json`、过滤 `*.tsbuildinfo`、用 `linkTypes(root)` 重建农场；`tests/product-sources.test.mjs` 的 `copiedSources` 改成独立验证发布集合（dist vs src）；保留 `bundle-packages` 的 files 守卫。
- **门禁（#202）**：`scripts/precommit.mjs` 四模式 `docs`/`related`/`typecheck`/`full`；related 按 staged 测试 + 测试正文里的包/脚本名选择，full 触发为根构建/门禁权威、包 manifest、helpers/fixtures、merge、`--full`、选中 >45。CI 删 `pull_request`，保留 push `main`/`integration/**` + `workflow_dispatch`，dsh 构建后加 `npm run build`。改 `tests/precommit.test.mjs` 与 README 的提交前钩子/CI 段。
- **`backend/http`**：把 `ticket/203-ts-http-trial` @ `00e158e` 的两个 `.ts` 文件、tsconfig、manifest 改动重做到本票；补 strict 注解；`main`/`types`/`exports`/`files` 指向 `dist`（`dist/**/*.js` + `dist/**/*.d.ts`）；删 `.mjs`；README 路径更新。

## Acceptance

- `npm run build` 干净通过；`node --test tests/product-sources.test.mjs tests/bundle-packages.test.mjs tests/precommit.test.mjs tests/identity-http.test.mjs` 全绿。
- `doctor`/`probe` 在 http 产物上通过；缺/空 `dist` 被 `productSources` 响亮拒绝（新增断言）。
- 不跑全量（留 T6）；不触发 CI。

