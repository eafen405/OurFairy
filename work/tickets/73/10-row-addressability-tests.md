## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

用 profile overlay 证明行确实可寻址：单独 disable 投递、群组或某个 scoped provider，断言启动成功、该能力缺席、依赖它的调用明确失败；再断言 overlay 能替换一个 provider 而不影响其他行；用非法 config 启动，断言 boot 失败并命名行与字段。

## Acceptance criteria

- [ ] 投递、群组、至少一个 scoped provider 各有独立 disable 用例，断言能力缺席且依赖调用明确失败
- [ ] 至少一个 overlay 替换 provider 的用例，断言其他行不受影响
- [ ] 非法 root/缺失字段的 boot 失败用例命名行与字段，且是加载期失败
- [ ] 用例只断言调用方可见行为（启动结果、HTTP 响应、工具缺席），不断言私有实现
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [投递成为独立产品行并只向 chat 请求窄运行时](https://github.com/eafen405/OurFairy/issues/99)
- [群组工具成为独立产品行](https://github.com/eafen405/OurFairy/issues/100)
- [文件系统、sandbox、bash、工作目录 scoped provider 各自成行](https://github.com/eafen405/OurFairy/issues/101)
- [产品行声明 Config 并在加载期以行名和字段失败](https://github.com/eafen405/OurFairy/issues/102)
