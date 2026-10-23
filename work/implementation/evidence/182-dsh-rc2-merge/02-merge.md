# 02 真合并与 17 处冲突取舍

票 [#186](https://github.com/eafen405/OurFairy/issues/186)。dsh 检出
`/home/eafen405/projects/deepseek-harness`，集成分支 `integration/spec-182`。

## 结果

| 项 | 值 |
| --- | --- |
| 合并提交 | `b8035f1afd`（第一父 `42133b30ad`，合入 `687f282e86`） |
| 后续修复提交 | `d1b6099ae7` |
| 冲突 | 17 处，逐条处理见下表 |
| 类型检查 | `tsc -b tsconfig.host.json` 干净；`tsc -b tsconfig.client.json` 由 `build:lib:client` 承担 |

`combo.json` 在合并提交里没有被改动（改动发生在验证通过后的产品提交 `8657b1d8e8`）。

## 逐条取舍

| # | 文件 | 取舍 | 理由 |
| --- | --- | --- | --- |
| 1 | `docs/persistence-catalog.md` | 取上游后重生成 | 生成物；手解 87 个 hunk 会与源不一致 |
| 2 | `docs/persistence-catalog.zh.md` | 同上 | 同上 |
| 3 | `docs/persistence-catalog.i18n.yaml` | 同上 | 同上 |
| 4 | `docs/persistence-schema.json` | 同上 | 生成物，293 个 hunk 全部来自 schema 重排 |
| 5 | `docs/persistence-changes/historical-formats/README.md` | 取上游 | 历史格式说明，跟随上游事实 |
| 6 | `docs/persistence-changes/historical-formats/README.zh.md` | 同上 | 同上 |
| 7 | `docs/persistence-changes/historical-formats/README.i18n.yaml` | 同上 | 同上 |
| 8 | `docs/subsystems/web-server.md` | 取上游后由 `gen-cordis-catalog` 重生成 | 生成物 |
| 9 | `docs/subsystems/web-server.zh.md` | 同上 | 同上 |
| 10 | `packages/core/session/src/known-event-types.ts` | 取上游后重生成 | 生成物；重生成后四个 job 事件同时在内 |
| 11 | `packages/extensions/tool-cordis/src/api-catalog.ts` | 取上游后重生成 | 生成物，随连接层接口变化 |
| 12 | `vendor/README.md` | 两边都保留 | fork 的 loader 条目留 24，上游 timer locale 条目改为 25 |
| 13 | `packages/boot/app-boot/src/index.ts` | 两边 import 都保留 | fork 的 `assertUniqueEntryIds` 与上游的 `ProfileRuntimeResolution`/`ResolutionRestartRequired` 各自独立 |
| 14 | `packages/client/connection/src/index.ts` | 主体取上游，补回注册表导出 | 采用上游 Peer 模型，注册表是本 spec 保留的接缝 |
| 15 | `packages/client/connection/src/rpc-host.ts` | 主体取上游，补回注册表实现 | 同上 |
| 16 | `packages/client/connection/src/rpc.ts` | 主体取上游，补回接缝类型与成员 | 同上 |
| 17 | `packages/client/connection/tsconfig.host.json` | 取上游 | `peer.ts` 取代 fork 的两个 Peer 文件 |

## 冲突之外必须一并处理的事实

- **删除** `operator-peer.ts`、`principal-peer.ts`：上游 `peer.ts` 的 `Peer` 已经覆盖同一职责，留着就是两份权威状态。
- **重写** 第二凭据准入：注册表建在上游 `Peer`/`peers` 上，`identify` 返回 `{ subject, principal }`，
  `subject` 是不透明键；删除 `principalOf`（`PeerScope.principal` 已公开）。
- **保留** `jobs/lifecycle`、`jobs/report`：产品的 chat 投影依赖它们（见 `01-seam-decisions.md` 第 ④ 条）。
- **持久化历史修复**：fork 的 `2026-10-14-session-owner-and-delivery` 四个根与上游
  `2026-10-13-user-rpc-principal` 撞车，改为串在上游之后；另建
  `2026-10-23-merged-principal` 确认上游新增的 `principal` 可选属性。
  `verify-persistence-changes`：`68 roots match 19 history records`。

## 未执行

- 没有跑 dsh 的全量测试面（990 个上游提交的完整套件）；只跑了受冲突影响的包，见 `04-dsh-tests.md`。
