# 03 拓扑文档与仓库卫生

## Parent

[#123 客户端合仓](https://github.com/eafen405/OurFairy/issues/123)

## What to build

仓库里所有**描述当前拓扑**的文档改为"产品仓库（后端 + `android/` 客户端）+ dsh fork（按提交锁定）"，
并写清接手须知。历史证据不追改。

具体文件与要求：

- `README.md`（根）
  - 仓库是什么：产品仓库，含后端与 Android 客户端；`android/` 是正常 Gradle 工程，内部结构保持上游原样。
  - 两个入口：后端 `scripts/` 与客户端 `android/./gradlew`；说明根 `package.json` **不**包装 Gradle。
  - 客户端构建前置条件：JDK 21、Android SDK、未入库的 `local.properties`、`app/google-services.json`、
    签名材料；构建命令从 `android/` 发起。
  - 来源与许可证：AGPL-3.0；客户端派生自 RikkaHub 并含 Fairybot 的 MIT 许可代码，原声明随客户端保留。
  - 客户端不再跟随上游；将来取上游修复的方式是**手工挑选**（从归档仓库取提交、评估后落到 `android/` 并说明来源）。
  - 历史证据与旧路径：某一日期之前的证据里的客户端路径与提交引用指向已归档的 `eafen405/rikkahub`。
  - 依赖的 companion 只剩 dsh；`OURFAIRY_RIKKAHUB_DIR` 与 rikkahub companion 表述随 `02` 删除。
- `AGENTS.md`：开头"三个仓库"改为"产品仓库 + dsh fork"，写明客户端已内联、不再跟随上游；
  其余条目不动。
- `work/implementation/CONVENTIONS.md`
  - §1 仓库表删除 rikkahub 行，改为本仓库 + dsh；说明客户端快照提交 `460109d`、不再跟随上游，
    以及组合校验的 `android source` 行是来源权威。
  - §2 worktree 协议删除 rikkahub 侧命令。
  - §3.1 Android 构建踩坑里的"rikkahub 检出目录"改为 `android/`（`local.properties` 写在 `android/`）。
  - §5 或 §1 增加一句：某日期之前的证据中的客户端路径与提交引用指向已归档的旧仓库，保持原样。
- **生态边界文档不在本票范围。** `docs/architecture/dsh-ecosystem-boundary.md` 与
  `tests/ecosystem-boundary.test.mjs` 只存在于并行 spec-73 的分支（`integration/spec-73`），
  `integration/spec-123` 上没有这两个文件。本票不创建、不链接、不修改它们；它那句
  "客户端代码不在本仓库"须在两条集成分支汇合时随该文件一起改（记录为后续项，不静默跳过）。
- `docs/decisions/upstream-compatibility-calibration.md` 与 `docs/decisions/v1-implementation-route.md`：
  只加最小的**当前拓扑说明**（一行注明客户端已内联、组合只剩 dsh 锁定），不重写历史结论与日期。
- `package.json`：`license` 改为 `AGPL-3.0`；脚本**不**新增 Gradle 包装。
- `.gitignore`：验证客户端产物在根规则下同样被忽略（`android/.gitignore` 与各模块 `.gitignore` 随快照保留，
  是对应目录的唯一权威）。仅当实测有产物未被忽略时才补规则，不复制一份清单。

## Acceptance criteria

- [x] 全仓库（除历史证据与历史票面副本）不再把 rikkahub 描述成当前第三个仓库
- [x] `README.md` 能回答：哪个目录是什么、客户端怎么构建、许可证是什么、将来怎么取上游修复、旧证据路径指向哪里
- [x] 没有创建或链接 `docs/architecture/dsh-ecosystem-boundary.md`（它属于 spec-73；本票只在报告里记下待汇合项）
- [x] `package.json` 的 `license` 为 `AGPL-3.0`，没有新增 Gradle 包装脚本
- [x] `git check-ignore` 对 `android/local.properties`、`android/app/google-services.json`、
      `android/build/x`、`android/app/build/x`、`android/.gradle/x`、`android/.kotlin/x` 均命中
- [x] 不修改 `combo.json` / `combo.mjs` / `tests/android-source.test.mjs`（`02` 的范围）与 `android/` 内业务代码

## Blocked by

[01](01-import-client-snapshot.md)
