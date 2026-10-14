## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

已登录用户能在手机创建、列出、选择自己的会话并返回固定主会话；会话在后端重启后仍具有同一归属和访问范围。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：8、9、11、12、13、14、22。

依据：[用户作用域最终决议](https://github.com/eafen405/OurFairy/issues/7#issuecomment-6162548547)；[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 从可信登录身份创建并永久保存会话归属，主会话创建/绑定一致；其他会话的创建或选择不改变主会话。
- [ ] Android 会话列表、切换和返回主会话走远程接口；缓存不成为归属或历史权威。
- [ ] 列表、读取、订阅及控制入口在返回内容或执行副作用前核对归属，覆盖 live 命中与 cold 恢复/日志修复；法厄同管理身份不例外。
- [ ] 无归属或不兼容旧数据明确拒绝或按正式兼容规则处理，不默认用户 1，也不自动接管旧产品数据。
- [ ] 两个用户的上下文/状态独立；客户端已知他人会话标识、重复请求和账号切换均不能扩大访问。
- [ ] 通过真实持久化和业务库从公开接口完成创建—重启—列表/读取闭环及越权拒绝，证明必要元数据与主会话关系恢复一致。

## Blocked by

- [扩展会话归属与投递的正式记录格式](https://github.com/eafen405/OurFairy/issues/25)
- [邀请码注册、登录与单 APK 身份入口](https://github.com/eafen405/OurFairy/issues/26)
