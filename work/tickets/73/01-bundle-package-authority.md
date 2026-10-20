## Parent

[#73 dsh 插件生态兼容：bundle 自描述、行级寻址与插件契约](https://github.com/eafen405/OurFairy/issues/73)

## What to build

bundle 的 manifest 成为产品包集合的唯一权威。bundle 自己声明它挂载的产品包；launcher 生成 profile 时只从 bundle 解析这份集合（探针除外），不再维护 `LINKED_PACKAGES` 一类手写清单。bundle 的 `files` 覆盖 patch、运行入口与最小元数据，安装副本不依赖仓库里未声明的文件。doctor 与测试一起回答"bundle 行、声明的包、已安装的包、生成的 profile 四者是否一致"，缺失、重复挂载或已装未挂载都报出包名与行号。

本票不改变行集合本身（行拆分在后续票），也不改模型声明。

## Acceptance criteria

- [ ] 生成 profile 的产品依赖集合从 bundle manifest 派生；launcher 中不存在第二份人工筛选的产品包清单（探针包除外，它仍由 combo.json 的 probePackage 指定）
- [ ] bundle `files` 覆盖 patch、README 与 locale；安装副本启动不读取仓库中未声明的文件
- [ ] 每个 bundle patch 行引用的包都已安装；每个已安装产品包至多被一行挂载；缺失、重复、未挂载三种情况由 doctor 与测试报出包名与行 id
- [ ] 移除 bundle 中一个声明的包后，doctor 与一致性测试失败并命名该包；本地 checkout 的 `file:` 安装仍可用
- [ ] `npm test` 与 `npm run combo:verify` 通过的证据写入本票证据目录

## Blocked by

None (can start immediately).
