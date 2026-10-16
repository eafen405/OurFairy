# T16 / #39：认证后端 ASR 与可编辑录音草稿

分支：两仓 `ticket/16-asr`。Android 提交 `3426401c10379dfcbef819a7a299a60c0d0d23eb`（此文件不伪造
自身 OurFairy 提交 SHA）。不涉及 dsh 或数据库结构，不修改根集成分支。

## 实现与复用

- `backend/speech` 适配 Fairybot 固定基线 `095efdd84fd7ab2215a0b5b03369aac4f1303108`
  的 `src/server/speech.ts`；复用产品 identity 认证、connection fence、sendJson。
  WAV、限流、一次性请求断开取消沿旧路径，模型/输入/超时/并发改为部署配置，
  后端读取单独 `VOICE_API_KEY`，不触碰 DeepSeek 对话密钥。
- Android 采集复用该 Fairybot 基线 `mobile/.../speech/CloudSpeechRecognitionEngine.kt`
  的 AudioRecord PCM16/16kHz、WAV 封装与停止读操作；预算取后端可用性。
  草稿沿录音前快照附加文本的输入语义，UI 沿当前 RikkaHub Compose 组件。
- `RemoteSpeechInputState` 是输入 UI 实际调用的公开事件/状态入口；一 take 一
  source，cancel 先撤销当前 take 再取消录音/HTTP，迟到文本和 finally 均不影响
  新 take。账号/会话 epoch 沿用现有附件输入归属，由现有 `RemoteChatState`
  在转写返回时复核，Compose 输入离开时 cancel。成功只回填文字，不自动发送。
- mcode 只整理/完善 `RemoteSpeechApi.kt` 与其 HTTP 接线测试；运行任务及结果
  见 `mcode-api/`，真实 diff 已核验。没有增加 HTTP 测试依赖，沿仓库现有 JDK
  HttpServer 替身。回传通知失败，但执行退出 0，已读取结果并本地验收。

## 实际验证

| 命令 | 结果 / 原始证据 |
| --- | --- |
| `node --test tests/speech.test.mjs` | 2 通过；真实 profile/Loader/身份 HTTP + 平台替身，`backend-final.log` |
| `npm test` | 104 通过、0 失败；`npm-test-final.log`（含最后更新的 ASR 验收） |
| `npm run combo:verify` | 通过；`combo-verify.log`，票基于 OurFairy 集成 7687485，其他仓含集成基线 |
| `ANDROID_HOME=... ./gradlew :app:compileDebugUnitTestKotlin --offline --max-workers=4 -Dorg.gradle.jvmargs='-Xmx6g -Dfile.encoding=UTF-8'` | 预期 red：新公开状态入口未实现；`android-state-red.log` |
| `ANDROID_HOME=... ./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteSpeech*' --offline --max-workers=4 -Dorg.gradle.jvmargs='-Xmx6g -Dfile.encoding=UTF-8'` | 最终 BUILD SUCCESSFUL，7 测试、0 失败；`android-final.log` 和两份结果 XML |

后端覆盖无密钥、未认证、部署预算/模型与 voice-only 认证、正确转写、畸形/
超限 WAV、空结果、429/503/超时、请求取消及释放预算。Android 公开状态/平台
替身覆盖录音→结束→WAV→回填、权限拒绝、无服务、空结果、超时、取消后迟到
结果及新 owner 草稿，HTTP 覆盖 bearer/WAV 原字节/错误码传回。没有声称 JVM
替身执行了真实 Android AudioRecord。

后端初始 red/green 继承接续前留下的原始 `backend-red.log`、
`backend-keyless-green.log`、`backend-provider.log`；后续完整验证如上。
Android 初次构建发现新 worktree 的已有颜色库子模块未初始化；最终以本机
现有相同 SHA `5b3618b16fdc3825e21d5679bafd144662088ea1` 的 shared clone
准备依赖后完成上述 red/green。使用已有 SDK 与 Firebase 假配置桩；该桩
不证明 Firebase/Crashlytics 可用。不提交 local.properties 或 Firebase 桩。

## 实际限制

未执行真实硅基账号/录音容器调用、vivo 麦克风及 Compose 真机交互。本票的
平台替身、Android 编译和 JVM 状态测试均不替代这些验收。
最小真实场景交付给最终集成/真机票：`real-siliconflow-scene.md`。
最终批次合并后须由 merger 再运行 `npm test`、`combo:verify` 及阶段评审。

## T17 集成同步（2026-10-16）

T16 票分支正常 merge 最新集成 `9bf2b4f85d17140115d44dd3723e510a9d34456b`
（包含 T17 PDF 与其集成证据），自动生成合并提交
`a67ddd410b2f0a855d93295126c988e98bb2cdd4`。`scripts/ourfairy-backend.mjs`
自动合并无冲突，保留 PDF worker/wheel 源清单与 Speech 包接线；未新增功能。
Android 不变 `3426401c10379dfcbef819a7a299a60c0d0d23eb`，其集成仍为 3ee4bc26。

合并后完整 `npm test` **107/107 通过**，`npm run combo:verify` 通过，原始日志
分别为 `npm-test-after-t17-final.log`、`combo-after-t17-final.log`。

第一次在 `git merge --no-commit` 状态运行测试，106 通过、唯一 doctor 失败：
组合检查读取的是仍未包含 T17 的旧 HEAD。这是待提交合并的检查时序问题，
原始失败保留于 `npm-test-after-t17.log`。随后撤销该待提交合并并使用普通
`git merge --no-edit integration/ourfairy-v1` 正常生成合并提交，再执行上述完整
检查；未覆盖 hooksPath、未修改检查规则。证据提交继续使用正常 pre-commit。
