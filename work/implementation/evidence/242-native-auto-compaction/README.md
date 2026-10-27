# #242 真实 profile 启用 dsh 原生自动压缩

日期：2026-10-27。票面：[`work/tickets/fairy-memory/02-native-auto-compaction.md`](../../../tickets/fairy-memory/02-native-auto-compaction.md)。
分支：`ticket/242-native-auto-compaction`；实现提交：`54181d04fc`（测试提交 `cd94ba54f9`）。
规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md) Implementation Decisions §1「模块与原生接缝」、§8「压缩行为」，User Stories 61–65。
依赖：dsh `product/ourfairy-v1` 的 `d80522d276`（#241 的绝对阈值）。

本票只做装配：在真实 OurFairy bundle 的内核段挂载 token 计量、`compaction-basic`、
工具结果裁剪与图片 offload，保留现有 spill 行，不挂 `command-compact`。
行为由真实 launcher、真实 dsh Loader、经过认证的产品会话和外部 Messages 替身共同证明；
没有手工拼装插件，也没有复制一份阈值计算。

## 改动

| 文件 | 职责 |
| --- | --- |
| `backend/v1-bundle/cordis.patch.yml` | 内核段新增 `token-meter`、`compaction-basic`（`thresholdTokens: 500000`、`retainTokens: 16000`）、`tool-result-pruner`（8192/4096/1024 字符）与 `image-offload` 四行，并写明不挂 `command-compact` 的理由 |
| `backend/v1-bundle/README.md` | 记录原生压缩装配、绝对阈值与保留预算、裁剪/offload 分工和命令压缩缺席 |
| `tests/native-compaction.test.mjs` | 6 个真实装配用例：组合读取、阈值压缩与继续回复、裁剪、图片 offload、溢出恢复、冷恢复，以及摘要不写长期记忆 |
| `tests/baseline-boot.test.mjs` | `FORBIDDEN_ROW_IDS` 增加 `command-compact`，让命令压缩面在真实启动的组合里保持缺席 |

### 为什么 `backend/v1-bundle/package.json` 不变

该 manifest 的 `dependencies` 是**产品包清单**：每个条目必须是 `file:` 指向本仓库
`backend/` 内的目录，launcher 由它派生生成 profile 的产品依赖，doctor 的
`bundle packages` 检查再与行、安装结果对照（`scripts/ourfairy-composition.ts`
的 `admitBundleDependencies`）。`token-meter`、`compaction-basic`、
`tool-result-pruner`、`image-offload` 都是锁定 dsh 安装提供的原生包，不是产品包；
把 `workspace:`/版本号写进这里会被 admission 规则拒绝。#82 挂 `llm-retry` 与 spill
行时同样只改了 patch，没有改 manifest；本票沿用同一权威。

## 关键决定

- **四行放在 `kernel`。** 该段定义「一次启动、一次模型回合仍能工作」的最小面；
  压缩、裁剪和 offload 与既有的 `llm-retry`、spill 一样属于模型回合的原生保障，
  不是可停用的产品能力。停用整个 `plugins` 段时内核仍能启动并完成一回合，
  `tests/bundle-groups.test.mjs` 继续通过。
- **阈值与保留预算是部署值，不是模型配置。** 1M 窗口的 MiniMax 路由按原生比例
  要等到 800,000 才压缩；`thresholdTokens: 500000` 把绝对值压到部署上限，
  `retainTokens: 16000` 让最近原文（含工具配对）整体保留。小幅模型窗口仍可由
  适配器容量把实际触发点压得更低，二者取最小值是 dsh #241 的既有语义。
- **裁剪预算是显式值。** 8192/4096/1024 是原生默认；写出来是为了让「模型看到多大的
  工具结果」成为本部署的决定，而不是升级 dsh 时的隐式漂移。完整原件仍在会话日志。
- **不挂 `command-compact`。** 产品没有挂载 `commands` 注册表，`/compact` 没有调用者；
  自动入口只有 `agent/pre-step` 的压力检查和 `agent/request-error` 的溢出恢复。
  命令/Typert 面因此不进入本组合，baseline 的禁止行会固定这一点。
- **图片 offload 用真实路由预算驱动。** 组合测试把 `llm-pi-ai` 的
  `maxRequestImageBytes` 用测试 overlay 降到 1 字节，让适配器像真实网关的
  request-size 上限一样在发送前报 `IMAGE_OFFLOAD_REQUIRED`；行的挂载、事件的落盘、
  重启后的重放和模型看到的占位文本都来自真实组合。部署默认仍是原生 20 MiB，
  没有为了测试收紧产品配置。
- **冷恢复用真实崩溃制造。** 在摘要请求挂起时 SIGKILL 后端，重启后会话加载追加
  `session/end-seed`；新的压缩在 end-seed 之后开启，旧的 `compaction/start`
  按原生规则被识别为上一生命周期的陈旧锁，因此不阻塞。
- **摘要不写长期记忆。** 压缩只写会话事件；负向不变量同时从两处检查：`memory.sqlite`
  的 `memories` 表为 0 行，以及模型在压缩后调用 `memory_search` 查摘要标记得到
  `matched: 0`。长期记忆存储仍然只属于记忆行。

## TDD 红绿记录

先写测试、再挂行。未挂行时的真实失败（移除 bundle 新增的 36 行后执行）：

```text
$ node --test --test-name-pattern='above the absolute ceiling' tests/native-compaction.test.mjs
✖ a session above the absolute ceiling condenses, keeps tool pairing and recent text, and continues
  AssertionError [ERR_ASSERTION]: one summarization call condenses the older span
  0 !== 1
```

组合测试的同类红色（首次运行）：

```text
✖ the shipped bundle composes native compaction and no command compaction row
  AssertionError [ERR_ASSERTION]: kernel must mount compaction-basic; it mounts ["agent","session","llm",…]
```

挂载四行后的绿色（完整文件）：

```text
$ node --test tests/native-compaction.test.mjs
✔ the shipped bundle composes native compaction and no command compaction row
✔ a session above the absolute ceiling condenses, keeps tool pairing and recent text, and continues
✔ a qualifying pressure pass prunes an oversized tool result before any summarization
✔ an image-capable route over its image budget offloads the oldest image and keeps replying
✔ a provider context-overflow rejection condenses and retries without spending the provider retry budget
✔ a cold restore ignores the stale compaction bracket of the previous lifecycle and compacts again
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

## 验证（实际运行）

工作目录 `.worktrees/242-native-auto-compaction`：

```sh
npm run build
# node scripts/tsc.ts --fresh，退出 0

node --test tests/native-compaction.test.mjs
# tests 6 / pass 6 / fail 0

node --test \
  tests/baseline-boot.test.mjs tests/bundle-groups.test.mjs tests/bundle-packages.test.mjs \
  tests/model-double.test.mjs tests/native-rows.test.mjs tests/spill-read.test.mjs \
  tests/config-contracts.test.mjs tests/docs.test.mjs
# tests 35 / pass 35 / fail 0
```

用例断言的可观察事实：

- 组合：四行在 `kernel`，`compaction-basic` 的配置正好是 500000/16000，裁剪是
  8192/4096/1024，且整个组合没有 `@deepseek-ai/dsh-command-compact`。
- 阈值压缩：provider 报告 500,000 输入 token 后，下一回合发起一次摘要调用；
  摘要输入含被压缩的最老回合、不含保留的中段；压缩后的请求带
  `<compacted-summary>`、保留中段与最新长回合原文、当前用户消息，工具调用与
  工具结果仍一一配对；回合继续回复；事件里有且仅有一组
  `compaction/start`/`compaction/summary`/`compaction/end`，摘要走
  `minimax-cn/MiniMax-M3.1-Flash`，压缩掉的 token 数 > 12000。
- 裁剪：压力合格后 `compaction/prune` 恰好一次，后续请求保留头尾、丢掉中段并带
  原生裁剪标记；因为没有剩余压力，没有摘要调用，也没有额外模型请求。
- 图片 offload：重试请求无 image block，模型看到原生占位文本；`image/offload`
  事件恰好一次且命名一个 occurrence；冷重启后选择被重放，不重复 offload。
- 溢出：拒绝一次、摘要一次、检查点重试一次；无 `llm/retry` 事件，用户请求保留。
- 冷恢复：两次 `compaction/start`，旧 bracket 与新的 `session/end-seed` 之间没有
  `compaction/end`，新压缩关闭无错误；重启后的压缩继续走真实路由。
- 长期记忆：摘要后 `memories` 表 0 行，模型查摘要标记得到 `matched: 0`。

## 未完成与风险

- **设置入口属 #243。** 本票只落默认值 500000/16000；100K–900K 的保存、校验、
  热生效和重启保留（故事 49–58）留给 #243/#247。dsh 侧字段是 volatile，
  #241 的 Loader 测试已证明保存后下一次压力判断读取新值。
- **真实 MiniMax 路由未跑。** 所有行为都由本地 Messages 替身验证；真实供应商的
  摘要质量、错误码与网关 request-size 行为没有实测。图片 offload 的触发预算在
  测试中由 overlay 降低；部署默认 20 MiB 下需要超过该大小的图片才会触发，
  本轮未用真实大图验证。
- **摘要质量未验收。** 模型替身只证明原生摘要器和路由被调用，不证明摘要内容
  对长会话的语义效果；真实模型的质量样本按规格另行验收（#248 类收口）。
- **全量门禁留给集成收口。** 未跑 `npm test` 全集与 Android `test`/`lintDebug`；
  pre-commit 已跑构建、`combo:verify` 与本次改动面的相关测试。
- **依赖 dsh 不可回退。** 若以后换回没有 #241 `thresholdTokens` 的 dsh 提交，
  `compaction-basic` 会在加载期拒绝未知配置；组合锁定在 `combo.json` 的
  `productCommit`。
