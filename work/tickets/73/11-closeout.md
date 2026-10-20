## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

把本轮改动纳入版本组合并收口：更新 `combo.json`（行为组合与 dsh 锁定提交若有变化）、在证据索引登记新目录、运行最终两轴 code-review 并修复发现的问题、按 issue tracker 的方式关闭各票。只改文档时也要说明是否影响既有组合。

## Acceptance criteria

- [ ] `combo.json` 反映本轮合并后的组合，`npm run combo:verify` 通过
- [ ] 证据索引与新证据目录互相可达，链接可解析
- [ ] 两轴 code-review（Standards + Spec）已执行，问题在其所属模块修复；最终 `npm test` 全绿
- [ ] 各子票按 tracker 方式关闭并留有结论；父票 #73 的正文、标题与状态未被修改
- [ ] 明确列出未执行项（如真实模型服务、真机）与原因

## Blocked by

- [只声明 bundle 的 profile 可安装并启动](https://github.com/eafen405/OurFairy/issues/104)
- [行可寻址与配置契约的 overlay 验收](https://github.com/eafen405/OurFairy/issues/105)
