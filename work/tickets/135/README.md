# #135 原生语义漂移守卫：实施分析与票面

父票：[#135 原生语义漂移守卫：六处静默失败改为允许列表或响亮失败](https://github.com/eafen405/OurFairy/issues/135)。
本目录是工作副本，票号对应见 `published.json`（发布后补）。

## 这张票在解决什么

产品在六处与 dsh 原生语义平行：传输与业务规则是产品自己的，但「原生值 → 产品值」的翻译规则
各写了一遍。上游改变这些值时，产品多数情况下不会报错，而是给出一个看起来正常的错误结果。
本票只处理**上游改变后产品会静默出错**的那一类；上游改变会响亮失败的地方不在范围内。

六处按处理方式分三类：

| 处理方式 | 用于 | 为什么 |
| --- | --- | --- |
| 允许列表（构造上不可能漏） | 路由保存、输入模态 | 能改成「只覆盖产品有权写的字段」或「直接读原生列表」，就不需要维护第二份清单 |
| 改用原生入口 | 选型写入 | 原生入口已按提交顺序串行化，并保留无配置编辑器时的组合入口 |
| 测试期显式对账 + 运行期显式未知/响亮失败 | 任务状态、停止结果 | 原生值是导出**类型**而非运行时值，编译期无法保证；对账在测试期失败，运行期对未知值不再猜测 |

## 六处逐一分析

### 1. 任务状态映射

- **原生事实**：`JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'`
  （pinned dsh `5b8ec0f175`，`packages/jobs/jobs/src/view.ts`），是导出类型，不是运行时值。
- **产品现状**：`TASK_STATUS` 是手写映射；查不到时得到 `undefined`。`terminal(undefined)` 为
  false，于是可用任务的状态直接以 `undefined` 漏进投影（JSON 里字段消失），不可用任务被折成
  0；活动计算只把 `status === 0` 当作未知，`undefined` 既不算活跃也不算未知，可能把仍在执行
  的任务报告成安静。
- **失败方式**：上游新增一个状态时，终态任务不会收敛为终态；活动摘要可能在任务仍存在时报告
  安静。没有异常、没有日志。
- **守卫形式**：运行期对无法映射的状态显式报告 0（未知），活动摘要把未知当作「不可收敛」而
  不是「非终态」；测试期读取 pinned dsh 的 `JobStatus` 声明，与产品映射集合逐项对账，上游
  增删成员即失败并指出成员名。
- **上游变化时失败的断言**：`native job status vocabulary matches the projection`（票 01）。

### 2. 停止结果

- **原生事实**：`JobRegistry.kill(...)` 返回 `'requested' | 'already-finished'`（导出类型）。
- **产品现状**：`result === 'requested' ? 1 : 2`。任何非 `requested` 的返回值都被折叠成 2
  （已结束）。
- **失败方式**：上游新增第三种返回值时，手机看到「已结束」，无法区分真的结束与未知。
- **守卫形式**：只映射已知值（1/2），未知值抛产品错误并带上原始值；测试期对账原生 `kill`
  返回类型。
- **上游变化时失败的断言**：`native job stop outcome vocabulary matches the adapter`（票 02）。

### 3. 路由保存的部署字段搬运

- **原生事实**：`PiAiModelProfile` 的模型级字段里，手机可编辑的是
  `id/name/contextWindow/maxTokens/input`；`reasoningEfforts`、`compat` 由部署声明，上游还可能
  继续增加模型级字段。
- **产品现状**：`keepDeploymentFields` 硬编码搬运 `reasoningEfforts` 与 `compat` 两个字段。
- **失败方式**：上游新增第三个部署自有模型字段后，手机每保存一次路由就把它静默抹掉。
- **守卫形式**：允许列表——以先前条目为底，只覆盖手机可编辑的那一组；其它字段默认保留。
- **上游变化时失败的断言**：`a route saved from the phone keeps model fields the draft does not edit`
  （票 03）。

### 4. 选型写入

- **原生事实**：`agentDefaultModel.saveSelection(next)` 按提交顺序串行化写入，并在没有配置
  编辑器时保持组合入口（pinned dsh `packages/core/agent-default-model/src/index.ts`）。
- **产品现状**：网关直接 `settings().mutate('agent-default-model', …)`，绕过该入口，并发保存
  没有提交顺序保证。
- **失败方式**：连续两次保存时，后发的旧值可能最后落盘，用户看到旧选择。
- **守卫形式**：改用原生保存入口；保留网关自己的校验与「无配置编辑器时 503」的拒绝。
- **上游变化时失败的断言**：`consecutive selection saves commit in submission order`（票 04）。

### 5. 输入模态集合

- **原生事实**：pi-ai 目录模块导出运行时值 `MODALITIES`（`@deepseek-ai/dsh-llm-pi-ai` 的
  `src/catalog.ts` 子路径；`MODALITY_GATE` 的 `Record` 键类型是上游自己的漂移门）。
- **产品现状**：网关维护本地 `MODALITIES = new Set(['text', 'image'])`。
- **失败方式**：上游新增模态后，手机提交该模态会得到误导性的 400「不认识的模态」。
- **守卫形式**：直接导入原生列表；测试断言网关接受原生列表里的每一项。
- **上游变化时失败的断言**：`the gateway accepts every native input modality`（票 05）。

### 6. 请求幂等

- **产品现状**：`/chat/send` 的幂等只依赖 transcript 单元里的 receipts 这一份持久锚点。
- **风险**：锚点行为变化（或锚点之外的路径）可能让同标识重发变成第二条消息，而现有测试主要
  覆盖并发重试与重启。
- **守卫形式**：新增一条外部行为断言——同一请求标识连续两次发送只产生一条消息且受理序号
  相同；内容不同仍 409。
- **上游变化时失败的断言**：`the same request id sent twice in a row produces one message`
  （票 06）。

## 票与依赖

| 票 | 内容 | Blocked by | 独立提交数 |
| --- | --- | --- | --- |
| 01 | 任务状态词表：未知显式化 + 原生类型对账 | — | 1 |
| 02 | 停止结果：保留原生词表，未知响亮失败 | 01 | 1 |
| 03 | 路由保存：只覆盖手机可编辑字段 | — | 1 |
| 04 | 选型写入：走原生保存入口 | 03 | 1 |
| 05 | 输入模态：从原生列表导入 | 04 | 1 |
| 06 | 请求幂等：同标识连续重发断言 | — | 1 |
| 07 | 升级复核清单与收口 | 01–06 | 1 |

01→02 与 03→04→05 的边是**写范围边**：同一模块与同一测试文件，按仓库「每张票只写自己声明过
的写范围」的约定串行，避免并行票在同一文件里冲突；不是行为依赖。01、03、06 可同时开工。

## 范围外（照抄父票）

- 把产品路由迁移到原生 Remote 调用面。
- 合并产品与原生的分页语义。
- 主会话规则。
- 为这些守卫新增第二份需要手工同步的清单。

## 验证入口

最终集成状态必须跑 `npm test` 与 `npm run combo:verify`；票 07 负责记录。逐票的行为证据写在
`work/implementation/evidence/135-native-semantic-guards/<票号>/`。
