# 侦察证据：rikkahub fork 本机构建可用性（票 #26 前置）

目的：消除票 #26「邀请码注册、登录与单 APK 身份入口」最大的未知——**rikkahub fork 在本机能否真实构建出 APK**。这是侦察，不是完成 #26。

固定基线：`0966502c4d65c1ee4b2a3e49a19703bb1978016c`（本地 `/home/eafen405/projects/rikkahub`，分支 `product/ourfairy-v1`）。
原始日志：`build-01-assembleDebug.log`（早期失败/停滞的记录）、`build-02-assembleDebug.log`（成功）、`resource-samples.csv`（早期采样的内存曲线）、`run-build.sh`（可复现脚本）。

## 结论：构建成功

```
BUILD SUCCESSFUL in 6m 57s
EXIT=0
```

产物（`app/build/outputs/apk/debug/`）：

| APK | 大小 |
| --- | --- |
| `app-arm64-v8a-debug.apk` | 82.1 MB |
| `app-x86_64-debug.apk` | 82.9 MB |
| `app-universal-debug.apk` | 93.0 MB |

（`splits { abi { ... } }` 同时产出两个 ABI 包与一个 universal 包。）

## 可复现的最小命令序列

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-recon-bin:$PATH          # pnpm shim → corepack pnpm@11.28.5
cd /home/eafen405/projects/rikkahub
git submodule update --init --recursive            # material3/material-color-utilities
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > local.properties
(cd web-ui && pnpm install --frozen-lockfile)      # web 模块 preBuild 只 build 不 install
./gradlew :app:assembleDebug \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8 \
    -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 \
    -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 \
    -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]" \
  --max-workers=8 --parallel --console=plain
```

等价的仓库内脚本：`run-build.sh`（`setsid nohup` 脱离 agent turn 运行，日志追加到 `build-02-assembleDebug.log`）。

## 实测踩坑（每条都花过时间，已同步到 `work/implementation/CONVENTIONS.md` §3.1）

| 现象 | 实测事实与对策 |
| --- | --- |
| `./gradlew` 下载发行版超时 | 本机代理只以**环境变量**存在（`http_proxy/https_proxy=http://127.0.0.1:7890`），**Java/Gradle 不读环境变量代理**。对策：用 `curl` 走代理把 `gradle-9.6.0-bin.zip` 下到 `~/.gradle/wrapper/dists/gradle-9.6.0-bin/<base36(md5(url))>/`（本机实测该 hash 方案与既有 `gradle-9.5.1` 目录完全吻合），用 python3 `zipfile` 解压（**本机没有 `unzip`**），`chmod +x gradle-9.6.0/bin/*`，再 `touch gradle-9.6.0-bin.zip.ok`。 |
| 依赖解析极慢 / 长时间无输出 | 两条独立事实：(1) Gradle 只在任务完成时打印 `> Task`，大量元数据下载期间日志会长时间静止，**这是正常推进**（判据：`~/.gradle/caches/modules-2/metadata-*/descriptors/` 有新文件写入）；(2) 直连仓库实测比代理慢 3–5 倍（`repo.maven.apache.org` 直连 2.30s vs 代理 0.68s；`plugins.gradle.org` 3.57s vs 0.54s），所以**给 JVM 传 proxy 参数是必须的**，不只是 gradle 发行版那一次。加上 proxy 参数后同一目标 6m57s 完成。 |
| 构建极慢 / 单 worker | 用户级 `~/.gradle/gradle.properties` 含 `-Xmx2560m`、`org.gradle.workers.max=1`、`org.gradle.parallel=false`、`kotlin.compiler.execution.strategy=in-process`。**不要改这个共享文件**（其他队友也在用）；用命令行覆盖：`-Dorg.gradle.jvmargs=... --max-workers=8 --parallel`（实测 daemon 确实拿到了 `-Xmx10g`）。 |
| `compileSdk` 与已装平台不符 | rikkahub 用 `compileSdk { version = release(37) { minorApiLevel = 2 } }`，实际解析到 **`android-37.2`**（不是已装的 `android-37.0`）。AGP 会自动安装（license 已接受），但首次会拖长构建。 |
| 缺 `app/google-services.json` | `:app:processDebugGoogleServices` 硬失败：`File google-services.json is missing. The Google Services Plugin cannot function without it.`（早期日志 `build-01`）。该文件被 `app/.gitignore` 忽略，需要自备。 |
| 子模块未初始化 | `material3/material-color-utilities` 未 init 时 `:material3` 编译失败（`material3/build.gradle.kts` 把 `material-color-utilities/kotlin` 当作 source dir）。 |
| `web` 模块 preBuild 跑 pnpm | `web/build.gradle.kts` 的 `buildWebUi` 只跑 `pnpm run build`，**不跑 install**；必须在 `web-ui/` 先 `pnpm install --frozen-lockfile`。pnpm 必须是 `corepack pnpm@11.28.5`（PATH 上的 12 是 Windows 版）。 |

## 必须声明的证据限度（不要让 #26/#45 误用）

1. **`app/google-services.json` 是自备桩文件，里面是假 key**（`project_number 000000000000`、`current_key AIzaSyDSTUBKEYNOTREAL…`）。它只够让 Google Services 插件完成构建。**Firebase Analytics / Crashlytics 在运行时不可用**；任何真机崩溃上报、分析结论都不能基于这个桩。
2. **只构建了 debug 变体**。release 需要签名配置（`local.properties` 里的 storeFile/storePassword/keyAlias/keyPassword）与 `app/app.key`，本机没有，**未尝试也未验证**。
3. **没有安装到设备**。未连接任何真机或模拟器，未运行任何 instrumentation 测试；`app:baselineprofile` 的 `useConnectedDevices = true` 因此未执行。
4. 产物是 **rikkahub 基线提交**构建的，不含任何 OurFairy 产品改动（产品分支此时等于基线提交）。#26 的首次 APK 构建仍须在加入身份入口后重新验收。
5. 内存采样 `resource-samples.csv` 来自早期那次未完成的构建，**不代表成功构建的峰值**；成功那次的 `/usr/bin/time -v` 只统计了 wrapper 客户端进程（`Maximum resident set size 119612 KB`），**不是** daemon 峰值。

## 对票 #26 的建议

- 直接采用上面「最小命令序列」+ `run-build.sh`；把 `-Dorg.gradle.jvmargs` 的 proxy 参数写进团队约定，否则换一个 shell 就会重新踩。
- `local.properties` 与 `app/google-services.json` 都已被 `.gitignore` 覆盖（前者根 `.gitignore`，后者 `app/.gitignore:3`），**不要提交**。
- 若 #26 需要真实 Firebase 行为，必须由用户提供真实 `google-services.json`；否则应在证据里继续声明桩文件限制，或评估 `MissingGoogleServicesStrategy`（属构建配置改动，需按票面决定）。
- 长构建务必 `setsid nohup` 脱离 agent turn：队友 turn 结束时其后台任务会被回收，早先那次构建就是这样被中断的（`build-01` 日志停在中途）。
