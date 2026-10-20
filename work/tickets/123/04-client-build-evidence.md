# 04 客户端构建与证据

## Parent

[#123 客户端合仓](https://github.com/eafen405/OurFairy/issues/123)

## What to build

在合并后的树上实际跑一遍，留下可复查的证据：`work/implementation/evidence/123-client-merge/README.md`，
并在 `work/implementation/evidence/README.md` 索引里加一行。之后把证据文件 amend 进适配提交。

证据至少包含（规格 Testing Decisions 的要求）：

1. **组合校验**：`node scripts/combo.mjs verify` 的完整输出（两行仓库行 + `android source`），
   以及 `node scripts/ourfairy-backend.mjs doctor` 的 `combo combination` 结果。
2. **产品测试**：`npm test` 的真实结果与耗时；与合仓前基线（`integration/ourfairy-v1`，80 s 左右，
   唯一不稳定项是 `pdf-worker-cancel` 的并发抖动）对比，说明客户端源码进入仓库后后端测试没有变慢。
   已知抖动项要写明重跑结果，不写成全绿。
3. **客户端构建与单元测试**：在 `android/` 内执行 release 构建、perf（测量变体）构建与单元测试，
   记录真实命令与结果。前置条件（`local.properties`、`app/google-services.json` 桩、签名）由本地文件提供、
   不提交；要给命令和前置文件清单，并声明桩里的 key 是假的、Firebase/Crashlytics 运行时不可用。
4. **测量入口仍可用**：`scripts/measure-presentation.py` 指向的 Activity 仍在 perf APK 的清单与
   负载资产中（沿用 `work/implementation/evidence/74-presentation/README.md` 的隔离核对方法）。
   无真机 → 只到"可构建、APK 含入口"为止，不写设备结论。
5. **快照一致性**：证明 `android/` 内容与来源提交一致（blob 哈希逐文件比对，命令与输出摘要）。
6. **仓库卫生**：`git check-ignore` 结果；确认仓库根没有 `.github/workflows`（客户端自带的 CI 定义
   在 `android/.github/`，平台的流水线不读取，未启用）。
7. **未执行项**：逐条列（真机测量、客户端 CI、dsh 升级等），不接受"推断通过"。

## Acceptance criteria

- [x] 证据 README 记录实际执行的命令与输出摘要、固定提交、未执行项
- [x] 客户端 release 构建与单元测试成功；perf 变体构建成功且 APK 含测量入口；「可运行」需要真机，列为未执行项
- [x] `npm test` 与 `node scripts/combo.mjs verify` 在最终树上通过；`pdf-worker-cancel` 若抖动则重跑并如实记录
- [x] 证据目录与索引在一处（`work/implementation/evidence/123-client-merge/`），不另建第二份
- [x] 只改 `work/implementation/evidence/` 下本票证据与索引，不改产品代码、`android/` 源码与 `combo.json`

## Blocked by

[02](02-combination-and-source-check.md)、[03](03-topology-docs-and-hygiene.md)

## 构建前置文件（不入库）

```bash
cd android
cp /home/eafen405/projects/rikkahub/local.properties local.properties      # sdk.dir + 既有测试签名
cp /home/eafen405/projects/rikkahub/app/google-services.json app/google-services.json  # 桩，key 为假
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assembleRelease :app:assemblePerf :app:testDebugUnitTest \
  --max-workers=8 --parallel -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' \
  -Pourfairy.identityEndpoint=https://example.invalid
```
