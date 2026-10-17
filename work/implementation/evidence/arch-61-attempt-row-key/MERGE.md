# Merge record — arch-61-attempt-row-key (#61)

- Ticket: #61（Android / rikkahub）attempt 行 key 约定收敛
- 票分支：`arch/61-attempt-row-key`，FINAL_SHA `f32486416e73f90f0609acc514d0f31613bd1a75`
- 合并前集成分支 tip：`product/ourfairy-v1` = `771bffd1424da0f8537507caec028e77d0b8b7bc`（`771bffd1` 已是票分支祖先，未前进，无需回合并）
- 合并提交（`--no-ff`）：`5d8efe425d4abb45ad1d1333214bd0c9a23473cc`
  - parents：`771bffd1`（集成分支旧 tip）、`f3248641`（票分支）
- 冲突：无（`Merge made by the 'ort' strategy`，4 files changed, 41 insertions(+), 24 deletions(-)）

## 源树等价（复用依据）

按 MERGER.md 第 3 步先判断合并后源树是否与实现者验收的 FINAL_SHA 树相同：

```bash
git -C /home/eafen405/projects/rikkahub diff --quiet f32486416e73f90f0609acc514d0f31613bd1a75 5d8efe425d4abb45ad1d1333214bd0c9a23473cc
# EXIT=0（无差异）
git rev-parse 'f32486416e73f90f0609acc514d0f31613bd1a75^{tree}'  # 9cfd0ac85b59d892db9e4eb13cc741b846350cbd
git rev-parse '5d8efe425d4abb45ad1d1333214bd0c9a23473cc^{tree}'  # 9cfd0ac85b59d892db9e4eb13cc741b846350cbd
```

tree sha 相同 → 合并后源树与实现者验收的源树**逐字节相同**。因此复用实现者已在同一源树上跑过的
完整 JVM 测试 + `assembleDebug` 证据（见本目录：69 套件 / 516 tests / 0 failures / 0 errors，
BUILD SUCCESSFUL，产出 3 个 debug APK），不重复跑全量。

## 合并后定向回归（本次实际执行）

在 rikkahub 主 checkout（合并后 tip `5d8efe42`）执行：

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/tmp/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest' \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

结果：`BUILD SUCCESSFUL in 1m 54s`（230 actionable tasks: 22 executed, 208 up-to-date）；
聚合 **1 套件 / 6 tests / 0 failures / 0 errors / 0 skipped**。完整日志

包含本票钉住约定的用例 `attempt row key spells the generation scoped attempt convention`
（字面量 `attempt:gen-7:attempt-2`，约定漂移即红）。

## 未做

- 未做真机/模拟器、Firebase 运行时、真实云服务或性能验收；本记录只声明 JVM 单元测试与 debug 构建。
- 未改动实现者代码。
- 实现者记录的范围外发现（`PresentationBenchmarkActivity.kt:145` 仍硬编码 `attempt:benchmark:tail`）
  保持原样：benchmark harness 独立键，不在生产会话路径，未纳入本票收敛面。
