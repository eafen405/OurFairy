## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

Fairy 在已确定的文字投递中附带获准文件，收件人可阅读引用并下载原件；部分失败不能被报告为完整送达。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：33、34、35、40、43、44。

依据：[ASR/附件/PDF 研究](https://github.com/eafen405/OurFairy/issues/21)；[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 投递前核对指定源文件的可用资格并准备不可变引用；只交付显式选定内容，不增加第二次分享审批。
- [ ] 同一投递身份协调文件准备、正式会话写入和业务状态；准备失败不出现完整送达回执或半完成的收件消息。
- [ ] 收件主会话形成独立引用资格，可以下载原件并在后续回复通过获准工具读取；发送方权限不会被隐式冒用到收件方。
- [ ] 相同内容可去重存储但不公共开放；对收件方不可见的来源私有空间也不会因文件交付而整体可读。
- [ ] 历史/实时投影显示普通 Fairy 消息和附件，模型请求采用合法来源/文件句柄而非伪造 assistant 图片或模型调用信息。
- [ ] 以真实存储验证跨用户交付、无资格源文件拒绝、准备中断、落盘/业务库间故障、重试去重和原始下载字节一致性。

## Blocked by

- [附件上传、获准读取与原件下载](https://github.com/eafen405/OurFairy/issues/32)
- [跨用户文字投递与单次送达恢复](https://github.com/eafen405/OurFairy/issues/34)
