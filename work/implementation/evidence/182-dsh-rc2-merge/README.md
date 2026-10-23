# spec #182 同步 dsh fork 到上游 rc.2：逐票证据

父票 [#182](https://github.com/eafen405/OurFairy/issues/182)。任务图与实测事实见
[`work/tickets/182/README.md`](../../../tickets/182/README.md)。

## 逐票记录

| 文件 | 票 | 内容 |
| --- | --- | --- |
| [01-seam-decisions.md](01-seam-decisions.md) | [#185](https://github.com/eafen405/OurFairy/issues/185) | 四条接缝的上游等价物裁决 |
| [02-merge.md](02-merge.md) | [#186](https://github.com/eafen405/OurFairy/issues/186) | 真合并与 17 处冲突逐条取舍 |
| [03-builds.md](03-builds.md) | [#187](https://github.com/eafen405/OurFairy/issues/187) | 四条必需构建 |
| [04-dsh-tests.md](04-dsh-tests.md) | [#188](https://github.com/eafen405/OurFairy/issues/188) | 冲突面 dsh 测试 |
| [05-product-side.md](05-product-side.md) | [#189](https://github.com/eafen405/OurFairy/issues/189) | 产品侧改接与组合锁 |
| [06-upstream-patches.md](06-upstream-patches.md) | [#190](https://github.com/eafen405/OurFairy/issues/190) | 保留接缝的可上游形态 |

## 结论

版本组合从 dsh `0.2.1-alpha.2` 的 fork 提交 `42133b30ad` 推进到 `0.2.1-rc.2` 的
`d1b6099ae716870a2afba705a2c90415408a69f5`：990 个上游提交、17 处冲突全部收口。

四条必需构建、冲突面 dsh 测试（6570 条）、产品全量（285 条）、`combo:verify` 与
`backend:doctor` 都在同一组合上通过。

四条 seam 的结局：`session-history` 与 `SessionHeader.owner` 保留（上游没有等价物）；
`connection.authenticators` 保留能力但改建在上游 `Peer`/`Principal` 之上；
job 事件两套并存，因为产品的活动卡与投递语义依赖 fork 的那两个事件。

## 未执行

- 没有把接缝提交上游（只有可提交形态）。
- 没有跑 dsh 的全量测试面与 Android 客户端构建。
- 没有起真实模型或真实 ASR 服务。
