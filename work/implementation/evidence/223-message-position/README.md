# #223/#224 消息呈现顺序恢复

日期：2026-10-25。集成分支 `integration/spec-223`，票分支 `ticket/224-message-position`，worktree
`.worktrees/224-message-position`。被测代码 tip 为 `09a0cc0a09`（票分支 fast-forward 到
集成分支后的落地提交）；本目录与证据索引随后由只改文档的提交加入并推送。

票面与最终设计见 [`work/tickets/223/README.md`](../../../tickets/223/README.md) 与
[`01-position-recovery.md`](../../../tickets/223/01-position-recovery.md)。实现按票面逐项完成，
没有扩张到 stateRevision、恢复 actor、独立合并 module、数据库或 dsh fork。

## 交付

| 提交 | 内容 |
| --- | --- |
| `1df6cf8a0f` | 后端 `messages[]` 增加必填数字 `position`，由 transcript `rows` 下标读时派生 |
| `e16f74cc76` | Android 必填 `position`、按位置恢复顺序、位置冲突校验；提醒/流式测量取最大 seq |
| `68ce5c06fd` | 两轴评审修正：校验范围措辞、共享 `newestFairyOutput`、解码 cause |
| `09a0cc0a09` | 同步 `integration/spec-223` 的证据登记（仅文档） |

后端：[`units.ts`](../../../../backend/chat/src/units.ts) 的 `rowAtCut` 接收行下标并输出
`position`；`transcriptAt` 对 moved 与 visible 行都按 `rows` 下标派生。fold 语义与持久 state 形状
未变，transcript `stateVersion` 仍为 4（绑定见 `tests/projection-units.test.mjs`），未改数据库。

客户端：[`RemoteChatApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt)
的 `RemoteChatMessage.position: Long` 必填、无默认值；[`RemoteChatState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt)
保留 `mergeMessages` 的 `seq >=` 内容合并，整批校验「同一 messageId 位置不变 + 位置唯一」后才写入，
`orderedMessages` 改为按 position 排序。提醒预览与 perf `StreamingRateActivity` 共用
`newestFairyOutput(throughSeq)` 取最大 seq。缺 position 解码失败；同一 ID 改位置、不同 ID 同位置
响亮失败，保留最后可信 snapshot 且不推进消费。

wire 与合并契约写入 [`backend/chat/README.md`](../../../../backend/chat/README.md)：`position` 只用于
排列，不是 seq、不表示连续或内容新旧；`messages` 按 position 升序；配对版本交付，不做混合版本
fallback。所有 `RemoteChatMessage` 构造点（测试、fixture、perf、`SyntheticChatBackend`）显式给出
位置，未保留生产默认值。

## 红绿回归

以下断言都由现有公开接缝驱动，没有为测试新增生产接口。

Android（接缝 `RemoteChatState.bind/snapshot`，[`RemoteChatStateTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatStateTest.kt)）：

- `snapshot keeps the backend presentation order even when seq disagrees`：复现 #223 探针的
  `[u-first,u-second,a1]`。旧实现按 `(seq,messageId)` 得 `[u-second,a1,u-first]` 而先失败；改为
  position 排序后通过。
- `rows sharing one splice seq keep their insert order`：同一次 splice 的两行 seq 相同，旧比较器按
  messageId 颠倒，position 保留 inserted 次序。
- `a page backfills earlier rows into their own positions`：live 尾部带一个首次出现早、seq 最新的行，
  旧页回填后仍按 position 排在前面，consumption 推进到 4。
- `a valid older page cannot roll back a newer live row`：旧页持有较旧 seq 的同一行，合并后保留 live
  的 `seq=4,status=3,text=new`（保留既有几何保障，排序前后都通过）。
- `a message that changes position is refused and keeps the last trusted snapshot`：旧实现静默采用新
  位置；现在断言 `failure`、snapshot 仍是版本 1、消息文本/位置不变、`consumedThrough` 停在 7。
- `a page that gives a second message the same position is refused`：页给出不同 ID 同位置，断言
  failure、保留最后可信 snapshot、`consumedThrough` 仍为 -1。
- `the newest Fairy output is the greatest seq, not the last row`：提醒与 perf 共用的规则直测。
- `a message without a position is refused instead of guessed`
  （[`RemoteChatApiTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatApiTest.kt)）：
  缺字段解码失败，并沿 cause 链断言是点名 `position` 的序列化错误，而不是泛化的「文档不可读」。

敏感性核对：把 `orderedMessages` 临时换回旧的 `compareBy(seq).thenBy(messageId)`，三个排序用例
失败；恢复 position 排序后全部通过。其余顺序与冲突用例在旧实现上同样失败。

后端（投影 fold 与 HTTP）：

- `every wire row carries the transcript position that keeps the probe order`
  （[`projection-units.test.mjs`](../../../../tests/projection-units.test.mjs)）：`[u-first,u-second,a1]`
  的 position 为 `0,1,2`，会话内唯一，且对每个 cut/窗口都指向 `rows` 中同一 messageId 的行。
- `one splice numbers its rows in inserted order and a later re-splice keeps them`：同 splice 两行按
  inserted 次序编号，re-splice 移动 seq 但不移动位置。
- `a page window names the same position as the live read`：页窗口与 live 读对同一行给出同样的
  position。
- `a page names the same position as the live read for the same row`
  （[`remote-chat.test.mjs`](../../../../tests/remote-chat.test.mjs)）：真实 HTTP read/page，单行页仍
  报会话内位置而不是页内序号。
- `the units reproduce the frozen values over a real session log`
  （[`projection-units-real.test.mjs`](../../../../tests/projection-units-real.test.mjs)）：真实日志上
  `/chat/read` 的整行（含 position）等于 fold 的行；冻结 fixture 的既有字段比较在去掉新增
  position 后逐字段不变，position 另按冻结前缀的行下标逐行断言。
- 既有 generation 重置、events 覆盖、durable/consumer、pending、附件、任务与实时 attempt 回归全部
  保留并通过；[`chat-cold-boundary.test.mjs`](../../../../tests/chat-cold-boundary.test.mjs) 的冷恢复
  逐字段比较现在也覆盖 position。

## 全量门禁（集成 tip `09a0cc0a09`，集成 worktree 实跑）

```sh
$ npm test
ℹ tests 315
ℹ suites 7
ℹ pass 315
ℹ fail 0
ℹ duration_ms 101924.503144

$ npm run combo:verify
ourfairy        main                 based on main     09a0cc0a097311fa  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1  d1b6099ae716870a  d1b6099ae716870a  ok
android source  -                    460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified

$ cd android
$ ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
BUILD SUCCESSFUL in 4m 27s（141 tasks executed）
# JUnit XML 合计：37 个套件 / 236 tests / 0 failures / 0 errors / 0 skipped
# :app:lintDebug 与 :app:assembleDebug 均成功，debug APK 完成打包

$ ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:compilePerfKotlin
BUILD SUCCESSFUL
```

perf 源集没有单测接缝；其中「最新输出取最大 seq」的规则抽到共享 `newestFairyOutput` 并由
`RemoteChatStateTest` 的直测覆盖，perf 只调用该函数。

## 真实服务验收

`node scripts/real-acceptance.ts`（真实 MiniMax M3.1-Flash 文本 + 真实 SiliconFlow 语音，临时
home；未向仓库写入文件）：

- 文本步：`requestedModel=minimax-cn/MiniMax-M3.1-Flash`，真实回复
  「已收到，主人——这条真实链路验收消息经 OurFairy 通道确认送达。」，`error=null`。这是真实模型
  调用，不是模型替身。
- PDF 扫描页：smoke 进程 exit 0，但验收报告未能捕获它的 stdout JSON
  （`scripts/pdf-flash-smoke.ts` 在 `console.log` 后立即 `process.exit(0)`，管道 stdout 被截断）。
  本目录不据此声称 PDF 扫描页真实验收通过；PDF 路径的确定性套件在 `npm test` 中通过。
- ASR：`fetch failed`（执行环境到语音服务网络不可达），未执行。
- 真机：当前无物理设备，未执行；不以构建或模拟器代替真机验收。

## 两轴评审（Standards + Spec）

范围 `ecb275a...68ce5c06fd`，两个轴由独立子代理（MiniMax-M3.1-Flash）并行评审；Standards 依据
[`AGENTS.md`](../../../../AGENTS.md)、[`CODING_STANDARDS.md`](../../../../CODING_STANDARDS.md) 与
[`CONVENTIONS.md`](../../CONVENTIONS.md)，Spec 依据票面副本与父规格。

| 编号 | 轴 | 发现 | 处理 |
| --- | --- | --- | --- |
| S-A1 | Standards | README 第二处 `stateVersion` 数字没有绑定测试读它，属于无检查声称 | 改为不复述号码，指向「投影单元」的当前版本与绑定测试 |
| S-A2 | Standards | 冲突校验的措辞覆盖到 generation 切换之后，而客户端此时已清空行缓存，无法校验 | README 限定「对其仍持有的行」；KDoc 说明跨 generation 由服务端冷恢复比较保证 |
| S-A3 | Standards | 缺证据目录与索引登记；另称缺 `work/tickets/224` 副本 | 本目录与索引由收尾提交补齐；#224 的票面副本就是 `work/tickets/223/01-position-recovery.md`，不存在独立票号目录 |
| S-B1 | Standards | 「最新输出 = 最大 seq」规则与注释写了两遍 | 抽出 `newestFairyOutput(throughSeq)`，提醒与 perf 共用，并补直接用例 |
| S-B2 | Standards | `position` 与 `seq` 同为 `Long`，位置化构造有调换风险 | 未改：wire 字段类型由票面固定为数字/`Long`，包装类型会扩散到序列化与全部构造点；fixture 与测试都显式给出两值，行为由用例钉住 |
| S-B3 | Standards | 一个必填字段扩散到 12 个 Android 测试文件 | 未改：票面要求每个构造点显式给位置；在共享 builder 上加默认值会掩盖缺字段，正是本票要禁止的 |
| S-B4 | Standards | `placeOf`/`holderOf` 命名含糊 | 改为 `positionById`/`idByPosition` |
| P-1 | Spec | 跨 generation 的位置漂移无法由客户端检测 | 不新增状态：generation 切换清空行缓存是现有语义；在 README/KDoc 明示边界，跨 generation 稳定性由服务端冷恢复比较保证 |
| P-2 | Spec | perf 的 max-seq 没有测试 | 规则抽到共享函数并补直测（perf 源集无单测接缝，perf 只调用该函数） |
| P-3 | Spec | generation 重置 fixture 中 position 恰等于 seq，无法区分排序依据 | 未改：这些用例的既有断言是内容替换；排序依据由专门用例覆盖，不为同一规则再造 generation 变体 |
| P-4 | Spec | 录制的真实 SSE 被手工补了 `position: 0` | 保留并在测试 KDoc 说明：捕获早于本票，唯一行的位置就是当前后端按行下标 0 派生的值，其余字节为原捕获；证据不据此声称原始字节级复现 |
| P-5 | Spec | 真实日志测试新增了整行 endpoint 等值，超出 position 单字段 | 保留：与该文件既有的 roster endpoint 校验同一形状，同时钉住 wire position 的送达 |
| P-6 | Spec | 缺 position 的解码失败与普通「不可读文档」不可区分 | 解码失败保留真实 cause，测试沿 cause 链断言点名 `position`；用户可见分类仍是 unreachable，本票不新增错误类型或公开流程 |

结论：硬问题已在所属模块修正（`68ce5c06fd`）；其余为按票面保留的判断项，已写明理由与边界。
没有在集成分支之外打补丁，也没有遗留未修项。

## 未执行项

- 真机验收（无物理设备）。
- 真实 PDF 扫描页与真实 ASR 未取得可引用结果（原因见上）；不把 exit 0 当作通过。
- `combo.json`、数据库与 dsh fork 未变（dsh `d1b6099ae716870a`，android source
  `460109d1b89b824a`）。
