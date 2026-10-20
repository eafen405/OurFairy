## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

文件系统、sandbox、bash、working-directory 的 scoped provider 各自成为可定位的行，spaces 行只保留 scope 协调、根计算与贡献者注册。单独 disable 任一 provider 行时，需要它的能力明确失败或降级，而不是静默回落到未加 scope 的原生 provider。纯 fold、格式化与内部 helper 不拆行。

## Acceptance criteria

- [ ] bundle 中 fs、sandbox、bash、working-directory 的 scoped provider 各有稳定行 id 与所属包
- [ ] spaces 行不再自行 `ctx.plugin` 四个 provider；scope 规则仍只有一份
- [ ] disable 任一 provider 行后，依赖它的工具调用以明确错误失败，且不会挂载未加 scope 的原生替代
- [ ] 既有文件/脚本/群组/附件场景全部通过
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [bundle 成为产品包集合的唯一权威](https://github.com/eafen405/OurFairy/issues/96)
