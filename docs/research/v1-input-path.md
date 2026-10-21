> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# 首版输入链路：ASR、附件与 DeepSeek 官方接口

核实日期：2026-10-14。结论是静态源码及公开官方文档的兼容性研究，不是上线或付费调用验收。
未读取真实密钥、未请求模型推理或上传用户数据；未修改产品代码。
本报告属于 [研究首版输入链路：ASR、附件与 DeepSeek 官方接口](https://github.com/eafen405/OurFairy/issues/21)。

## 结论

首版语音输入有可复用的 Android 录音→后端代理转写→可编辑草稿路径，需把旧 Fairybot 实现接到 rikkahub。
语音识别凭据和对话凭据必须分开接线；旧实现的变量与模型默认值均不能原样视为当前配置。
附件保存、文本工具读取、图片模型理解、二进制交付是四种不同能力。
官方 DeepSeek 当前 Flash 支持图片，本地固定 dsh 也有相应 catalog、Messages 与 Files 通路；不能再概括为“官方仅文本”。
官方 Files 的当前文件输入仍限图片；PDF、音视频、任意二进制不能因附件上传成功就宣称模型理解。
这些事实没有迫使首版扩大 provider、引入 OCR 或撤掉附件选择/上传/下载。

## 范围与基线

权威产品边界：

- [前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)：语音输入与附件选择/上传/下载保留；TTS 不采用。
- [后端最终决议](https://github.com/eafen405/OurFairy/issues/9#issuecomment-6163738839)：共用官方 DeepSeek、不可变本地附件、按会话/用户限制、文件及脚本、投递。
- VOICE_API_KEY 是硅基流动 ASR 凭据；不是 DeepSeek 对话凭据。
- 本轮不恢复个人模型、子代理、记忆、技能、定时任务。用户后续明确不做音视频兼容；语音输入 ASR 转文字保留。用户随后选择 PDF 文字＋扫描页按需读图；原始 PDF 保留，具备视觉的官方模型为前提。具体型号、解析库和限额仍由工程落实。

固定源码：

| 项目 | 提交 | 来源 |
| --- | --- | --- |
| rikkahub | `0966502c4d65c1ee4b2a3e49a19703bb1978016c` | [源码树](https://github.com/rikkahub/rikkahub/tree/0966502c4d65c1ee4b2a3e49a19703bb1978016c) |
| Fairybot | `095efdd84fd7ab2215a0b5b03369aac4f1303108` | [源码树](https://github.com/eafen405/Fairybot/tree/095efdd84fd7ab2215a0b5b03369aac4f1303108) |
| deepseek-harness | `d743267388641bc76f17c45ce8b4c231aed1d32c` | [源码树](https://github.com/deepseek-ai/deepseek-harness/tree/d743267388641bc76f17c45ce8b4c231aed1d32c) |

主工作区的未提交 `docs/research/message-model.md` 只作阅读线索；以下关键结论重新追至固定源码。

## 事实：语音输入现有路径

rikkahub 的 ASR 状态、音频焦点、录音权限和输入框回填可以作为 UI 素材。
其 `CustomAsrState` 从设备设置选择 provider，并创建带本地 API key 的 controller。
当前 providers 是 OpenAIRealtime、DashScope、Volcengine、MiMo、Step；没有硅基流动或 OurFairy 后端代理。
因此“保留 rikkahub ASR UI”不等于“已有共用硅基 ASR 接入”。
普通输入框 ASR callback 将转写附加到录音前文本，错误由 toaster 展示；最终文本仍在输入框。
其独立 voice mode 还有服务器 VAD、语音会话及播放设计，不应因复用 ASR 而一并恢复 TTS。

来源：[ASR 状态和 controller 工厂](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/hooks/ASR.kt#L51)、[输入框回填](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/components/ai/ChatInput.kt#L344)、[provider 定义](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/speech/src/main/java/me/rerere/asr/ASRProviderSetting.kt)。

旧 Fairybot 已有更接近首版的完整一次性路径：

1. Android 查询后端可用性；用 AudioRecord 录 16kHz、16bit、单声道 PCM，封装 WAV。
2. 录音限 60 秒/1,920,000 PCM 字节；松手后才调用转写；取消或 owner 销毁会停止录音和请求。
3. 后端认证请求者，接收 `audio/wav`，限制大小并验证 WAV 结构，以 multipart 转发硅基。
4. 转写 JSON `{text}` 回到手机；草稿控制器保留录音前快照，成功成为可编辑文本，失败/取消恢复。
5. ASR 本身不提交聊天消息；用户之后发送文本才进入模型/工具循环。

旧服务每用户至多一个在途请求，全局至多两个，45 秒超时；这些是旧部署参数，不是官方上限或本轮产品决定。
旧服务在连接断开时取消 ASR；这与“已开始的 agent 推理/脚本断线继续”是不同生命周期。
没有承诺保存每次录音为聊天附件，不能据此自动引入音频归档。

来源：[录音与 WAV](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/speech/CloudSpeechRecognitionEngine.kt#L21)、[可编辑草稿状态机](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/speech/SpeechSessionController.kt#L11)、[服务端转写](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/speech.ts#L5)。

## 事实：硅基流动当前公开 ASR 契约

官方页面：[创建语音转文本请求](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)，访问 2026-10-14。
旧 `/cn/api-reference/audio/create-audio-transcriptions` 已返回页面未找到，本报告使用当前站内 API 链接。

| 项目 | 当前官方页面证据 |
| --- | --- |
| 请求 | `POST https://api.siliconflow.cn/v1/audio/transcriptions` |
| 认证 | `Authorization: Bearer {账户 API Key}` |
| 请求体 | multipart，必填 `file` 为文件对象、`model` 为模型名 |
| 公开模型 enum | `FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR` |
| 输入限制 | 时长不超过 1 小时，文件大小不超过 50MB |
| 返回 | JSON 必填 `text: string` |
| 跟踪 | 响应 `x-siliconcloud-trace-id`；可传 `X-Trace-Id` |
| 错误 | 页面列出 400/401/403/404/429/503/504 |

页面示例使用 MP3，但本次读取的当前 API 页面没有完整编码/容器支持清单。
因此旧 WAV 路径只能作为已有实现证据；当前 WAV/16kHz 接受情况仍需上线前用获授权的最小样本确认。
不把示例仅列 MP3理解为只支持 MP3，也不把旧代码的 WAV 宣称为此次已验证。
官方页面明确模型可上下线或调整；上述 enum 是文档时点，不保证某账号实际可用模型全集。

旧 Fairybot 硬编码 `XingChenAGI/XingChenASR-V3.2-Ultra`，默认读取 `SILICONFLOW_API_KEY`。
该模型不在当前公开 enum，只能结论为“当前文档未承诺”，不是证明账号实际调用必然失败。
OurFairy 应显式读取 `VOICE_API_KEY`，ASR model 为部署配置，启动时缺密钥稳定显示不可用。
建议按当前文档支持的模型配置并验证；本研究未替用户选定某一模型，未读取密钥、未调用 API。

## 事实：DeepSeek 当前输入能力与本地 provider

以下官方页面均访问于 2026-10-14，页面状态与固定源码分开记录：

- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)：`deepseek-flash` 对应 DeepSeek-V4.1-Flash，Vision 为 ✓；`deepseek-v4-pro` 对应 DeepSeek-V4-Pro-0813，Vision 为 Not supported。
- [Vision](https://api-docs.deepseek.com/guides/vision)：Flash 可接图片与文字，支持 JPEG/PNG/GIF/WebP；依据内容判断格式。
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)：用户内容可为 text、image_url、file；并非任意附件类型声明。
- [Upload File](https://api-docs.deepseek.com/api/create-file)：上传对象明确为图片；`purpose=user_data`，单图最大 64MiB。

Vision 提供内联 base64、外部 URL、Files API ID 三种方式，也明确 Anthropic `/messages` 支持对应 image/source。
这允许复用已选官方 provider，不能扩展成官方原生理解 PDF、DOCX、视频或音频。
公开 `file` 内容块指上述图片 Files，不等于 OurFairy 的一般 `file` 内容块。

当前 Vision 文档限制：请求体 48MiB；内联/URL 单图 32MiB；Files 单图 64MiB；每请求最多 600 图；
无 file_id 总图 64MiB、有 file_id 可至 200MiB；最长边 8192px，15 图及以上降为 4096px。
这些是官方最大值，不是应在手机/后端开放的默认额度；本地附件和请求投影另有更保守预算。
官方 Chat Restrictions 不接受 system/assistant 图片；本地 provider 对 user/tool 图有单独序列化规则，仍须以实际 Messages 联调验证工具图结果。

模型名是可漂移路由：官方注明 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp` 仍接受，但旧模型退休并转到最新 Flash。
版本显示名不等于可锁定的 API ID；本报告没有证据证明可用版本快照 ID 固定锁住 V4.1。
不能拿历史模型名称证明旧能力仍在，也不能把当前 Flash 支持图片套到 Pro。

本地 dsh 固定提交并非落后为文本 provider：

- default catalog 已列 `deepseek-flash`、显示 V4.1-Flash、`inputModalities=['text','image']`；Pro 默认仅文本。
- API-key provider 注册 `deepseek-official`，默认凭据引用 `DEEPSEEK_API_KEY`，在后端解析 credential/environment。
- 默认 base URL 是 `https://api.deepseek.com/anthropic`；追加 `/v1/messages`，不是 OpenAI Chat JSON 直接转发。
- 图片准备先检查模型 inputModalities 与附件服务；缺能力时报 `UNSUPPORTED_CONTENT`。
- image 序列化支持 base64/source 或 Files file_id；有 Files resolution/index、失败重试及有界内联回退。
- Files 路径使用 `anthropic-beta: files-api-2025-04-14`；原生通路仍需配置、装配和网络验收。
- 未在 catalog 的模型保守当作仅文本；替换 catalog 时必须显式保留真实能力，而非任意宣称 vision。

来源：[catalog](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/models.ts)、[model 能力](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/model-info.ts#L55)、[base URL](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/config.ts#L105)、[API key](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek-api-key/src/index.ts#L19)、[图像准备](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/images.ts#L40)、[请求适配](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/adapter.ts#L80)、[Messages headers](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/messages-api.ts)。

## 事实：附件从手机到模型/工具

rikkahub 有图片/文件选择、缓存临时副本和附件呈现素材；其设备 URI 和 UIMessagePart 不是后端附件引用。
旧 Fairybot Android 已有远程附件草稿、本地保存及上传回执路径，可作为 rikkahub 远程接线素材。
旧服务器上传分 propose→chunk→complete：完成才保存不可变对象、产生 upload ID，未完成对象不可发送。
`consumableInputs` 核对 owner、complete、未过期和对象引用；admission 再 reserve→持久消息→bound。
图片消息接纳会复核当前模型图片能力，失败返回 `image_input_unsupported`。
一般文件成为 file 块、图像成为 image 块；上传原始字节与模型用的归一化图片不可混为同一下载承诺。

来源：[rikkahub 选择](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/components/ai/ChatAttachmentPicker.kt)、[旧 Android 草稿](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/RemoteAttachmentDrafts.kt)、[上传服务](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/files.ts#L796)、[消息接纳](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/admission.ts#L480)。

当前 dsh 一般 file 在发给任何 provider 前被投影为文件名、大小和只读路径文本句柄。
不是自动读取全文；无法取得执行世界路径时明确告知模型不能声称读过。
`read` 是有界 UTF-8 文本工具；`read_image` 检查当前模型 vision 能力，再返回图像块。
CAS 存储本身不维护 OurFairy 用户/会话资格；内容 hash 相同不代表请求者有权访问。
FS/sandbox 中可读路径必须是该用户执行环境真正获准访问的路径，不能把全局 CAS 根直接开放。

来源：[文件文本投影](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/content.ts#L142)、[UTF-8 read](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/read.ts#L88)、[read_image 能力核对](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/read-image.ts#L125)、[不可变文件](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/attachment/attachment-local/src/file-store.ts)。

旧下载接口先解析当前用户主会话，再从 message ID/附件索引找 admitted input，不按裸 hash 公共读取。
OurFairy 的多会话、投递收件主会话须二次适配：核对永久会话归属和消息引用/收件资格，然后提供原始对象下载。
投递共享不可变对象可以避免复制字节，但必须产生收件方会话的资格；sender 权限不会自动变成 receiver 权限。
这承接已定投递语义，不沿用旧只主会话或自动启动收件方推理行为。
来源：[旧下载入口](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile.ts#L235)、[输入解析](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/admission.ts#L434)、[后端决议](https://github.com/eafen405/OurFairy/issues/9#issuecomment-6163738839)。

## 兼容性表

| 输入 | 保存/交付 | 工具消费 | 官方模型直接理解 | 最小适配/边界 |
| --- | --- | --- | --- | --- |
| 录音输入 | 短暂采集并代理转写；无需归档 | 无需 agent 工具 | ASR 返回文字后 DeepSeek 理解文字 | 旧云录音接 rikkahub；VOICE_API_KEY；当前 ASR model 与 WAV 验收 |
| UTF-8 文本文件 | 原始文件 CAS 与下载 | 授权路径 `read` 输出有界文字 | file 块仅文字句柄；内容要工具读取 | 执行世界只读路径、用户/会话资格 |
| JPEG/PNG/GIF/WebP | 保留原始交付与图片引用 | `read_image` 需 vision；可脚本处理字节 | 当前 Flash 可；Pro 不可 | 模型能力接到 UI/接纳；Messages/Files 联调；不自动切模型 |
| PDF/DOCX/表格 | 可存、投递、下载 | 可用已有脚本/依赖解析，具体格式不保证现成 | 当前官方 Files 不原生承诺 | 文件句柄；解析失败如实说明，不自动新增转换服务 |
| 音频/视频附件 | 通用字节保存/交付不等于格式兼容 | 用户明确不做兼容；不建设解码路径 | 不承诺 | ASR 录音转文字独立保留 |
| 任意二进制 | 可存、投递、下载 | 文件/脚本可处理字节；UTF-8 read 不等于语义解析 | 不承诺 | 支持交付；无可用解析时告知边界 |

## 建议：最小职责与验证

接口名称只是接线建议，精确字段/限额由实现落地，不是新的产品选择：

- 身份模块认证 ASR/上传/下载；手机只持 OurFairy 登录凭据，两个云 API key 留后端。
- ASR 模块提供 availability 与 transcribe；检查音频、限流/超时，返回 text 和稳定错误码，不写会话或触发 Agent。
- Android 采集、取消、文本回填并允许编辑；切账号/会话或退出输入 owner 时丢弃迟到回调。
- 附件模块提供上传回执/不可变引用和有资格的只读对象解析；会话模块保存消息引用和永久归属。
- 模型模块提供当前共用 model 能力；客户端提示与服务端接纳都使用它，模型替换时复核历史图片投影。
- FS/sandbox 适配授予附件可读路径；投递模块保存收件引用资格；下载核对收件/会话，不公开 hash。

必须在实施验收覆盖：无密钥、权限拒绝、空识别、取消/切 owner、429/503/超时、畸形 WAV；
完成上传后发消息重试、未完成/过期/其他用户回执、二次能力检查、原始下载、收件资格与越权；
Flash/Pro 对图片的不同处理、Files 过期/回退、UTF-8 read 预算、脚本不可解析与 sandbox 只读路径。
本轮未执行上述测试；语音容器和账号可用性仍需获授权样本调用，不能由静态研究证明。

## 真正需要后续决定的冲突

现有承诺只是附件选择/上传/下载，并未承诺所有附件原生多模态理解；研究没有发现必须撤销的功能。
用户追加 PDF 扫描页读图后，共用模型需选具备视觉能力的官方模型；仅文本 Pro 不能单独满足这项承诺。
具体模型型号仍需在工程路线中收束，不再把仅文本 PDF 当作待选产品边界。
不得由此研究擅自替换共用模型，尤其不能按某用户附件临时引入个人/provider 选择。
ASR 当前模型与旧模型文档缺口应由部署配置和验证收束；若坚持旧模型且账号无法使用，才需回报影响和选项。
格式转换、第三方 OCR、新 provider 和“自动转写所有媒体附件”不属于本轮闭合路径；PDF 按页文本＋扫描页读图已由用户追加确认。

## 用户追加：已采纳 PDF 文字＋扫描页按需读图

源码增量：rikkahub `PdfParser` 已用 MuPDF `PDFDocument` 逐页 `toStructuredText().asText()`，拼接 `Page N`。
`DocumentAsPromptTransformer` 在 Android 本地全文提取并塞入输入提示。可借鉴页码/文本提取，不宜将全文手机投影原样搬到后端。
这是 Android Java/native 实现，不是现成 TypeScript 后端库；后端需要自己的解析进程与依赖。
Fairybot `preview.ts` 是受控 PDF 下载及 Office→PDF 预览，不是 agent 的 PDF 内容读取；dsh fs 工具没有 PDF 解析器。
来源：[PdfParser](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/document/src/main/java/me/rerere/document/PdfParser.kt)、[全文 transformer](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/data/ai/transformers/DocumentAsPromptTransformer.kt#L15)、[旧 preview](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/preview.ts#L2)。

用户已选择文字型 PDF 提取和扫描页/图表按需视觉读取。最小路径为：

1. 后端核对会话附件资格，读取原始 PDF，返回页数和指定页有界文字，保留页码。
2. 无文本或涉及图表/排版时按需要把指定页渲染为 PNG，交给现有 `read_image` 和官方视觉模型通路。
3. 原始文件继续保存、投递和下载；解析错误、无文字及截断如实展示。

共用模型须具备 vision；当前已核实 Flash 可、Pro 不可。本研究没有替项目选择具体型号。
复杂表格/扫描页的视觉读取不保证完美文字识别或结构还原；不要声称 PDF 被原生上传理解。

推荐接口方向是窄 `pdf_info`/`pdf_read_pages`（名称示例）：输入只允许当前会话已获资格的附件和页码范围，
返回页数、选定页文本、空白/无文字提示及截断信息；视觉路线按需要另产出选定页图像。
长文件先给页数/少量样本或已有目录，再按问题选择页；不承诺未读全文的“完整概况”，不一次把全 PDF 塞上下文。
原始 PDF 仍以不可变附件保存/下载，派生文本/PNG 只是执行产物，权限和寿命沿用户执行空间落实。
加密 PDF、损坏文件、页数/资源超限和无可提取文字需要稳定失败，不自动猜密码或启用外部 OCR。

可用的具体依赖路径：文字路线可用 Python `pypdf`（官方支持逐页 `extract_text()`；不是 OCR，不能从图像提取文字）；
扩展视觉路线可用 MuPDF 的后端绑定 PyMuPDF 在指定页 `get_pixmap()` 渲染，再接 dsh 现有图像读取。
这复用的是 MuPDF 技术路径和 dsh 图片通路，仍需新增后端 PDF 适配，不能声称 Android PdfParser 直接复用。
pypdf 官方提醒单页内容流提取可大量占内存；页码分页不等于资源天然有界，需要隔离进程和实际资源限制。
PyMuPDF/MuPDF 官方为 AGPL 或商业双许可；选此依赖时核对项目发布/服务方式，报告未替项目确认许可选型。
来源：[pypdf 提取与限制](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)、[PyMuPDF 页图渲染](https://pymupdf.readthedocs.io/en/latest/recipes-images.html)、[PyMuPDF/MuPDF 许可](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright)，均访问 2026-10-14。

工具图像不应因 Chat 文档“图片仅 user role”被误判完全不兼容。所选 dsh 走 Anthropic，
`serialize.ts` 将 dsh tool 消息变成 **user role 的 tool_result，内部 content 可含 image**，不是顶层 tool role。
官方 [Anthropic 支持矩阵](https://api-docs.deepseek.com/guides/anthropic_api)（访问 2026-10-14）列 image/source 支持、
tool_result.content Fully Supported；同时明确 document 块 Not Supported，故不能直接把 PDF 塞 document 块。
静态结构与官方矩阵支持按页图路线；尚未实际调用，须验收 `read_image` 返回→tool_result 图→Flash 真正读取页内容。
来源：[工具结果序列化](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/serialize.ts#L118)。

PDF 文字＋视觉页范围已由用户确认，进入首版输入链路。该方案不增加新 provider 或第三方 OCR；
需新增后端 PDF 解析/渲染依赖与预算管理。共用官方视觉模型的具体选择、库/限额是后续工程收束事项。
音视频附件理解已经明确排除；ASR 转文字独立保留。
