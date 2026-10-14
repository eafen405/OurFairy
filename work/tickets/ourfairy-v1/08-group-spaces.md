## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

法厄同通过对话创建群组并指定群主，群主通过对话管理成员，Fairy 据当前成员资格读写群组文件。

涉及仓库：OurFairy、dsh fork；沿用 Android 对话入口。

父规格用户故事：24、27、28、29、30。

依据：[共享与空间最终决议](https://github.com/eafen405/OurFairy/issues/8#issuecomment-6163344040)；[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 持久化群组、群主及成员关系；法厄同创建并指定群主，群主仅管理自己群组成员。
- [ ] 工具注册按角色提供，实际成员变更再次核对目标群组当前资格；普通成员、他群群主和已失去资格者不能通过参数绕过。
- [ ] 成员关系进入已有空间范围接口，群组文件和脚本沿同一权限实现；法厄同未加入的群组不因管理身份自动可读。
- [ ] 群组不形成群聊，不增加专门成员管理页面；用户可在已有对话看到操作结果及稳定失败说明。
- [ ] 通过真实装配、业务库和文件/脚本路径验证添加、移除、重启恢复和越权；后续操作不能继续沿用过期工具可见性当作权限。

## Blocked by

- [私有与公有文件空间及受限脚本](https://github.com/eafen405/OurFairy/issues/30)
