# #345 会话命令保留与恢复组合验收

开工基线：`integration/spec-342` @ `0b911101ee58d693064db6c040534a91fcf14191`；独立分支 `ticket/345-session-command-retention`。开工 DSH 锁为 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`。发现原生读取缺口后，由 #347 修复并更新组合；本票已快进合入 `integration/spec-342` @ `7f4a395d5e9b596bf7a0f6dd890497bf6374da81`，最终 DSH 锁与 `/home/fatfish/deepseek-harness` HEAD 均为 `8014fc775a27e7273300a68fcadb7e2980bb93f0`。本票没有修改 DSH、Android 或产品生产源码。

## 接缝与范围

遵循父规格已确认的接缝并调用 `tdd`：真实产品启动器、profile/Loader、Bearer HTTP、原生 JSONL writer 与真实 stop/start；仅模型/网络使用确定性 Messages 替身。复用现有 backend/title-aware helper 和既有测试的少量 SSE/gate/分页/SQLite 只读观察模式，没有新增产品或测试服务器架构。持久行只作冻结 child/cut/watermark、signal 与已审核版本的恢复证据，不写生产状态来安排用例。

新增测试位于：

- [`session-commands-retention.test.mjs`](../../../../../tests/session-commands-retention.test.mjs)：真实 compact 后再追加独立原文、bash 输出并激活技能；clear 前确认实际请求有 summary/raw/tool result/skill body，首条普通 probe 确认全部退出；保留人格、身份、印象、工具/技能目录、同一 memory、审核版本/偏好/资源与本人另一个会话。真实重启后再次检索、激活、读取资源。
- 同文件：memory child held 时 source idle 的 clear 先完成，child/cut/watermark 不变；释放后只消费旧 cut，下一段收新原材料且不重放旧材料。Learning 分别从 held 与真实 HTTP 400 failed 开始，跨 clear 和真实重启仍以原 child/cut 恢复；失败场景下一段 evidence range 连续、每段仅一条 signal。真实 bash 步骤避开 learning 的纯文本 precheck。
- [`session-commands-recovery.test.mjs`](../../../../../tests/session-commands-recovery.test.mjs)：durable compact 受理后持有摘要请求，真实日志 chmod 0400，再释放模型；观察 committed 终态的 seq 大于 durableThroughSeq，同时 status/execute/checkpoint 均 HTTP 500，JSONL 字节哈希不变。恢复权限后先查旧身份并真实重启，同一 commandId/acceptedSeq/completedSeq 恢复且没有第二次摘要。
- 同文件：两个 observe 按共同 version 比较消息、命令与 durableThroughSeq；重连和后续追加、旧身份重试、真实重启后重读 C0/C1 固定分页。C0 不含未来分界，C1 包含旧聊天与唯一分界而无之后的新消息；实际 socket 丢弃 page 响应再重试，每页深等。观察窗口使用足够容纳此用例完整消息的上限，不比较各连接的 throughSeq/fromSeq/events 窗口。
- 同文件：真实 session-owned bash job 在 reply idle 时仍使两类命令即时拒绝；拒绝不取消 job，释放后正常输出并报告，旧命令无受理事实也不延后执行。持有回复时已受理的排队输入也跨命令拒绝保留，后续实际模型请求仍携带全部已受理材料。
- 同文件：真实跨用户投递先于 clear 或与 clear 并发，只有一份耐久落点；实际模型材料按日志中的 reset 边界保留或退出，冷恢复保留旧聊天和投递。摘要模型 HTTP400 产生耐久 status 5 / error code 2 和原生公开原因，不创建聊天回合；原上下文仍可继续。成功 compact/clear 与失败 compact 前后经 `/gateway/read` 比较自动压缩设置及保存标志。

#343 已有权限、基础 busy/compact/clear、同身份并发、迟到重试、冷恢复、缺 done 与 run-only interruption 继续由原测试负责，本票不修改该文件。

## TDD 与运行记录

逐行为写测试后运行，既有实现直接满足的行为按绿灯记录，没有故意破坏生产代码制造红灯。原始输出在忽略的 `work/tmp/345/`，不作为提交物。

- `npm test -- tests/session-commands-retention.test.mjs`：首条保留组合 1/1 通过；增加 memory 时首轮 1/2，通过调整夹具执行顺序隔离全局维护阈值（此前已存在的其他 source 抢先触发 child）后 2/2；增加 failed learning 后 3/3；增加 held learning 后 4/4。
- `npm test -- tests/session-commands-recovery.test.mjs`：EACCES 组合首轮 1/1 通过；增加观察分页后首轮 1/2，原因是夹具用 5/9 个事件的不同窗口比较了完整 messages，修为足以包含本用例完整消息的窗口后 2/2。增加真实 idle job busy 后 3/3，增加 queued input 后 4/4，均无生产修复。

旧锁上的实际红灯：投递竞争原场景 `recovery-06.log` 4/5（exit 1），独立重放持续失败；一轮版本 `delivery-minimal.log` 1/1 通过，两轮版本冷读稳定 500。`delivery-stderr.log:8` 给出 `SessionPersistenceCorruptionError → SessionFormatError: compaction/prune shadowedSeqs do not name an exact current surface span`。旧锁 DSH 的 `packages/session/session-format-v3-to-v4/src/relationships.ts:7` 将 `delivery/message` 排除于 surface，与真实 Session surface 不同；覆盖已有投递的 clear 因而被该冷校验器拒绝。不是系统头或并发重复 seq，本票没有过滤真实 span、改写历史或增加产品绕过。根因上报后由 [#347 独立修复并更新 native pin](../05-native-reader/README.md)。临时 `[DEBUG-345-replay]` 日志已移除。

最终回归第一轮显式等待真实投递完成再 clear，第二轮让真实投递与 clear 并发，随后冷恢复。`OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm test -- --test-name-pattern='real cross-user delivery' tests/session-commands-recovery.test.mjs` 在最终 pin `8014fc7` 上 **1/1 通过，exit 0**；日志 `work/tmp/345/delivery-final-pin.log`。

恢复记录：Lead 确认 #347 已关闭、#345 live blocked=0，最终 DSH requiredBuild/artifacts/build checks 已完成，无并行构建，本票于 2026-11-10 恢复。`git merge --ff-only integration/spec-342` exit 0，取得 `7f4a395` 和最终 pin `8014fc7`。提交前再次核对 integration tip 与本票 HEAD 均为 `7f4a395d5e9b596bf7a0f6dd890497bf6374da81`，DSH HEAD 为 `8014fc775a27e7273300a68fcadb7e2980bb93f0`。

摘要拒绝切片 `summary-refusal.log` 首轮 0/1（exit 1）：status 5 / error code 2 正确，夹具错误要求透传 provider 的私有文本；native 公开的具体原因是 `manual compaction could not produce a smaller summary`。断言改为公开原因，并确认真实 HTTP400 脚本已消耗后，在最终 pin 复验通过，没有修改压缩算法。

### 最终实际验证

下列产品测试和 combo 命令均显式设置 `OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness`。focused cases 包含在四文件组合中，不将重复执行计为独立测试总数。

| 实际命令（省略上述相同 env 前缀） | 结果 | 忽略的原始日志 |
| --- | --- | --- |
| `npm test -- --test-name-pattern='real cross-user delivery' tests/session-commands-recovery.test.mjs` | 1/1 passed，exit 0，原冷恢复失败场景转绿 | `work/tmp/345/delivery-final-pin.log` |
| `npm test -- --test-name-pattern='refused summary' tests/session-commands-recovery.test.mjs` | 1/1 passed，exit 0，包含原上下文与自动设置保留 | `work/tmp/345/summary-refusal-final-pin.log` |
| `npm test -- tests/session-commands-retention.test.mjs tests/session-commands-recovery.test.mjs tests/session-commands.test.mjs tests/docs.test.mjs` | **20/20 passed，0 failed / skipped，exit 0**：retention 4、recovery 6、既有 commands 8、docs 2；测试时长 70.86 s | `work/tmp/345/final-related.log` |
| `npm run combo:verify` | exit 0，OurFairy / DSH / Android source 三行 ok，无 skipped | `work/tmp/345/final-combo.log` |
| `npm run specs:status -- --offline` | exit 1，唯一 need-attention 为 #342 unpushed（6 ahead，副本均 ok），符合本轮不 push 的安排 | `work/tmp/345/final-specs-status.log` |

两新文件 `node --check` 通过；暂存后的 whitespace 检查发现并删除了一处额外 EOF 空行，属于格式修正，随后 `git diff --cached --check` 通过。测试内容没有再改变。本票仅提交两新测试与本证据，所有托管测试 job 均已收集，没有运行中的任务。

## 门禁节奏与未执行项

本轮 Lead 明确协调：相关测试与 `combo:verify` 绿灯后使用 `git commit --no-verify`；共享机器资源与根 `AGENTS.md` 的按改动面验证节奏要求，完整 hook / 全量 `npm test` / Android `./gradlew test lintDebug` 延后到 #346 最终 integration 统一执行。没有修改 hook 配置或源码，也不将子集结果称作本票 full。

没有调用真实云模型、真实外部服务或 Android 真机；替身通过只证明当前产品组合的命令、请求、持久/恢复行为。最终 full、Android 单测/lint、两轴审查与设备结论由 #346 单独记录。本票不 push、不关闭 GitHub issue；由 Lead 指定 merger 合入。
