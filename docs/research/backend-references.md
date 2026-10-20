> 2026-10-20 状态：现行。本文记录 2026-10-13 的判断，不描述当前实现。

# 后端骨架参考：Koishi、Open WebUI 与 LibreChat

研究票：[研究外部项目：小规模多用户与插件化后端的可借鉴设计](https://github.com/eafen405/OurFairy/issues/5)。核查日期：2026-10-13。范围是为 dsh 用户作用域与插件装配决策提供证据，不作技术栈替换决定。

## 结论

没有发现一个可以直接照搬、同时覆盖 OurFairy 全部条件的参照。三个项目分别回答不同问题：Koishi 最接近 Cordis 插件装配；Open WebUI 展示共享工具代码与用户运行参数的分离；LibreChat 展示服务端会话归属和个人模型凭据。它们均不能证明“只给 dsh 持久化插件增加用户字段就足够”，也没有证明每用户必须装配一套运行时。

对当前骨架最有用的共同点是：装配上下文、用户身份、对话上下文可以分别承载；身份由服务端提供，工具的业务参数不必让模型重复填写用户 ID。作用域如何贯穿恢复、后台执行和跨会话投递，仍需结合 dsh 源码作后续决策。

## 固定版本与选择理由

本次从官方 GitHub API 获取 HEAD，再按提交下载和阅读源文件。以下链接均固定到提交，不依赖会移动的主分支。

| 项目 | 核查提交（提交时间 UTC） | 覆盖维度 | 不覆盖或不能推定的维度 |
| --- | --- | --- | --- |
| Koishi | `97d5c395750cec37b772e0b94dc63c427e3bb868`（2026-10-08） | Cordis 插件、事件用户身份、上下文选择器、数据库服务 | 不是持久化 agent 对话系统；选择器不是文件执行隔离 |
| Open WebUI | `f8ae8a6c328946dc62cd0712961a0632574581bf`（2026-10-10） | 多用户服务端会话、共享工具实现、个人工具配置 | 插件体系不同于 dsh；管理员及共享会话规则不符合 OurFairy 原样需求 |
| LibreChat | `e1dfc10449ff713faffacd60273fddcfe2c0a698`（2026-10-06） | React 客户端/API 服务端、会话归属、个人凭据、MCP 用户上下文 | 当前版本已包含 tenant 和复杂工具策略；不适合整体移植 |

选择依据是与问题的具体匹配，不是项目热度；这些源码也不提供可用于判断 OurFairy 小用户规模资源消耗的测量。

## Koishi：插件装配 Context 与事件 Session 分开

**一手事实。** Koishi 的 `Context` 扩展 Satori Context，并安装 FilterService；插件运行环境使用 Cordis 服务机制。`FilterService.user(...ids)` 返回按事件 `session.userId` 匹配的派生 Context，`intersect/union/exclude` 组合选择范围。Session 的 `Context.filter` 实现将事件交给该过滤器；命令执行也检查 `command.ctx.filter(this)`。

- [Context 装配与服务](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/context.ts#L50-L63)
- [用户选择器与组合规则](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/filter.ts#L35-L79)
- [事件与过滤器连接](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/context.ts#L118-L130)
- [命令选择检查](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/session.ts#L413)

用户数据接口集中在数据库服务：`getUser(platform, pid, fields)`；事件 Session 的 `getUser()` 默认使用自身的 `userId`。由事件对象携带身份，插件代码可以取得当前用户数据，不必从原始传输消息自行解析。

- [数据库用户接口](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/database.ts#L17-L29)
- [Session 默认身份读取](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/session.ts#L275-L287)

**可借鉴的接口与装配思想。** “插件在哪些事件上生效”可以在装配/分发处表达，而不是给每个插件复制用户判断。事件执行对象与插件生命周期上下文不必是同一个对象。

**适用条件与不可照搬处。** Koishi Session 是消息平台的事件处理上下文，不能等同于 dsh 持久化会话。源码中的用户选择器只证明路由过滤；没有证明数据库、文件、shell 自动限制在当前用户范围，也不等同于 Cordis 同名服务隔离。

**对 dsh 的启发（推断）。** 骨架研究应分别验证“事件/运行携带身份”与“作用域提供正确服务实例”，不要用一个 Context 名称混淆二者。可以复用分发思想，但是否每用户装配会话服务仍待实证。

## Open WebUI：共享工具实现，绑定用户运行参数

**一手事实。** `Chat` 数据实体含 owner `user_id`；模型方法既有按 `id + user_id` 查询，也有集中处理访问规则的 `get_accessible_chat_by_id`。聊天读取路由从 `get_verified_user` 得到用户，再调用后一方法。它不是仅在客户端过滤列表。

- [Chat 归属字段](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/backend/open_webui/models/chats.py#L131-L139)
- [归属查询与集中访问方法](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/backend/open_webui/models/chats.py#L1885-L1946)
- [服务端读取路由](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/backend/open_webui/routers/chats.py#L1409-L1421)

工具装配 `get_tools(request, tool_ids, user, extra_params)` 使用缓存的模块实现。公共配置放在模块 `Valves`；个人 `UserValves` 按工具和用户读取，放入本次 `__user__` 参数。内部保留参数从模型可见 schema 中移除，再通过 partial 绑定到实际 callable。

- [工具缓存、公共/个人配置和参数绑定](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/backend/open_webui/utils/tools.py#L343-L427)
- [运行参数从函数签名移除](https://github.com/open-webui/open-webui/blob/f8ae8a6c328946dc62cd0712961a0632574581bf/backend/open_webui/utils/tools.py#L265-L324)

**可借鉴的接口与装配思想。** 同一工具实现可以由服务端绑定不同用户环境，模型只填工具业务参数。用户配置可以与共享模块代码分开，不必复制每个工具插件。

**适用条件与不可照搬处。** 适合比较“按次绑定运行参数”的方案。共享可变模块属性是否满足并发、后台执行和恢复需求，不能从上述接口直接推定。当前访问方法允许管理员在特定条件下读取他人或内部会话，且包含共享会话、文件夹规则；OurFairy 的法厄同没有个人内容可见性，不能原样采用该规则。工具配置的读权限也不能替代 OurFairy 文件空间与 shell 的执行范围。

**对 dsh 的启发（推断）。** 先看能否在工具/模型/会话执行入口绑定现有服务，而保持模型及普通调用方接口简洁。这是与“每用户装配服务”可比较的一条路径，不是已经选定的实现。

## LibreChat：会话归属、个人 key 与较复杂的运行上下文

**一手事实。** 服务端 `getConvo(user, conversationId)` 联合查询会话归属；请求中间件比较已认证用户与会话 owner，并将解析结果放入 `req.resolvedConversation` 供后续复用。React 客户端位于 `client/`，Express API 路由位于 `api/server/`；客户端不是会话归属的权威判断位置。

- [服务端会话查询](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/data-schemas/src/methods/conversation.ts#L754-L765)
- [入口归属判断及结果复用](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/api/server/middleware/validate/convoAccess.js#L33-L83)
- [会话实体及索引](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/data-schemas/src/schema/convo.ts#L35-L39)

个人模型 key 有客户端输入 hook；服务端 keys 路由经过 JWT 认证，使用 `req.user.id` 更新、删除或读取有效期，正文只需 key 名称、值和过期时间。这证明个人凭据可以在共享 API 基础设施中单独维护；本次没有核查全部模型供应商的凭据优先级，不能据此保证任意供应商都支持个人 key。

- [个人 key 客户端接口](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/client/src/hooks/Input/useUserKey.ts#L6-L55)
- [服务端个人 key 路由](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/api/server/routes/keys.js#L1-L42)

工具服务用 `getMCPRequestContext(req, res)` 管理本次连接，并由服务端用户构造身份上下文。但该版本同时带 tenant、OAuth、服务器权限与别名碰撞等逻辑。会话索引也含 `tenantId`，不能将它作为“小规模应用就应这样设计”的证据。

- [请求绑定 MCP/身份上下文](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/api/server/services/ToolService.js#L1034-L1063)
- [tenant 参与会话索引](https://github.com/danny-avila/LibreChat/blob/e1dfc10449ff713faffacd60273fddcfe2c0a698/packages/data-schemas/src/schema/convo.ts#L438)

**可借鉴的接口与装配思想。** 身份来自已认证上下文；同一次解析得到的会话对象可供下游复用；个人 key 与共享模型实现是两个维度。

**适用条件与不可照搬处。** 可作为已有多用户产品的具体反例和局部参考，不能移植整套请求对象传播、MongoDB 表结构或多租户层。请求上下文方案是否能自然用于无人在线的定时任务，本次所读代码没有给出答案。

## 留给骨架决策的明确问题

以下是研究产生的候选验证项，不是新的架构定案：

1. dsh 哪些接口允许在创建会话/执行时绑定用户服务，哪些实现保存装配时 Context？按用户装配与按运行绑定，分别需要替换哪些插件？
2. 一个绑定好的执行环境能否直接用于恢复会话、后台任务、工具执行和搜索，避免调用方逐处传用户参数？
3. 模型实现能否共享而凭据按用户选择，且不修改共享模块上的用户可变状态？这决定个人 key 的实际改造成本。
4. Fairy 明确选择 B、正文和附件即完成投递授权；如何沿用 dsh 接收/持久化能力，将输出纳入 B 上下文，而不携带 A 的其他上下文？这些参考项目没有提供对应的现成答案。

用户空间限制是已经确认的需求；本报告不增加跨会话投递审批、内容再分类或企业租户机制。管理权限与个人内容可见性仍按 OurFairy 已确认规则分别表达。

## 研究限制

本次是固定版本源码阅读，没有部署或性能测试，没有证明任一项目满足全部空间权限或跨用户 Fairy 投递需求。没有引入官方资料以外的架构宣传。结论中的“启发”均是对 OurFairy 的类比或推断，需由 dsh 能力研究和后续人工决策验证。
