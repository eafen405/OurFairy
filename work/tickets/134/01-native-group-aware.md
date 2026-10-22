# 01: 原生能力检查与行删除测试不再假设扁平行表

## Parent

[#134 组合层显式化内核与插件：bundle 分组与缺席行归因](https://github.com/eafen405/OurFairy/issues/134)

## What to build

让「必选原生行是否存在」这件事在行被包进 group 之后仍然成立，并让「删掉一行后诊断必须失败」的测试真的删掉那一行。

今天 `nativeCapabilityFailures` 只按顶层行建 id 表，`tests/native-capabilities.test.mjs` 的 doctor 用例用固定缩进做字符串替换。分组会把这两个做法同时打空：前者让 doctor 对已挂载的行报「missing」，后者让替换静默落空。

这一票不分组。它只把两处假设改成「展开后再看」与「按 id 定位后删除」，交付后组合文件一字未改、`npm test` 与 `npm run backend:doctor` 仍然全绿。

分析记录：`docs/research/dsh-bundle-group-composition.md` 第 2 节。

## Acceptance criteria

- [ ] `nativeCapabilityFailures` 在判断前展开 group 子行（复用 `scripts/combo.mjs` 已有的 `flattenEntries`），四个必选原生行无论位于顶层还是 group 内都能被找到；缺失/禁用/换包的报错措辞不变
- [ ] `verifyInstalledNativeCapabilities` 把展开后的行集合交给上面那个函数，而不是未展开的 `composeEntries` 结果
- [ ] `tests/native-capabilities.test.mjs` 的 `composedRows()` 返回展开后的行；现有六个用例断言的是同一批行为，全部通过
- [ ] 「doctor 在删掉 `llm-retry` 后失败」的用例改为按 id 定位并删除该行再写回，不依赖缩进字符串；删除失败时必须响亮失败（例如找不到该行就断言失败），不能静默跳过
- [ ] 新增/调整的断言证明「group 内的必选行仍被找到」：构造一个把必选行放进 group 的行集合，`nativeCapabilityFailures` 返回空
- [ ] `node --test tests/native-capabilities.test.mjs` 与 `node --test tests/bundle-packages.test.mjs` 通过；`npm run backend:doctor` 的 `native capabilities` 仍为 ok

## Blocked by

None (can start immediately).
