> 发布权威：[#157](https://github.com/eafen405/OurFairy/issues/157)。本文件是工作副本。

## Parent

[#137 启动器拆分：组合层独立成零 spawn 模块，并修正 doctor 的错误契约](https://github.com/eafen405/OurFairy/issues/137)

## What to build

让 bundle manifest 的依赖准入规则只有一套实现：启动器读 worktree 副本、`combo.mjs` 读已安装副本，
两侧调用组合层的同一个规则函数，对同一份 manifest 给出同一答案。

## Acceptance criteria

- [ ] 三条规则在组合层实现一次：依赖必须是 `file:`、解析后必须落在 containment 根内、名字不得与 bundle/probe 条目重名
- [ ] 启动器读 worktree 副本，containment 根为仓库根；违规时的消息文本与今天逐字相同
- [ ] `verifyBundlePackages` 读已安装副本并调用同一规则函数，containment 根为 profile 的 `node_modules`；违规转成 `failures` 的一条，不抛穿 doctor
- [ ] 新增断言：同一份 manifest 在两条路径上对三种违规给出同一判定（违规被发现、且点名同一依赖名）
- [ ] `tests/bundle-packages.test.mjs`、`tests/bundle-manifest.test.mjs`、`tests/plugin-compatibility.test.mjs` 原样通过
- [ ] 证据落在 `work/implementation/evidence/137-launcher-split/03-manifest-rules.md`

## Blocked by

- 02
