# #225 会话读取：完整页操作与任务身份访问

父票：[#225 会话读取：完整页操作与任务身份访问](https://github.com/eafen405/OurFairy/issues/225)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `6662bef17e`，集成分支 `integration/spec-225`。
dsh 检出 `product/ourfairy-v1` @ `d1b6099ae7`（与 [`combo.json`](../../../combo.json) 锁定一致）。

## 目标

在现有 `SessionRuntime` 内形成完整的页读取操作，并形成按产品任务标识返回任务投影与当前原生
`JobId` 的窄任务查找操作。`RemoteChat` 继续负责不可信输入、权限与 HTTP 错误映射；`jobs` 仍负责
字节偏移、输出、停止与结果映射。行为与协议保持不变，只深化 page 与任务访问两个 seam。

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-page-read.md` | [#226](https://github.com/eafen405/OurFairy/issues/226) | T1 页读取：SessionRuntime 完整页操作 | 无 |
| `02-task-lookup.md` | [#227](https://github.com/eafen405/OurFairy/issues/227) | T2 任务访问：窄任务查找与原生 JobId | T1 |
| `03-closeout.md` | [#228](https://github.com/eafen405/OurFairy/issues/228) | T3 收口：两轴评审修复、证据与全量门禁 | T2 |

T2 依赖 T1：两者都改 `runtime.ts`，且任务测试复用 T1 抽取的 fake native world helper。
T3 在 T1/T2 合入并完成两轴评审后开始。

## 约定

- 每票在自己的 worktree 里工作，分支 `ticket/<NN>-<slug>`，证据在
  `work/implementation/evidence/<NN>-<slug>/`，由 merger 合入集成分支。
- 实现与测试按 [`work/implementation/CONVENTIONS.md`](../../implementation/CONVENTIONS.md) 与
  [`CODING_STANDARDS.md`](../../../CODING_STANDARDS.md)。
- 验证节奏按 [`AGENTS.md`](../../../AGENTS.md)：实施期按改动面跑相关测试，全量 `npm test` 与
  `npm run combo:verify` 留到 T3 收口。
- 本规格不改 Android、数据库结构、projection 持久 state/stateVersion、dsh fork、bundle 行、
  路由/字段/数字编码或 SSE transport。

## 范围外

- 不增加或修改用户可见功能、路由、请求响应字段或数字编码。
- 不重构 send、receipt、checkpoint、stop、delivery、gateway 或其它 LiveSession 字段访问。
- 不迁移到 dsh Remote/Typert，不新增 dsh patch、插件行或数据库结构。
- 不新建分页或任务 module，不引入第二套任务身份、状态映射、消息 fold 或事件权威。
- 不处理 #223/#224 的 position 工作，不接管其分支、证据或交付。
