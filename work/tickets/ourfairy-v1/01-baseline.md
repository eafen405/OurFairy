## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

从可获取的固定来源启动最小 OurFairy 后端装配，形成 implement-spec 后续 worktree 共用的构建、版本组合和真实组合测试入口。此票是必要启动前置，不交付尚未适配的工具能力。

涉及仓库：OurFairy、dsh fork；记录 rikkahub 配套基线。

本票为必要构建/兼容或最终验收前置，按父规格对应实施与测试决定验收。

依据：[后端适配研究](https://github.com/eafen405/OurFairy/issues/19)；[实施路线最终决议](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 建立 OurFairy 主集成目标及各 fork 的配套来源/版本记录；新的任务工作树能取得同一组合，研究用上游 SHA 与实际产品提交明确区分。
- [ ] 通过受支持的 dsh profile/配置启动最小会话、工具注册、模型接口和持久化基础；使用隔离数据目录和外部模型替身，确认已启用服务真实就绪，不以 Loader 未抛错代替活性检查。
- [ ] 锁定后端依赖与构建环境，提供可重复的启动/停止、失败诊断和测试命令；缺必要配置明确失败，重复启动/销毁不泄漏端口或子进程。
- [ ] 尚未完成权限适配的文件、shell 和其他首版未就绪能力保持不可用，不能为让装配变绿而开放无约束默认实现；完整首版装配在后续票中逐步接入。
- [ ] 记录 Android 来源及所需工具链；不把未具备 Android 构建环境变成原生后端改造的虚假阻塞，首次 APK 构建由邀请登录票验收。
- [ ] 交付真实 profile/应用入口的无凭据启动验证与基线记录；后续跨仓库票以主集成组合为验收基准。

## Blocked by

None (can start immediately).
