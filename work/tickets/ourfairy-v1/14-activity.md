## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

同一会话的 Fairy 执行、未结束任务、实际结果报告与投递输出形成统一激活状态，客户端观察到连续且按会话独立的活动。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：49、50、51。

依据：[实施路线最终决议](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227)；[共同接口研究](https://github.com/eafen405/OurFairy/issues/20)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 将 Agent 执行、同会话运行/停止中的 jobs、实际待处理报告及已保存投递输出统一归并；终态任务本身不持续占用激活原因。
- [ ] Agent 已 idle 但任务仍运行时保持会话激活；任务与实际报告全部结束才静默，中间回复结束不提前关闭活动。
- [ ] 任务 settled 到报告排队/运行之间不误发静默再激活；未安排、取消或失败报告明确结算，不无限等待不存在的报告。
- [ ] 生成中到来的投递加入同次活动；静默投递是输出而不启动推理，不通过伪造 Agent.running 表达。
- [ ] 统一会话投影供 UI 状态及后续通知消费，各页面不各自猜原生事件；一个会话活动不影响另一个会话。
- [ ] 以真实事件/持久化和客户端观察验证并发原因进入/退出、两会话、断线未知态和重启对账；记录可恢复活动依据，不重复创建聊天权威。

## Blocked by

- [跨用户文字投递与单次送达恢复](https://github.com/eafen405/OurFairy/issues/34)
- [后台任务活动卡、输出与双停止](https://github.com/eafen405/OurFairy/issues/36)
