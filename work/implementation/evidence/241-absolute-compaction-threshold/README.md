# #241 dsh 支持绝对压缩阈值与运行期读取

日期：2026-10-27。票面：[`work/tickets/fairy-memory/01-absolute-compaction-threshold.md`](../../../tickets/fairy-memory/01-absolute-compaction-threshold.md)。
仓库：dsh 检出 `/home/eafen405/projects/deepseek-harness`，分支 `ticket/241-absolute-compaction-threshold`，
提交 `bbccb1c435`，合并 `d80522d276`（`product/ourfairy-v1`，即 `combo.json` 的 `repos.dsh.productCommit`）。
规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md) Implementation Decisions §1「模块与原生接缝」。

本票只给 dsh 原生 `compaction-basic` 增加**可选**的绝对 token 阈值；未配置时既有解析结果一字不变。
产品侧装配留给 #242，设置入口留给 #243。

## 改动

| 文件 | 职责 |
| --- | --- |
| `packages/compaction/compaction-basic/src/config.ts` | `resolveConfig` 接受运行期配置视图；`resolveCompactSpec` 新增 `absoluteThresholdTokens`，与路由比例阈值、扣除输出预留与余量后的容量三者取最小值；非法值仍以 `TargetPressureConfigError` 响亮失败，不做静默 clamp |
| `packages/compaction/compaction-basic/src/index.ts` | schema 声明顶层 `thresholdTokens` 为 volatile；引擎在每次压力判断时读取该引用，保存后的新值无需重挂载即生效 |
| `packages/compaction/compaction-basic/src/types.ts` | `BasicCompactionRuntimeConfig` 与 `ResolvedCompactSpec` 的字段/注释同步 |
| `packages/compaction/compaction-basic/README.md`、`README.zh.md`、`README.i18n.yaml` | 阈值语义与「未配置保持原生行为」写进插件文档与 i18n 对照 |
| `docs/config-catalog.md`、`docs/config-catalog.zh.md` | 生成的配置目录同步 |
| `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` | 阈值取最小值、未配置不变、非法值失败、运行期读数 |
| `packages/compaction/compaction-basic/tests/loader-composition.spec.ts` | 真实 Loader 装配下的配置解析与热更新 |

设计要点：

- 绝对阈值是**部署级上限**，不进入 `modelPolicies`，也不按模型覆盖；模型容量仍可把实际触发点压得更低。
- 字段声明为 volatile，因此引擎持有 Loader 的活引用，每次压力判断读一次；构造期快照不算满足票面要求。
- 只有顶层合法键集合接受 `thresholdTokens`，未知键与非法值都保持既有的响亮失败路径。

## 验证（实际运行）

工作目录 `/home/eafen405/projects/deepseek-harness`（已按 `combo.json` 四条 `requiredBuild` 构建过）：

```sh
corepack pnpm@11.28.5 exec vitest run \
  packages/compaction/compaction-basic/tests/compaction-basic.spec.ts \
  packages/compaction/compaction-basic/tests/loader-composition.spec.ts
# Test Files 2 passed (2) / Tests 116 passed (116)

corepack pnpm@11.28.5 exec vitest run \
  scripts/gen-config-catalog.spec.ts scripts/translation-pairing.spec.ts
# Test Files 2 passed (2) / Tests 91 passed (91)（生成文档与中英对照门禁）
```

合并后于 `product/ourfairy-v1`（`d80522d276`）复核：OurFairy 侧 `npm run build` 与
`node --test tests/memory-crud.test.mjs` 通过（见 [#244](../244-memory-crud/README.md)），
证明组合锁移动到本提交后产品侧仍可构建运行。

## 未完成与风险

- 产品 profile 是否真的挂载 `compaction-basic`、默认 500K 与 16K 保留、裁剪与图片 offload：属 #242。
- 设置读取、校验与 Android 控件：属 #243、#247。
- dsh 侧本轮未跑全量 `npm test` 与覆盖率分区门禁；按仓库约定留到该 spec 收口
  （#248）与组合交付前。本票只跑了改动面与生成文档门禁。
