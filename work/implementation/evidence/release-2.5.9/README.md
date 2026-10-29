# 2.5.9 / versionCode 194 发布与 fairybox 部署

日期：2026-10-29。范围：`main` 上 #251–#255（会话标题、改名、归档与恢复、Fairy 眼睛高光）
与仓库环境清扫批次（CLEAN-01～CLEAN-09）之后的客户端与后端；客户端内更新沿用 #238 的固定
APK 通道。

## 版本组合

| 项 | 值 |
| --- | --- |
| OurFairy `main` | `009521b40e`（发布提交；其前是 CLEAN-09 的合并 `3f85d20081`） |
| dsh | `d80522d276`（`product/ourfairy-v1`，未变） |
| Android 版本 | `versionCode 194` / `versionName 2.5.9` |
| Android 来源快照 | `460109d1b8`（`combo.json` 的 `androidSource`，未变） |

## 部署前状态（fairybox）

| 项 | 更新前 |
| --- | --- |
| app 检出 | `d4dbd5d939`（2.5.8 之后的文档提交） |
| 服务 | `ourfairy-backend.service` active，`NRestarts=0`，起于 2026-10-27 10:25 UTC |
| APK | 2.5.8 / 193（2026-10-27 10:06，8,667,951 / 8,685,084 / 8,668,612 字节） |

## 发布前的门禁（`main` @ `009521b40e`）

- 版本提交 `chore(release): 2.5.9 (versionCode 194)` 过完整提交门禁：`npm test` 全量 +
  `npm run combo:verify` 三行 ok + `android/` 改动追加的 `./gradlew test lintDebug`
  （BUILD SUCCESSFUL in 3m 20s，134 tasks）。
- 发布提交后的复测：`npm test` → 430 tests / 430 pass / 0 fail（91 s）。
- 合并 CLEAN-09 时的合并门禁也在同一棵树上跑过全量 `npm test`。

## APK 事实（读取实际产物）

```
aapt2 dump badging app-arm64-v8a-release.apk
  package: name='me.rerere.rikkahub' versionCode='194' versionName='2.5.9'
  native-code: 'arm64-v8a'
apksigner verify --print-certs
  V2 Signer: certificate DN: CN=Fairy, O=Fairybot
  V2 Signer: certificate SHA-256 digest: 406a2d5c63fd717febdffc65731b449aa209693eba266ea845b8e00d0be01d8e
```

构建命令（`android/` 下，需要 `-Pourfairy.identityEndpoint`，否则 `generateReleaseBuildConfig`
直接失败）：

```sh
./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=https://85.137.246.15:38518/ourfairy
```

| 产物 | 字节 | SHA-256 |
| --- | --- | --- |
| `app-arm64-v8a-release.apk` | 8,683,631 | `062fdca6bba5d625679b9d7092e8c23c5eea927150089af9135cea54e3f74825` |
| `app-universal-release.apk` | 8,700,764 | `a13ebdbb8ae2d91b5aa9237147297ea7183bdc21fa57850b9631247dfe29c8ae` |
| `app-x86_64-release.apk` | 8,684,292 | `115c123f0bb64039b3b4a3d917ac4a7a299aa7d010357ca35ddfc07f486ccf12` |

签名与 2.5.8 同一个 key（`406a2d5c…1d8e`），可覆盖安装。

## APK 发布

- 旧的三份 APK 先备份到 `/var/www/ourfairy-v1/backup-20261029/`（2.5.8 / 193）。
- 新三份 `scp` 到 `/var/www/ourfairy-v1/`；服务器侧 `sha256sum` 与本地逐字一致（见上表）。
- 下载索引页 `/var/www/ourfairy-v1/downloads/index.html` 更新为 `main@009521b4`、`2.5.9 / 194`，
  旧页备份为 `index.html.bak-20261029`。

## 后端更新（在用的 `ourfairy-backend.service`）

```sh
cd /home/devin/ourfairy/app
git merge --ff-only origin/main          # d4dbd5d → 009521b40e
node scripts/combo.ts verify             # 三行 ok
node scripts/tsc.ts --fresh              # 服务器只构建产品包
node scripts/ourfairy-backend.ts doctor  # 重装 profile
sudo systemctl restart ourfairy-backend.service
```

- dsh 检出保持 `d80522d276`，未在服务器跑 `tsc -b`（部署 README 的内存约束）。
- `doctor: all checks passed`：隔离 home、node 24.21.0、pnpm 11.28.5、组合
  `ourfairy@009521b40e85` + `dsh@d80522d276dd`、dsh CLI、产品包构建、profile 已安装、
  12 个包由 17 行挂载、14 个包与 dsh 0.2.1-rc.2 兼容、五项原生能力。
- 重启后 `ActiveState=active`、`NRestarts=0`、监听 `127.0.0.1:3080`。

## 部署后验证（真实服务）

- `GET /identity/session` → 405（路由在，方法不对），秒回。
- `POST /gateway/read` → `compaction.thresholdTokens=500000`、`maintenance={triggerTurns:15,decayHours:6}`，
  `editable = [selection, routes, asr, compaction, maintenance]`（两个新设置面都在）。
- `POST /impression/read` → 200（记忆行在线）。
- `POST /sessions/create` → 200，返回 `ourfairy-user-1-…` 会话。
- 真实模型一轮：`/chat/send` 回执受理，随后 `/chat/read` 拿到 `replyStatus=0` 与回复 **OK**
  （MiniMax 真实路由，非替身）。
- 公网：`POST https://85.137.246.15:38518/ourfairy/identity/sign-in`（错误口令）→ 401；
  `/downloads/` → 200 且页面写着 `main@009521b4`、`2.5.9 / 194`；
  `GET /downloads/ourfairy-v1` → 302 → 200，8,683,631 字节，SHA-256 与本地一致。

## 回滚材料

| 项 | 位置 |
| --- | --- |
| 上一版 APK（2.5.8 / 193） | `/var/www/ourfairy-v1/backup-20261029/` |
| 上一版下载页 | `/var/www/ourfairy-v1/downloads/index.html.bak-20261029` |
| 上一版 app 检出 | `git checkout d4dbd5d939`（随后 `node scripts/tsc.ts --fresh` 并重启服务） |

## 未执行与风险

- 未在真机上跑客户端内更新全流程（版本号、下载通道与签名已核对，安装行为未复测）。
- `google-services.json` 是仓库里的桩文件，Firebase/Crashlytics 运行时不可用；本版本没有真机
  崩溃上报结论。
- 服务器上只构建产品包；dsh 构建产物仍是 `d80522d276` 的既有产物，本次没有重建。
