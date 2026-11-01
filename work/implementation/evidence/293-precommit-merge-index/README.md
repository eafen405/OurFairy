# #293 门禁自检非封闭：`--merge` 用例改用临时 index

- 票：[#293](https://github.com/eafen405/OurFairy/issues/293)
- 分支：`integration/fixes-290-291-292`；基线 `347c966ed4`
- 范围：`tests/precommit.test.mjs` 一条用例；没有产品代码、数据库、wire、manifest 或依赖变更。

## 缺陷

`the merge entry point asks for the full gate itself, because MERGE_HEAD is not written yet`
直接对当前仓库的 index 运行 `scripts/precommit.ts --print --merge`，断言命令列表等于 `FULL_COMMANDS`。
`scripts/precommit.ts` 的 `plan()` 会在 staged 路径含非 Markdown 的 `android/**` 时追加
`./gradlew test lintDebug`，所以任何带 Android 改动的提交或合并都会让这条自检失败：门禁在真正跑
Gradle 之前就被自己的测试挡住，只剩 `--no-verify` 一条路。

这个缺陷是 #286 引入该用例时留下的，与本批 #290/#291/#292 的改动无关；#292 的实现者在提交时先撞上它。

## 修复

用例改为在临时 `GIT_INDEX_FILE` 上执行 `git read-tree HEAD`，再让 `scripts/precommit.ts --print --merge`
读这份与 HEAD 一致的 index：

- 决策里 `paths` 恒为空，`commands` 就是 `FULL_COMMANDS`，只验证 `--merge` 本身；
- 调用者真实 index 里有什么（包括 Android 路径）不再影响这条自检；
- Android 追加 Gradle 命令由既有用例
  `an Android source change keeps the root gate and adds one Gradle check in android/` 单独覆盖，没有丢覆盖。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node --test tests/precommit.test.mjs` | 28 tests，28 pass，0 fail |
| 暂存 `android/__precommit_probe.txt` 后 `node --test tests/precommit.test.mjs` | 28 tests，28 pass，0 fail（修复前同条件 27/28，失败的就是本条） |
| `git status --short` | 仅 `tests/precommit.test.mjs`，探针文件已移除 |

未执行：无（纯 Node 测试改动）。
