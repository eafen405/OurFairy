## Parent

[#225 会话读取：完整页操作与任务身份访问](https://github.com/eafen405/OurFairy/issues/225)

## What to build

把 `/chat/page` 的固定截点校验、页范围计算、事件读取与消息选择收进 `SessionRuntime` 的单一完整页
操作；`RemoteChat` 只保留认证、打开会话、不可信输入校验、`maxEvents` 范围与 HTTP 错误映射。

- `backend/chat/src/runtime.ts`：增加完整页读取操作，接收已打开的 `LiveSession` 与已校验的数字
  `throughSeq` / `beforeSeq` / `maxEvents`；拥有动态截点校验（`throughSeq` 超出当前 cursor 返回
  `null`）；计算页范围、读取事件、按固定截点派生消息并限制在页事件范围内，返回正常页对象。
- `backend/chat/src/service.ts`：`page()` 只做数字输入校验与 `null -> 400 chat/invalid-page`
  映射；不新增 writer queue 或 durability barrier。
- 未初始化 window 时经 `ctx.sessionPersistence` 只读精确页范围；已初始化 window 直接切片；不额外
  建立 window、不读取整份日志、不改变 cursor 来源与语义。
- 把 `pageEvents` / `cursorOf` 收为 runtime 内部；页测试经 `runtime.open` + 完整页操作，不手工
  构造 `LiveSession`。
- 抽取 `tests/chat-read-window.test.mjs` 的 fake native world 到共享测试 helper（如
  `tests/helpers/chat-world.mjs`）；运行窗口测试改用该 helper，页测试复用同一套原生替身。

## Acceptance

- [ ] 分页定义不变：`throughSeq` 包含式上界、`beforeSeq` 排除式下界；`end = min(throughSeq + 1,
      beforeSeq)`、`from = max(0, end - maxEvents)`。
- [ ] 有效空页返回正常页对象；`null` 只在 `throughSeq` 超出当前 cursor 时出现。
- [ ] 未初始化 window：原生 persistence 恰好收到本页范围，且不发生 `observeSession` 读取。
- [ ] 已初始化 window：直接切片且不发生额外日志读取。
- [ ] 相同参数在追加新事件后重试，页内容相同。
- [ ] 页消息的 `seq` 落在 `[fromSeq, end)`；固定截点语义不变。
- [ ] 现有 HTTP 400、reconnect / lost-page、跨页消息、多观察者、projection fold 回归通过。
- [ ] `npm run build` 与相关测试通过；证据写 `work/implementation/evidence/225-page-read/README.md`。

## Baseline

- worktree：`.worktrees/225-page-read`；分支：`ticket/225-page-read`；基线：`integration/spec-225`。
- 完成后把 `integration/spec-225` tip 合入本分支并报告冲突处理。
