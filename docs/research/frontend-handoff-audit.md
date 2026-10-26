> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# 前端 wayfinder 交接与既有结论审核

2026-10-14。审核对象：[交接](https://github.com/eafen405/OurFairy/blob/902bc11a0f12fe936bde430b1b11ba06719b0d06/work/handoff/grilling-10-frontend-boundary.md)、关联研究、GitHub 当前议题与 resolution，以及本轮用户重新提供的功能表。只审核规划，不实施功能或重新代替用户选择。

## 总体判断

前后端职责、多用户会话归属、断线继续执行、持久补取及尽力后台提醒的方向，与 GitHub 最终决议一致，可以保留。交接把若干推断写成事实、把未定 UI 写成已定，并遗失了功能表；因此不能依交接的“事实层已稳”“只需 Q4/Q5 后清空地图”直接收束。

技术问题已分开追溯一手依据：[Android/vivo 审计](android-notification-audit.md)、[dsh 源码复核](dsh-event-consumption-audit.md)。这些纠正不自动更改已确认产品选择。

## 记录与决策漂移

| 原表述 | 审核与处理 |
| --- | --- |
| jobs 与 schedule 首版都纳入 | 错误。jobs 纳入，定时任务排除；以后端 resolution 为准 |
| 长任务 = 会话 banner + 完成通知，已经决定 | 决议确认状态/输出/控制与结果报告；没有锁定 banner，也未完整规定系统通知触发时机。恢复为待选 UI |
| Q2 完整 18 项表存在指定 brief | 当时文件没有该表，临时 worktree 及 draft 也不存在。用户本轮已重新提供，现保存到边界讨论稿 |
| 代理人完全不能管理群组 | 原表只排除了入口，却与群主管理成员的规则存在歧义。本轮用户明确经 Fairy 对话管理，按角色开放工具并落实变更资格 |
| 主动消息/生成通知都追加主会话 | 过度泛化。跨用户投递进入收件主会话；当前会话生成与 jobs 反馈仍属于原会话 |
| 主会话切换 | 按固定主会话定义，应指切回它的导航，不是改变主会话身份 |
| 邀请码登录现成可用 | 旧业务可作适配素材；既有决议没有保证其能原样接入新多用户后端，更不能把 dsh 单 operator cookie 当作完整产品身份系统 |
| S3/WebDAV 与多用户不兼容 | 排除是已选范围；“天然不兼容”缺证据，不用它论证取舍 |
| 每票都在地图的原生关系中 | 当前地图子议题只有“前端 fork 模块价值研究”与“确定前端首版边界”；rikkahub 架构研究仅在正文中链接。后者已关闭，不影响现票可工作；交接声称的阻塞边未存在于现票原生依赖中 |
| 前端地图可直接清空并宣告 ready | 尚有通知、呈现与契约待决；地图正文“未分配”也已过时。须按实际讨论修订，不能提前完结 |

## 本轮有效产品澄清

恢复表及解释见[前端首版边界讨论稿](../decisions/frontend-v1-boundary.md)。用户明确排除图片生成与语音输出；群组作为文件空间范围，通过 Fairy 对话管理。工具注册按角色提供，成员变更核对当前用户对目标群组的管理资格，不能只依赖模型遵从工具描述。

## 对技术事实的结论

- 原生 dsh stream 用 WebSocket，unary RPC 用 HTTP；原报告的“单传输”说法错误。
- 历史 page 的 throughSeq 是快照上界，向后分页；不是 afterSeq 增量补取。当前 assistant attempt 可在重连时恢复累计 stream 前缀；不能一概说断线内容丢失。
- jobs 的字节 offset 续取有环形缓冲保留范围，可能 lossy；原生单 operator 与 job→session 检查不能代替登录用户→session 授权。
- Android 普通回收、Task Manager Stop、设置 Force Stop 必须分开；Doze 维护窗口恢复联网，FGS 本身不自动豁免，电池优化豁免另有作用。
- dataSync 6h 需说明 Android/target 版本、后台计时及前台重置条件；也未因此选定本产品的服务类型。
- vivo 未上架缺正式推送资格，不等于不存在受限测试；不改变用户当前不采用厂商推送的选择。
- vivo 本地通知分类/备案规则是此前遗漏的验收因素，对当前自用 APK/ROM 的实际影响尚未证实；不能保证仅开通知权限即可横幅、锁屏或响铃。

## 权威引用与边界

- [确定共享与限制：能力在何处按用户提供](https://github.com/eafen405/OurFairy/issues/8#issuecomment-6163344040)
- [确定后端最小装配：选用、替换与新增插件](https://github.com/eafen405/OurFairy/issues/9#issuecomment-6163738839)
- [确定前端首版边界：功能取舍与后端契约](https://github.com/eafen405/OurFairy/issues/10)
- [前端改造与剪枝：rikkahub 客户端与法厄同网关](https://github.com/eafen405/OurFairy/issues/2)

没有真机测试、Android 构建、产品兼容验证或完整安全审计。未提交工作稿，未关闭决策票。
