> 发布权威：[#152](https://github.com/eafen405/OurFairy/issues/152)。本文件是工作副本。

## Parent

[#133 chat 的 inject 与实际依赖对齐：删残留、显式化隐性依赖](https://github.com/eafen405/OurFairy/issues/133)

## What to build

把 `backend/chat/README.md` 改写成两类契约：**传输契约**（客户端可依赖的 HTTP/SSE 行为）与**运行时语义**（本模块在 dsh 运行时里的注册、fold、派生与降级规则）。每一节标明归属；跨两侧的条目在两侧各写自己那一半，不复制同一事实。

分析记录：`work/tickets/133/README.md` 的「README 分节映射」。要点：

- 顶部用一小段说明两类契约与阅读方式。
- 传输契约：路由与信封、投影载荷（字段与数字枚举）、分页与重连的请求/响应、后台任务端点。
- 运行时语义：投影单元、投影派生、分页/重连的服务端实现、后台任务折叠、跨用户投递、活动、工具执行路径的 spill 目录授权、服务依赖。
- 服务依赖小节写清：`inject` 只列缺了就会让 chat 契约错误的服务；`agentLoop` 仅排序；`llm` 已声明；`spillStore` 故意动态读取（缺席是受支持降级）；`identity`/`tools` 不再声明；`sessionQuery`/`systemPrompt` 的间接使用。
- `spill-read` 的注册理由写明它属于工具执行路径，不是传输逻辑。
- dsh 升级复核改成表格：每条测试/命令、归属（传输契约/运行时语义）、钉住的接缝；补上 `tests/spill-read.test.mjs` 与图片能力用例。
- 不改变路由、投影字段、数字枚举的语义；不为没有可执行检查的事实写「已保证/不会漂移」一类措辞。

## Acceptance criteria

- [ ] README 分为「传输契约」「运行时语义」两段，每节标明归属；跨两侧的条目已拆分且不重复同一事实
- [ ] 投影、分页/重连、后台任务、活动等混合内容按线上形状与运行时派生分开
- [ ] dsh 升级复核表逐条标注归属，覆盖现有测试清单、`tests/spill-read.test.mjs` 与图片能力用例
- [ ] 运行时语义写明 spill-read 属于工具执行路径及其理由
- [ ] 服务依赖小节与代码声明一致，并指向代码注释作为唯一依据
- [ ] 路由表、投影字段、数字枚举的语义未改变
- [ ] `node --test tests/docs.test.mjs` 通过，所有相对链接可解析
- [ ] 证据落在 `work/implementation/evidence/133-inject-truth/02-readme.md`，含分节映射与命令

## Blocked by

None (can start immediately). 代码票与本票并行实现同一组已定决定；若实现偏离分析记录，以分析记录为准并上报。
