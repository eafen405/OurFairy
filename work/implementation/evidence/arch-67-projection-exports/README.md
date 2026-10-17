# arch-67-projection-exports — 票 #67 证据

票面：`backend/chat/src/projection.mjs` 导出 `messageText` / `attemptText` / `requestMessages`，但
`backend/` 与 `tests/` 无任何包外消费者；三个函数只在文件内部被 `receiptIn` / `transcript` 调用。
修复方向：去掉三者的 `export`，保留函数本身。基线 `integration/ourfairy-v1` @ `42bbf89`。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/src/projection.mjs` | `messageText`、`attemptText`、`requestMessages` 去掉 `export`，改为文件内私有（`const` / `function`）。函数体、调用点、`receiptIn` 与 `transcript` 两个公开 seam 均未改。 |
| `tests/projection-interface.test.mjs`（新增，1 条） | 模块接口契约：`projection.mjs` 的公开导出名必须恰好是 `receiptIn`、`transcript`（声明式导出、`export {... }`、`export *`、`export default` 都计入公开面）。 |

行为零变化，没有新增行为断言。

## 前提核对（先核对再动手）

- `git show HEAD:backend/chat/src/projection.mjs`：`messageText` 在 :6、`attemptText` 在 :7、`requestMessages`
  在 :10 均为 `export`；与票面行号一致。
- `backend/chat/src/service.mjs:6`：仍然只 `import { receiptIn, transcript } from './projection.mjs'`。
- 全文件类型 grep（`backend/` + `tests/`，不限 `*.mjs`）：

  ```
  $ grep -rn -E 'messageText|attemptText|requestMessages' backend/ tests/ | grep -v projection.mjs
  → 无命中（改动前）
  ```

  改动后：除 `projection.mjs` 内部调用点外，唯一文本命中是新契约测试自己的名字清单
  （`tests/projection-interface.test.mjs:22`），它是断言期望、不是消费者。
- import 形态的消费者 grep：无命中。
- 结论：票面前提成立；无需 `premise-invalid`。

## 测试取舍（为什么加这一条、以及它不是什么）

票面允许「只跑全量」或「加一条轻量契约断言」。选择加一条，理由是：去掉 export 这个事实对行为完全不可见，
全量测试绿只能说明「没改坏」，不能防止后来者把三个名字重新 `export` 出去；契约测试是唯一会因接口重新变宽而
失败的可执行检查。它不是重复断言：

- 没有复制任何行为期望。文本投影的行为（`receiptIn` 的 receipt/text、`transcript` 的 attempt 文本等）
  本来就由现有 HTTP 层测试经 chat service 覆盖（如 `tests/remote-chat.test.mjs`），本次未改这些行为，也未新增这类断言。
- 期望名单来自票面的接口决定（seam 只有 `receiptIn`/`transcript`），不是从模块自身 export 列表反推。
- 为什么不直接动态 `import()` 后断言命名空间：裸 worktree 里 `projection.mjs` 的
  `@deepseek-ai/*` peer 只在 launcher 生成的 profile 里可解析，独立 import 会
  `ERR_MODULE_NOT_FOUND`。本仓已有同类先例
  `tests/conversation-search.test.mjs` 对「跨包 reach-through 这类行为测试看不见的接口事实」采用源码断言。
- 代价：一个约 30 行、无运行时代码的测试文件；不引入新抽象、不 import launcher 内部。

## Red / green

Red

```
$ node --test tests/projection-interface.test.mjs
✖ projection publishes exactly its receipt and transcript seam
  actual:   [ 'attemptText', 'messageText', 'receiptIn', 'requestMessages', 'transcript' ]
  expected: [ 'receiptIn', 'transcript' ]
ℹ pass 0 / fail 1
```

最初的 red 是去掉 export 前直接跑出的（当时的断言文案较窄，已删旧日志）；为让留存日志与最终提交
的测试完全一致，又用变异重建了一次：临时恢复 HEAD 的三处 `export` → 跑出上面的失败 → 立即还原。
还原后 `git diff` 只剩三处去 `export`，未改动函数体。

Green（去掉 export 后）

```
$ node --test tests/projection-interface.test.mjs
✔ projection publishes exactly its receipt and transcript seam
ℹ tests 1 / pass 1 / fail 0
```

## 验收

- `npm test`：最终合并状态 125/125 通过，见下。
- `npm run combo:verify`：`combo: combination verified`（最终状态；另两次中间状态
- 已知无关 flake：在 `42bbf89` 基线上的两次全量各在 `tests/pdf.test.mjs:161` 报
  `{"status":3,"error":"worker-unavailable"}`（期望 `resource-limit`），与本票改动无关，且是本仓已记录过的
  并发负载 flake（`17-pdf-text/`、`arch-49`、`arch-54` 有同名记录）。失败时机器负载为 16–22，同机另有两个票的
  `npm test`/PDF 定向测试在跑（`/proc/<pid>/cwd` 分别指向 arch-66、arch-50 的 worktree）。隔离重跑
  `node --test tests/pdf.test.mjs` 为 5/5 通过，未改 PDF 代码，未用 `--no-verify` 掩盖；
  等兄弟票的测试进程退出后全量通过（124/124）。

### 全量结果（最终合并状态：`1c95299` + 本票改动）

```
$ npm test
ℹ tests 125
ℹ suites 6
ℹ pass 125
ℹ fail 0
```

125 = 本票新增 1 条 + 合并进来的 arch-66 新增 1 条 + 原 123 条。

合并后的两次失败原文也保留，均与本票改动无关：

- `baseline-boot` 的 keyless 启动在 launcher 计算 product-source
  hash 时 `stat` 报 ENOENT `backend/identity/src/staleness-probe.mjs`。该文件是**并发**运行的
  `tests/product-sources.test.mjs` 临时创建、`finally` 删除的探针（见该测试 `:26`、`:110`、`:124`）；
  node 按文件并发跑测试，launcher 的 `readdirSync` 与删除交错就会命中。属既有测试间竞态，
  本票只新增一个只读测试，未触碰这两处。
- 全量跑到一半时 `integration/ourfairy-v1` 被别的票推进到
  `1c95299`，`lifecycle` 的 doctor 组合检查因此报 HEAD 不是集成分支 tip。合并新 tip 后重跑即通过。

## 合并与提交

- 开工第一步 `git merge integration/ourfairy-v1`：`704a1a9..42bbf89` fast-forward，无冲突、无合并提交。
- 第一次提交尝试：pre-commit 的 `npm test` 通过，但 `combo:verify` 报集成分支已在运行期间前进
  （`42bbf89` → `f360385`，arch-66 被合入），hook 失败、未生成提交。
  随后 `git stash` → `git merge integration/ourfairy-v1`（`42bbf89..f360385` ff）→ `git stash pop`。
- 全量验证期间集成 tip 又前进到 `1c95299`（arch-66 证据 pin），再次 ff 合入；最终全量在
  `1c95299` + 本票改动上通过。
- 提交时 pre-commit 在最终树上复跑 `npm test`（125/125）与 `npm run combo:verify`，均通过
- 本次提交（见报告 FINAL_SHA）。
- 未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。

## 范围外发现

`tests/product-sources.test.mjs` 会在**共享 worktree 的源码树里**临时创建/删除
`backend/identity/src/staleness-probe.mjs`，而 launcher 的 staleness hash 会遍历同一目录；并发跑测试时两者
存在竞态（上条 `baseline-boot` 失败即一次命中）。这是既有测试设计问题，修复需改该测试的探针位置或隔离方式，
超出本票范围；已保留原始失败日志，未顺手改动。
