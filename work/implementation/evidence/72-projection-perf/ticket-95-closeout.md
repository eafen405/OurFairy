# #95 契约文档、全量验证与子票收口

## 1. 交付的契约

`backend/chat/README.md`「投影单元」与「dsh 升级复核」现在写明：

- key：`ourfairyTranscript` / `ourfairyWork`，均为 host-only（无 `wire`），只用公开
  `register` / `stateOf`。
- 每个单元声明 `stateVersion`、zod `stateSchema`、`init(header)`、`apply(state,event)`；
  `apply` 同步纯函数，未解释事件返回同一 state 引用；state 可 JSON checkpoint。
- transcript 为 `stateVersion 3`（不可变首次出现 + 有序 transitions + move 索引）；work 为
  `stateVersion 2`（完整 pending 消息换成 id/来源 kind 的窄索引）。
- durable（transcript 行、receipts、任务/report、activity）与 live（`availability`、running、
  attempt 文本、`replyStatus`、`stopping`、`error`、`settledAttempt`）的分界。
- 任务与活动必须共享一次 fold 的原因：activity 读取每个事件后的任务/report 快照，拆开会
  复制 report 状态机。
- dsh 升级后要跑的行为测试与基准命令；接口/事件形状变化时应失败，不能加第二套 fold 绕过。
- transcript 的 `fromSeq` 窗口读取、`transitions` 与 `moves` 索引；原生 inbox 投影拥有 pending 消息，
  work 只保留历史重放需要的 id/kind。

## 2. 全量验证（最终集成分支 @ `9f002a4`）

```bash
npm test
# → tests 172 / suites 7 / pass 171 / fail 1，74.5 s
#   唯一失败：tests/pdf-worker-cancel.test.mjs「temporary directory must be removed」
#   —— #71 范围内已知的并发负载抖动。

node --test tests/pdf-worker-cancel.test.mjs
# → tests 1 / pass 1 / fail 0，单独运行通过；复现「并发负载下偶发」。

node --test --test-concurrency=1 "tests/**/*.test.mjs"
# → tests 172 / suites 7 / pass 172 / fail 0，247.2 s
#   串行全量通过，说明默认并发下的 PDF 失败不是本 spec 的确定性回归。

npm run backend:doctor
# → 1 check failed: rikkahub product/ourfairy-v1 is 2d97ed14 but combo.json locks 460109d1。
#   其余 node/pnpm/dsh build/product packages/profile/model double/bundle model 全 ok。
#   本次运行输出摘要；原始日志按 CONVENTIONS §5 不入库。

npm run combo:verify
# → ourfairy ok（worktree 基于集成分支 tip）；dsh ok（5b8ec0f）；rikkahub MISMATCH。
#   1 drift/missing entry。
```

**本票不声称三个入口全绿**：默认并发 `npm test` 的 1 个失败和 doctor/combo 的错误都来自
两个外部条件，而不是本 spec 的代码。rikkahub 漂移属于客户端合仓（#123 / spec-123）的收敛范围：`combo.json` 锁 `460109d1`，
本地检出是 `2d97ed14`。本 spec 按约定不改 `combo.json`、不切共享的 rikkahub 检出，因此
`doctor`/`combo verify` 的这两条失败**不是本 spec 引入**，也不能在本 spec 内修复。#71 的
PDF 取消用例失败同理，单独跑与串行全量均通过。

## 3. #72 定向验证（同一 tip）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/projection-units.test.mjs` | 14/14 |
| `node --test tests/projection-units-real.test.mjs` | 1/1（真实 launcher + 模型替身） |
| `node --test tests/projection-fold.test.mjs` | 3/3 |
| `node --test tests/chat-read-window.test.mjs` | 5/5 |
| `node --test tests/chat-page-cut.test.mjs` | 4/4 |
| `node --test tests/chat-multi-observer.test.mjs` | 2/2 |
| `node --test tests/chat-cold-boundary.test.mjs` | 1/1（真实 launcher + SIGKILL + 多次重启） |
| `node --test tests/remote-chat.test.mjs tests/reconnect.test.mjs` | 14/14 |
| `node --test tests/jobs.test.mjs tests/chat-multi-observer.test.mjs` | 11/11 |
| `node --test tests/bench-gate.test.mjs` | 4/4（门槛算术与失败方向） |
| `node --test tests/docs.test.mjs` | 1/1（所有相对链接可解析） |

#94 的相对门槛由 `npm run bench:gate -- --baseline ... --after work/tmp/after-94-final2.json work/tmp/after-94-final4.json`
判定（先按 #94 §1 生成 after JSON；18 个检查全过）：历史斜率 1.03/1.07（门槛 ≤1.20）、160 轮每观察者成本 0.64/0.69× 基线
（门槛 ≤0.85）、观察者放大 1.76（门槛 ≤1.80）、read p95 最差 0.91（门槛 ≤1.50）、峰值内存
最差 1.07（门槛 ≤1.25）、payload 1.008（门槛 ≤1.05）。内存没有下降，观察者放大接近门槛，
均已在 #94 如实记录。

## 3.1 最终评审后的额外修复

- transcript 行改为「不可变 `first` + 有序 `transitions`」，并只用会移动行位置的 transition
  建 `moves` 索引；修复了 re-splice 后数组不再按 first.seq 排序、尾窗口可能丢行的问题。
- 新增 5000 行窗口访问计数测试、重复 splice 顺序测试、pending id/kind 形状测试；`stateVersion`
  由测试精确绑定（transcript 3 / work 2）。
- 新增 `scripts/bench-gate.mjs` 与 `tests/bench-gate.test.mjs`，把 #94 的 18 个相对检查变成
  失败即红的命令；最终两次静默运行在 `9f002a4` 上全过（观察者放大 1.76，接近 1.80 门槛）。
- 默认并发全量为 172/171（唯一 #71 PDF flake），串行 172/172。

## 3.2 已知偏离（未在本票内消除）

- **inbox**：原生 `inbox` 投影拥有 pending 消息内容；activity/report 必须按历史事件重放，
  因此 work 保留每条 pending 的 id/source-kind 窄索引。它不是 pending 消息的第二份存储，
  但字面上仍是对 spec「不重新实现 inbox fold」的偏离；消除它需要改变 activity 的历史语义。
- **window**：事件窗口保留会话的完整已提交前缀，而不是 ticket-03 的「最近的窗口」；#90 已
  记录理由（任意 `fromSeq` 与长连接冻结 L），#94 的内存也如实记录为未下降（+6–7%）。

## 4. 证据索引与链接

本目录 `README.md` 已链接 #88–#94 的逐票证据；`work/implementation/evidence/README.md` 的
目录入口指向本索引。`tests/docs.test.mjs` 在最终 tip 上通过，所有新增相对链接均可解析。

## 5. 子票收口

按 tracker 方式关闭 #89–#95；#88 已在基线合入时关闭；父票 #72 的标题、正文与状态不被修改。
各票的关闭依据指向本目录对应 `ticket-*.md`，不在此重复结论。

## 6. 未执行项与保留风险

- 没有真实云模型、Android 设备或跨机比较；全部用模型替身，验收全在后端。
- 没有 projection cache / compaction / token meter；冷启动仍从完整日志重建，事件窗口在
  会话存活期间保留完整已提交前缀（ticket-90 已记录这一偏离与理由）。
- 没有长时内存曲线；#94 只有单轮流式窗口的 RSS/VmHWM。
- 组合漂移仍在：dsh `fe2bbc3 → 5b8ec0f`、rikkahub 本地 `2d97ed14` 对 `combo.json` 的
  `460109d1`；#72 的门槛只在本组合的静默窗口上成立。
- 已知外部失败：#71 的 PDF 取消并发抖动（单独/串行通过）、#123/spec-123 的 rikkahub 组合
  漂移（`doctor`/`combo verify` 各报一条）。
