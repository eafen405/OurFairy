## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

用户通过 Fairy 读取、写入自己的私有空间和公有空间，并运行允许联网的脚本；真实文件和子进程都遵守同一用户范围。

涉及仓库：OurFairy、dsh fork；复用 Fairybot 局部实现。

父规格用户故事：24、25、26、30、31、32。

依据：[共享与空间最终决议](https://github.com/eafen405/OurFairy/issues/8#issuecomment-6163344040)；[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 以永久会话归属计算私有/公有空间范围，实际读写及执行分别落实；公有文件直接共享，不增加逐文件审批。
- [ ] 复用 dsh 文件/脚本 Interface 和旧局部权限实现，覆盖 read/write/edit/read_image、目录 ensure/set、工具外路径解析及进程启动。
- [ ] 工作目录变化、full-access/escalation 路径或后台执行入口不得扩大用户文件范围；缺身份拒绝而非默认用户。
- [ ] 允许联网和工作所需依赖安装，网络策略与文件隔离分别验证；不新增每用户独立依赖环境的产品要求。
- [ ] 从聊天工具调用完成真实文件/脚本操作，结果可回到原会话；用户不需要直接管理后端空间目录。
- [ ] 使用两个用户、真实受限子进程和文件读写验证允许与拒绝行为，不能只用桩返回拒绝；无法运行所需内核隔离时报告未完成门槛。

## Blocked by

- [远程对话、完整回复与显式停止](https://github.com/eafen405/OurFairy/issues/28)
