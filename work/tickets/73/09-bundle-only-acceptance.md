## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

最高 seam 的验收：一个只声明 bundle 的 profile（不经过 launcher 的产品包清单）能被安装并启动，所有必需服务与产品行 live，并用模型替身走一次认证后的产品 HTTP 请求。测试驱动真实 dsh CLI 与真实 pnpm，只替换模型端点。

## Acceptance criteria

- [ ] 测试在只含 bundle 依赖的 profile 上完成安装、启动、探针就绪
- [ ] 断言必需服务 live、bundle 声明的产品行全部 active、一次认证后的产品 HTTP 请求成功（模型替身）
- [ ] 该测试在缺少任一 bundle 声明包时失败并命名该包
- [ ] 测试不依赖 launcher 的产品包清单；launcher 的包集合变化不会让它失效
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [产品包声明明确的 dsh 兼容范围并由 doctor 校验](https://github.com/eafen405/OurFairy/issues/98)
- [投递成为独立产品行并只向 chat 请求窄运行时](https://github.com/eafen405/OurFairy/issues/99)
- [群组工具成为独立产品行](https://github.com/eafen405/OurFairy/issues/100)
- [文件系统、sandbox、bash、工作目录 scoped provider 各自成行](https://github.com/eafen405/OurFairy/issues/101)
- [产品行声明 Config 并在加载期以行名和字段失败](https://github.com/eafen405/OurFairy/issues/102)
- [共享模型初始声明只保留在 bundle](https://github.com/eafen405/OurFairy/issues/103)
