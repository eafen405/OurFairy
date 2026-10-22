## Parent

#136

## What to build

每份产品包清单的 `peerDependencies` 只描述真实的模块 import。运行时通过 `inject` 读取的服务是可用性约束，不写成 peer。

- `backend/groups` 不再声明 `@ourfairy/dsh-identity` 与 `@ourfairy/dsh-spaces`：源码没有 import 它们，只用 `inject: ['identity', 'ourfairySpaces']`。
- `backend/gateway` 不再声明 `@ourfairy/dsh-chat`：源码只用 `ctx.ourfairyChat`，没有 import。
- `backend/probe` 声明 `@ourfairy/dsh-identity`：`src/index.mjs` 直接 import `@ourfairy/dsh-identity/owner`。使用显式 semver 范围 `^0.1.0`，不用 `workspace:`。

不新增任何扫描源码判断 peer 的检查（#136 实施决定明确排除）。提交说明必须写明每个被删声明「从未有消费者」，并写明 probe 选择声明而非例外的理由。

## Acceptance criteria

- [ ] `groups`、`gateway` 的清单不再包含上述三处无 import 的 `@ourfairy/*` peer
- [ ] `probe` 的清单声明 `@ourfairy/dsh-identity: ^0.1.0`
- [ ] 三个包中不再存在对已删 peer 的 import；`probe` 的 `@ourfairy/dsh-identity/owner` import 保留
- [ ] 提交说明逐条写明被删声明从未有消费者，并写明 probe 的决定与理由
- [ ] `tests/plugin-compatibility.test.mjs` 的 peer 范围用例仍通过
- [ ] 不改动任何运行时代码

## Blocked by

None (can start immediately).
