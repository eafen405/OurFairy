## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

产品包不再用只在 pnpm workspace 内成立的 `workspace:` peer 协议，改为明确的 semver 范围，表达"这个包对应哪条 dsh 版本线"。doctor 用 dsh 自己公开的兼容性判定（pinned CLI 的 `evaluatePluginCompatibility`）对照版本组合锁定的 dsh 版本检查每个已安装产品包，越界时失败并命名包、peer 与期望范围。兼容声明只描述对应版本线，不承诺任意上游版本可用。

## Acceptance criteria

- [ ] 所有产品包的 dsh peer 与 cordis/schemastery peer 使用明确 semver 范围，仓库内不再出现 `workspace:` 协议
- [ ] doctor 对每个已安装产品包执行与 dsh 运行时一致的兼容性判定，并报告被检查的 dsh 版本
- [ ] 人为把某个产品包的 peer 改成当前 dsh 不满足的范围后，doctor 失败并命名该包、peer 与范围
- [ ] 判定复用 dsh 公开导出，不复制其比较逻辑、不读取 dsh 内部源码
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

- [bundle 成为产品包集合的唯一权威](https://github.com/eafen405/OurFairy/issues/96)
