# 票 #43 证据：法厄同配置网关与首版入口收束

- 父规格：issue #23；本票：issue #43（票面 `work/tickets/ourfairy-v1/20-gateway.md`）
- 分支：`ticket/20-gateway`（OurFairy、rikkahub 各一个 worktree）
- OurFairy 合并：`9d2822c`（`integration/ourfairy-v1`）
  - `1ca230d` 网关模块、配置行挂载、ASR 行活配置
  - `8178c18` 每轮选模与在用路由保护
  - `f9926a2` 公开接口测试
- rikkahub 合并：`90c3cfc5`（`product/ourfairy-v1`），客户端实现 `b874282a`
- 依赖研究：`docs/decisions/upstream-compatibility-calibration.md`、`docs/adr/0001-upstream-extension-policy.md`

## 做了什么

后端新增 `backend/gateway`（`@ourfairy/dsh-gateway`），在 v1 profile 中挂载
`config-editor`、`settings`、`llm-pi-ai`（无路由的休眠适配器）与 `gateway` 行。`/gateway/*`
只允许法厄同调用，读写全部落在 dsh 活动 profile：

- `agent-default-model`：共用选模。所有会话在各自 turn 开始时读取一次并固定到该 turn 结束，
  工具调用后的续请求仍用原模型；正在执行的回复不切换。
- `llm-pi-ai` 的 `providers`：自定义供应商与模型（端点、协议、模型清单、输入模态、凭据引用）。
  改路由级字段影响该路由全部模型；只改某模型项时只影响该模型。被正在运行的回复使用的路由
  返回 409 `chat/route-in-use`，删除共用选择指向的路由返回 409 `gateway/route-selected`。
  写入与新回复开始相互协调：写入期间开始的回复等提交后再读选择与路由。
- `speech`：ASR 连接（model/endpoint/limits/凭据引用），字段设为 volatile，下一次录音即读取新值；
  语音密钥改为经原生凭据 seam 解析。
- 附件图片能力检查读取与下一 turn 相同的共用选模来源（`agentDefaultModel.currentSelection()`）。

网关不建自己的配置表；密钥值不经过网关，路由只携带凭据引用，读取只报告是否已配置。
缺少配置编辑器/相应行时读取返回 `editable.*=false` 与原因，写入返回 503
`gateway/configuration-unavailable`。

## 实际命令与结果

以下命令在合并后的 `integration/ourfairy-v1`（`9d2822c`）上执行。

| 命令 | 结果 |
| --- | --- |
| `node --test tests/gateway.test.mjs` | **7/7 pass** |
| `node --test "tests/**/*.test.mjs"` | **129/129 pass**（基线 122 + 本票 7） |
| `node scripts/ourfairy-backend.mjs doctor` | **all checks passed**（9 项；keyless） |
| `node scripts/combo.mjs verify` | **combination verified**（ourfairy 基于集成分支；dsh/rikkahub 按组合锁定） |
| `git diff --check` | 通过 |

`tests/gateway.test.mjs` 覆盖（全部走真实 launcher、真实 HTTP、真实 profile settings/凭据 seam；
模型是 loopback Messages 替身）：

1. 匿名 401 / 普通代理人 403 覆盖全部 5 条管理路由；管理员读取初始状态；官方 DeepSeek 路由
   不可改写；MiniMax 模板可用；保存路由与选模；删除共用选择指向的路由被拒；
   保存 ASR；重启后选择、路由、ASR 与 `saved` 标志保留，模板不再重复出现。
2. 无效选模（未知 provider/未知 model）、无效路由（非法 provider id、非 http(s) 端点、
   空模型清单、未知模态、未知字段、改写官方路由）、未知路由删除、非法 ASR → 400/404 且
   `saved` 全部保持 false（没有半写入）。
3. 两个模型替身观察线上请求体：首请求 + 工具暂停 + 切到另一模型 + 同轮续请求仍为原 model；
   下一轮请求才采用新 model。
4. 附件能力检查跟随下一轮选模：选纯文本路由时图片发送被 400 `attachments/image-unsupported`
   拒绝；切回支持图片的路由后同一图片被接受。
5. 正在运行的回复所用路由：改端点 409 `chat/route-in-use`、删除选择指向路由 409
   `gateway/route-selected`；回复结束后同一修改成功。
6. ASR 行保存后，`/speech` 立即读回新限制与新 model（同一行、同一来源），不重启。
7. probe 报告 `settings`、`config-editor`、`llm-pi-ai`、`gateway` 行组合且
   `settings`/`configEditor`/`agentDefaultModel`/`ourfairyChat`/`ourfairyGateway` 服务 live。

## 配置结构与数据变化

无数据库结构变化。新增/改变的是 dsh profile 行与活动 profile 的用户层文件：

- 组合新增行：`config-editor`、`settings`、`llm-pi-ai`、`gateway`。
- 保存的配置写入 `<OURFAIRY_HOME>/dsh-home/profiles/ourfairy/cordis.patch.yml`；重启不覆盖。
- `speech` 行新增 `apiKeyEnv`（默认 `VOICE_API_KEY`），其余连接字段改为 volatile。
- `combo.json` 的 `agentModelNote` 改为说明「初始值」与运行时保存选择的关系；`doctor` 的
  `bundle agent model` 仍只核对组合声明，不覆盖已保存选择。

## 未执行 / 边界

- **真实 MiniMax 调用未执行**：本机没有 MiniMax 凭据（已查环境、仓库 `.env` 与
  `.ourfairy/dsh-home/.credentials.yaml`），因此「实际套餐/凭据适用性」留给 #44 具体报告，
  本票只验证配置路径与引用状态。模板中的模型与图片模态是可编辑草稿，不是能力声明。
- **Android 客户端**：见下节；模拟器/真机未运行。
- 网关不提供插件安装/启停/装配（由部署维护），也不提供 dsh Web 设置界面。
- 模型替身不等于真实供应商；真实官方 Flash 与 MiniMax 的调用属 #44。

## 客户端（rikkahub）

客户端实现 `b874282a`，合并 `90c3cfc5`：

- `IdentityAccessPolicy`：`GATEWAY` 进入 DELIVERED，`mayCompose` 只允许 `isAdmin`；普通代理人
  没有可组合的页面，不是隐藏按钮。`CONVERSATION` 仍不交付（远程对话走 sessions 页）。
- `RouteActivity`：`Screen.Gateway` 映射到 `GATEWAY`、注册页面入口；账户页在邀请块上方给
  管理员一个入口。映射函数改为 `internal` 以便测试。
- `GatewayPage` / `GatewayApi` / `GatewayState` / `GatewayEditing`：读取共用选模、路由与 ASR；
  选择模型、增删改路由、编辑 ASR；写入后重新读取，不信任回显；失败原样显示后端 code/message
  （含 `gateway/route-in-use`、`gateway/route-selected`、`gateway/forbidden`）；凭据只显示
  环境变量名，没有任何密钥输入框。在用路由禁用编辑并说明原因。
- 客户端按「扁平 route 草稿 + `gateway` 包装的读取」契约实现，后端在 `45f7c93` 对齐同一契约。

实际命令与结果（`ANDROID_HOME=/home/eafen405/Android/Sdk`；在合并后的
`product/ourfairy-v1` = `90c3cfc5` 上执行）：

| 命令 | 结果 |
| --- | --- |
| `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.Gateway*' --tests 'me.rerere.rikkahub.ui.identity.*'` | BUILD SUCCESSFUL；GatewayApiTest 9、GatewayStateTest 10、GatewayEditingTest 4、IdentityAccessPolicyTest 7、ScreenIdentityDestinationTest 3，0 失败 |
| `./gradlew :app:testDebugUnitTest :app:assembleDebug` | **BUILD SUCCESSFUL**；XML 聚合 **76 suites / 560 tests / 0 failures / 0 errors / 0 skipped**；3 个 debug APK |
| `./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=http://172.26.211.174:3080` | 见 [21-integration](../21-integration/README.md) 的 release 记录（签名宿主不在本票范围，构建入口相同） |

构建准备（均不提交）：工作树缺 `local.properties`、`google-services.json`（假 key 桩）、
`material3` 子模块与 `web-ui/node_modules`；已按 CONVENTIONS §3 准备。Firebase 桩不代表
Firebase/Crashlytics 可用。

## 验收边界（客户端）

- 未运行模拟器/真机，Compose 的禁用/可见状态是代码审查 + gate/mapping 测试；
  授权由后端与 gate 双重保证。
- 未连接真实 dsh 后端的 Android 端到端；`GatewayApiTest` 用真实 loopback HTTP 服务器
  固定 wire 形状与拒绝码。
- 真实模型/供应商调用、release 设备票在 #44/#45。
