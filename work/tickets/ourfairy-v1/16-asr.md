## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

用户录音后通过后端硅基流动 ASR 得到可编辑文字，核对后自行发送；取消和失败不会把迟到文本写入错误草稿。

涉及仓库：OurFairy、rikkahub fork。

父规格用户故事：63、64、65。

依据：[ASR/附件/PDF 研究](https://github.com/eafen405/OurFairy/issues/21)；[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 复用已有录音、权限和草稿机制，建立认证后的后端可用性/转写入口；后端读取 VOICE_API_KEY，与对话凭据分开。
- [ ] ASR 型号与输入/超时/并发预算使用部署配置，不机械沿用当前文档未承诺的旧硬编码型号；手机不持云密钥。
- [ ] 成功返回文字到可编辑草稿，不自动提交聊天、启动 Agent、归档每次录音或开启 TTS。
- [ ] 取消、失败、账号/会话或输入归属变化后处理迟到结果，原有草稿按已定输入语义保留；不把 ASR 断开取消与已接纳后端推理继续混淆。
- [ ] 验证无密钥、权限拒绝、空结果、畸形/超限输入、429/服务错误/超时及取消；后端代理到平台替身、Android 录音/回填闭环可运行。
- [ ] 交付真实硅基账号/录音容器的最小联调场景给最终集成票，明确哪些仅通过替身，不把音视频附件理解扩入范围。

## Blocked by

- [远程对话、完整回复与显式停止](https://github.com/eafen405/OurFairy/issues/28)
