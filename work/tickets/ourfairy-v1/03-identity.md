## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

法厄同能生成邀请，代理人在同一个 APK 注册并登录；客户端根据后端身份展示网关或对话入口，获得后续操作可用的可信身份。

涉及仓库：OurFairy、rikkahub fork。

父规格用户故事：1、2、3、4、5、7、10。

依据：[用户作用域最终决议](https://github.com/eafen405/OurFairy/issues/7#issuecomment-6162548547)；[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 持久化法厄同初始身份、编号 1、邀请与注册关系，其他短编号按注册顺序分配；并发/失败注册不造成重复身份或部分成功。
- [ ] 完成邀请生成、注册、登录和会话凭据验证的真实后端请求路径及 Android UI；邀请码注册不被当成跳过登录认证的公开访问。
- [ ] 后端从认证得出请求者，不接受客户端自选用户/管理身份；普通代理人调用邀请/管理操作被拒绝，不只隐藏界面。
- [ ] 一 APK 在同一导航组织中按身份进入可用区域；尚未交付功能显示明确未就绪且不可触发旧本地执行或系统管理路径。
- [ ] 账号切换/退出清理旧登录归属，迟到认证回调不得覆盖新账号；云模型/ASR 凭据不进入 APK。
- [ ] 完成首次 Android 构建，以及真实应用组合下合法/非法邀请、越权、重复提交和身份切换的可观察验证；无需等待会话格式票即可验收本身份闭环。

## Blocked by

- [建立可启动后端与可复现集成基线](https://github.com/eafen405/OurFairy/issues/24)
