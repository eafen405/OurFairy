## Parent

[#229 Profile 安装：恢复与模板复用的生命周期回归](https://github.com/eafen405/OurFairy/issues/229)

## What to build

用真实 pnpm 在隔离的临时仓库副本里完成一次真实安装，从生产结果出发验证模板发布与跨 home 复用闭环；并补上 copy 后 linked bundle 缺失的响亮失败。

- 第一个 home 用真实 pnpm 经 launcher CLI 安装，确认生产发布共享模板并写入来源 stamp；
- 第二个隔离 home 使用同一产品源哈希，经生产判定复制模板并报告 copied；复制阶段用进程调用记录证明没有执行 `pnpm install`，并核对第二个 home 的 linked bundle manifest 与来源 stamp 与发布者一致；
- 同一第二个 home 再次判定时报告 cached；
- copy 缺 linked 用例：从一个已有模板但缺少 linked bundle manifest、从未写 stamp 的新 home 开始，断言既有模板缺失错误被报告，失败后仍无 stamp 且没有 install 调用。

闭环起点必须是真实安装，不得用 fake corepack 生成；真实安装测试既有 inode、包集合与 installed/cached 证据保留。

## Acceptance criteria

- [ ] 第一个 home 真实安装后 `profile project linked` 报告 installed，共享模板与来源 stamp 均存在。
- [ ] 第二个 home 报告 copied；调用记录中本次没有 install 调用（版本查询若出现不计为安装）。
- [ ] 第二个 home 的 linked bundle manifest 存在，来源 stamp 内容与第一个 home 一致。
- [ ] 第二个 home 再次运行报告 cached。
- [ ] copy 缺 linked：报出既有模板缺失错误，无 stamp，无 install 调用。
- [ ] 既有真实安装不是硬链接、产品包集合、安装失败报告与 installed/cached 回归继续运行。
- [ ] 证据区分真实 pnpm 与进程替身；写 `work/implementation/evidence/<本票号>-template-reuse/README.md`。

## Blocked by

- [T1 确定性安装恢复：fake corepack 进程替身与重试验证](https://github.com/eafen405/OurFairy/issues/230)
  （fake corepack 调用记录 helper 由 T1 抽取）
