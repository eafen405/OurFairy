# 01 导入客户端快照

## Parent

[#123 客户端合仓](https://github.com/eafen405/OurFairy/issues/123)

## What to build

把 rikkahub `product/ourfairy-v1` 的末端 `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`
以**快照**方式导入本仓库 `android/`，内部结构原样不动（Gradle wrapper、`app`/`ui`/`highlight`/
`build-logic`、版本目录、文档、`.github` 定义均保持原相对位置）。

同时：

- 仓库根新增 `LICENSE`，内容为 AGPL-3.0（与 `android/LICENSE` 同文）。
- 新增 `android/ourfairy-source.json`：机器可读的来源声明，记录来源仓库地址、来源分支与来源提交。
  它是 `combo.mjs verify` 的 `android source` 行读取的对象，格式由本票定下、由 `02` 消费。
- 提交说明写明来源仓库与来源提交，并说明这是快照而非历史改写。

本票**不**改 `combo.json`、`combo.mjs`、`package.json`、任何文档或忽略规则（那些属于 `02`/`03`）。

## 实现要点

- 快照必须来自提交对象而不是工作树（rikkahub 检出有未提交改动）：

  ```bash
  cd <worktree>
  mkdir android
  git -C /home/eafen405/projects/rikkahub archive 460109d1b89b824a2ddb7f3201d8d3f7af7e02ce | tar -x -C android
  cp android/LICENSE LICENSE
  ```

- `git add -A` 前确认没有构建产物、Gradle 缓存、APK、`local.properties`、`google-services.json`、
  签名材料进入暂存区：`git status --short --ignored` 与 `git diff --cached --name-only` 对照快照清单
  （快照共 520 个文件，导入后 `android/` 为 521 个文件 —— 多出的一个是来源声明）。
- 来源声明（`android/ourfairy-source.json`）建议形状（字段名由 `02` 的校验读取，不要改名）：

  ```json
  {
    "repository": "https://github.com/eafen405/rikkahub",
    "branch": "product/ourfairy-v1",
    "commit": "460109d1b89b824a2ddb7f3201d8d3f7af7e02ce",
    "note": "The Android client was imported as a snapshot from this commit and no longer follows upstream."
  }
  ```

- 提交信息建议：

  ```
  android: import the client snapshot from rikkahub 460109d1

  The Android client no longer follows upstream: it lives in this repository
  from here on. This is a snapshot, not a history rewrite, so old evidence
  keeps resolving against the archived fork.

  Source: https://github.com/eafen405/rikkahub (product/ourfairy-v1)
  Source commit: 460109d1b89b824a2ddb7f3201d8d3f7af7e02ce
  ```

## Acceptance criteria

- [x] `android/` 的文件集合与 `460109d1` 的树逐文件相同（除新增的来源声明）
- [x] 快照内容与来源提交一致是可执行断言：blob 哈希逐文件比对无差异（命令见证据票）
- [x] 仓库根 `LICENSE` 为 AGPL-3.0，与 `android/LICENSE` 同文
- [x] `android/ourfairy-source.json` 存在且 commit 等于 `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`
- [x] 没有改动 `android/` 内任何客户端源码，没有导入构建产物 / 缓存 / APK / 本地属性 / 服务配置 / 签名材料
- [x] 提交前钩子（`npm test` + `combo:verify`）通过后提交；本票只有一个提交

## Blocked by

None (can start immediately).
