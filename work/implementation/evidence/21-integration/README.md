# 票 #44 证据：首版版本组合、真实云服务与整体验收

- 父规格：issue #23；本票：issue #44（票面 `work/tickets/ourfairy-v1/21-integration.md`）
- 执行时间：2026-10-18
- 结论：**版本组合与自动化门槛已完成；真实官方模型门槛未通过，本票不能关闭**。
  - 官方 DeepSeek 账号余额为 **-0.38 CNY**，真实请求返回 `Insufficient Balance`；
    因此「官方 Flash 文本 + 图像工具结果」「PDF 扫描页真实联调」两项未完成。
  - MiniMax 无凭据（环境、仓库 `.env`、`.credentials.yaml` 均无），未发起真实调用。
  - 硅基流动 ASR 真实调用**通过**（合成语音，非真人录音）。
  - vivo S50 实机验收属 #45，本票只交付构建与交接说明。

## 1. 版本组合

| 仓库 | 集成分支 | 锁定提交 |
| --- | --- | --- |
| OurFairy | `integration/ourfairy-v1` | `f1f8aeb`（本文件提交前的分支 tip；本文件只新增证据，不改产品代码） |
| dsh fork | `product/ourfairy-v1` | `fe2bbc3b`（本票无源码改动） |
| rikkahub fork | `product/ourfairy-v1` | `90c3cfc5`（#43 客户端合并） |

`node scripts/combo.mjs verify` → `combination verified`（三行 ok）。
`combo.json` 已锁定 rikkahub `90c3cfc5`；OurFairy 自身按集成分支锁定。

### 干净工作树重建

```bash
git -C /home/eafen405/projects/OurFairy worktree add --detach /tmp/ourfairy-clean-v1 integration/ourfairy-v1
cd /tmp/ourfairy-clean-v1 && OURFAIRY_HOME=/tmp/ourfairy-clean-home npm test
```

结果：**131 / 131 pass，0 fail**（7 suites）。同一提交上 `doctor` 的 9 项检查通过。
`/tmp/ourfairy-clean-v1` 为临时检出，不随仓库保留。

## 2. 自动化门槛

| 命令 | 结果 |
| --- | --- |
| `npm test`（OurFairy，干净工作树） | **131/131 pass** |
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
并发结束后单独重跑 `node --test tests/pdf.test.mjs` **5/5 pass**，全量再跑 **131/131 pass**。
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
932889dc9a390c58cddb5210a4aaf205904f08aa396116899567d07710a58fa1  app-arm64-v8a-release.apk
047002854ac1f4e27ae4fbda817fb5f92792ec96458d3d312595fa2591f003eb  app-universal-release.apk
a4d248b8a3b952b1cd19cf127f996e65435529ffe66e2bdf1f8ba6175e271744  app-x86_64-release.apk
```

`apksigner verify --print-certs`：V2 签名，证书 `CN=Fairy, O=Fairybot`，
SHA-256 `406a2d5c63fd717febdffc65731b449aa209693eba266ea845b8e00d0be01d8e`。
这是既有本地测试签名身份，不是生产发布身份；构建内嵌的后端地址为本次整机的局域网地址
`http://172.26.211.174:3080`，换部署地址必须按上面的命令重新构建。

## 3. 真实云服务

复跑命令（密钥来自仓库根的两个 `.env` 文件，不提交）：

```bash
set -a; . ./DEEPSEEK_API_KEY.env; . ./VOICE_API_KEY.env; set +a
node scripts/real-acceptance.mjs --home /tmp/ourfairy-real-2
```

脚本逐步记录，任一步失败不阻断其余步骤；原始 JSON 在
`/tmp/ourfairy-real-2/real-acceptance.json`。摘要：

| 步骤 | 结果 |
| --- | --- |
| 官方 DeepSeek Flash 文本 | **失败（外部条件）**：`"Insufficient Balance (request_id: 7a140caa-…)"`；`GET /user/balance` 返回 `is_available:false`，`total_balance:-0.38` CNY |
| PDF 扫描页（真实渲染 → 官方图像工具结果） | **未完成**：同一余额错误（request_id `8720029d-…`），`pdf-flash-smoke.mjs` 在首个模型响应即退出 |
| 硅基流动 ASR | **通过**：同一账号 TTS 合成「主人，首版真实链路验收已经完成，语音转写返回了这段文字。」→ 24 kHz 降采样为产品要求的 16 kHz PCM WAV → `POST /speech/transcriptions` → 200，返回「主人**手板**真实链路验收已经完成，语音转写返回了这段文字。」（“首版”被识别为“手板”，实际结果原样记录） |
| MiniMax 套餐/凭据/模型能力 | **未执行**：无 `MINIMAX_API_KEY`，未发起调用；不以模板或官方说明替代 |

因此票面的「官方 DeepSeek Flash 文本和图像工具结果」「PDF 扫描页通路」与
「MiniMax 经 `llm-pi-ai` 的实际调用」门槛**保持未完成**。余额是账户状态，不是本仓库代码缺陷；
充值后按同一脚本重跑即可，`scripts/real-acceptance.mjs --minimax` 在有 `MINIMAX_API_KEY` 时会
真实保存 MiniMax 路由、切换共用选模并请求一次。

## 4. 共用模型切换与附件能力（自动化）

`tests/gateway.test.mjs`（7 例，真实 launcher/HTTP/profile settings/凭据 seam，模型为 loopback 替身）：

- 工具暂停时切换选择：同轮续请求仍为原 model，下一轮才采用新 model（以线上请求体为准）。
- 在用路由的端点修改 409 `chat/route-in-use`，回复结束后重试成功；删除共用选择指向的路由 409。
- 保存/选择/路由/ASR 在重启后保留；启动不覆盖已保存选择。
- 图片能力检查随下一轮选模变化。

真实官方模型上的同一切换行为因余额错误未执行。

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
| 共用模型切换 | `tests/gateway.test.mjs` 的两个模型替身用例与在用路由用例 | 自动化通过；真实官方模型因余额未执行 |
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
| PDF 与官方视觉 | `tests/pdf.test.mjs` | 替身通过；真实官方图像结果因余额未执行 |
| 流式及最终格式 | `tests/reconnect.test.mjs`、`tests/remote-chat.test.mjs`；Android presentation JVM 测试 | 通过；真机性能属 #45 |
| vivo S50 release | [device-handoff.md](device-handoff.md) | **未执行**（#45） |

唯一没有真实服务证据的两行（PDF/官方视觉、MiniMax）已在上节明确列为未完成；ASR 的真实调用
已完成但样本是合成的。

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

1. 官方 DeepSeek Flash 文本与 PDF 扫描页真实联调：账户余额不足，充值后重跑 `scripts/real-acceptance.mjs`。
2. MiniMax 套餐/凭据/模型能力：无凭据，未调用；提供 `MINIMAX_API_KEY` 后加 `--minimax` 重跑。
3. vivo S50 实机：属 #45。
4. 单一会话串行的双用户八步链：未执行；各环节已分别验收。
5. dsh 上游 rc.2 升级与重验：未执行，理由见第 7 节。
