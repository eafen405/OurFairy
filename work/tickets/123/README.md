# #123 客户端合仓：实施票与任务图

父规格：[#123 客户端合仓：把 Android 客户端并入产品仓库并收敛版本组合](https://github.com/eafen405/OurFairy/issues/123)。

状态：**已完成**。合并到 `integration/spec-123` 的两次提交为 `e151e73`（导入）与随后一次适配提交。

本次按用户授权使用**临时票**（宿主 issue 是 #123，不另开子议题）；票面即本目录下的文件，
阻塞关系写在票尾。工作树与分支协议沿用 `work/implementation/CONVENTIONS.md` §2。

## 合仓提交拆分（规格的硬性要求）

合并到集成分支 `integration/spec-123` 恰好是**两次提交**：

1. **导入**（`01`）：`android/` 快照 + 仓库根 `LICENSE` + `android/ourfairy-source.json`。
   提交说明写明来源仓库与来源提交。快照与原仓库 `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce` 一致。
2. **适配**（`02` + `03` + `04` 的文档部分）：版本组合、来源校验、文档拓扑、忽略规则、证据。
   两次提交都不得改动 `android/` 里的客户端业务代码。

`04` 的证据在被验证的树全部就位后写入，并**amend 进适配提交**，因此合并历史仍是两次提交。
`05` 是旧仓库归档说明，落在 rikkahub 仓库，不进入本仓库历史。

## 任务图

```
01 import ──┬── 02 combination ──┬── 04 evidence
            └── 03 docs ─────────┘
05 archive note（独立，另一个仓库）
```

| 票 | 交付 | 阻塞 | 分支 |
| --- | --- | --- | --- |
| [01 导入客户端快照](01-import-client-snapshot.md) | `android/` 快照、根 `LICENSE`、来源声明 | 无 | `ticket/123-import` |
| [02 版本组合与来源校验](02-combination-and-source-check.md) | `combo.json`、`combo.mjs`、`bench`、新测试 | 01 | `ticket/123-combination` |
| [03 拓扑文档与仓库卫生](03-topology-docs-and-hygiene.md) | 根说明、AGENTS、协作约定、边界与校准文档、忽略规则 | 01 | `ticket/123-docs` |
| [04 客户端构建与证据](04-client-build-evidence.md) | release/perf 构建、单元测试、证据 README | 02、03 | `ticket/123-evidence` |
| [05 旧仓库归档说明](05-archive-note.md) | rikkahub 根说明一行 | 无 | 直接在归档仓库提交 |

## 边界

- 只改本规格列出的文件。`android/` 内的业务代码、`work/implementation/evidence/` 下的历史证据、
  `docs/specs/ourfairy-v1.md`、`work/tickets/ourfairy-v1/` 均不追改（仅 `05`/`03` 允许的一行或一句说明除外）。
- dsh 升级不在本规格内（父规格 Out of Scope）；不新增客户端 CI 流水线。
- 并行 spec（#71/#72/#73 等）的写范围不碰：不修改 `backend/`、`docs/research/`、`work/wayfinder/`。
