## Parent

[OurFairy 首版总规格：受邀多用户后端与 Android 客户端](https://github.com/eafen405/OurFairy/issues/23)

## What to build

用户上传 PDF 后，Fairy 可取得页数/目录或样本、选择页码读取文字并定位来源；原件仍可下载和继续追问。

涉及仓库：OurFairy、dsh fork；沿用 Android 附件与对话入口。

父规格用户故事：66、68、69。

依据：[ASR/附件/PDF 研究](https://github.com/eafen405/OurFairy/issues/21)；[实施路线最终决议](https://github.com/eafen405/OurFairy/issues/22#issuecomment-6167313227)。

执行交接：遵循父规格的 implement-spec 集成方式，在匹配的独立 worktree 中完成本票；主集成组合记录实际配套提交。测试沿已确认的真实装配/公开接口，结论附实际检查与未执行条件。仅完成本票不表示整个首版或真机验收已经完成。

## Acceptance criteria

- [ ] 通过已有会话附件资格访问 PDF，在后端解析，不将 Android 全文抽取后一次塞入提示当作实现。
- [ ] 提供页数、已有目录或少量样本及有界按页文字读取，保留页码和截断/无文字信息；未读页面不宣称已理解。
- [ ] 原始 PDF 继续通过既有不可变附件与下载能力交付；派生内容留在获准执行范围。
- [ ] 使用维护库建立可重现的解析依赖与受控执行，页码分页之外仍有实际资源预算；具体库与平台约束在票中记录。
- [ ] 损坏、加密、超限、无文字和部分解析结果明确；扫描页本票可识别并说明需读图，读图由下一票补齐，不提前声称整个 PDF 目标已完成。
- [ ] 通过真实 PDF 样本和授权工具/模型替身完成上传—指定页读取—对话页码引用—原件下载闭环，覆盖跨用户引用拒绝。

## Blocked by

- [附件上传、获准读取与原件下载](https://github.com/eafen405/OurFairy/issues/32)
