## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

每个声明 config 的产品行导出 Config schema，identity、spaces、attachments 的必填字段在激活时校验；非法配置让启动失败，错误命名行与字段，而不是等到第一次请求。探针把"bundle 声明的产品行未激活"当作启动失败并报出行与包，因此 `start` 与 `probe` 在非法配置下直接失败。没有 config 的行不加空 schema。

## Acceptance criteria

- [ ] identity、spaces、attachments 导出 Config；缺必填字段或类型错误的 config 在激活期失败
- [ ] 失败信息包含行 id（或模块名）与字段路径；`start`/`probe` 以非零退出，而不是报告 ready
- [ ] 探针把任何未激活的 bundle 产品行报为失败，并命名行与包
- [ ] 合法配置下所有产品行 active，既有场景通过
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [文件系统、sandbox、bash、工作目录 scoped provider 各自成行](https://github.com/eafen405/OurFairy/issues/101)
