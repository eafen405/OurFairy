> 发布权威：[#151](https://github.com/eafen405/OurFairy/issues/151)。本文件是工作副本。

## Parent

[#133 chat 的 inject 与实际依赖对齐：删残留、显式化隐性依赖](https://github.com/eafen405/OurFairy/issues/133)

## What to build

让 `@ourfairy/dsh-chat` 的 `inject` 只声明它真正依赖的服务，并在声明处写清两类例外：只用于排序的声明，以及故意保留动态读取的可选能力。

具体决定（分析记录：`work/tickets/133/README.md`）：

- 删除 `identity` 与 `tools`：投递行搬走后 chat 内没有对这两个服务的 `ctx.<name>` 引用；身份经 `ourfairySessions`、工具经 Agent 取得，二者已由保留的声明传递保证。
- `agentLoop` 保留，加注释说明它不为调用，只为让 Agent 工厂先于本行可用。
- `llm` 声明进 `inject`，图片能力检查改用已声明的服务读取。理由：该检查在带图片的回合开始时会真正调用 `resolveModelInfo`，缺席应在组合期失败，而不是等到图片轮次。
- `spillStore` 保持 `ctx.get('spillStore')` 动态读取，并在读取处注明「允许缺席」的语义：没有 spill 行就没有 spill 文件，贡献返回空；声明它会让所有 chat 路由等待一个辅助能力。
- 不新增断言 `inject` 数组字面量的测试；现有行为套件就是接缝。

## Acceptance criteria

- [ ] `inject` 不再包含 `identity`、`tools`，并包含 `llm`
- [ ] `agentLoop` 保留且有相邻注释说明其排序/工厂注册用途
- [ ] `llm` 的使用点改为已声明的服务访问；组合缺少 `llm` 时在加载期失败而不是图片轮次
- [ ] `spillStore` 仍是动态读取，读取处注释说明缺席是受支持的降级，并指向 shipped composition 的既有检查
- [ ] `ourfairyChat` / `ourfairyChatRuntime` 的公开方法集不变；gateway 与 delivery 的依赖不变；`service.mjs`、`jobs.mjs`、`units.mjs` 无行为改动
- [ ] `tests/remote-chat.test.mjs`、`tests/chat-cold-boundary.test.mjs`、`tests/chat-multi-observer.test.mjs`、`tests/jobs.test.mjs`、`tests/reconnect.test.mjs`、`tests/spill-read.test.mjs` 与 `tests/gateway.test.mjs` 的图片能力用例原样通过
- [ ] 提交说明写明删除 `identity`/`tools` 的依据，以及 `llm`/`spillStore` 两种处理的选择理由
- [ ] 证据落在 `work/implementation/evidence/133-inject-truth/01-inject.md`，含逐项审计、命令与结果

## Blocked by

None (can start immediately).
