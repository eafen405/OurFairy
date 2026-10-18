## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

2026-10-18 修订；供应商与模型验收依据[父规格](../../../docs/specs/ourfairy-v1.md)。同日后续决定：共用模型改用 MiniMax `MiniMax-M3.1-Flash-Preview`，官方 DeepSeek 暂不使用、路由保留为备选。

## What to build

把所有已完成行为纳入一个可复现的首版版本组合，完成跨模块、双用户和真实官方服务验收，形成可交给 vivo 真机票的 release 构建。

涉及仓库：OurFairy、dsh fork、rikkahub fork。

本票为必要构建/兼容或最终验收前置，按父规格对应实施与测试决定验收。

依据：[实施路线最终决议](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227)；[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)；[ASR/附件/PDF 研究](https://github.com/eafen405/OurFairy/issues/21)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 主集成分支锁定实际配套 fork 提交与构建产物；从干净工作树能重建相同组合，完整首版 profile 真实就绪，排除能力未被默认挂载。
- [ ] 采用新的 dsh 上游版本时，验证产品身份准入、旧会话归属与投递历史读取、任务终态和实际结果报告衔接，以及共用配置持久化；文本合并成功不能替代这些行为检查。
- [ ] 逐项核对父规格 75 条用户故事及验收矩阵，汇总每条对应票/证据；发现集成缺口在实际所属模块修复，不只在报告标注通过。
- [ ] 在真实日志、业务库、查询、附件和受限进程的组合上跑双用户关键链路：注册—对话—检索—文件/群组—任务—投递—断线恢复—通知；包含跨模块故障窗口。
- [ ] 完成共用 MiniMax 模型的文本和图像工具结果、PDF 扫描页通路以及硅基 ASR 账号/录音容器的最小真实联调；只用合成/获准样本，记录实际模型能力与调用结果。官方 DeepSeek 路由本轮不验收（用户决定暂不使用）。
- [ ] 核实实际 MiniMax 套餐、凭据类型及该部署的适用性，经 `llm-pi-ai` 验证所选模型的文本、工具调用和声明支持的图像工具结果；官方说明和模型能力声明不代替实际调用。跨供应商切换后覆盖既有投递历史、图片和扫描 PDF，不能把降级为未读内容记为完整成功。
- [ ] 在多会话、工具续答及冷恢复中验证共用模型切换时机；检查网关保存、在用路由拒绝修改、错误反馈及重启持久化，包含实际装配的 settings 和凭据服务。
- [ ] 凭据或外部条件缺失时具体报告并保持相关门槛未完成，不能把替身/跳过检查记作真实联调通过。
- [ ] 通过必要的各仓库构建、类型、相关回归与公共消费者兼容门槛，输出 release APK、版本组合及真实服务/自动化验收记录。
- [ ] 给真机票交付确定构建、测试账号/场景的非敏感说明、可运行的通知及性能采集步骤；实际 vivo 验收由下一票完成。
- [ ] implement-spec 的最终两轴 code-review 仍是总规格交付门槛；本票不通过提前关闭父规格或伪造评审结果替代它。

## Blocked by

- [对话建群、群主管理与群组文件访问](https://github.com/eafen405/OurFairy/issues/31)
- [Fairy 检索本人会话与按区间读取](https://github.com/eafen405/OurFairy/issues/33)
- [跨用户文件投递与收件附件资格](https://github.com/eafen405/OurFairy/issues/35)
- [后台接收、单次通知与积压合并](https://github.com/eafen405/OurFairy/issues/38)
- [语音转写为可编辑消息草稿](https://github.com/eafen405/OurFairy/issues/39)
- [PDF 扫描页与图表按需读图](https://github.com/eafen405/OurFairy/issues/41)
- [Fairy 视觉、本地偏好与长回复呈现](https://github.com/eafen405/OurFairy/issues/42)
- [法厄同配置网关与首版入口收束](https://github.com/eafen405/OurFairy/issues/43)
