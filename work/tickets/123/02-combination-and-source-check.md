# 02 版本组合与来源校验

## Parent

[#123 客户端合仓](https://github.com/eafen405/OurFairy/issues/123)

## What to build

把版本组合从"三个仓库"收敛为"本仓库（锁集成分支）+ dsh（锁提交）"，并把客户端来源做成一条
**可执行**的声明：

- `combo.json` 的 `repos` 只保留 `ourfairy` 与 `dsh`。新增顶层字段 `androidSource`，记录来源仓库地址、
  来源分支、来源提交与声明文件路径；它**不参与**仓库循环（不参与 `repoPath` / `verify` 的仓库行推导）。
- `scripts/combo.mjs verify` 新增一行 `android source`：读取 `android/ourfairy-source.json`，
  断言其中的 `commit` 等于 `combo.json androidSource.commit`。这是本次唯一新增的断言。
  失败信息沿用现有风格：说清两边不一致的值并给出补救命令。
- `combo.mjs show` 打印来源；`--json` 输出包含这一行。
- `scripts/bench-projection.mjs` 的 `combination` 记录改为 `dsh` 与 `androidSource`（不再读
  `combo.repos.rikkahub`）。
- `combo.json` 的描述与 `androidToolchain` 里指向 rikkahub 检出的表述同步改到 `android/`。
- 新测试 `tests/android-source.test.mjs`：用真实仓库与临时根目录驱动 `verifyCombination`，
  断言来源一致通过、声明漂移失败并命名两个提交、声明缺失失败并给出路径。

## Acceptance criteria

- [x] `combo.repos` 恰好是 `ourfairy`、`dsh`；`combo.json` 不再有 `rikkahub` 仓库条目
- [x] `node scripts/combo.mjs verify` 输出两行仓库行加一行 `android source`；`--json` 也含该行
- [x] 声明与组合不一致时 verify 非零退出，失败信息含声明路径与两个提交，并点名要改的文件、字段与目标值
- [x] 声明缺失时 verify 非零退出并说明缺什么
- [x] `tests/android-source.test.mjs` 覆盖通过、漂移、缺失三条路径；`npm test` 全绿（已知
      `pdf-worker-cancel` 并发抖动除外，重跑确认）
- [x] `doctor` 的 `combo combination` 检查通过并列出 `android source`，不新增第二份来源判断
- [x] 不修改 `android/`、文档拓扑（`03` 的范围）、`package.json`

## Blocked by

[01](01-import-client-snapshot.md)
