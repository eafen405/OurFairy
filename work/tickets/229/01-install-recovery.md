## Parent

[#229 Profile 安装：恢复与模板复用的生命周期回归](https://github.com/eafen405/OurFairy/issues/229)

## What to build

用现有后端 launcher CLI 作为最高 seam，在临时仓库副本与隔离 home 中，通过 PATH 上的 fake corepack 控制 pnpm 进程结果，固定安装恢复与 linked 验证的确定性行为。生产 launcher、composition 与安装编排不改。

新增一个可复用的 fake corepack 测试替身：接受版本查询与 install 调用，按测试配置返回成功、失败或「成功但不布置 linked manifest」；把调用序号、参数、cwd 与调用时 lockfile 是否存在记录到临时目录。成功安装时按 profile manifest 布置最小 linked bundle manifest 与 lockfile 产物，不跳过生产的 linked 验证、模板发布与 stamp 写入。

新增确定性用例：

- 首次安装失败且 profile 中存在旧 lockfile：恰好两次 install，第二次调用前 lockfile 已被删除，CLI 报告 installed，并核对已发布模板与来源 stamp；
- 两次安装都失败：恰好两次 install，错误详情同时保留两次可识别输出，没有成功模板或来源 stamp；
- 首次失败但没有旧 lockfile：不进入删除重试，只有一次 install，失败语义与现有 CLI 错误契约一致；
- 替身报告安装成功但未布置 linked bundle manifest：现有响亮失败被报告，不发布模板、不写 stamp。

## Acceptance criteria

- [ ] fake corepack 经 PATH 生效；调用记录包含每次 install 时 lockfile 是否存在；测试不读取或替换生产内部函数。
- [ ] 恢复成功：恰好两次 install，第二次调用前旧 lockfile 已删除，`profile project linked` 报告 installed。
- [ ] 恢复成功后模板已发布（含 linked bundle manifest 与 lockfile），来源 stamp 内容与模板哈希目录一致。
- [ ] 双失败：恰好两次 install，两次输出都出现在错误里，没有模板目录、没有 stamp。
- [ ] 无旧 lockfile 的首次失败：只有一次 install，错误不含 lockfile 删除重试说明。
- [ ] install 成功但 linked 缺失：报出既有「reported success but ... is missing」错误，没有模板与 stamp。
- [ ] 沿用 `copyProductRepo`、`makeHome`、`launchEnv` 与 `OURFAIRY_SKIP_BUILD=1`，不新建第二套测试基础设施。
- [ ] 相关测试通过；证据写 `work/implementation/evidence/<本票号>-install-recovery/README.md`。

## Blocked by

None (can start immediately).
