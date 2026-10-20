# #83 被 spill 的结果仍可用 read 与受限 shell 取回

票面：[#83](https://github.com/eafen405/OurFairy/issues/83)（父规格 [#71](https://github.com/eafen405/OurFairy/issues/71)）。
分支 `ticket/83-spill-read`，基于 `integration/spec-71` @ `88c27b0`。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/spill-read.mjs`（新增） | `installSpillRead(ctx)` 向 `ctx.ourfairySpaces` 注册一个只读贡献：当前 Session 的 spill 目录。根目录取自挂载的 `spillStore.root`，目录名用 `@deepseek-ai/dsh-spill-local` 自己的 `sessionDir(root, sessionId)`；只在目录已存在时返回，未发生 spill 的会话不授予任何路径。 |
| `backend/chat/src/index.mjs` | 注入 `ourfairySpaces`，在 apply 时安装上述贡献。 |
| `backend/chat/package.json` | 声明 `@deepseek-ai/dsh-spill-local` peer（产品包可解析 CLI 安装域内的该包，见 `work/implementation/notes/spec71-boundary.md`）。 |
| `backend/spaces/README.md` | 把 `contributeReadonlyFiles` 的描述从「exact read-only files」改为「read-only paths」，因为它的消费者现在包含一个目录；`contributeExtraRoots` 的语义不变。 |
| `tests/spill-read.test.mjs`（新增，2 条） | 真实 launcher + 真实 profile + 内联 Messages 替身，覆盖完整读取、shell 检索、只读性、跨会话/跨用户拒绝。 |

提交：`016522d`（实现）、`6f49002`（测试）。

## 为什么这个授予是窄的

- 贡献的是一个**目录**，不是 `DSH_HOME`、不是整个 spill 根、不是上传目录；同一用户的另一个会话、另一个用户都拿不到。
- 贡献在每次文件操作时重新求值，只返回 `realpathSync` 后确实存在的目录；没有缓存、没有第二个路径常量。
- 只读：`readonlyFiles` 只进入 `readRoots`，不进入 `writeRoots`。测试同时用 `write` 工具和 `bash` 的 `>>` 验证了这一点。
- 目录名由 spill 后端自己的 `sessionDir` 派生，产品不复制它的 hash 规则。

## 验收行为

`node --test tests/spill-read.test.mjs`（2/2）：

1. **同一会话完整取回与检索**：`bash` 打印 800 行（约 33 648 字节，估算 > 8 000 token）触发原生 spill；模型收到有界预览与 locator，预览省略中间标记。随后 `read` locator 成功，返回的编号行与 spill 文件逐行相等（802 行），footer 报告同样的总行数；`grep -n` 在原位找到第 401 行的中间标记。
2. **只读与跨会话/跨用户拒绝**：所有者能读自己的 spill 文件（磁盘上仍是 `0600`）；所有者对 locator 的 `write` 被拒绝并给出范围错误；`bash` 的 `>>` 因只读挂载失败且文件字节不变；同一用户的另一个会话、另一个用户读取时得到 `is_error: true` 与明确的拒绝文案，拿不到任何 spill 内容；同会话目录的兄弟目录、上传目录和 `DSH_HOME` 本身都被拒绝。

部署的模型目录没有原生 `grep` 工具（`dsh-tool-fs` 只提供 read/write/edit/read_image；动态工具目录断言 `catalog.includes('grep') === false`）。因此本票的「grep」由受限 shell 承担；这也与原生 spill notice 的 `read ... or grep this path` 指引一致，不新增工具名。

`read` 的输出信封是 `<content>\n<编号行>\n\n(End of file - total N lines)\n</content>`（`packages/fs/tool-fs/src/read-render.ts`）。测试先按空行切出 footer，再比较编号行，避免把 footer 当成文件内容。

## 实际命令与结果

```
$ node --test --test-reporter=spec tests/spill-read.test.mjs
✔ a spilled bash result is fully readable and searchable in the session that produced it
✔ another session and another user are denied the locator even though the file is readable
ℹ tests 2 / pass 2 / fail 0
```

相关回归（`tests/spaces.test.mjs`、`tests/attachments.test.mjs`、`tests/pdf.test.mjs`、
`tests/pdf-worker-cancel.test.mjs`、`tests/sandbox-network-profile.test.mjs`）：

```
ℹ tests 21 / pass 20 / fail 1
✖ a cancelled PDF worker ... (AssertionError: the temporary directory must be removed after the call)
```

隔离重跑 `node --test tests/pdf-worker-cancel.test.mjs` → 1/1 通过（221 ms）。这是 #81/#82
证据里已记录的并发负载 flake（当时 load average 15.58，隔离重跑同样通过），不是 #83 的改动。

全量 `npm test`：

```
ℹ tests 142 / pass 141 / fail 1
✖ a cancelled PDF worker ...（同一条 flake）
```

隔离重跑该文件 1/1 通过。全量其余 141 条全部通过。

## 替身与真实服务的分界

- **模型替身**：测试内联的 loopback Messages 服务（与 `tests/spaces.test.mjs` 同形），只生成一次
  `bash`/`read`/`write` 工具调用并回显 wire 结果。没有真实云服务。
- **真实的部分**：真实 launcher、真实 dsh profile 装配、真实 spill-local 写盘（`0600`）、真实
  bwrap 沙箱与只读挂载、真实文件系统与只读授权判定、真实耐久会话日志。
- **未执行**：真实模型服务；Android 客户端（本票不改契约）。

## 未执行项

- 上表两处并发 flake 的隔离重跑已通过；最终集成状态的 `npm test` 由 #87 在
  `integration/spec-71` 上重跑并记录，避免把并行负载下的抖动当成 #83 的回归。
</content>
