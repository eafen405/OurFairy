## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

Fairy 向指定用户编号投递文字，在收件主会话中显示普通 Fairy 消息；重试和故障恢复保持同一次送达，接收方无需启动推理。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：33、34、35、36、37、38、39、41。

依据：[用户作用域最终决议](https://github.com/eafen405/OurFairy/issues/7#issuecomment-6162548547)；[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)；[共同接口研究](https://github.com/eafen405/OurFairy/issues/20)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 投递调用只含指定收件人和正文，不增加二次分享审批，不授予收件历史读取能力，也不复制其他来源上下文。
- [ ] 使用正式非模型投递事件保留真实来源与稳定投递身份，普通 Fairy 外观不额外加转达标签；后续用户回复的模型历史包含该消息。
- [ ] live 沿同一 Session/writer，cold 沿独占写入生命周期追加；创建/恢复竞争及生成中插入保持顺序，不为投递创建推理。
- [ ] 先落盘再确认/产生可恢复通知依据；同身份重试不重复插入，日志成功而业务记录未更新可协调恢复，通知出口失败不撤销正文。
- [ ] 通过现有会话读取/订阅在 Android 看见收件消息，正在生成的 attempt 不被投递气泡替换；完整断线补页由恢复票负责，系统通知由后续通知票负责。
- [ ] 正式消息进入相关历史投影与查询提取，消费者兼容；在原生正式日志和业务库上验证 live/cold/并发/flush 失败/崩溃窗口及零收件推理。
- [ ] 采用已有文件来源策略的文字部分，不提前实现文件交付；可选文件能力由附件投递票加入同一送达流程。

## Blocked by

- [远程对话、完整回复与显式停止](https://github.com/eafen405/OurFairy/issues/28)
