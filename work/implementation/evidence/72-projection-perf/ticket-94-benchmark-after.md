# #94 改造后基准与相对门槛

在同一台机器、同一脚本与同一 `PARAMS` 上重跑 #88 的基准，与改造前基线比较。**注意组合漂移**：
基线在 dsh `fe2bbc3` 上测得，改造后在 dsh `5b8ec0f` 上测得，因此这是组合级前后对比，不是
纯投影代码的单变量实验；结论只用于本 spec 的相对门槛，不把差值全部归给本 spec。

## 1. 参数、命令与环境

```bash
# 改造前（已记录在 ticket-88-baseline.md；同一脚本、同一 PARAMS）
node scripts/bench-projection.mjs --out baseline-run1.json
node scripts/bench-projection.mjs --out baseline-run2.json
node scripts/bench-projection.mjs --out baseline-run3-final-tip.json

# 改造后（最终 tip @ `9f002a4`；原始 JSON 按 CONVENTIONS §5 不入库）
node scripts/bench-projection.mjs --label after-final --out work/tmp/after-94-final2.json
node scripts/bench-projection.mjs --label after-final --out work/tmp/after-94-final4.json
```

`PARAMS`（两次完全相同）：`historyTurnCounts [40,160]`、`replyChars 2048`、`chunkSize 16`、
`streamChunkDelayMs 15`、`observerCounts [1,2]`、每个组合 `repetitions 2`、`readSamples 32`、
`readSampleIntervalMs 10`、`rssSampleIntervalMs 25`。基线 JSON 的 `ticket` 为 88；改造后脚本
在本次 review 中改为 spec 级 `ticket: 72` 并增加 `label` 字段，测量逻辑未变。

环境：Node v24.18.0，WSL2，AMD Ryzen 9 8945HX / 32 逻辑核。两次改造后运行的启动负载为
`2.58` 与 `2.60`（结束 `2.38` / `1.55`），与基线三次的 `1.75–3.73` 同量级。**另有 5 次在
load 5–21 下运行的读数**（160/1 的 p95 一度到 106 ms、每片段 CPU 到 6.55 ms），按
「同一窗口内负载不得与另一 launcher/测试负载并发」的约定判为噪声，不参与下表；这也说明
后面所有门槛都只适用于静默窗口。改造后可用内存为 19.5 GiB，基线机记录为 23.5 GiB；WSL
内存配置变化会影响绝对内存值，因此内存只看同口径的相对比值。

## 2. 对比表（基线每格 6 个重复 = 3 次运行×2；改造后 4 个重复 = 2 次静默运行×2，取中位数）

| 历史 | 观察者 | 基线 read p95 (ms) | 改造后 read p95 (ms) | 基线 每片段 CPU 合计 (ms) | 改造后 每片段 CPU 合计 (ms) | 基线 每观察者 (ms) | 改造后 每观察者 (ms) | 基线 峰值内存 (MB) | 改造后 峰值内存 (MB) | 基线 payload (MB) | 改造后 payload (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | 1 | 9.90 | 8.37 | 2.01 | 1.61 | 2.01 | 1.61 | 243 | 258 | 27.19 | 27.40 |
| 40 | 2 | 12.77 | 11.41 | 3.11 | 2.73 | 1.56 | 1.36 | 247 | 258 | 54.40 | 54.83 |
| 160 | 1 | 10.14 | 8.77 | 2.60 | 1.65 | 2.60 | 1.65 | 352 | 373 | 27.22 | 27.44 |
| 160 | 2 | 15.38 | 14.01 | 4.25 | 2.92 | 2.13 | 1.46 | 352 | 378 | 54.45 | 54.88 |

「每片段 CPU」是 `cpuMs / fragments`，已扣掉脚本估算的探针 CPU（`cpuMsPerFragmentExcludingProbeApprox`）；
「每观察者」再除以观察者数。基线表原先把 2 观察者的合计值误标为每观察者，本表按同一 JSON 重算，
见 `ticket-88-baseline.md` 的更正。

## 3. 相对门槛与判定

所有门槛都是**相对同机基线**的比值，不用绝对毫秒；取整到 0.01。

| 门槛 | 定义 | 基线读数 | 改造后读数 | 判定 |
| --- | --- | --- | --- | --- |
| 历史斜率 | 160 轮每观察者 CPU ÷ 40 轮同口径 | 1.29（1 观察者）/ 1.37（2 观察者） | **1.03 / 1.07** | 通过；门槛 ≤1.20，改造后接近平坦 |
| 160 轮成本回归 | 改造后 160 轮每观察者 CPU ÷ 基线同格 | 1.00 | **0.64 / 0.69** | 通过；门槛 ≤0.85 |
| 观察者放大 | 2 观察者每片段 CPU 合计 ÷ 1 观察者合计（160 轮） | 1.63 | **1.76** | 通过；门槛 ≤1.80，不是 2×（接近门槛，见 §4） |
| 流式 read p95 | 改造后 ÷ 基线同格 | 1.00 | **0.85 / 0.89 / 0.86 / 0.91** | 通过；门槛 ≤1.50 |
| 峰值内存 | 改造后 ÷ 基线同格 | 1.00 | **1.06 / 1.05 / 1.06 / 1.07** | 通过；门槛 ≤1.25 |
| SSE payload | 改造后 ÷ 基线同格 | 1.00 | **1.008 / 1.008** | 通过；门槛 ≤1.05 |

门槛取值理由：历史斜率用 1.20，给 20% 的读数抖动余量；160 轮成本用 0.85，要求相对基线有
可观测改善而不是持平；观察者放大用 1.80，既能抓住「第二套全量 fold」的 ~2×，又不把每观察者
各自的格式化和 payload 序列化误判为回归；read p95/内存/payload 用 1.50/1.25/1.05，吸收本次
静默窗口内仍存在的 p95 抖动（40 轮 p95 改造后略高 14–18%，但 p50 与基线同量级）。

这些门槛不是手工比较，而是 `scripts/bench-gate.mjs` 的可执行判定。改造后的 JSON 不随仓库
保留；先按 §1 重新生成两次，再运行：

```bash
npm run bench:gate -- \
  --baseline work/implementation/evidence/72-projection-perf/baseline-run1.json \
             work/implementation/evidence/72-projection-perf/baseline-run2.json \
             work/implementation/evidence/72-projection-perf/baseline-run3-final-tip.json \
  --after work/tmp/after-94-final2.json work/tmp/after-94-final4.json
# → 18 checks, bench-gate: all gates pass（本机本次运行）
```

`tests/bench-gate.test.mjs` 固定了门槛算术与失败方向：160 轮 CPU 回归会同时让
`historySlope`/`cost160` 变红，缺 cell 会让整体失败，而不是静默跳过。

## 4. 改善与未改善（实测口径）

**改善：**

- 每片段 CPU 与历史长度基本脱钩：基线 40→160 轮为 ×1.29/×1.37，改造后为 ×1.03/×1.07。
  这是本次最直接的 spec 目标：160 轮不再为重放全部历史付固定成本。
- 160 轮每片段 CPU 降到基线的约 64%/69%（1/2 观察者）；40 轮约 80%/88%，改善较小，
  与「固定成本占比较高」一致。
- 160 轮流式期 `/chat/read` p95 从 10.14/15.38 ms 降到 8.77/14.01 ms；静默期 p95 也从
  7.89/8.01 ms 降到约 6.3/6.9 ms。40 轮 p95 本次也低于基线（0.85/0.89），但两轮样本
  不足以把 40 轮的差值当成稳定收益。
- 观察者共享：2 观察者合计成本约为 1 观察者的 1.76 倍，不是 2 倍，但已接近 1.80 门槛；
  #93 的行为测试另证「同会话两个 observe 共用一次 seed 与一份单元状态」。这一项按门槛通过
  记录，不声称有大幅改善。

**未改善 / 需说明：**

- **峰值内存没有下降**：改造后 160 轮约 373–378 MB，基线 352 MB（+6–7%）；40 轮 +5–6%。
  原因是事件窗口保留完整已提交前缀，单元状态也常驻；本 spec 不实施 projection cache，
  冷会话仍由 dsh resume 载入整份日志。这里的数字**不能**支持「内存更低」的结论。
- **payload 增加约 0.8%**：27.40/54.83 MB vs 27.19/54.40 MB。SSE 形状未改，差异来自
  事件数/组合的细微变化；payload 缩减明确不在本 spec 范围。
- **观察者合计放大比 1.76，接近 1.80 门槛**（基线 1.63）：共享的是 durable fold，第二个
  观察者仍要为自己的窗口格式化并支付一份 SSE 字节。门槛只要求不出现 ~2× 的第二套 fold；
  这一项本机本轮余量很小，后续运行要同时看 #93 的行为测试与门槛。
- **组合漂移**：dsh `fe2bbc3 → 5b8ec0f`，差值包含上游/并行 spec 的变化；本表只证明
  「本组合上达到相对门槛」，不证明全部差值是投影改造带来的。
- **没有分页基准**：`/chat/page` 的「只读本页区间、消息只格式窗口行」由
  `tests/chat-page-cut.test.mjs` 的事件区间断言与 `tests/projection-units.test.mjs` 的
  窗口扫描测试固定（5000 行状态上，窗口读取的行访问数 <100；全量扫描会变红），未在本基准里
  另设分页负载。

## 5. 未执行项

- 没有真实云模型、Android 设备、跨机比较。
- 没有长时内存曲线（只有单轮 RSS/VmHWM 采样）。
- 没有 projection cache / compaction / token meter；这些不在本 spec。
- 高负载下的 3 次运行不参与比较，只作为噪声记录；若未来在 CI 跑，必须先确认 load 与
  无并发 launcher，再按本表门槛判定。
