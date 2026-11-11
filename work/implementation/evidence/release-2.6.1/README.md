# 2.6.1 / versionCode 201 发布与 fairydev 部署

日期：2026-11-10。范围：2.6 / 200（客户端提交 `release/2.6@2a6041e`）之后的 `main` 提交——
#341 账单页删去说明小字并把千位以上数字换成 K/M/B 单位、#312 Fairy 人格与提示词重写，
以及同批的文档整理。客户端与后端改动都在这一批里；dsh 与 Android 来源快照未变。

## 版本组合

| 项 | 值 |
| --- | --- |
| OurFairy `main` | `134e28bcbfb37397ce77d94c6b44628d2d4c98a4`（`chore(release): 2.6.1 (versionCode 201)`） |
| dsh | `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`（未变） |
| Android 版本 | `versionCode 201` / `versionName 2.6.1` |
| Android 来源快照 | `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`（未变） |

版本提交只改 `android/app/build.gradle.kts` 的两行版本常量（`196 / 2.5.11` → `201 / 2.6.1`）；
2.6 / 200 的版本提交在 `release/2.6` 分支上，此前没有合入 `main`，因此 `main` 的版本常量从
2.5.11 直接跳到 2.6.1。versionCode 200 未被占用过的设备跳过，不影响覆盖安装。

## 发布前门禁（`main` @ `134e28bc`）

- 版本提交的提交门禁：`android/` 改动被判为 **full**，先跑全量 `npm test`，再跑
  `npm run combo:verify` 与 `cd android && ./gradlew test lintDebug`
  （**BUILD SUCCESSFUL in 4m 21s**，134 actionable tasks），提交 `134e28bcbf`。
- 发布提交上复跑 `npm test`：**836 tests / 52 suites / 836 pass / 0 fail / 0 skipped**，
  `duration_ms 120464.78`。
- `npm run combo:verify`：三行 ok（`ourfairy` 134e28bcbf、`dsh` ae2adffd8d67、
  `android source` 460109d1b89b）。
- `./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=https://103.118.246.141:38518/ourfairy`
  → **BUILD SUCCESSFUL in 3m 8s**（127 actionable tasks）。

## APK 事实（读取实际产物）

```
aapt2 dump badging app-arm64-v8a-release.apk
  package: name='me.rerere.rikkahub' versionCode='201' versionName='2.6.1'
  native-code: 'arm64-v8a'
apksigner verify --print-certs
  V2 Signer: CN=Fairy, O=Fairybot
  SHA-256 digest: 406a2d5c63fd717febdffc65731b449aa209693eba266ea845b8e00d0be01d8e
```

`classes.dex` 内含 `103.118.246.141:38518/ourfairy`（1 处命中），确认发布包内置正式后端地址。
签名与 2.6 / 200 相同，可覆盖安装。

| 产物 | 字节 | SHA-256 |
| --- | --- | --- |
| `app-arm64-v8a-release.apk` | 8,777,375 | `0e6941234bea8db8493c66dfda7da89365beb26f844523002cb243dd49bf2404` |
| `app-universal-release.apk` | 8,794,508 | `3e33016a09b572283a011cec71c7914611c45eaa05a2bec4a90a9a7656e9ca91` |
| `app-x86_64-release.apk` | 8,778,036 | `9a1be93545fa7566a37fa20189fd9b6a137f31e6105cbd1d51ef6be8a097a1b8` |

## 后端部署（fairydev）

| 项 | 更新前 | 更新后 |
| --- | --- | --- |
| app 检出 | `408e62bc`（2.6 / 200 的后端提交） | `134e28bc`（fast-forward） |
| dsh 检出 | `ae2adffd8d67` | 未变 |
| 服务 | `ourfairy-backend.service` active、`NRestarts=0` | active，起于 2026-11-10 08:59:23 UTC，`NRestarts=0` |

过程：`git fetch origin && git merge --ff-only origin/main`（408e62bc → 134e28bc）→
`bash /home/fairy/ourfairy/deploy-backend.sh`：

- `node scripts/combo.ts verify` → 三行 ok（ourfairy 134e28bcbf、dsh ae2adffd8d67、android source 460109d1b89b）。
- `node scripts/tsc.ts --fresh` → 产品包重新编译。
- `node scripts/ourfairy-backend.ts doctor` → `doctor: all checks passed`（9 项；profile 重新安装，
  19 行 / 14 个包；插件兼容 16 个包）。
- 单元安装后 `systemctl restart`，`carrier answered on 127.0.0.1:3080`。

**提示词确实生效**：安装后的 profile 里 `@ourfairy/dsh-chat/dist/persona.js` 含新人格标记
（`系统权限不足`、`不要瞎编` 各 1 处），旧人格标记（`Youkai`）0 处；服务器检出的
`backend/chat/src/persona.ts` SHA-256 与本地逐字一致（`97bd68f2…a9a3a`）。

## 部署后验证（真实服务）

- 真实模型一轮：`/identity/sign-in`（`OURFAIRY_PHAETHON_PASSWORD`）→ `/sessions/create` →
  `/chat/send` → 轮询 `/chat/read` 到 `replyStatus === 0`。回复原文：

  > 在。我能处理文件读写与代码执行、检索并核对网络信息、管理记忆与技能、读取电费与运行统计、
  > 群组共享，以及把结果投递给指定用户——现在就把委托交给我。

  这一轮用的测试会话（`ourfairy-user-1-b84b7833…`）事后已归档；主人的现役会话仍为 5 个，
  主会话 `ourfairy-user-1-primary` 未动。
- 公网入口：`GET /ourfairy/identity/session` → 405（路由在、方法不对）；
  `POST /ourfairy/identity/sign-in`（错误口令）→ 401。
- 下载页 `GET /downloads/` → 200（1,575 字节），页面写着 `main@134e28bc`、`2.6.1 / 201`。
- `GET /downloads/ourfairy-v1` → 302 → 200，8,777,375 字节，SHA-256
  `0e6941234b…f2404`，与本地一致；`GET /downloads/ourfairy-v1-arm64-release.apk` →
  `Content-Length: 8777375`、`Content-Disposition: attachment`。

## APK 发布

- 新 APK 先上传到 `/home/fairy/ourfairy/releases/20261110-2.6.1/`，服务器侧 `sha256sum` 与本地逐字一致。
- 旧的 2.6 / 200 三份 APK 备份到 `/var/www/ourfairy-v1/backup-20261110-2.6/`
  （`86aff223…` / `0ab767e8…` / `68ca5829…`）。
- 三份新 APK 安装到 `/var/www/ourfairy-v1/`；旧下载页备份为
  `downloads/index.html.bak-20261110`。
- 下载页更新为 `main@134e28bc`、`2.6.1 / 201`，并列出本次两项更新（账单页、提示词）。
  客户端内更新按钮读的是固定路径 `/downloads/ourfairy-v1-arm64-release.apk`，不解析本页文字。

## 回滚材料

| 项 | 位置 |
| --- | --- |
| 上一版 APK（2.6 / 200） | `/var/www/ourfairy-v1/backup-20261110-2.6/` |
| 上一版下载页 | `/var/www/ourfairy-v1/downloads/index.html.bak-20261110` |
| 上一版 app 检出 | `git checkout 408e62bc` + 重跑 `deploy-backend.sh`（dsh 未变，不必重建 dsh） |

## 未执行与风险

- 真机未跑安装与「设置 → 更新」全流程；本轮只到 Robolectric、构建与公网下载。
- #341 的账单页观感只在 Robolectric 截图（411dp 与 320dp）里确认过，设备上的实际观感仍未复测。
- `google-services.json` 是仓库里的桩文件，Firebase/Crashlytics 运行时不可用；本版本没有真机崩溃上报结论。
