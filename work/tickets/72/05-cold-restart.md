## Parent

[#72 后端投影性能：长会话与流式回复的增量投影与分页读取](https://github.com/eafen405/OurFairy/issues/72)

## What to build

冷启动与重启后的投影由会话日志重建，只在冷启动或 `stateVersion` 变化时发生；重启前后同一会话的 `messages`、`tasks`、`activity` 一致，而 `attempt`、`replyStatus`、`error`、`settledAttempt` 与任务可用性不被伪造。无法解释的事件按现有行为保留/忽略，不使整次读取失败。

## Acceptance criteria

- [ ] 重启后端后读取同一长会话，`messages`、`tasks`、`activity` 与重启前一致（live 字段按规则归零/null）
- [ ] 重启后不出现「正在执行」的伪造状态；旧 generation 的任务标记为未知/不可用，`report.status` 不可恢复时为 6
- [ ] 损坏/未知事件不导致读取失败；错误仍走现有 error 字段或日志
- [ ] 冷读与 live 读的投影结果一致（同一截点）
- [ ] 现有断线恢复与冷启动测试通过

## Blocked by

- [观察者共享与 read/observe 切换](https://github.com/eafen405/OurFairy/issues/90)
