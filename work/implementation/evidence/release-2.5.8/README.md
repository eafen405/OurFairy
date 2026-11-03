# 2.5.8 / versionCode 193 发布与 fairybox 部署

日期：2026-10-27。范围：#240 记忆与上下文治理（`integration/spec-240`）合入 `main`，连同
Fairy 视觉令牌重做一起发布；客户端内更新沿用 #238 的固定 APK 通道。

## 版本组合

| 项 | 值 |
| --- | --- |
| OurFairy `main` | `02dce245b6`（合并提交 `b033bfdeee`，版本提交 `02dce245b6`） |
| dsh | `d80522d276`（`product/ourfairy-v1`，含 #241 绝对 `thresholdTokens`） |
| Android 版本 | `versionCode 193` / `versionName 2.5.8` |
| APK | `app-arm64-v8a-release.apk`，SHA-256 `5bf1b598039faeb54b994f00f60edef3073252a5ccb3b9ae554b07b0030fb701` |

## 合并前的门禁（`main` 合并后、发布前）

- `npm run build` → 通过；`npm test` → 381 tests / 381 pass / 0 fail。
- `npm run combo:verify` → 三行 ok（ourfairy `02dce245b6`、dsh `d80522d276`、android source `460109d1b8`）。
- Android `ANDROID_HOME=… ./gradlew test lintDebug` → BUILD SUCCESSFUL（134 tasks）。
- 冲突只在 `RouteActivity.kt`：保留视觉重做的 `FairyCrtPowerDown` 包裹与 `Screen.Impression`
  路由并存。

## APK 事实（读取实际产物）

```
aapt2 dump badging  → package name='me.rerere.rikkahub' versionCode='193' versionName='2.5.8'
native-code         → 'arm64-v8a'
classes.dex         → https://85.137.246.15:38518/ourfairy
apksigner           → V2，CN=Fairy, O=Fairybot，SHA-256 406a2d5c…1d8e（与旧包同 key）
```

公网下载实测：`https://85.137.246.15:38518/downloads/ourfairy-v1` → 302 → 200，
8,667,951 字节，SHA-256 与本地一致。

## fairybox 部署（在用的 `ourfairy-backend.service`）

| 项 | 值 |
| --- | --- |
| 检出 | `/home/devin/ourfairy/app` = `02dce245b6` |
| dsh | `/home/devin/ourfairy/deepseek-harness` = `d80522d276`（构建产物本地构建后 rsync，未在服务器跑 `tsc -b`） |
| 隔离 home | `/home/devin/ourfairy/home`（`OURFAIRY_HOME`） |
| 入口 | nginx `38518` 的 `/ourfairy/` → `127.0.0.1:3080` |
| APK 目录 | `/var/www/ourfairy-v1/`（arm64 / universal / x86_64 三份同批替换） |

过程：`systemctl stop` → `git checkout` dsh 与 app → 本地 `build:lib:host`、`build:lib:client`、
`build:native-system` 后 rsync 构建产物 → 服务器 `node scripts/tsc.ts --fresh` →
`node scripts/ourfairy-backend.ts doctor`（重装 profile，17 行、含 `memory`）→ `systemctl start`。

服务器上 `build:lib:host` 实测在 4 核 3.9 GiB + 4 GiB swap 上跑 12 分钟仍未完成且常驻
3.8 GiB 内存，因此按部署 README 的要求改为本地构建后同步产物。

## 部署后验证（真实服务）

- `systemctl is-active ourfairy-backend.service` → `active`，`NRestarts=0`，监听 `127.0.0.1:3080`。
- `doctor: all checks passed`（9 项；组合锁定 `ourfairy@02dce245b6` + `dsh@d80522d276`）。
- `POST /gateway/read` → `compaction:{thresholdTokens:500000}`、`maintenance:{triggerTurns:15,decayHours:6}`，
  `editable.compaction` 与 `editable.maintenance` 均为 true（新设置面已装配）。
- `POST /impression/read` → 200（`max_characters: 8000`），记忆插件行在线。
- `POST /sessions/create` → `/chat/send` 一轮真实 MiniMax 回复，`turn/end reason=completed`。
- 公网：`POST https://85.137.246.15:38518/ourfairy/identity/sign-in`（错误口令）→ 401；
  下载索引 200。

## 服务器清理（同日）

删除前先把可能要回滚的唯一数据打包到 `/home/devin/backups/`（0700，文件 0600）：

- `OurFairy-old-checkout-20261027.bundle`（15 MB）：旧检出 `/home/devin/OurFairy` 的 `--all` 引用，
  其中含未推到远端的本地分支历史。
- `legacy-deploy-home-20261027.tar.gz`（3.5 KB）：旧部署隔离 home 的 `identity.sqlite`、
  `memory.sqlite` 与凭据文件。

删除项（均与现役 `ourfairy-backend.service` 无关）：

| 路径 | 大小 | 为什么能删 |
| --- | --- | --- |
| `/home/devin/deploy` | 110 MB | 旧 `ourfairy.service` 的检出与隔离 home；该单元已失败 5 天且已删除 |
| `/home/devin/OurFairy` | 71 MB | 重构前的旧检出（本地分支已打包） |
| `/home/devin/deepseek-harness` | 457 MB | 旧 dsh 克隆，已无提交或引用 |
| `/home/devin/projects/deepseek-harness` | 2.8 GB | 本轮为排查重建的 dsh 副本；现役服务用 `/home/devin/ourfairy/deepseek-harness` |
| `/home/devin/projects/rikkahub` | 45 MB | 仓库拆分后的旧客户端检出，`.git` 已损坏且不再被组合引用 |
| `/home/devin/ourfairy/app-before-81356a` | 1.3 GB | 旧 app 副本及其构建产物 |
| `/home/devin/ourfairy/{android-decl,dsh-build.log}` | 8 KB | 客户端声明由 `app/android/ourfairy-source.json` 提供；构建日志无保留价值 |
| `/home/devin/ourfairy/ourfairy-src.tgz` | 134 MB | 旧源码快照，git 已覆盖 |
| `/var/www/ourfairy-v1/backup-20261018`、`backup-20261025-pre-d56` | 114 MB | 更早的 APK 备份；保留 `backup-20261026`（192 / 2.5.7）作上一版回滚 |
| `/etc/systemd/system/ourfairy.service` | — | 旧单元，删除后 `daemon-reload` 并 `reset-failed` |

清理后 `/` 使用 33 GB → 29 GB（可用 16 GB → 20 GB）。`fairy.service`、`fairy-pilot.service`、
`fairy-backup.*` 与 `/var/www/ourfairy-v1/{app-*.apk,backup-20261026,downloads}` 保持不动。
清理后复跑：`doctor: all checks passed`（组合 `ourfairy@be5607a2ae` + `dsh@d80522d276`），
`systemctl is-active ourfairy-backend.service` → `active`，`/identity/sign-in` 错误口令仍 401。

## 未执行与风险

- 未在真机上跑客户端内更新全流程（APK 版本号与下载通道已验证，安装行为未在本轮复测）。
- 维护子会话的真实模型语义质量只在 #248 的健康样例上验收过，本次部署随包生效但未追加新的质量样本。
