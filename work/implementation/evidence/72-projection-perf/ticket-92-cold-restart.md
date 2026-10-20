# #92 冷启动重建与 live 状态边界

本票用一个隔离 home 与真实 launcher 证明：进程重启后 durable 投影从会话日志重建，live 字段
按规则归零，旧 generation 的任务不可用，未知/无法解释的行不使读取失败。**没有生产代码改动**；
新增 `tests/chat-cold-boundary.test.mjs`，只通过产品 HTTP 面、真实 launcher 与模型替身断言。

## 1. 场景与断言

测试在一个 home 上依次经历崩溃重启、干净重启和手工追加日志行：

1. 一轮已完成回复、一个已 settle 但通知仍排队的后台任务、一个真正在跑的任务；用
   `/chat/checkpoint` 确认这些事实 durable 后 SIGKILL。
2. 冷读：`messages` 与崩溃前一致；`attempt=null`、`replyStatus=0`、`error=null`、
   `settledAttempt=null`；旧 generation 的 quick 任务 `status=3/availability=0`，
   其排队 report 因崩溃恢复的 `turn/end` 被记为 canceled(4)；running 任务
   `status=0/availability=0`；没有任务声称仍在执行；activity `status=0`、`reasons=[]`。
3. 追加一条没有 turn、没有 message 的 `jobs/report`（真实的 between-turns wakeup 形状），
   冷读必须把它的 report 记为未知(6)，而不是排队或已投递。
4. 干净重启冷到冷：`messages`/`tasks`/`activity` 与上一次冷读一致；重启只允许增加
   commit 行，不回退 cursor。
5. 追加一条 `ignorable: true` 的未知类型行；下一次冷读不失败，未知行之后的原生 resume
   标记也不改变 durable 投影，`activity.throughSeq` 等于读取截点。
6. 同一个截点上冷读与 live `/chat/read` 的 `messages`/`tasks`/`activity` 一致；打开一个
   observe 观察者只发布帧，不追加日志。

## 2. 为什么之前卡住，怎么修

上一轮失败在第三次 start 后的 `/chat/read` 500，日志是
`SessionPersistenceCorruptionError: complete frame contains a torn JSONL record`。逐个解压
20 个 frame 后每帧明文都以换行结尾，真正的扫描器错误是
`released v2 row 43 has seq gap (expected 43, got 42)`：测试用
`appendLogEvent(..., seq: cold.cursor + 1)`，但 `cold.cursor` 是崩溃重启读完后的 41，
紧接着的 `stop` 为清空排队通知追加了一条 `agent/inbox/spliced`（seq 42），于是手工行占用了
已存在的 seq。**不是Zstandard 帧边界问题，也不是产品读取器缺陷。**

修法：在追加前先 `start` 并读一次产品截点，`stop` 后用这个截点 +1 作为手工行的 seq；
未知行同理。重启本身还可能追加 `session/end-seed` 等 marker，所以「追加后 cursor 恰好多 1」
不是正确断言，改为「cursor 至少前进 1，且读窗口包含这条未知行」。耐断言，不削弱任何
durable/live 断言。

## 3. 实际命令与结果

环境：Node v24.18.0，WSL2；dsh 为 `combo.json` 锁定检出；工作副本
`.worktrees/92-cold-restart`（分支 `ticket/92-cold-restart`，合并 `integration/spec-72`
后运行）。

```bash
TMPDIR=$PWD/work/tmp node --test tests/chat-cold-boundary.test.mjs
# → tests 1 / pass 1 / fail 0，约 10.1 s（本次运行）
```

测试只跑真实 launcher 和模型替身；不依赖真实云服务或 Android 设备。手工追加使用
`zstdCompressSync` 写入与 launcher 相同的 concatenated-frame 容器，行本身通过当前 v4
解码器的校验。

## 4. 验收点对照

| 验收点 | 证据 |
| --- | --- |
| 重启后 `messages`/`tasks`/`activity` 与重启前一致，live 字段归零 | §1.2、§1.4；`cold.messages === live.messages`，`attempt/replyStatus/error/settledAttempt` 断言 |
| 不伪造「正在执行」；旧 generation 任务未知/不可用；report 不可恢复为 6 | §1.2、§1.3；quick/running 两个任务的 status/availability/report 断言 |
| 损坏/未知事件不使读取失败 | §1.5；未知行之后仍返回 200 且三个 durable 输出不变 |
| 冷读与 live 读同截点一致 | §1.6；`observeOnce` 后 `/chat/read` 与冷读逐字段相等 |
| 现有断线恢复与冷启动测试通过 | 本票只跑新用例；定向断线恢复/冷启动回归留在集成分支的 #95 全量验证 |

## 5. 未执行项

- 没有跑全量 `npm test`、`combo verify`、`backend doctor`；这些是 #95 的最终验证。
- 没有 projection cache：每次冷启动仍从完整日志重建；本 spec 明确不实施 cache。
- 没有真实云服务、Android 设备或跨机比较。
