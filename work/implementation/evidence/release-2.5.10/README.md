# 2.5.10 / versionCode 195 发布与 fairybox 部署

日期：2026-10-31。范围：2.5.9（`009521b40e`）之后的 #256–#259：Fairy 互动统一、目的地拓扑与冷启动
恢复、会话列表浮层、接收提醒解耦。全部改动在客户端；后端产品源码未变，dsh 与 Android 来源快照未变。

## 版本组合

| 项 | 值 |
| --- | --- |
| OurFairy `main` | `9a590b4632`（`chore(release): 2.5.10 (versionCode 195)`） |
| dsh | `d80522d276`（`product/ourfairy-v1`，未变） |
| Android 版本 | `versionCode 195` / `versionName 2.5.10` |
| Android 来源快照 | `460109d1b8`（`combo.json` 的 `androidSource`，未变） |

## 发布前状态（fairybox）

| 项 | 更新前 |
| --- | --- |
| app 检出 | `009521b40e`（2.5.9 发布提交） |
| 服务 | `ourfairy-backend.service` active，`NRestarts=0` |
| APK | 2.5.9 / 194（8,683,631 / 8,700,764 / 8,684,292 字节） |
| 下载页 | `main@009521b4`、2.5.9 / 194 |

## 门禁

- 版本提交只改 `android/app/build.gradle.kts` 的 `versionCode` 与 `versionName`（`194/2.5.9` →
  `195/2.5.10`）。提交钩子的全量 `npm test` 重跑在隔离 home 的 `corepack pnpm install` 下载处连续
  阻塞超过 5 分钟（两次尝试），未取得新的全量绿；上一次同一代码（`722108db77`，仅差版本常量）
  的全量为 **430 tests / 430 pass / 0 fail**（101.5 s）。未把这次阻塞写成通过。
- release 提交上 `android/`：`./gradlew test lintDebug` → `BUILD SUCCESSFUL`；57 suites /
  **477 tests / 0 failures**，`lintDebug` 0 errors（2m50s）。
- release 构建：`./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=https://85.137.246.15:38518/ourfairy`
  → `BUILD SUCCESSFUL`。
- `npm run combo:verify` → 三行 ok（ourfairy 基于 main，dsh `d80522d276`，android source
  `460109d1`）。

## APK 事实（读取实际产物）

```
aapt2 dump badging app-arm64-v8a-release.apk
  package: name='me.rerere.rikkahub' versionCode='195' versionName='2.5.10'
apksigner verify --print-certs
  V2 Signer: CN=Fairy, O=Fairybot
  SHA-256 digest: 406a2d5c63fd717febdffc65731b449aa209693eba266ea845b8e00d0be01d8e
```

签名与 2.5.9 相同，可覆盖安装。APK 的 `classes.dex` 内含
`85.137.246.15:38518/ourfairy`，确认发布包内置正式后端地址。

| 产物 | 字节 | SHA-256 |
| --- | --- | --- |
| `app-arm64-v8a-release.apk` | 8,700,019 | `f2ac88290b5c76ee0a94fb58fb58698d7744086a29a9b8438bb54074533f6c94` |
| `app-universal-release.apk` | 8,717,152 | `c30b8d320b75ec127bfcea61ecffee2d819fa656ada2048bc78c86ca5f383421` |
| `app-x86_64-release.apk` | 8,700,680 | `8617006b78b575ef2f9b8076accaed769e988fe3c3375030b2375042d80a44a6` |

## APK 发布

- 新 APK 先上传到 `/home/devin/ourfairy/releases/20261031-2.5.10/`，服务器侧 `sha256sum` 与本地
  逐字一致。
- 旧的 2.5.9 三份 APK 备份到 `/var/www/ourfairy-v1/backup-20261031/`（哈希与 2.5.9 发布记录一致）。
- 三份新 APK 安装到 `/var/www/ourfairy-v1/`；旧下载页备份为
  `downloads/index.html.bak-20261031`。
- 下载页更新为 `main@9a590b46`、`2.5.10 / 195`，并列出本次四项更新。

## 后端

后端产品源码未变：`git diff --name-only 009521b40e..9a590b4632 -- backend` 为空。服务器 app 检出
fast-forward 到发布提交：

```sh
cd /home/devin/ourfairy/app
git fetch origin
git merge --ff-only origin/main            # 009521b40e → 9a590b4632
OURFAIRY_DSH_DIR=/home/devin/ourfairy/deepseek-harness node scripts/combo.ts verify
```

- `combo.ts verify` 三行 ok（ourfairy `9a590b4632`、dsh `d80522d276`、android source `460109d1`）。
- 因产品包源码未变，没有重跑 `tsc --fresh`、没有重装 profile、没有重启服务；服务保持
  `active`、`NRestarts=0`。

## 部署后验证（真实服务）

- `GET /ourfairy/identity/session` → 405（路由在，方法不对）。
- `POST /ourfairy/identity/sign-in`（错误口令）→ 401。
- `GET /downloads/` → 200，页面写着 `main@9a590b46`、`2.5.10 / 195`。
- `GET /downloads/ourfairy-v1` → 302 → 200，8,700,019 字节，SHA-256
  `f2ac8829…f6c94`，与本地一致。
- `GET /downloads/ourfairy-v1-arm64-release.apk` → 200，`Content-Length: 8700019`，
  `Content-Disposition: attachment`。

## 回滚材料

| 项 | 位置 |
| --- | --- |
| 上一版 APK（2.5.9 / 194） | `/var/www/ourfairy-v1/backup-20261031/`（哈希见 2.5.9 发布记录） |
| 上一版下载页 | `/var/www/ourfairy-v1/downloads/index.html.bak-20261031` |
| 上一版 app 检出 | `git checkout 009521b40e`（后端源码未变，不需要重建/重启） |

## 未执行与风险

- 客户端内更新与安装全流程未在真机复测；需要用户在已安装 2.5.9/194 的设备上走
  「设置 → 更新」冒烟。
- `google-services.json` 是仓库里的桩文件，Firebase/Crashlytics 运行时不可用；本版本没有真机
  崩溃上报结论。
- release 提交的全量 `npm test` 受隔离 home 的 corepack/pnpm 下载阻塞未重跑；代码面只有版本常量
  变化，后端全量绿停在 `722108db77`。
