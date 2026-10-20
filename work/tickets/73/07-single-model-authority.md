## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

共享模型的初始声明只保留一处：bundle 的 `agent-default-model` 行。版本组合文件不再重复 provider/model，也不再由 doctor 比对两份声明。探针从启动后的组合读取模型选择（`agentDefaultModel` 服务），不解析 YAML、不读另一份环境变量。法厄同通过网关保存的选择继续覆盖初始声明，下一轮生效、运行中不切换的规则不变。

## Acceptance criteria

- [ ] combo.json 与 launcher 中不再存在第二份 provider/model 声明
- [ ] 探针的 turn 使用组合中的 `agentDefaultModel.currentSelection()`；删除原来的双声明比对检查与对应测试
- [ ] 修改 bundle 模型行后，探针与 doctor 读到同一个值（以复制仓库的测试证明）
- [ ] 网关保存选择覆盖初始声明的既有测试保持通过
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [产品行声明 Config 并在加载期以行名和字段失败](https://github.com/eafen405/OurFairy/issues/102)
