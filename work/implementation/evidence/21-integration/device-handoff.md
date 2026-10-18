# #45 真机票交接：构建、账号与采集步骤

本文件只描述**已构建并验证过构建成功**的产物与操作步骤。它不声称任何 vivo S50 行为已经通过；
#45 必须在目标设备上实际运行并记录结果，模拟器、JVM 测试与构建成功都不能替代。

## 1. 构建

```bash
cd /home/eafen405/projects/rikkahub            # product/ourfairy-v1 = 90c3cfc5
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assembleRelease \
  -Pourfairy.identityEndpoint=http://<后端局域网地址>:3080 \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8" --max-workers=8 --parallel
```

产物：`app/build/outputs/apk/release/app-arm64-v8a-release.apk`（vivo S50 用这个）、
`app-universal-release.apk`、`app-x86_64-release.apk`。

本次组合实际构建的 SHA256 与签名身份见 [21-integration/README.md](../21-integration/README.md) 第 2 节。
`-Pourfairy.identityEndpoint` 是**必须**的：不传时 `generateReleaseBuildConfig` 直接失败。
换后端地址必须重新构建，地址是编译期常量。

签名使用本机既有测试签名（`local.properties` 中 `storeFile` 指向的 jks，不入库）；它不是生产
发布身份。安装前如设备已装同包名不同签名的 APK，需要先卸载。

## 2. 后端

```bash
cd /home/eafen405/projects/OurFairy
set -a; . ./VOICE_API_KEY.env; set +a
# MiniMax 密钥：让后端读取部署自己的凭据文档（含 MINIMAX_CN_API_KEY），
# 或直接 export MINIMAX_CN_API_KEY。不要把密钥写进仓库。
export OURFAIRY_CREDENTIALS_FILE="$HOME/.dsh/.credentials.yaml"
export OURFAIRY_BIND_HOST=172.26.211.174        # 手机可达的地址，不能是 127.0.0.1
export OURFAIRY_TRUSTED_HOSTS=172.26.211.174:3080   # 非 loopback 必须列入，否则一律 403
export OURFAIRY_PHAETHON_PASSWORD='<至少 8 位>'
node scripts/ourfairy-backend.mjs start
```

共用模型为 `minimax-cn` / `MiniMax-M3.1-Flash-Preview`（1M 上下文、`max` 思考强度），复用 dsh
自带供应商；法厄同可在网关页切换模型或调整思考强度。官方 DeepSeek 路由仍挂载，但本轮不使用。

管理员 = 法厄同（短号 1，用上面的密码登录）；代理人通过管理员在账户页生成的邀请码注册。
`/speech` 的可用性取决于 `VOICE_API_KEY`；ASR 连接参数可在管理员网关页调整。

## 3. 设备场景（#45 必做）

1. 记录设备型号/系统版本、APK SHA256、后端与两个 fork 的锁定提交、通知与后台设置截图。
2. 前台抑制：应用在前台时收到投递，不应弹提醒。
3. 后台回复/任务完成、静默投递一次提醒、多会话独立提醒、点击通知定位正确会话。
4. 拒绝通知权限后不重复引导；重新授予后恢复。
5. 锁屏、断网重连、普通进程回收、用户停止/强停：分别记录连接恢复、内容补齐和提醒时机。
6. 首次无记录建立基线、普通断线积压合并、账号切换、任务报告衔接。
7. 长回复：用 `app/src/main/assets/presentation/workload.md` 固定负载，
   `python3 scripts/measure-presentation.py --adb "$ANDROID_HOME/platform-tools/adb" --serial <设备> --out /tmp/ourfairy-presentation --scroll`
   记录帧耗时/卡顿、接收至呈现延迟、积压与内存；模型首内容等待单独统计。
8. 长文最终格式、阅读位置、PDF 结果可读。

不满足规格时在所属模块修复并重跑受影响场景；不得调小负载或改用冷启动指标掩盖问题。
设备/设置不可用时交回精确未完成项，不关闭 #45、不声称父规格完成。
