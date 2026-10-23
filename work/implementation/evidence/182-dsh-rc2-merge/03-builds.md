# 03 四条必需构建

票 [#187](https://github.com/eafen405/OurFairy/issues/187)。构建在 dsh 检出里执行，
命令来自 [`combo.json`](../../../../combo.json) 的 `repos.dsh.requiredBuild`，全部用
`corepack pnpm@11.28.5`。

## 结果

两次都跑在同一提交 `d1b6099ae7` 上：一次在集成分支的 worktree
（`.worktrees/182-merge`），一次在真正会被产品加载的主检出。

| 命令 | worktree | 主检出 |
| --- | --- | --- |
| `install` | exit 0（19.3s） | exit 0（10.8s） |
| `build:lib:host` | exit 0 | exit 0 |
| `build:lib:client` | exit 0 | exit 0 |
| `build:native-system` | exit 0 | exit 0 |

`build:native-system` 产物：`linux-x64/bin/glibc/system.node`（flock addon）。
`build:lib:client` 产物包含客户端 loader 入口：`packages/api/settings-controller/lib/typert.remote-client.d.ts`
等文件由 tsdown 的 client face 产出，产品连接行导入它们。

## 过程中修掉的两件事

1. **`tsc -b tsconfig.client.json` 单独跑会报 `settings`/`session` 不在 `TypertRemoteNamespaceMap`。**
   这不是合并缺陷：那两份测试文件与上游逐字相同，缺的是 `lib/typert.remote-client.d.ts`，而它只由
   tsdown 产出，`tsc` 不产出。按 `requiredBuild` 的顺序跑（host 面先跑 tsdown）即绿。教训写在
   [`CONVENTIONS.md`](../../CONVENTIONS.md) 的构建清单里：四条要按顺序跑，不能拆开单跑 tsc。
2. **`http-bridge.ts` 重复标识符。** fork 改过 `bridge()` 的实参顺序，上游也改过，自动合并把
   `PeerScope` 的 import 和 `peer` 形参各留了两份。按上游的顺序保留一份：
   `bridge(req, res, apiHandler, peer, maxRequestBodyBytes)`。

## 未执行

- 没有为这四个命令留原始日志（`CONVENTIONS.md` §5：原始输出不入库）。重放方式就是上表命令。
