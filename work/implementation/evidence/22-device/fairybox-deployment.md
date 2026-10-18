# fairybox 测试部署：OurFairy v1 后端 + 真机 APK（2026-10-18）

本文件记录一次**测试部署**的实际操作与结果，不是生产发布，也不替代 #45 的真机验收记录。
部署目标由用户指定为 `fairybox`（`ssh fairybox` → `devin@85.137.246.15`，香港，Ubuntu 24.04）。

## 1. 部署形态

| 项 | 值 |
| --- | --- |
| 服务器 | `85.137.246.15`，Ubuntu 24.04.1，Node v24.21.0，4 核 / 3.9 GB 内存（部署时加 4 GB swap 供 dsh 构建） |
| OurFairy 检出 | `/home/devin/deploy/OurFairy`，`integration/ourfairy-v1` = `b48d4c6f803b` |
| dsh 检出 | `/home/devin/projects/deepseek-harness`，detached `fe2bbc3b1c14`（与 `combo.json` 一致） |
| rikkahub 检出 | `/home/devin/projects/rikkahub`，`product/ourfairy-v1` = `505f02c2969e`（仅用于 `combo verify`，服务端不构建 Android） |
| 隔离 home | `/home/devin/deploy/ourfairy-home`（`OURFAIRY_HOME`） |
| 后端监听 | `127.0.0.1:3080`（`OURFAIRY_BIND_HOST=127.0.0.1`；插件拒绝通配绑定） |
| 公网入口 | nginx `38518` 的 `/ourfairy/` 前缀反代到 `127.0.0.1:3080/`，复用该端口既有的 Let's Encrypt 裸 IP 证书 |
| 凭据 | `/home/devin/deploy/ourfairy-home/credentials.yaml`（0600，`MINIMAX_CN_API_KEY`、`VOICE_API_KEY`）；`OURFAIRY_CREDENTIALS_FILE` 指向它 |
| 服务单元 | `ourfairy.service`（systemd，`Type=oneshot` + `RemainAfterExit`，`ExecStart=node scripts/ourfairy-backend.mjs start`，`ExecStop=... stop`）；环境文件 `/home/devin/deploy/ourfairy.env`（0600） |

`fairybox` 上原有 `fairy.service`（旧 Fairybot，127.0.0.1:3777）与 `38518` 的旧 pilot 反代保持不变；
本次只**新增** `location /ourfairy/`、`location = /downloads/ourfairy-v1-arm64-release.apk` 和一个 systemd 单元，
配置文件改动前已备份为 `/etc/nginx/sites-available/fairy-pilot.bak-<时间戳>`。

## 2. 实际执行的命令

```bash
# 服务器：放置 4G swap（构建 dsh 时内存不足）
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile

# 服务器：按 combo.json 取三个仓库的锁定提交
git clone --branch integration/ourfairy-v1 git@github.com:eafen405/OurFairy.git ~/deploy/OurFairy
git -C ~/projects/deepseek-harness checkout --detach fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee
git -C ~/projects/rikkahub fetch git@github.com:eafen405/rikkahub.git product/ourfairy-v1
git -C ~/projects/rikkahub checkout product/ourfairy-v1 && git -C ~/projects/rikkahub reset --hard 505f02c2969efe46f8a1cca3fc831e00f559429e

# 服务器：dsh 的四条 requiredBuild（combo.json backend.requiredBuild 之外，install 已在检出中完成）
cd ~/projects/deepseek-harness
corepack pnpm@11.28.5 install --frozen-lockfile
corepack pnpm@11.28.5 run build:lib:host
corepack pnpm@11.28.5 run build:lib:client
corepack pnpm@11.28.5 run build:native-system   # built linux-x64/bin/glibc/system.node

# 服务器：启动并纳入 systemd（启动前 source ~/deploy/ourfairy.env）
sudo systemctl enable --now ourfairy.service
```

APK 在本机构建（服务端只有 4 GB 内存，不适合 Gradle）：

```bash
cd /home/eafen405/projects/rikkahub
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assembleRelease \
  -Pourfairy.identityEndpoint=https://85.137.246.15:38518/ourfairy \
  -Dorg.gradle.jvmargs="-Xmx8g -Dfile.encoding=UTF-8" --max-workers=8 --parallel
```

## 3. 结果与验证

| 检查 | 命令 | 实际结果 |
| --- | --- | --- |
| 版本组合 | 服务器 `node scripts/combo.mjs verify` | `combo: combination verified`（三行 ok） |
| 后端诊断 | 服务器 `node scripts/ourfairy-backend.mjs doctor` | `doctor: all checks passed`（9 项） |
| 后端状态 | 服务器 `node scripts/ourfairy-backend.mjs status` | `running: true`、`ready: true`、`probe.ok: true`、`failures: []`、监听 `3080` |
| 公网 HTTPS | 大陆侧 `curl --noproxy '*' https://85.137.246.15:38518/ourfairy/...` | `identity/sign-in` 200；`sessions/list` 200；`chat/send` 200 |
| 真实模型 | 同上，经 `/chat/send` 发一条消息后 `/chat/read` | `assistant/message` 返回「收到 OurFairy 真机联调测试确认，正在待命。」，`source.provider=minimax-cn`、`model=MiniMax-M3.1-Flash-Preview`、`turn/end reason=completed` |
| 重启持久化 | `systemctl restart ourfairy.service` 后用同一 token 请求 | `sessions/list` 200，主会话 `ourfairy-user-1-primary` 仍在 |
| APK 内嵌地址 | `python3` 读 `classes3.dex` | 含 `https://85.137.246.15:38518/ourfairy` |
| APK 签名 | `apksigner verify --print-certs` | V2，`CN=Fairy, O=Fairybot`，SHA-256 `406a2d5c…1d8e`（既有测试签名，非生产身份） |
| APK 公网下载 | 大陆侧 `curl -o /dev/null https://…/downloads/ourfairy-v1-arm64-release.apk` | 200，42,899,427 字节 |

APK 产物（本机 `/home/eafen405/projects/rikkahub/app/build/outputs/apk/release/`，服务器 `/var/www/ourfairy-v1/`，
两处 SHA256 一致）：

```text
267706aa6d99b4ca16e8894829ed99e6c98e0d5dbb2c1ac1f6be98dba52ac7a9  app-arm64-v8a-release.apk
001e2db4009b4242810a046e524038c1e2b64feeabad85ccb67b079b19c8c111  app-universal-release.apk
```

## 4. 访问地址与账号

- 后端地址（已编译进 APK）：`https://85.137.246.15:38518/ourfairy`
- APK 下载：`https://85.137.246.15:38518/downloads/ourfairy-v1-arm64-release.apk`
- 管理员：法厄同，短号 `1`，初始密码见 `/home/devin/deploy/ourfairy.env` 的 `OURFAIRY_PHAETHON_PASSWORD`
  （由部署时随机生成，不在本文件重复记录）。
- 测试代理人：`tester` / `tester-pass-1`（短号 `2`，用部署时生成的一次性邀请码 `RKYXL5B9STCV` 注册；
  该邀请码已用掉，后续代理人由管理员在账户页重新生成邀请码）。两名账号都已在公网代理上实测
  `/sessions/*` 与一次真实 MiniMax 对话（管理员回复「收到 OurFairy 真机联调测试确认，正在待命。」，
  代理人回复「在线」）。

## 5. 已知限制

- 这是**测试部署**：systemd 单元只保证 `start`/`stop` 与已启动状态，后端进程若崩溃不会自动重启（`Type=oneshot`），
  真机测试前用 `systemctl status ourfairy.service` 与 `node scripts/ourfairy-backend.mjs status` 复核。
- 路径前缀 `/ourfairy` 是本部署为避免改动服务器云安全组而选的入口；换端口或去掉前缀需要**重新构建 APK**，
  因为地址是编译期常量。
- 服务器 TLS 使用 `85.137.246.15` 的 Let's Encrypt 短周期证书（lego cron 续期，部署时有效期至 2026-10-22）。
- `38518` 的旧 pilot 上游（127.0.0.1:4580）本来就没有进程；本次没有接入或修复它。
- 本记录只证明后端可达、身份与真实模型链路、APK 可下载与签名；**没有**执行 #45 的设备行为验收
  （后台提醒、锁屏、进程回收、长文性能等），那些仍需在目标设备上按要求记录。
