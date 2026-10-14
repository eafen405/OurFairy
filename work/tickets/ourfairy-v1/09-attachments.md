## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

用户在手机选择文件或图片，上传并发送给 Fairy；Fairy 通过获准文件/图片通路消费内容，用户能下载有资格的原件。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：42、43、44。

依据：[ASR/附件/PDF 研究](https://github.com/eafen405/OurFairy/issues/21)；[用户作用域最终决议](https://github.com/eafen405/OurFairy/issues/7#issuecomment-6162548547)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 完成选择、上传、完成回执、发送引用与下载的远程闭环；未完成、过期或他人引用不能作为有效消息输入。
- [ ] 原件保存于不可变存储，发送/模型读取/工具读取/下载各自核对用户与会话资格；内容哈希相同不授予读取权。
- [ ] 文本文件提供可获准读取的真实只读句柄；图片按所选模型能力进入现有官方 provider 通路，失败明确，不把所有 file 块当原生理解。
- [ ] 原始下载与模型归一化图片或派生产物分开；消息呈现能展示附件并执行有资格下载。
- [ ] 上传完成后重试发送、过期/重复回执、权限拒绝、账号切换和原件字节一致性有确定性验证。
- [ ] 真实日志、业务库、附件存储和文件范围贯穿公开接口；真实模型图片联调由最终集成票统一验收，本票提供可运行序列化/替身证据。

## Blocked by

- [私有与公有文件空间及受限脚本](https://github.com/eafen405/OurFairy/issues/30)
