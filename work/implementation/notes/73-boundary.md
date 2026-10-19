# #73 边界与并行协作（#71 / #72）

本文件是 #73 实施期间与 #71、#72 的唯一协调入口。票面仍是行为权威；这里只写**写范围**与**交接点**。

## 三个 spec 的写范围

| 区域 | 归属 | 说明 |
| --- | --- | --- |
| `backend/v1-bundle/package.json`、`files`、包清单 | #73（#96） | bundle 是产品包集合的唯一权威 |
| `scripts/ourfairy-backend.mjs` 的 `LINKED_PACKAGES` / profile 生成 | #73（#96） | 改为从 bundle 派生；之后 #71 不再改任何包清单 |
| 产品包 `peerDependencies` 的 `workspace:` → semver；doctor 兼容检查 | #73（#98） | #72 的 `backend/chat/package.json` 新增 `dependencies.zod` 必须保留 |
| `backend/bundle` 行的拆分：投递、群组、四个 scoped provider | #73（#99–#101） | 新增包/行；spaces 保留 scope |
| 产品行 `Config` 与启动期失败、探针行 liveness | #73（#102） | |
| 模型初始声明单点（bundle `agent-default-model`） | #73（#103） | 删除 combo.json/launcher 的第二份声明与双声明比对 |
| 并行传输/保留实现的文档 | #73（#97） | 只写文档 |
| `backend/chat/src/projection.mjs`、`history.mjs`、`activity.mjs`、`runtime.mjs`、`service.mjs` 的投影与读取路径 | #72 | #73 不碰这些文件 |
| `backend/chat/package.json` 的 `dependencies.zod` | #72 | #98 重写 peers 时保留 |
| PDF subprocess、llm-retry、spill 行、历史 seam | #71 | #71 新增的行必须同时在 `backend/v1-bundle/package.json` 的包集合中声明（#96 之后这是唯一权威） |

## 交接点

1. **#96 先落地**：bundle 包清单 + launcher 派生 + doctor/测试一致性检查。#71 之后新增的行只改 bundle 的 patch 与 `dependencies`，不改 launcher。
2. **#72 的 `zod` 依赖**在 #98 重写 `backend/chat/package.json` 时保留为普通 `dependencies`。
3. **#73 的投递行（#99）** 只在 `backend/chat/src/index.mjs` 与新增的窄运行时门面文件落改动；不修改 `runtime.mjs`/`service.mjs` 的投影逻辑。#72 若同时改 `chat/src/index.mjs`，以 rebase 解决。
4. 三个 spec 都合到 `integration/ourfairy-v1`（本轮 #73 先在工作分支 `integration/spec-73` 上推进）；合并顺序不强制，但 #96 应尽量早合，因为 #71 的新行依赖它。
