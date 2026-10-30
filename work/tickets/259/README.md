# spec 259 票面副本

父规格：<https://github.com/eafen405/OurFairy/issues/259>（[259.md](259.md)）

| 票 | 标题 | 阻塞 | 副本 |
| --- | --- | --- | --- |
| #268 | 建立多会话历史与流式并存的性能基线 | 无 | [268.md](268.md) |
| #269 | 持久提醒记账脱离活会话运行时 | 无 | [269.md](269.md) |
| #270 | 依据多会话基线受控优化接收生命周期 | #268、#269 | [270.md](270.md) |

本 spec 全部落在 `android/`：`data/remote/` 的会话接收 module 与其 `app/src/test` 行为测试，
外加 `app/src/perf` 的多会话组合负载与 `scripts/measure-presentation.py` 的重放入口。
不涉及后端、dsh 或插件。
