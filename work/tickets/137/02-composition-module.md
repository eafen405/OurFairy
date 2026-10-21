> 发布权威：[#156](https://github.com/eafen405/OurFairy/issues/156)。本文件是工作副本。

## Parent

[#137 启动器拆分：组合层独立成零 spawn 模块，并修正 doctor 的错误契约](https://github.com/eafen405/OurFairy/issues/137)

## What to build

把组合层从启动器抽成同级的独立脚本模块（零 spawn，全部函数接收根目录参数），启动器只留进程层；
安装拆成「组合层判定 / 进程层执行」两半。产品源文件的哈希集合与陈旧判定因此可被测试直接 import 断言。

## Acceptance criteria

- [ ] 新增与启动器同级的组合层模块，导出：读版本组合、由 home 推出布局、隔离 home 断言、隔离环境构造、产品包清单派生、发布源文件展开、单条目展开、manifest 读取、内容哈希、profile manifest 生成、profile 写盘、安装判定、探针 overlay 路径、overlay 列表
- [ ] 组合层不 import `node:child_process`，不调用 git 或 pnpm；所有函数接受根目录参数并给出默认值
- [ ] `readCombo` 迁入组合层，`scripts/combo.mjs` 从组合层 import 并 re-export，既有 `import { readCombo, repoPath } from '../scripts/combo.mjs'` 的调用点不改
- [ ] 启动器保留 argv 解析、进程版 `fail`、git 调用、dsh 检出解析、探针子进程环境、`--patch` 参数拼装、全部命令实现与派发
- [ ] 启动器顶部加 `import.meta.main` 守卫；import 启动器不解析 argv、不读 `combo.json`、不打印、不退出
- [ ] 安装判定与执行分开：组合层给出 `cached` / `install`，进程层执行 pnpm 并在成功后写 stamp；`doctor` 仍报告 `(installed|cached)`
- [ ] `tests/product-sources.test.mjs` 的三个用例改为直接 import 组合层断言：哈希集合、未改动时复用、新增源文件使哈希变化；不再靠两次 doctor 反推
- [ ] `tests/bundle-only-profile.test.mjs` 继续自己写 profile，但隔离环境构造改为 import 组合层实现
- [ ] 新增可测项：三条 `files`/依赖准入规则的违规可直接断言抛错，且消息点名具体规则
- [ ] 已安装 profile 相关的断言（挂载行、已安装集、locale、幽灵包）仍走真实启动器
- [ ] 证据落在 `work/implementation/evidence/137-launcher-split/02-composition-module.md`

## Blocked by

- 01
