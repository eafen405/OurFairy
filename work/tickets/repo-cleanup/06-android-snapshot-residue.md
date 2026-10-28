## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-06。

## What to build

删除三个高置信、无产品行为的 Android 快照残留：未引用 shape、未引用代码块折叠/展开文案和无业务断言的模板单测。

## Current evidence

- `android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairySlantShape.kt` 的符号在全仓只有自身声明；相邻 `FairyChamferShape` 有真实消费者。
- `code_block_collapse` 与 `code_block_expand` 在默认及中文 strings.xml 中声明，但没有 `R.string` 或 `@string` 消费者；相邻 copy/preview 文案有真实调用。
- `android/highlight/src/test/java/me/rerere/highlight/ExampleUnitTest.kt` 只有 `2 + 2 = 4` 的 IDE 模板断言。

## Scope

- 删除 `FairySlantShape.kt`。
- 删除默认与中文资源中的 `code_block_collapse`、`code_block_expand` 共四条声明。
- 删除 `ExampleUnitTest.kt`。

执行前重新做一次符号与资源引用检查；若出现新消费者，对应项退出本票，不强行删除。

## Acceptance criteria

- [ ] 三项目标的引用检查仍为零，删除后没有新增未解析资源或符号。
- [ ] 保留有消费者的 `FairyChamferShape`、代码块 copy/preview 文案和真实 highlight 测试。
- [ ] Android 单测与 lint 通过；测试数量变化只来自模板测试移除。
- [ ] 客户端快照来源声明与许可证校验保持通过。

## Verification

```bash
(cd android && ./gradlew test lintDebug)
node --test tests/android-source.test.mjs
npm run combo:verify
```

最终根全量门禁由 CLEAN-08 执行。

## Blocked by

无。

## Out of scope

不碰当前未提交的 IdentityPages/FairyPagesTest 或 `android/work/`；不删除整组多语言资源、营销图片、vineflower、`.github`、agent skills、DTO 字段、设计 token 或依赖；不做上游同步和版本升级。
