# 04 冲突面 dsh 测试

票 [#188](https://github.com/eafen405/OurFairy/issues/188)。范围是**被这次合并动过的包**，
不是 990 个上游提交的全量测试面。

## 跑了什么

```
corepack pnpm@11.28.5 exec vitest run \
  packages/client/connection packages/core/session packages/jobs packages/boot/app-boot
```

结果：`Test Files 63 passed (63)` / `Tests 6570 passed (6570)`。

## 修掉的三条

| 测试 | 原因 | 处理 |
| --- | --- | --- |
| `principal-admission.host.spec.ts`（3 条断言） | 我自己重写的注册表丢了「同名 authenticator 重复注册要报错」 | 在 `registerAuthenticator` 里按 name 拒绝 |
| `tool-jobs.spec.ts`（2 条 notice 断言） | rc.2 的 `LocalJobRegistry` 发不透明 id（`bash-<hex>`），fork 的测试把旧序数 `bash-1` / `test-task-1` 写死在 `source.jobId` 里 | 改用套件自带的 `startedId(ctx, 'bash-1')` 解析运行时 id |

第一条是真实缺陷（能力丢了），第二条是**采用上游事实**：id 方案属于上游的注册表，
patched 的应该是断言，不是注册表。

## 覆盖情况

- 保留的接缝：`principal-admission.host.spec.ts` 直接覆盖注册表准入、`revokePrincipal`、
  authenticator 卸载时撤销其名下 subject。
- 改用上游的接缝（Peer/principal、`admitConnection`）：由上游自带的
  `node-half.host.spec.ts`、`socket.client.spec.ts` 等承担。

## 未执行

- 没有跑 dsh 全量 `vitest run`。判断依据：本次只改连接层、会话事件与 tool-jobs 通知，
  其余包既无冲突也无改动；把全量跑一遍的边际信息不足以抵消它的耗时。
