# 05 产品侧改接与组合锁

票 [#189](https://github.com/eafen405/OurFairy/issues/189)。产品提交 `8657b1d8e8`。

## 锁

[`combo.json`](../../../../combo.json) 的 `productCommit` 从 `42133b30ad…` 改为
`d1b6099ae716870a2afba705a2c90415408a69f5`。改动发生在**验证通过之后**：先把四条构建与冲突面
测试跑绿，再改锁，再跑产品全量。合并提交 `b8035f1afd` 与修复提交 `d1b6099ae7` 都没有碰过这个文件。

`integration/spec-182` → `product/ourfairy-v1` 已快进并推送到 fork
（`42133b30ad..d1b6099ae7`），CI 能按锁检出。

## 产品侧改了四处

1. **`backend/identity` 的 `identify`** 返回 `{ subject, principal: { kind: 'user', id } }`。
   注册表现在按不透明 `subject` 缓存上游 Peer，`revokePrincipal` 也用同一个键，所以
   subject 与 principal id 都仍是短号的 owner 串。
2. **`scripts/combo.mjs` 的插件兼容消息** 读 `requirements` 而不是 `peers`。
   rc.2 把 `evaluatePluginCompatibility` 的返回字段改了名，旧字段已不存在，
   `Object.entries(undefined)` 会把 `doctor` 的 detail 变成 undefined。
3. **两条载体测试改发合法 RPC 信封**（`tests/identity-http.test.mjs`、`tests/owned-sessions.test.mjs`）。
   rc.2 在查表**之前**校验信封，裸 body 一律 400；想观察「已准入但端点不存在」就必须发
   `{ type: 'client-request', rpcId, method, payload }`，这样仍然是 404。
4. **`tests/spaces.test.mjs` 的后台任务 id 断言** 改为 `/bash-[0-9a-f]{16}/`。
   rc.2 用短 UUID 命名可见任务（`bash-c2d9941e5405492b`），不是 fork 当时的序数 `bash-<数字>`。
5. **`tests/gateway.test.mjs` 的 ASR 凭据期望** 改为 `writable: true`。
   rc.2 的 `credentials-local.describe()` 对每个引用都报可写：存进去的值压过所有回退，
   unset 之后又暴露回退值。fork 当时的「env 来源即只读」已经不成立。

## 验证

| 命令 | 结果 |
| --- | --- |
| `npm test` | 285 / 285 通过 |
| `npm run combo:verify` | 三行 ok |
| `npm run backend:doctor` | `doctor: all checks passed`，插件兼容行是 `13 installed product package(s) compatible with dsh 0.2.1-rc.2` |

全量测试跑过四轮才干净，失败的都不是同一批：

- 第一轮：两条 400-vs-404（RPC 信封，已改测试）。
- 第二轮：插件兼容字段、`spaces` 的一条、ASR 凭据。其中 `spaces` 那条当时在串行复跑下通过，
  是并行跑 dsh 构建造成的资源竞争抖动。
- 第三轮：`spaces` 又失败，这次拿到了实际值 `bash-c2d9941e5405492b`——不是抖动，是 id 方案变了。
- 第四轮：285/285。

记这一串是因为「复跑一次就绿」不等于没有问题：同一个文件先抖后真错，只有看到实际值才分得清。

## 未执行

- 没有跑 Android 客户端构建（本 spec 范围外）。
- 没有起真实模型或硅基流动 ASR；doctor 的 `model double: not configured` 如实反映这一点。
