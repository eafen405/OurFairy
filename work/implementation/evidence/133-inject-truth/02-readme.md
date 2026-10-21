# #152 README 分「传输契约 / 运行时语义」

票面：[#152](https://github.com/eafen405/OurFairy/issues/152)（父票 [#133](https://github.com/eafen405/OurFairy/issues/133)）。
分析记录：`work/tickets/133/README.md` 的「README 分节映射」、`work/tickets/133/02-readme-contracts.md`。

## 基线

| 项 | 值 |
| --- | --- |
| 开工前 worktree 基线 | `fc5ea92`（`ticket/152-readme` 起点） |
| 开工前合入的集成分支 tip | `a649a59921f95ffaa67ae7358090cd74aaca70cf`（`integration/spec-133`，含票面发布提交） |
| 提交前再次合入的集成分支 tip | `a036fb8b823b9fdcf509f4013e68f5821080a793`（含 #151 的 inject 对齐提交 `86b68b5`） |
| 分支 | `ticket/152-readme` |
| worktree | `/home/eafen405/projects/OurFairy/.worktrees/152-readme` |
| dsh 锁定 | `5b8ec0f175d3d7ba0fc7f120165d5cad6fd81aaf`（`product/ourfairy-v1`） |

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `backend/chat/README.md` | 重写为「传输契约」「运行时语义」两段，混合小节按线上形状与服务端派生拆开；dsh 升级复核改成逐条标注归属的表 |
| `docs/decisions/native-capability-dependencies.md` | 一行引用同步：`"后台任务" section` → `"后台任务折叠" section`；链接目标未变 |

没有改代码、测试、`test-support` 夹具或 `combo.json`；没有新增测试。服务依赖小节描述的是
#151 已定并已合入的声明状态（`llm` 声明、`identity`/`tools` 删除、`spillStore` 动态读取），
提交前已把含 #151 的 `a036fb8` 合入本分支，README 与代码注释一致。

## 实现的分节映射

```text
传输契约（客户端可依赖的线上行为）
  路由与信封：路由表、鉴权、错误形状、requestId/receipt、stop
  投影载荷：投影字段、messages/attempt/settledAttempt/replyStatus/error、tasks 与 activity 的字段与数字枚举
  分页与重连：maxEvents、C/L、hasMore/beforeSeq、page 请求/响应、事件合并规则、客户端三个位置
  后台任务端点：/chat/jobs/output 与 /chat/jobs/stop 的请求/响应形状

运行时语义（服务端如何产生这些值）
  投影单元：注册、fold、stateVersion/schema、inbox 所有权、transcript 行、receipt、共享状态
  投影派生：generation/version/cursor/durableThroughSeq/attempt/settledAttempt/replyStatus/error 的来源与失效
  分页与重连的服务端：观察者冻结范围、窗口只读一次、页读取、barrier/durable ACK、连续读取
  后台任务折叠：tasks fold、注册表 generation、availability、report.status、输出环、保留产品适配层的理由
  跨用户投递：deliver_message、deliveries 协调、文件准备、live/cold；行主人指向 delivery README
  活动：episode、reasons、completed/delivery 摘要及稳定性
  工具执行路径：spill 目录授权（chat 为何拥有、attachments 授权为何不适用、缺席降级）
  服务依赖：inject 规则与逐项依据

dsh 升级复核（跨两侧，逐条标注）
```

### 混合小节的拆分

| 旧内容 | 传输契约 | 运行时语义 |
| --- | --- | --- |
| 「投影」 | 字段、数字枚举、客户端可见的形状 | 「投影派生」写每个 live 值的来源与失效 |
| 「分页与重连」 | 请求/响应、C/L、hasMore/beforeSeq、合并规则、客户端消费位置 | 「分页与重连的服务端」写冻结范围、窗口只读一次、barrier/durable ACK、torn read |
| 「后台任务」 | 「后台任务端点」写两个 jobs 端点的形状；tasks 枚举归入「投影载荷」 | 「后台任务折叠」写 fold、generation、availability、report.status、输出环、适配层理由 |
| 「活动」 | 「投影载荷」写 activity 字段与枚举、摘要消费规则 | 「活动」写 episode 折叠、reasons 计算、completed/delivery 稳定性 |
| 「跨用户投递」 | —（不是 chat HTTP 路由） | 整节归运行时，并指向 delivery README |
| 「投影单元」 | — | 整节归运行时 |

## 命令与结果

全部在 `/home/eafen405/projects/OurFairy/.worktrees/152-readme` 执行。

```bash
$ node --test tests/docs.test.mjs
✔ every relative link in the repository Markdown resolves
ℹ tests 1 / pass 1 / fail 0
```

```bash
$ node --test tests/projection-units.test.mjs
ℹ tests 14 / pass 14 / fail 0

$ node --test tests/projection-fold.test.mjs
ℹ tests 3 / pass 3 / fail 0
```

这两套是 README 所述 `stateVersion`、transcript 行、tasks/activity wire 值的既有接缝；
`tests/docs.test.mjs` 验证 README 的两个相对链接（原生能力依赖记录、delivery README）可解析。

```bash
$ git diff --check
# exit 0
```

分节名与链接复核：

```bash
$ grep -nE '^## (路由|投影|后台任务)$' backend/chat/README.md
# 无输出：旧的精确标题已不存在

$ grep -nE '^##+ ' backend/chat/README.md
# 传输契约 / 路由与信封 / 投影载荷 / 分页与重连 / 后台任务端点
# 运行时语义 / 投影单元 / 投影派生 / 分页与重连的服务端 / 后台任务折叠
# 跨用户投递 / 活动 / 工具执行路径：spill 目录授权 / 服务依赖 / dsh 升级复核

$ grep -noE '\]\([^)]*\)' backend/chat/README.md
# 两个目标（去掉 Markdown 链接括号）：
# 188: ../../docs/decisions/native-capability-dependencies.md#job-output-and-stop
# 194: ../delivery/README.md

$ grep -n '后台任务折叠' docs/decisions/native-capability-dependencies.md
184:  "后台任务折叠" section of backend/chat/README.md
```

`docs/decisions/native-capability-dependencies.md` 的指针仍指向文件（不是 anchor），文件内
「后台任务折叠」小节存在；相对链接解析由 `tests/docs.test.mjs` 覆盖。

## 核对与 reconcile 的事实

- **任务 id 的组成**：原文「注册表 generation 与序号组成」，代码是
  `taskKey = ${generation}/${id}`（`src/units.mjs`），`src/jobs.mjs` 也按 generation 长度切回原生
  job id；README 改为「generation 与原生 job id」。
- **transcript 行字段**：原文写 `first` / `settled`，但 `transcriptRowSchema` 只有
  `first` 与 `transitions`，没有 `settled` 字段；结算位置由 status-only transition 表达。
  README 改为 `first` / `transitions`，保留「任意 throughSeq 可还原 seq/status」的语义。
- **「唯一后端摘要」**：原文称 activity 是「呈现与通知共用的唯一后端摘要」。没有可执行检查能
  固定「唯一」，按 `CODING_STANDARDS.md`「声称须可执行」删除「唯一」，保留「呈现与通知共用的
  后端摘要」与摘要消费规则。
- **identity/tools 的传递可用性**：分析记录写「`agents`/`agentLoop` 自己 inject `tools`」；在
  pinned dsh 中 `AgentRegistry`（`agents`）本身不声明 `tools`，是 `AgentLoop` 的
  `static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections']`
  声明了它。README 因此只写 `agentLoop` inject `tools`；`ourfairySessions` 声明 `identity`
  已在 `backend/sessions/src/index.mjs:14` 核对。
- **attempt / settledAttempt 来源**：原文只给值；运行时侧按 `runtime.mjs` 写明 attempt 来自
  native history seam 的 `assistantStream`（`needsResync` 时撤回），settledAttempt 来自
  `agent/assistant-stream` 的 committed end 帧。
- **activity.throughSeq**：`runtime.projection` 把当前 `cursor` 传给
  `tasksAndActivityAt`，不是观察者冻结的 `throughSeq`；README 在活动小节写明这一点。
- **messages 顺序**：`messages` 按首次出现顺序排列（`units.mjs` 行注释与
  `tests/projection-units.test.mjs` 的 `the transcript read at a cut keeps the frozen
  first-appearance order, not seq order`），该 wire 事实放在传输侧；运行时侧只解释
  `first`/`transitions` 的存储方式。
- **tasks 字段与枚举位置**：按分析记录的「投影载荷：字段与数字枚举」，tasks 的字段和
  status/availability/report.status 枚举放在传输侧「投影载荷」；运行时侧只写
  availability/report.status 的派生与失效。
- **升级复核表**：按分析记录的归属表标注；`chat-cold-boundary` 与 `jobs` 是跨两侧用例，表内
  写「跨两侧（运行时语义为主；含 HTTP 观察）」「跨两侧（传输契约为先；含折叠观察）」，其余
  按归属表写单侧。`reconnect` 按分析记录归传输契约。
- **指向代码注释**：`inject` 规则与 `agentLoop` 例外在 `src/index.mjs` 的声明/注释，
  `spillStore` 的动态读取与缺席语义在 `src/spill-read.mjs` 读取处注释；README 只做索引。

## 偏离分析记录

- 分析记录的升级复核表把 `chat-cold-boundary` 记为「运行时语义（含 HTTP 观察）」、`jobs` 记为
  「传输契约（含折叠观察）」。表内保留这两个主归属，并按票面要求把确实跨两侧的用例显式写成
  「跨两侧（…为主；含…观察）」；`reconnect` 仍按分析记录归传输契约。
- 额外做了一行 `docs/decisions/native-capability-dependencies.md` 的引用同步（`后台任务` →
  `后台任务折叠`），因为 README 的运行时小节按分析记录改名为「后台任务折叠」；链接目标未变。
- 未运行全量 `npm test` / `npm run combo:verify`：本票是文档改动，最终全量门禁按 spec 在 #153
  合并后的集成分支上跑。提交使用 `git commit --no-verify`，原因同 #151：与并行票的 README/代码
  改动在同一集成树上汇合，最终门禁由 #153 拥有。

## 提交与合并

- 提交信息：`docs(chat): separate transport contract from runtime semantics (#152)`。
- 提交前已把 `integration/spec-133`（`a036fb8`，含 #151）合入本分支；提交后再次
  `git merge integration/spec-133` 的结果与最终 tip 见交接报告。
- 本次提交包含 `backend/chat/README.md`、`docs/decisions/native-capability-dependencies.md`
  与本证据文件；没有代码、测试或夹具改动。
