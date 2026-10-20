# #123 客户端合仓：把 Android 客户端并入产品仓库并收敛版本组合

本目录记录规格 [#123](https://github.com/eafen405/OurFairy/issues/123) 的实施证据。合并到
`integration/spec-123` 的是**两次提交**：

| 提交 | 内容 |
| --- | --- |
| 导入 `e151e73`（`android: import the client snapshot from rikkahub 460109d1`） | `android/` 快照、仓库根 `LICENSE`、`android/ourfairy-source.json` |
| 适配（`combo: converge the version combination on the inlined client`，即本文件所在提交） | 版本组合与来源校验、拓扑文档、忽略规则、本证据 |

适配提交无法在自己的内容里写自己的 SHA，因此按提交标题引用；用
`git log --oneline -1 -- work/implementation/evidence/123-client-merge/README.md` 即可定位。
下文所有命令与输出都在**该适配提交**上执行。

导入来自提交对象（`git archive`），不是 rikkahub 的工作树；rikkahub 检出当时有未提交改动。
两次提交都没有改动 `android/` 内的客户端业务代码。

## 1. 快照与来源提交一致

来源：`eafen405/rikkahub` 的 `product/ourfairy-v1` 末端
`460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`。

```bash
git -C /home/eafen405/projects/rikkahub ls-tree -r --format='%(objectname) %(path)' \
  460109d1b89b824a2ddb7f3201d8d3f7af7e02ce | sort > /tmp/rika-src.txt
git ls-tree -r --format='%(objectname) %(path)' HEAD:android \
  | grep -v ' ourfairy-source.json$' | sort > /tmp/rika-imp.txt
diff /tmp/rika-src.txt /tmp/rika-imp.txt
```

结果：两边各 **520** 行，`diff` 无输出——逐 blob 的对象哈希相同，`android/` 的 521 个文件
就是快照加一份来源声明。仓库根 `LICENSE` 与 `android/LICENSE` 同文（AGPL-3.0，sha256
`0d96a4ff…`）。

来源声明 `android/ourfairy-source.json`：

```json
{
  "repository": "https://github.com/eafen405/rikkahub",
  "branch": "product/ourfairy-v1",
  "commit": "460109d1b89b824a2ddb7f3201d8d3f7af7e02ce",
  "note": "The Android client was imported as a snapshot from this commit and no longer follows upstream."
}
```

## 2. 组合校验

```bash
node scripts/combo.mjs verify
```

```text
repo            branch                   expected          actual            result
--------------  -----------------------  ----------------  ----------------  ---------------------------------------------
ourfairy        integration/ourfairy-v1  based on integra  <HEAD>            ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  product/ourfairy-v1      460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

`ourfairy` 行的 actual 是运行时的 HEAD，因此写成 `<HEAD>`；另两行是固定提交，原样抄录。

`android source` 是本次唯一新增的断言：它读 `android/ourfairy-source.json`，与 `combo.json`
的 `androidSource.commit` 比对。`doctor` 的同一检查读同一来源，没有第二份判断：

```text
ok    combo combination: ourfairy@<HEAD>, dsh@5b8ec0f175d3, android source@460109d1b89b
```

`doctor` 全部检查通过（`doctor: all checks passed`）。

`scripts/combo.mjs` 的 `PATH_OVERRIDES` 已无 `rikkahub`；`combo.json` 的 `repos` 只剩
`ourfairy` 与 `dsh`。声明缺失、声明与组合不一致都不再是未捕获异常，而是失败行——
`tests/android-source.test.mjs`（新）覆盖通过、漂移、缺失三条路径，共 4 个测试。

## 3. 产品测试套件：合仓前后耗时对比

规格要求"后端测试的耗时不受客户端源码影响"必须实测，不能假设。两次都在同一台机器上、无其它
构建负载时测量，命令均为 `npm test`：

| 树 | 提交 | 测试数 | 结果 | `duration_ms` |
| --- | --- | --- | --- | --- |
| 合仓前（`integration/ourfairy-v1`） | `88c27b0` | 140 | 140 pass / 0 fail | 93,434 |
| 合仓后（`integration/spec-123`） | 适配提交 | 144 | 144 pass / 0 fail | 95,243 |

两次运行之间同一棵树的抖动就有 10 秒量级（适配提交上另一次全量运行为 84,458 ms），所以不按单次
差值下结论。可以说的是：**+4 个测试**（全部来自新增的 `tests/android-source.test.mjs`）带来的是
百毫秒量级；两棵树的总耗时落在同一条 85–95 秒带里。
`android/` 的 521 个文件进入仓库**没有**让后端套件变慢：测试夹具只复制后端相关路径
（`tests/helpers/backend.mjs` 的 `copyProductRepo` 复制 `backend`、`scripts`、`combo.json`、
`package.json`），客户端源码从不进入夹具。

### 合仓期间修掉的一个测试缺陷

`tests/pdf-worker-cancel.test.mjs` 的「the temporary directory must be removed after the call」
在全量运行时偶发失败，重跑即过。追查到的原因不是负载，是**两个测试文件共用同一个临时目录前缀**：

- 被测的 PDF worker 用 `mkdtemp(join(tmpdir(), 'ourfairy-pdf-'))` 建自己的目录
  （`backend/attachments/src/pdf.mjs`）。
- `tests/pdf.test.mjs` 的隔离 home 也叫 `ourfairy-pdf-`（`makeHome('ourfairy-pdf-')`）。
- 取消测试原本在 `finally` 里扫描「所有新出现的 `ourfairy-pdf-*`」。并行运行时，另一个文件在自己的
  窗口里建出的 home 被算成这个调用的残留，于是报「临时目录未删除」。

修法是让断言检查**这个调用自己的目录**（`existsSync(path)`），而不是前缀范围扫描；worker 的存活与网络隔离仍由 `processesMentioning(path)` 与 netns 比较覆盖。没有改动 worker 实现，也没有
放宽任何断言——原来那条断言要证明的事实（调用结束后目录不在了）保持不变，只是不再把邻居当成自己。

修改后连续两次全量运行 **146/146 通过**（`duration_ms` 84–88 秒区间）。这个缺陷在合仓前的基线树上
同样存在（基线两次全量运行失败一次），不是本次改动引入的；它修好后 `npm test` 才能作为稳定的交付门槛。

## 4. 客户端构建与单元测试

前置文件由本地提供、不入库（`git check-ignore` 见第 6 节）：

- `android/local.properties`：`sdk.dir`、`storeFile`、`storePassword`、`keyAlias`、`keyPassword`
- `android/app/google-services.json`：**桩文件**。里面 key 是假的，Firebase/Crashlytics 运行时不可用

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
cd android
./gradlew :app:assembleRelease :app:assemblePerf :app:testDebugUnitTest \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=8 --parallel
```

实际结果：

| 项目 | 结果 |
| --- | --- |
| `:app:assembleRelease` | BUILD SUCCESSFUL（首次全量 244 tasks，4 m 33 s） |
| `:app:assemblePerf` | BUILD SUCCESSFUL |
| `:app:testDebugUnitTest` | **35 suites / 202 tests / 0 failures / 0 errors / 0 skipped** |
| 在最终树上复跑 | `BUILD SUCCESSFUL`，`240 actionable tasks: 2 executed, 238 up-to-date`（2 s） |

最终树复跑只用了 2 秒且 238 个任务 up-to-date，这本身就是证据：`android/` 的内容在导入提交与
适配提交之间没有变化（`git diff e151e73..HEAD -- android/` 为空）。

产物（6 个 APK，不入库）：

| 变体 | APK |
| --- | --- |
| release | `app-{arm64-v8a,x86_64,universal}-release.apk` |
| perf | `app-{arm64-v8a,x86_64,universal}-perf.apk` |

### 测量入口仍然可构建（未运行）

按 #74 的隔离核对方法，对 universal 的两个变体做同样的检查：

| APK | 清单含 `PresentationBenchmarkActivity` | 含 `assets/presentation/workload.md` |
| --- | --- | --- |
| `app-universal-release.apk` | 0 | 无 |
| `app-universal-perf.apk` | 1 | 有 |

也就是说 `scripts/measure-presentation.py` 仍指向存在的入口（Activity
`me.rerere.rikkahub.ui.identity.PresentationBenchmarkActivity`，包名 `me.rerere.rikkahub`），
固定负载仍是同一份 `workload.md`。**只到"可构建、APK 含入口"**——本次没有真机，不写任何设备结论。

## 5. 仓库卫生

- 未导入构建产物、Gradle 缓存、APK、`local.properties`、服务配置或签名材料：
  `git ls-files android | grep -Ei 'local\.properties|google-services\.json|\.apk$|(^|/)build/'` 无输出。
- 客户端产物在根规则下同样被忽略（**实测**，非推断）：

  ```text
  android/.gitignore:10:local.properties      android/local.properties
  android/app/.gitignore:3:google-services.json  android/app/google-services.json
  android/.gitignore:6:/build                android/build/x
  android/app/.gitignore:1:/build            android/app/build/x
  android/.gitignore:2:.gradle               android/.gradle/x
  android/.gitignore:13:.kotlin              android/.kotlin/x
  ```

  六条先由随快照保留的客户端规则命中；根 `.gitignore` 另有一组同样的回退规则，所以将来即使
  快照里的嵌套规则变了，这些路径仍然被忽略。`tests/android-source.test.mjs` 断言的是**效果**
  （`git check-ignore` 命中、`git ls-files` 里没有这些路径），不依赖哪一层的规则先匹配。
- 仓库根没有 `.github/workflows`；客户端自带的 CI 定义留在 `android/.github/workflows/`
  （`close-blank-issues.yml`、`daily-build.yml`），平台的流水线只读仓库根，因此不生效、未启用。
- 客户端快照里有一个符号链接（`android/.claude/skills`），是来源提交的原样内容。

## 6. 未执行项

- **真机测量**：目标设备 vivo S50 不可用。测量入口只验证到"可构建、perf APK 含入口与负载"，
  没有设备基线、没有帧率或延迟数字。
- **真实 Firebase/Crashlytics**：`google-services.json` 是桩文件，key 为假；没有运行时结论。
- **客户端 CI 流水线**：按规格不引入，`android/.github/` 保持不生效。
- **dsh 升级**：规格明确 out of scope，未做。
- **旧仓库归档与推送（需要人工完成）**：`eafen405/rikkahub` 根说明的归档一行已在本地提交 `2d97ed14`
  （`docs: mark the fork as merged into OurFairy and archived`），**未推送**。实测远端
  `product/ourfairy-v1` 停在 `505f02c2`，其中没有快照基线提交 `460109d1`，所以"旧提交引用可解析"
  这一条目前只在本地成立。推送被拒绝：

  ```text
  ! [remote rejected] product/ourfairy-v1 -> product/ourfairy-v1 (refusing to allow an OAuth App
    to create or update workflow `.github/workflows/daily-build.yml` without `workflow` scope)
  ```

  原因：本机 `gh` token 的 scope 是 `admin:public_key, gist, read:org, repo`，缺少 `workflow`；
  而 `460109d1` 这一次提交本身改动了 `.github/workflows/daily-build.yml`。远端 `505f02c2` 是本地
  分支的祖先（`git rev-list --left-right --count fork/product/ourfairy-v1...product/ourfairy-v1`
  为 `0 10`），所以这是一次快进推送，不重写历史。补救命令（换用带 `workflow` scope 的 token）：

  ```bash
  gh auth refresh -h github.com -s workflow          # 或改用带 workflow 的 PAT
  git -C /home/eafen405/projects/rikkahub push fork product/ourfairy-v1
  gh api -X PATCH repos/eafen405/rikkahub -f archived=true   # 置为只读归档
  ```

  推送完成前，`README.md` 与本文都不声称旧提交已在远端可解析。

## 7. 后续项（本次未做，需要时另开）

- `docs/architecture/dsh-ecosystem-boundary.md` 只存在于并行 spec-73 分支；其中
  "客户端代码不在本仓库"一句须在两条集成分支汇合时随文件一起改。本规格的分支不创建、不链接、
  不修改该文件。
