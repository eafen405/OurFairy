# 05 旧仓库归档说明

## Parent

[#123 客户端合仓](https://github.com/eafen405/OurFairy/issues/123)

## What to build

`eafen405/rikkahub` 保留为只读归档，不删除、不改写历史。只在其根说明（`README.md`）加一行：
已并入 OurFairy，仅作历史留存，不再更新。

这条说明让"历史证据里的旧路径与提交引用仍可解析"有一个明确的落点，也避免后来者去归档仓库上做例行合并。

## Acceptance criteria

- [x] rikkahub 根 `README.md` 出现该说明，且该仓库只有这一处改动
- [x] 提交不包含该检出现有的未提交改动（按路径提交，不用 `git commit -a`）
- [x] 不删除、不改写归档仓库的其它内容与历史

## Blocked by

None. 本票在另一个仓库落地，不进入本仓库的两次提交历史。
