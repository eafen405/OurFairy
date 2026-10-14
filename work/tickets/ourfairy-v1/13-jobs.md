## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

Fairy 启动长脚本后继续对话，用户通过活动卡/详情查看输出或停止任务；手机断线后继续执行，任务结果回原会话。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

父规格用户故事：16、17、45、46、47、48、52。

依据：[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)；[共同接口研究](https://github.com/eafen405/OurFairy/issues/20)；[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 接入既有 jobs 与受限脚本，不引入定时任务；任务始终绑定原会话身份，手机控制先核对请求者拥有该会话。
- [ ] 完成活动卡、详情、输出续取和停止任务，停止回复与停止任务操作和结果相互独立；取消观察不取消远端工作。
- [ ] 手机断线不销毁 Agent；恢复时可重建任务已知状态与原会话的最小生命周期/结果事实，不另建活动权威日志。
- [ ] 输出续取按真实字节位置和保留窗口处理重叠与缺口，不能将字符数当字节数或把终态当完整日志证明。
- [ ] 完成结果按原生配置进入原 Agent 后续上下文或实际结果报告；明确没有安排、取消或失败报告的结算，不制造永远待报告状态。
- [ ] 服务器重启或任务不存在时显示真实未知/不可用，不承诺续跑；使用实际受限子进程验证并行对话、断线、双停止、丢失输出及授权。
- [ ] 向后续统一活动票提供执行、任务和报告的明确生命周期事实；本票不新增按 jobs 来源单独发通知的政策。

## Blocked by

- [断线继续执行与持久历史补齐](https://github.com/eafen405/OurFairy/issues/29)
- [私有与公有文件空间及受限脚本](https://github.com/eafen405/OurFairy/issues/30)
