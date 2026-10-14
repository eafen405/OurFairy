## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

手机断线或切后台后后端继续工作，恢复连接时补齐保存的历史与当前回复状态，既不漏掉内容，也不把重复事件再次插入。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：10、16、18、62。

依据：[共同接口研究](https://github.com/eafen405/OurFairy/issues/20)；[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 明确已观察事件、后端已保存截点和客户端完整消费前缀；只有实际 writer 屏障成功且范围补齐后推进可恢复消费点。
- [ ] 通过 follow 基线及向后分页固定恢复截点，补到旧前缀并去重，独立归并恢复期间到来的实时尾部；不把历史上界当成增量 after 游标。
- [ ] 恢复当前 attempt 的累计前缀并接续后续增量；临时断线不标为生成完成，不让旧快照覆盖新终态。
- [ ] 长于尾窗的断线、重复/乱代连接、部分分页失败、保存失败、账号/会话切换及迟到事件均有明确状态与可恢复行为。
- [ ] 网络连接生命周期与 Agent 生命周期解耦；显式停止仍按上一票契约工作，断线本身不取消生成。
- [ ] 以真实日志/存储、确定网络故障和 Android 同步状态验证长断线与并发尾部；提供通知后续使用的批次/消费依据，但本票不制定通知触发策略。

## Blocked by

- [远程对话、完整回复与显式停止](https://github.com/eafen405/OurFairy/issues/28)
