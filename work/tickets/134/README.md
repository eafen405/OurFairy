# #134 组合层显式化内核与插件：实施票与任务图

父票：[#134 组合层显式化内核与插件：bundle 分组与缺席行归因](https://github.com/eafen405/OurFairy/issues/134)。
票面本体的 Web 权威在上面这个链接；本目录是工作副本，编号对应见 `published.json`。

分析记录：[`docs/research/dsh-bundle-group-composition.md`](../../../docs/research/dsh-bundle-group-composition.md)
（2026-10-21 的源码实读与离线合成实验，记录的是改动前的判断）。

## 任务图

| 文件 | 票号 | 内容 | 阻塞于 |
| --- | --- | --- | --- |
| `01-native-group-aware.md` | #159 | 原生能力检查与行删除测试不再假设扁平行表 | 无（可立即开始） |
| `02-bundle-groups.md` | #161 | 组合文件分成 `kernel` / `plugins` 两个 group | #159 |
| `03-absence-attribution.md` | #160 | 缺席行按性质分组并写明理由 | 无（可立即开始） |
| `04-closeout.md` | #162 | 收口：证据、零语义变化对照与全量门禁 | #159、#160、#161 |

先做 #159 是刻意的：`nativeCapabilityFailures` 现在只查顶层行表，把必选原生行包进 group
后 doctor 会报「required native capability missing」。这是分组的**前置条件**，不是分组的一部分。

## 分组决定

分段依据是「停掉之后基本功能是否还成立」，不是包名前缀。

**`kernel`（19 行）**：一次启动要能建立会话、跑一轮模型、并把 Web 载体和连接立起来所需的行。

```text
agent, session, llm, system-prompt, session-projection, tools,
agent-loop, agent-default-model, llm-deepseek-api-key, llm-retry,
spill-local, spill-policy, session-persistence-jsonl,
session-checkpoint-policy, session-query-sqlite, credentials,
llm-pi-ai, webserver, connection
```

**`plugins`（27 行）**：产品能力行，以及只为这些能力存在、停掉后内核仍能启动的原生工具/支撑行。

```text
identity, sessions, conversation-search, chat, delivery,
config-editor, settings, gateway,
spaces, sandbox-policy, scoped-fs, scoped-sandbox, scoped-bash, scoped-directory,
subprocess, shell-env, jobs-local, tool-todo, tool-fs, tool-working-directory,
tool-bash, tool-jobs, fs-observation-policy,
attachment-local, attachments, speech, groups
```

合计仍是 46 行；每行的 `config` 一字不改。`tool-todo`、`jobs-local`、`attachment-local`、
`config-editor`、`settings` 与各工具行虽然是原生包，但停掉它们内核仍能启动，所以归入 `plugins`。
离线实验已验证：`plugins` 整组停用后，probe 仍以 10 个内核服务 live 通过（24 个服务项中其余
为 disabled）。

## 四处对扁平行的假设

| 位置 | 现在的假设 | 改法 |
| --- | --- | --- |
| `scripts/combo.mjs` 的 `nativeCapabilityFailures` | 按顶层行建 id 表 | 建表前 `flattenEntries(rows)` |
| `scripts/combo.mjs` 的 `verifyInstalledNativeCapabilities` | 传入未展开的 `composeEntries` 结果 | 传入 `flattenEntries(...)` |
| `tests/native-capabilities.test.mjs` 的 `composedRows()` | 顶层查表/改行 | 返回展开后的行 |
| `tests/native-capabilities.test.mjs` 的 doctor 删行用例 | 用 4/6 空格缩进做字符串替换 | 用 dsh 自己的 `loadOverlayPatches` 读结构、递归删行、`entryListSchema` 写回 |

## 缺席行归因

`FORBIDDEN_ROW_IDS` 是缺席期望的唯一权威，按性质分成四段，每段一行理由：

- **暂缓（产品需要、尚未适配）**：`session-title`、`session-title-llm`。产品的会话投影没有标题
  字段，客户端也没有消费 `title` 投影单元的位置；`session-title-llm` 在 `session-title` 落地前
  没有注册目标，且辅助请求要落到产品的 `llm-pi-ai` 路由。
- **与 scoped 文件系统冲突**：`tool-fs-search`。它直接 spawn 打包的 ripgrep，二进制不在产品的
  bwrap 命名空间里；返回路径以全局 cwd 为基准，而产品 `read` 走按归属派生的 scoped 根。
- **写死排除（Remote 接缝）**：`user-questions`。它唯一的出厂应答路径是 Typert/Remote 方法，
  产品刻意不接这条接缝；产品问答走自己的路由。
- **产品明确不要 / 被 scoped 适配器取代**：skill、goal、subagent、telemetry、web、workflow、
  plan mode、MCP 资源，以及 `fs-sandbox`、`working-directory`、`bash-sandbox`、`pwsh-sandbox`、
  `tool-pwsh`、`sandbox`、`approval`、`permission` 这些原生默认行。

理由只写在名单旁的注释里；`backend/v1-bundle/README.md` 的散文不再复述分类，只保留指针。
不为 README 新增对账检查。

## 探针与 overlay 的已知语义

- probe 会多报 `kernel` / `plugins` 两个 group 行（50 行 = 46 行 + 2 group + include + probe）。
  现有断言没有按行数比较的，确认全绿即可。
- 禁用 group 行会连带禁用全部子行；group 行自身始终报告 `disabled: false`。任何「整段停用」的
  断言必须看子行状态。
- overlay 按 id 寻址已经递归进 group（`applyEntryPatches` 的索引），`tests/row-addressability.test.mjs`
  里对 `delivery` / `groups` / `scoped-*` 的用例在分组后原样通过，就是这条的检查。

## 验证

每票交付前跑相关测试；收口票在集成分支最终状态跑：

```sh
npm test
npm run combo:verify
npm run backend:doctor
```
