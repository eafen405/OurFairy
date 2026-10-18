# 票 #44 证据：首版版本组合、真实云服务与整体验收

- 父规格：issue #23；本票：issue #44（票面 `work/tickets/ourfairy-v1/21-integration.md`）
- 执行时间：2026-10-18
- 结论：**版本组合、自动化门槛与真实 MiniMax/ASR 联调已完成；vivo S50 实机验收属 #45，
  本票保持 open 以承载真机门槛**。
  - 2026-10-18 用户决定：共用模型改用 MiniMax `MiniMax-M3.1-Flash-Preview`（dsh 自带
    `minimax-cn` 供应商、1M 上下文、`max` 思考强度），DeepSeek 暂不使用但路由保留为可切换
    备选。规格与票面已同步。
  - 真实 MiniMax 文字、PDF 扫描页图像工具结果、硅基流动 ASR 均**通过**（见第 3 节）。
  - vivo S50 实机验收属 #45，本票只交付构建与交接说明。

## 1. 版本组合

| 仓库 | 集成分支 | 锁定提交 |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `24f93e0`（MiniMax 切换；其后只新增证据） |
| dsh fork | `product/ourfairy-v1` | `fe2bbc3b`（本票无源码改动） |
| rikkahub fork | `product/ourfairy-v1` | `90c3cfc5`（#43 客户端合并） |

`node scripts/combo.mjs verify` → `combination verified`（三行 ok）。
`combo.json` 已锁定 rikkahub `90c3cfc5`；OurFairy 自身按集成分支锁定。

### 干净工作树重建

```bash
git -C /home/eafen405/projects/OurFairy worktree add --detach /tmp/ourfairy-clean-v1 integration/ourfairy-v1
cd /tmp/ourfairy-clean-v1 && OURFAIRY_HOME=/tmp/ourfairy-clean-home npm test
```

结果：**131 / 131 pass，0 fail**（7 suites，`efd09d1` 之前；加上评审修复的用例后为 **133/133**）。同一提交上 `doctor` 的 9 项检查通过。
`/tmp/ourfairy-clean-v1` 为临时检出，不随仓库保留。

## 2. 自动化门槛

| 命令 | 结果 |
| --- | --- |
| `npm test`（OurFairy） | **133/133 pass** |
| `npm run backend:doctor` | **all checks passed**（9 项，keyless） |
| `node scripts/combo.mjs verify` | **combination verified** |
| Android `:app:testDebugUnitTest` | **76 suites / 560 tests / 0 failures / 0 errors / 0 skipped** |
| Android `:app:assembleDebug` | BUILD SUCCESSFUL，3 个 debug APK |
| Android `:app:assembleRelease` | BUILD SUCCESSFUL，3 个 release APK |

Android 运行于合并后的 `product/ourfairy-v1 = 90c3cfc5`，`ANDROID_HOME=/home/eafen405/Android/Sdk`，
`-Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8" --max-workers=8 --parallel`。
计数来自 `app/build/test-results/testDebugUnitTest/TEST-*.xml` 聚合，不只看 BUILD SUCCESSFUL。

一次与 Android release 构建并发运行的 `npm test` 出现已知偶发：
`tests/pdf.test.mjs` 的资源预算用例返回 `worker-unavailable` 而非 `resource-limit`；
并发结束后单独重跑 `node --test tests/pdf.test.mjs` **5/5 pass**，全量再跑 **131/131 pass**（此后新增用例使总数为 133）。
该偶发在 T16–T19 交接中已记录，原因仍未确认；此处只记录实际现象，不声称已修复 PDF。

### release 构建产物

```bash
cd /home/eafen405/projects/rikkahub
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:assembleRelease -Pourfairy.identityEndpoint=http://172.26.211.174:3080 \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8" --max-workers=8 --parallel
```

产物复制到 `/tmp/ourfairy-v1-release/`，SHA256：

```text
d3600da1a5a256c595ff9e02f1b19fb0a8df5c78e275515606532536405030bf  app-arm64-v8a-release.apk
5da14d56e63ffdf1c5b65376302e5f0392fd3248d59be88a947c6ff8a4deb4ea  app-universal-release.apk
c2ea0de6a3b62665c3dcf7440675504ba5d0f645125d31123a344308456854f2  app-x86_64-release.apk
```

这组产物在评审修复 `505f02c2` 上重建；更早一次构建（`90c3cfc5`）的 SHA256 为
`932889dc…`/`04700285…`/`a4d248b8…`，两者签名身份相同，前者已被后者取代。

`apksigner verify --print-certs`：V2 签名，证书 `CN=Fairy, O=Fairybot`，
SHA-256 `406a2d5c63fd717febdffc65731b449aa209693eba266ea845b8e00d0be01d8e`。
这是既有本地测试签名身份，不是生产发布身份；构建内嵌的后端地址为本次整机的局域网地址
`http://172.26.211.174:3080`，换部署地址必须按上面的命令重新构建。

## 3. 真实云服务

复跑命令（ASR 密钥来自仓库根的 `.env` 文件，不提交；MiniMax 密钥由后端从操作者自己的
凭据文档解析，脚本不读取或打印密钥值）：

```bash
set -a; . ./VOICE_API_KEY.env; set +a
node scripts/real-acceptance.mjs --home /tmp/ourfairy-real-mm
```

产物：`/tmp/ourfairy-real-mm/real-acceptance.json`，`failures: []`、`unexecuted: []`。
摘要：

| 步骤 | 结果 |
| --- | --- |
| MiniMax `MiniMax-M3.1-Flash-Preview` 文字 | **通过**：经产品 `/chat/send` 得到「已收到主人这条真实链路验收消息，OurFairy 在线待命。」 |
| PDF 扫描页（真实渲染 → 图像工具结果） | **通过**：模型先 `pdf_info` 再 `pdf_render_pages`，图像工具结果经 MiniMax 视觉通路返回；对 `scan.pdf` 读出三根纯色柱的相对高度约 1:2:3、无文字/标题/图例，并声明只读了第 1 页、按像素估计 |
| 硅基流动 ASR | **通过**：同账号 TTS 合成「主人，首版真实链路验收已经完成，语音转写返回了这段文字。」→ 24 kHz 降采样为产品要求的 16 kHz PCM WAV → `POST /speech/transcriptions` → 200，返回「主人**手板**真实链路验收已经完成，语音转写返回了这段文字。」（“首版”识别为“手板”，实际结果原样记录） |

真实调用同时验证了：`minimax-cn` 路由与 `MINIMAX_CN_API_KEY` 引用、1M 上下文声明、自适应
思考（`max`）、工具调用与图像工具结果通路。DeepSeek 路由仍挂载但未参与本轮验收；用户已确认
暂不使用，其历史余额失败记录保留在下方“变更记录”。

## 3.1 变更记录（2026-10-18）

- 上一轮以官方 DeepSeek 为共用模型时，账号余额 `-0.38 CNY` 导致文字与 PDF 扫描页返回
  `Insufficient Balance`（request_id `7a140caa-…`、`8720029d-…`）。用户随后决定改用 MiniMax，
  本轮按新组合重跑并通过；该失败不再作为本票门槛，余额问题仍属该账号的客观状态。

## 4. 共用模型切换与附件能力（自动化）

`tests/gateway.test.mjs`（7 例，真实 launcher/HTTP/profile settings/凭据 seam，模型为 loopback 替身）：

- 工具暂停时切换选择：同轮续请求仍为原 model，下一轮才采用新 model（以线上请求体为准）。
- 在用路由的端点修改 409 `chat/route-in-use`，回复结束后重试成功；删除共用选择指向的路由 409。
- 保存/选择/路由/ASR 在重启后保留；启动不覆盖已保存选择。
- 图片能力检查随下一轮选模变化。

真实 MiniMax 上的文字与工具续答已在第 3 节通过；两模型切换的逐轮时序由替身用例固定（真实供应商上 A/B 两条路由同时可用不是本部署的配置）。

## 5. 双用户关键链路

后端各环节已在同一集成分支、同一次 `npm test` 中通过真实日志、业务库、查询、附件与真实子进程
验证；每一步都有独立证据目录，**但没有单个会话串行重放全部八步**：

| 链路环节 | 覆盖测试（均为真实后端/HTTP/持久化；模型为替身） |
| --- | --- |
| 注册（邀请、编号 1/2） | `tests/identity-http.test.mjs` |
| 对话与完整回复 | `tests/remote-chat.test.mjs` |
| 检索与区间读取 | `tests/conversation-search.test.mjs`（含中文、越权、管理员不例外） |
| 文件空间与受限脚本 | `tests/spaces.test.mjs` |
| 群组 | `tests/groups.test.mjs` |
| 附件 | `tests/attachments.test.mjs` |
| 后台任务 | `tests/jobs.test.mjs` |
| 跨用户投递 | `tests/text-delivery.test.mjs`、`tests/file-delivery.test.mjs`（故障窗口：失败的业务更新、flush 失败、通知出口失败） |
| 断线恢复 | `tests/reconnect.test.mjs`（含 writer 权限失败、崩溃残留 turn） |
| 活动/通知投影 | `tests/jobs.test.mjs` 的活动断言与 `tests/text-delivery.test.mjs` 的通知出口失败 |

一次额外的人工双用户探测（临时脚本，不随仓库保留）在同一后端上验证了：法厄同=1、代理人=2；
两人各自会话与回复；重启后仍能读取；群组/任务/投递请求被接受；模型替身收到 5 次请求。
该探测调用了不存在的 `/chat/search`、`/chat/receive`（检索与通知消费不是 HTTP 路由），
得到 404；这两项以命中的专项测试为准，不把 404 解释为功能失败或通过。

## 6. 75 条用户故事与验收矩阵

[user-stories.md](user-stories.md) 由父规格故事列表与票面「用户故事覆盖」生成，覆盖 #1–#75；
`tests/story-coverage.test.mjs` 断言行数/顺序/所属票与票列表派生一致、每条证据链接可解析。
规格「验收场景」表的 16 行逐项对应：

| 验收场景 | 本轮证据 | 状态 |
| --- | --- | --- |
| 法厄同配置网关 | `tests/gateway.test.mjs` 的读取/拒绝/无效输入/ASR 用例；[20-gateway](../20-gateway/README.md) | 自动化通过（模型替身、真实配置层） |
| 共用模型切换 | `tests/gateway.test.mjs` 的替身用例、在用路由与按模型范围用例；第 3 节真实 MiniMax 文字/工具续答 | 自动化与真实 MiniMax 均通过 |
| 双用户并发创建与恢复 | `tests/owned-sessions.test.mjs`、`tests/identity-http.test.mjs` | 通过 |
| 本人跨会话搜索/区间读取 | `tests/conversation-search.test.mjs` | 通过（中文、越权、管理员不例外） |
| 群组与文件/脚本 | `tests/groups.test.mjs`、`tests/spaces.test.mjs` | 通过（真实子进程/目录） |
| 投递 live/cold/生成中 | `tests/text-delivery.test.mjs`、`tests/file-delivery.test.mjs` | 通过 |
| 投递重试及故障 | 同上（业务更新失败、flush 失败、通知出口失败） | 通过 |
| 回复、jobs 与报告并行 | `tests/jobs.test.mjs` | 通过 |
| 多会话活动及通知 | [14-activity](../14-activity/README.md) 的活动投影证据；[15-notifications](../15-notifications/README.md) 与 Android `RemoteNotification*` JVM 测试 | 通过（通知为客户端投影，真机未验） |
| 长断线与并发实时尾部 | `tests/reconnect.test.mjs` | 通过 |
| 首次设备与消费记录恢复 | Android `RemoteReceiveStateTest`/`RemoteNotificationBacklogTest`；[15-notifications](../15-notifications/README.md) | JVM 通过，真机未验 |
| 附件生命周期 | `tests/attachments.test.mjs` | 通过 |
| ASR | `tests/speech.test.mjs` + 本轮真实硅基账号调用 | 替身与真实账号均通过（合成语音） |
| PDF 与官方视觉 | `tests/pdf.test.mjs`；第 3 节真实扫描页联调 | 替身与真实 MiniMax 图像工具结果均通过 |
| 流式及最终格式 | `tests/reconnect.test.mjs`、`tests/remote-chat.test.mjs`；Android presentation JVM 测试 | 通过；真机性能属 #45 |
| vivo S50 release | [device-handoff.md](device-handoff.md) | **未执行**（#45） |

唯一没有真实服务证据的行（PDF/官方视觉、MiniMax，以及共用模型切换在真实供应商上的行为）已在
上节明确列为未完成；ASR 的真实调用已完成但样本是合成的。本表由
`tests/story-coverage.test.mjs` 检查：规格验收场景表的每一行都必须在这里出现。

## 7. dsh 上游版本

本票未采用新的 dsh 上游版本，组合保持 `fe2bbc3b`（基于研究基线 `d7432673` 的 20 个产品提交）。
冻结的 `dsh-v0.2.1-rc.2`（`687f282e`）相对 `d7432673` 有 **990 个提交 / 3698 个文件**，且不包含
本产品的会话归属、正式投递消息与中文字面量子串检索扩展；升级需要把这些产品提交重新落到新基线
并重跑全部跨端证据。本轮按 ADR-0001 的「具体缺口+维护成本」评估后**没有在收尾票内做这次升级**，
也不声称已兼容 rc.2。票面「采用新的 dsh 上游版本时……」的条件门槛因此未触发；若下一轮升级，
必须按票面重验身份准入、旧会话归属与投递历史、任务终态/报告衔接和共用配置持久化。

## 8. 真机票交接（#45）

见 [device-handoff.md](device-handoff.md)：构建命令、后端地址、管理员/代理人准备、通知与性能采集步骤。
本票不声称任何 vivo S50 行为已通过。

## 9. 未完成项汇总

1. **vivo S50 实机**：属 #45，交接见 [device-handoff.md](device-handoff.md)。
2. 单一会话串行的双用户八步链：未执行；各环节已分别验收。
3. dsh 上游 rc.2 升级与重验：未执行，理由见第 7 节。
4. DeepSeek 路由：按用户 2026-10-18 决定暂不使用；其账号余额仍为负，若日后切回需先充值并重跑
   `scripts/real-acceptance.mjs` 的对应步骤（当前脚本只验收 MiniMax）。


## 10. 两轴评审与修复

`code-review` skill 在 `9975f2f...HEAD` 上跑了两轴，发现的问题与处理：

**Standards（已修）**
- 写入屏障在两次重叠写入后不会清空（`#configWrite === gate` 比较错对象）→ 改为比较实际链上的
  promise；同一数据的 `#active` 与 `state.route` 两份权威合并为只读 live session。
- 「读到的路由对象就是可写回草稿」不实 → 文档改为只发送六个字段，只读事实写回会被 400。
- `reasoningEfforts` 可写但不回读、`modelOverrides` 分支永不可达、`GatewayError.details` 未用 →
  从草稿契约与代码中删除。
- 「缺少编辑器时 editable=false+reason」不可达 → 改为缺编辑器时读取 503 并说明；只保留逐行
  `editable` 事实。
- `resolveSpeechSettings` 声称每请求复验但未做 → 现在每请求复验；`/speech` 只返回可用性与预算，
  不再向普通代理人暴露连接字段。
- `scripts/real-acceptance.mjs` 硬编码模型对与 MiniMax 草稿 → 改为读 `combo.json` 与网关
  `templates`。
- speech 重复原生凭据 seam 的环境回退 → 删除，统一经 `credentials.resolve`；网关的
  `asr.available` 与 `/speech` 现在用同一解析事实。
- 故事矩阵只校验 75 条故事、不校验验收场景 → 新增用例要求规格 16 行场景都出现在本文件。
- 真机交接与证据中的计数、未执行边界按实际重写。

**Spec（已修）**
- 共用选模只覆盖单会话 → 测试加入第二个会话、重启后从磁盘恢复的会话，以及排队消息在后续
  turn 起点重新读取选择。
- 工具续请求的「工具暂停」用的是未注册的 `mock_tool` → 改为真实 `todo_write` 调用。
- 排队图片在模型切换后被原生层投影为文字（静默降级）→ turn 起点对图片做显式检查，不兼容时
  该轮明确失败并给出原因；发送时预检仍保留。
- 「两个模型替身」措辞不实 → 改为「一个替身服务两条路由，按请求体 model 区分」。

**记录为不适用/未执行（未声称通过）**
- 「整插件重载」：网关不提供重载入口，安装/启停/装配由部署维护。
- 「凭据写入失败」：网关只写凭据引用，不写密钥值。
- 写入与新回复开始的并发时序：实现有屏障，但没有计时测试；已在文档与证据中写明。
- vivo S50 实机仍未完成（见第 3、9 节）；MiniMax 与 PDF 扫描页已真实通过，DeepSeek 按决定暂不使用。
