## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

对于 PDF 扫描页、图表或复杂排版，Fairy 按需将指定页渲染为图片，使用已选官方视觉通路理解并保留页码。

涉及仓库：OurFairy、dsh fork；沿用 Android 附件/消息呈现。

父规格用户故事：67、68、69。

依据：[ASR/附件/PDF 研究](https://github.com/eafen405/OurFairy/issues/21)；[实施路线最终决议](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 在上一票的同一 PDF 接口和授权范围内加入指定页渲染，真实生成可读页面图像；不新建全文上传或第三方 OCR 通道。
- [ ] 页面图像接入现有 read_image/官方 Flash 能力，沿真实 provider 工具结果序列化路径保留合法角色和来源；不伪造模型历史。
- [ ] 文字页、扫描页、混合页及图表按需选择，页码和原件关联可追溯；不会将所有页面默认送入上下文。
- [ ] 渲染/图像尺寸/页数和资源预算在模块内部执行，损坏/加密/超限及部分失败可观察；不宣称视觉读取完美还原表格。
- [ ] 真实渲染与原始下载独立，派生图像不扩大用户访问范围；通过实际样本、工具结果和网络替身验证闭环。
- [ ] 提供官方 Flash 的真实图像工具结果联调样本及预期给最终集成票；未做真实调用时明确证据限度，音视频理解仍排除。

## Blocked by

- [PDF 原件保留与按页文字读取](https://github.com/eafen405/OurFairy/issues/40)
