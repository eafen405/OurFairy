# 测试质量、漂移与分层审查（仓库维护者视角）

日期：2026-11-04
范围：`tests/`（101 个文件 / 658 个用例 / 29,690 行）、`scripts/precommit.ts`、`.githooks/`、`.github/workflows/check.yml`
基线：`/tmp/baseline-clean.log`（串行、无并行构建）—— `tests 665 | pass 663 | fail 2 | duration_ms 458603`
约束：本文件是唯一写入；未改 `tests/`、`scripts/`、源码。

## 0. 结论摘要

套件整体不"虚"。实测断言密度是 **3,057 条断言 / 658 个用例**，零断言用例 0 个，重复用例标题 0 个。问题不在"写得少"，而在三个具体的地方：

1. **两条硬断言把不该由测试保证的事固定住了**（`docs.test.mjs` 扫未跟踪文件、`projection-units-real` 冻结绝对 seq）。两条都已在干净基线上实测复现，各有确定的根因和可执行的修法。
2. **`@covers` 只写在 35/101 个文件里**，related-gate 因此对 `skill-creator` 与 6 个 `scripts/*.ts` 完全失效——改了这些文件，门禁**选不中本就会红的测试**，退化成 `typecheck`。这是"门禁看起来跑了、其实没跑到"的一类。
3. **测试分层实际上只有两层**：46 个纯启停集成、27 个直 import 单元、10 个混合、**0 个 live-llm 层在 `npm test` 里**。live-llm 全靠 `acceptance:*` 手动脚本。这一层不进门禁是**有意的设计**（README:105/118 明确写了），我**不建议**把它接进 CI——只指出 `acceptance:skill` 存在于 `package.json` 却不在 README（§5.1）。

按影响排序的完整问题清单在 §7，含每条的删除/合并/补强建议与节省估算。

### 0.1 本稿撤回的 4 条结论（复核后被反证）

初稿有 4 条结论经队友/Lead 复核后**不成立，已撤回**，保留在此以免被后人引用：

| # | 初稿结论 | 撤回理由 |
| --- | --- | --- |
| 1 | `pretest` 改成 `npm run typecheck`（增量）可消除构建竞争 | **实测反证**：增量 `tsc -b` **修不好"部分缺失的 dist"**——只删 `dist/index.js` 保留 `.tsbuildinfo` 时，`typecheck` 报 exit=0 却不重建（`After: index.d.ts`）。`--fresh` 是唯一自愈路径。改法收窄为"加构建锁"（§6.1） |
| 2 | `tests/precommit.test.mjs:16-26` 注释与代码不符（说"命令不跑"但跑了） | **`docs-keeper` 反证 + 我复核**：`--print` 在 `precommit.ts:316-318` 打印后**直接 return**，任何门禁命令都不执行。注释准确，撤回 |
| 3 | README 没写 `acceptance:*` 不在 `npm test`/CI 内 | **`docs-keeper` 反证 + 我复核**：`README.md:105` 与 `:118` 都写了且加粗。是我只读了「跑测试」节、没读下面的「真实服务验收」节。**但顺此查出真实缺口**：`acceptance:skill` 在 `package.json` 里有、README 里查不到（§5.1） |
| 4 | 删 `tests/groups-row.test.mjs`（与 `row-addressability:408` 重复，省 15 s） | **Lead 否决 + 我逐条比对确认不等价**：`groups-row` 独有 3 个观测点（管理员 `group_create` 被拒、`bash` 在 group 根被拒走 script 通道、拒绝后私有空间仍可用）。保留（§4.1） |

教训与本次审查的主线一致：**"看起来重复/看起来不一致"本身也需要实测**，我前 3 条都犯了自己在这份报告里批评的错——只读了代码没跑验证。

---

## 1. 漂移扫描（实测）

### 1.1 已确认真缺陷 A：`docs.test.mjs` 扫描未跟踪的临时目录

**复现（干净基线，串行）：**

```
✖ every relative link in the repository Markdown resolves (225.503893ms)
  AssertionError [ERR_ASSERTION]: Markdown links must resolve; broken:
  work/tmp/303/README.md -> ../../docs/research/2026-11-04-autonomous-web-intake.md
```

**根因**（`tests/docs.test.mjs:16-27`）：`markdownFiles()` 从 `repoRoot` 递归读**文件系统**，只跳过 `.` 开头目录和 `node_modules`，没有限定"已跟踪文件"。而 `work/tmp/` 在 `.gitignore:9` 里明确声明为可丢弃目录：

```
$ git check-ignore -v work/tmp/303/README.md
.gitignore:9:/work/tmp/	work/tmp/303/README.md
```

于是**任何人往 `work/tmp/` 放一个带相对链接的 scratch md，就能让全量门禁变红**。这条链接本身也确实是错的（从 `work/tmp/303/` 到 `docs/research/` 需要 `../../../`，文件写的是 `../../`），但它是 gitignored 的临时文件，不该有权弄红门禁。这是"测试的输入面比它该负责的范围宽"。

**建议改法（已实测验证）：** 把 `markdownFiles()` 的输入收敛到 `git ls-files '*.md'`，并保留现有的点目录排除。

```
git ls-files -z '*.md'  → 723 个已跟踪
其中位于点目录下: 82（.github/、android/.agents/…）
git ls-files + 点目录排除 → 扫描 641 个文件，broken = 0   ← 实测
```

两个必须注意的坑，都已实测：

- 若只换成 `git ls-files` 而**不加**点目录排除，会引入一条新假红：`android/.agents/skills/claude-api/shared/managed-agents-self-hosted-sandboxes.md -> 2000`——这是代码块里 `ReclaimOlderThanMs: param.NewOpt[int64]` 后面紧跟一个 `(2000)` 调用括号，被 `\]\(([^)\s]+)\)` 误当成 Markdown 链接。这个正则在第三种语言片段里会继续误报，属于下一层的问题（见 §2.3）。
- 用 `git ls-files` 后 `work/tmp/` 自然消失（未跟踪），`work/implementation/notes/*` 里的真实坏链仍会被抓到——**收敛没有降低灵敏度**，这正是这条修改的价值。

### 1.2 已确认真缺陷 B：`projection-units-real` 冻结了竞态结果

**复现（干净基线，串行）：**

```
✖ the units reproduce the frozen values over a real session log (8660.937138ms)
  AssertionError: transcript must match the frozen rows
    role: 2 的 todo_write 工具行
      actual seq: 14
      expected seq: 15        ← 其余 7 行完全一致，只差这一行、只差 1
```

单跑 5/5、并发 6/6 全绿（我实测），说明它不是随机的抖动，而是**由负载决定的确定性分支**。

**根因（我做了定量证明，不是猜测）：** `backend/chat/src/runtime.ts:441` 的 `backfillTitle()` 是 fire-and-forget——`void (async () => { … await titles.refresh(state.session) })()`，它写的 `session/title`（模型标题）是一条**与投影无关的辅助事件**。而 `tests/projection-units-real.test.mjs:55-62` 的 `until()` 只要业务状态满足就走，随后**立刻**读整段日志。两者比赛谁先落地。

我用同一个三回合场景、只改**标题请求的延迟**做了扫描（`/tmp/slow-title2.mjs`）：

| 标题请求延迟 | `session/title` 行 | `todo/write` seq |
| --- | --- | --- |
| 0 ms | `12, 16`（两行） | **17** |
| 20 ms | `12, 16` | **17** |
| 50 ms | `12, 19` | **16** |
| 100 ms | `12, 19` | **16** |
| 200 ms | `12, 23` | **16** |
| 400 ms | `12`（仅一行，第三行还没写） | **16** |

标题答复慢下来，`todo_write` 行就从 17 掉到 16；`session/title` 那一行则从 16 漂到 19、23，甚至干脆还没落地。fixture 里的 15 是**某一次运行中某个延迟值下的快照**。

**这条比"偶发失败"严重的地方：** `tests/projection-units-real.test.mjs:29-35` 的注释自己写了「#251 把第一个人类消息之后所有 seq 平移了 3」，也就是说这个 fixture **已经因为事件先后顺序被人工平移过一次**。说明"冻结绝对 seq"这个断言方式与"产品异步写事件"根本不兼容，下次谁调标题时机它会以同样方式再红一次。

**建议改法（第 2 个更小、第 1 个更正确——推荐第 1 个）：**

1. **断言相对结构而非绝对 seq**：`todo_write` 行紧跟在其请求的用户消息之后、行间 seq 严格单调、`session/title` 行不计入（它不属于投影契约）。fixture 保留 `role/status/text/tools` 与 `work` 的冻结值——那些是真正的投影契约，实测稳定。
2. 若想保留 fixture 原样：在 `until()` 之后加一个"等标题落定"的显式屏障（等到 title service 报告不再 pending），把竞态消掉再读日志。

**顺带一提**：`backend/chat/src/runtime.ts:441` 的 fire-and-forget 本身**不是缺陷**——它的注释明确写了"runs detached from the opening request"。缺陷在测试把它当成了可观测的确定性事实。

### 1.3 非漂移：`work/implementation/notes/2026-11-04-docs-review.md` 的两条坏链

干净基线里同一失败还包含：

```
work/implementation/notes/2026-11-04-docs-review.md -> glossary/
work/implementation/notes/2026-11-04-docs-review.md -> README.md
```

这是**队友当天新建的评审稿件**里的相对链接没写对（从 `notes/` 到仓库根是 `../../../`）。它证明 `docs.test.mjs` 的**灵敏度是对的**——收敛到 `git ls-files` 之后仍然会抓到它。这条留给 `docs-keeper` 修文，不是测试的问题。

---

## 2. 断言质量（"碰了代码但没真正验证"）

先说量化结果，避免空谈：**658 个用例、3,057 条 `assert.*`、0 个零断言用例、0 个跨文件重复标题**。薄弱点集中在下面四类。

### 2.1 用 `assert.match` 断言自由文本 —— 最弱的一类，实测 38 处

全仓 `assert.match(` 共 **446** 处，其中 **38 处**的模式是"2 个以上英文单词的择一"（`/…|…/i`），也就是对工具返回的**自然语言**做择一匹配。按文件分布（实测）：

| 文件 | 处数 |
| --- | --- |
| `tests/groups.test.mjs` | 10 |
| `tests/spaces.test.mjs` | 7 |
| `tests/groups-row.test.mjs` | 5 |
| `tests/file-delivery.test.mjs` | 5 |
| `tests/skill-runtime.test.mjs` | 4 |
| `tests/spill-read.test.mjs` | 3 |
| `tests/pdf.test.mjs` / `tests/attachments.test.mjs` | 各 2 |

其中两族最典型：

```js
assert.match(await tool(alice, 'write', { file_path: privateFile, content: 'x' }), /create|wrote|write|success/i)
assert.match(await tool(other, 'read', { file_path: privateFile }), /denied|outside|permission/i)
```

**为什么弱**：`/create|wrote|write|success/i` 对一次**成功写入**几乎恒真——任何含 "write" 的结果都会通过，包括 "cannot write to this path"。`/denied|outside|permission/i` 更含糊：工具报 "permission denied" 通过，报 "outside the workspace" 也通过，而这两件事在权限模型里完全不同（前者是 DAC，后者是沙箱边界）。

**建议：** 优先处理**断言"成功"的那 7 处**（`create|wrote|write|success`），改用工具结果的结构字段；断言"拒绝"的 31 处因为要覆盖多种拒绝原因，可保留择一，但应把模式收紧到互斥的几种 `error.code` 而不是散文词。范例已在同仓：`tests/row-addressability.test.mjs:398` 断言精确的 `unknown tool "deliver_message"`——这才是可失败的形式。

### 2.2 用源码正则充当结构检查 —— 违反 `CODING_STANDARDS.md:7`

`CODING_STANDARDS.md:7` 明确：「结构类声称（只有一份编码、不经过某层）优先做成让该形状不可能出现或无法绕开的接缝……**做不到就删除声称，不用扫源码的正则充当检查**」。

实测这类断言全仓 **28 条 `doesNotMatch`**，其中真正"读源码再正则"的只有 2 条，都在同一个用例里（`tests/identity-interfaces.test.mjs:104-114`，用例名 `the service and its consumers reach identity through the domain faces, never the store`）：

```js
// :108  —— 扫 identity/src/index.ts
assert.doesNotMatch(service, /this\.store\s*=/u, 'IdentityService must not republish the store')
// :112  —— 扫 4 个消费方源码
for (const consumer of ['delivery/src/index.ts', 'groups/src/index.ts',
                        'attachments/src/service.ts', 'search/src/index.ts'])
  assert.doesNotMatch(read(consumer), /identity\s*\.\s*store\b/u, `${consumer} must not read the bare store`)
```

其余 26 条 `doesNotMatch` 是对**运行结果**的断言（如 `memory-impression.test.mjs:300` 断言回复正文里没有旧标记、`precommit.test.mjs:367` 断言 hook 里没有 `npm test`），那些是正当的。

**为什么这是最弱的一种通过**：它守的是"源码里没有这个字符串"。任何一次等价改写（`this["store"] =`、解构后重新赋值、抽到别的文件）都会让它继续通过而规则已经破了。这正是标准里点名要避免的形态。

**建议：** 删掉 `tests/identity-interfaces.test.mjs:104-114` 这整个用例。它想守的两件事都已有更强的行为断言：同文件 `:38-45` 的 `assert.equal(face[name], undefined, `${domain} must not publish ${name}`)` 在**运行时**证明 store 成员没有漏出接口（这正是"接缝"形态，改名/重构都绕不过去）；而"消费方只走 domain faces"由 `delivery`/`groups`/`attachments`/`search` 各自的整机套件在功能层覆盖。源码正则在这里是重复且更弱的一份。

### 2.3 `docs.test.mjs` 的 Markdown 链接正则把代码块当链接

实测：`android/.agents/skills/claude-api/shared/managed-agents-self-hosted-sandboxes.md:199` 的 Go 代码片段

```go
ReclaimOlderThanMs: param.NewOpt[int64]  // 紧接着是一个 (2000) 调用括号
```

被 `\]\(([^)\s]+)\)` 匹配成 `-> 2000`。现在没爆是因为该文件在点目录下被跳过（见 §1.1 的坑）。**一旦按 §1.1 收敛而漏掉点目录排除，这条立刻变红**。

**建议：** 遍历前剥掉围栏代码块（三反引号包裹的段落），再匹配链接。这是让 §1.1 的修法安全落地的前提，建议与 §1.1 同一次改动。

### 2.3b 失败信息里写死的数字（`route-inventory.test.mjs:146`）

```js
// :145  ← 断言本身正确：实测 json=41
assert.deepEqual(countsOf(ALL.map(entry => entry.body)), { json: 41, binary: 2, none: 1 },
  '35 addresses read a JSON object; chunk and transcriptions read raw bytes; the GET reads none')
//                                    ^^ 实测 json 是 41，这里写 35
```

实测该行 `body` 分布是 `{"json":41,"binary":2,"none":1}`，所以 **`41/2/1` 正确、而同一行失败信息里的 `35` 是错的**。

**为什么这条特别值得修**：`assert` 永远不会抓到它（断言是对的），只有**当它红的时候**人才会读这句话——也就是**在最需要看清事实的时刻给出一个错的数字**。数字已经会在 `actual`/`expected` 的 diff 里出现，在文案里再抄一遍必然漂。

**建议：** 失败信息不写数字，写来源与分类：

```js
'every address declares its request body; json rows read a JSON object, chunk and transcriptions read raw bytes, the GET reads none'
```

这条与 `docs-keeper` 复核一致（其清单 §」复述代码」类）。

### 2.3c 本报告自身踩中了 §2.3（实证）

我在写这份报告时，引用那段 Go 代码（`param.NewOpt[int64]` 后面紧跟一个 `(2000)` 调用括号）作为示例，结果 **`docs.test.mjs` 立刻把我的报告也报成坏链**（`… -> 2000`，连报 4 次）。这不是巧合，是 §2.3 那个正则缺陷的**可复现证明**：任何人写文档解释这个话题，都会撞上它。这也是为什么 §7 里 #1 和 #2 必须同批修。

### 2.4 值得表扬的一处（作为写法范例）

`tests/ecosystem-boundary.test.mjs:88-124` 的 `CITED_CHECKS`：文档每一条"这个限制有测试守着"的声称，都被拿去和**真实测试标题**对账，标题改名或删除就红。这是"声称须可执行"的正确落地方式，建议 §7 的问题都按这个模式修。

---

## 3. `@covers` 与 related-gate：门禁实际选不到什么

`scripts/precommit.ts` 的选择器读两个信号：测试体里出现 `backend/<pkg>/` 或包名，以及测试文件自己写的 `@covers backend/<package>` 行。实测 `@covers` 只覆盖 **35/101** 个文件。

### 3.1 缺陷 C（重要）：`skill-creator` 有 14 个测试文件，门禁只选得中 9 个

```
$ node -e "…relatedTests(['backend/skill-creator/src/index.ts'])…"
SELECTED (11): identity-http, route-inventory, skill-creation-store, skill-evolution-display,
  skill-install, skill-learning-material, skill-learning-store, skill-learning,
  skill-package, skill-runtime, skill-verify
SKILL TEST FILES: 14
NOT SELECTED: skill-creation, skill-evolution, skill-install-product,
              skill-review-entry, skill-sharing
```

漏网的 5 个**恰恰是最重的一批**（都是真启后端 + 模型替身的整机套件），单跑耗时实测：

| 文件 | 单跑 duration |
| --- | --- |
| `tests/skill-evolution.test.mjs` | **103 s** |
| `tests/skill-sharing.test.mjs` | 19.5 s |
| `tests/skill-install-product.test.mjs` | 12.0 s |
| `tests/skill-review-entry.test.mjs` | 9.1 s |
| `tests/skill-creation.test.mjs` | 19.8 s |

**根因**：这 5 个文件里 **`@covers` 0 处、`backend/skill-creator/dist` 直接 import 0 处**（实测）。它们只通过启动器 + HTTP 驱动 `skill-creator`，正是 `precommit.ts:155-163` 注释里描述的那个场景——注释说"文件自己声明",但这 5 个文件没有声明。

**后果**：改一行 `backend/skill-creator/src/*.ts`，门禁跑的是 11 个文件（含 6 个只沾边的），而**真正会红的 5 个整机套件一条都不跑**。约 164 s 的验证被跳过，门禁显示绿灯。

**建议：** 给这 5 个文件各加一行 `@covers backend/skill-creator`（照 `groups-row.test.mjs:11`、`delivery-row.test.mjs:11` 的现成写法）。这是纯注释改动，无行为风险，且立刻被 `precommit.test.mjs` 的既有选择逻辑覆盖。

### 3.2 缺陷 D：6 个脚本改动落进 `typecheck`，但其中 1 个其实有测试

```
scripts/bench-projection.ts   NO TEST MENTIONS IT
scripts/evidence-index.ts     NO TEST MENTIONS IT
scripts/measure-presentation.py NO TEST MENTIONS IT
scripts/pdf-flash-smoke.ts    NO TEST MENTIONS IT
scripts/skill-acceptance.ts   NO TEST MENTIONS IT
scripts/real-acceptance.ts    SELECTED 0, MENTIONED-BY 2, MISSED: precommit.test.mjs, real-acceptance.test.mjs
```

前 5 个无测试属正常（它们要么是手动验收脚本，要么是基准脚本），落 `typecheck` 是设计意图。

**但 `real-acceptance.ts` 是错的**：`tests/real-acceptance.test.mjs` 有 4 个用例、全部直接 `spawnSync(process.execPath, [join(repoRoot, 'scripts', 'real-acceptance.ts'), …])`。选择器选不中它，因为 `real-acceptance.test.mjs:150` 的注释特意说明了用 `['scripts', 'real-acceptance.ts'].join('/')` 拼路径——**目的就是让 `precommit.test.mjs` 自己不被误选**（`tests/precommit.test.mjs:229-238` 的注释写明了这个理由）。副作用是 `real-acceptance.test.mjs` 也永远选不中。

而且 `tests/precommit.test.mjs:229-238` 的 `'a source change no test names falls back to the type check'` **正是拿 `scripts/real-acceptance.ts` 当"没有测试引用"的样例**——这个样例已经不再为真。

**建议（二选一，我倾向第二个）：**
- 换一个确实没有测试的路径当样例（例如 `scripts/pdf-flash-smoke.ts`，实测无任何测试提及），并把 `real-acceptance.ts` 从拼接改为字面量，让 `real-acceptance.test.mjs` 能被选中；
- 或保留拼接，但把 `precommit.test.mjs:229` 那条用例的样例路径改成 `scripts/pdf-flash-smoke.ts`，并在 `real-acceptance.test.mjs` 里加一行 `@covers` 不适用——直接改用 `scripts/real-acceptance.` 的字面量（该文件本来就 spawn 它，字面量更自然）。

### 3.3 缺陷 E：17 个测试文件"只有自己被 staged 才跑"

实测：这些文件的正文里既没有 `backend/<pkg>/`、也没有 `scripts/*.`、也没有 `@covers`：

```
bundle-groups, bundle-manifest, chat-page-cut, config-contracts, docs,
install-recovery, lifecycle, model-double, real-acceptance, scoped-provider-rows,
skill-evolution, skill-review-entry, skill-sharing, spill-read, start-readiness,
story-coverage, template-reuse
```

对它们而言，任何**源码**改动都不会选中它们；只有改到它们自己才跑。其中 `chat-page-cut.test.mjs` 直接驱动 `runtime.page`、`config-contracts.test.mjs` 检查各 row 的配置 schema、`lifecycle.test.mjs` 检查启停——这三个明显属于某个包的表面。

**建议：** 与其逐个补 `@covers`（会陷入打补丁），不如让**选择器的兜底更响亮**：当一次源码改动选出的测试数 > 0 但某个包"有测试目录归属却未被选中"时，打印警告。不过这属于新机制，按 AGENTS.md「规模校准」应只在**当前已观测到的失败**上加——目前观测到的失败就是 §3.1 的 5 个文件，先就地补 `@covers` 即可，不建议现在建机制。

### 3.4 `precommit.test.mjs` 本身的质量：好

它的 28 个用例里，选择逻辑的每条规则都有独立用例（模式分类、Android 附加、merge、`--full`、45 条上限、`testFiles` 与 `npm test` glob 的一致性、hook 可执行位、CI 的 job 切分）。这部分**是本次审查里质量最高的测试**，不需要改。

**一处我原稿写错、已撤回的指控**：我曾写这条注释与代码不一致（因为 `:313` 确实 `execFileSync` 了 `scripts/precommit.ts`）。`docs-keeper` 核出反证，我复核确认其对：

```js
// tests/precommit.test.mjs:313
execFileSync(process.execPath, ['scripts/precommit.ts', '--print', '--merge'], { ... })
// scripts/precommit.ts:316-318
if (print) { process.stdout.write(...); return }   // ← 打印完直接 return
```

`--print` 在跑任何门禁命令**之前**就返回（`precommit.ts:316-318`）。所以「The commands themselves are not run」**准确**：该文件断言的是**决策**（mode / commands / paths），不是门禁跑通。这条撤回，§3.4 的结论是"无需改动"。

---

## 4. 重复与冗余

### 4.1 同一场景写了两个整机套件：`groups-row` vs `row-addressability`

两者各有一个**标题几乎相同**的用例：

```
tests/groups-row.test.mjs:99   'disabling the groups row removes the group tools and roots, not the file spaces or scripts'
tests/row-addressability.test.mjs:408  'disabling the groups row removes its tools and roots, not the file spaces or scripts'
```

只差 "the" 与 "the group" 两处措辞（所以按标题去重扫描是 0 命中，得人工看）。断言内容也高度重叠：都不提供 group 工具、私有/公共文件空间仍可用、group 根被拒绝（`/outside|denied/i`）、脚本仍可跑。

**实测成本：**

| 文件 | 单跑 duration | 用例数 |
| --- | --- | --- |
| `tests/groups-row.test.mjs` | **15.4 s** | 1 |
| `tests/row-addressability.test.mjs` | **59.6 s** | 6 |

**我原稿建议删 `tests/groups-row.test.mjs`，Lead 否决，我复核后同意保留——因为它们并不等价。**

我原稿只说"场景高度重叠"，没有验证断言集是否等价。逐条比对后，`groups-row` 有 3 处断言在 `row-addressability:408` 里**不存在**：

| 差异 | `groups-row.test.mjs` | `row-addressability.test.mjs:408` |
| --- | --- | --- |
| **管理员**调用 `group_create` 被拒 | 有（`:125`，`tool(admin, 'group_create', …)`） | 无（该用例只用 alice） |
| **`bash` 在 group 根**被拒 | 有（`:121`，`workdir: groupRoot`） | 无（只有 `read` / `write` 两个路径被拒） |
| 拒绝之后**私有空间仍可用** | 有（`:129` 复读私有文件） | 无 |

第二、三条尤其重要：`bash` 走的是 `spaces` 的 script 通道，与 `read`/`write` 的文件通道是**不同的授权路径**——只测 `read`/`write` 被拒，证明不了脚本通道也被关。"拒绝之后仍可用"则是防止测试在越权把整个 spaces 搞坏时假通过。

所以这是 **"场景相同、观测点不同"**，不是机械复制（跨文件重复标题实测确实是 0）。**保留两个文件。节省 15 s 不值得减掉 3 个独立观测点。** 我撤回删除建议。

### 4.2 重复的 inline 测试辅助函数

实测（只在 `tests/*.test.mjs` 内计数）：

| 函数 | 定义它的文件数 |
| --- | --- |
| `function request(` | **28** |
| `function tool(` | **14** |
| `function signIn(` | **12** |
| `function until(` | **12** |
| `function freshHome(` | **11** |

`signIn` 的 12 份实现有 4 种不同签名（`(port,name,pw)` / `(port)` / `(name,pw)` / `(port,name,pw)` 返回 `.json` 或 `.token`），其中 7 份是逐字相同的 `phaethon` 特化版本。

**建议：** 只合并**逐字相同**的那 7 份 `signIn(port)` 进 `tests/helpers/backend.mjs` 并导出 `signInPhaethon(port, password)`。**不建议**动 `request`/`tool`/`until`——它们各自捕获了不同的模块级状态（`port`、`alice` 等闭包变量），抽成公共函数要么传一堆参数、要么变成隐式全局，反而更难读。这是"重复但不同耦合"的正当情况。

### 4.3 `helpers/` 里的死代码（实测无任何测试引用）

| 位置 | 情况 |
| --- | --- |
| `tests/helpers/dsh-peers.mjs:69` `resolveDshPeer` | 0 处引用（`registerHooks` 那个副作用才是它存在的理由，再导出这个函数是多余的） |
| `tests/helpers/title-aware.mjs:33` `DOUBLE_TITLE` | 仅模块内部使用，导出无意义 |
| `tests/helpers/title-aware.mjs:41` `isTitleRequest` / `:57` `answerTitle` | 仅模块内部使用（`answerIfTitle` 是它们的对外包装） |
| `tests/helpers/backend.mjs:25` `backendScript` | 仅模块内部使用 |
| `tests/helpers/backend.mjs:54` `mergedEnv` | 仅模块内部使用 |
| `tests/helpers/backend.mjs:72` `EPHEMERAL_PORT` | 仅模块内部使用 |
| `tests/helpers/fake-corepack.mjs` 三个常量 + `runFakeCorepack` | 仅模块内部使用 |
| `tests/helpers/tar-archive.mjs:18` `TAR_TYPE` | 仅模块内部使用 |

**建议：** 去掉这 11 处 `export` 关键字（不改文件结构、零风险）。**注意**：`tests/helpers/` 在 `precommit.ts:111` 的 `FULL_AUTHORITY` 里，任何改动会触发一次全量门禁——所以这条建议应该和别的 helpers 改动**合并成一次提交**，别单独提。

---

## 5. 分层评估

按"是否启动真实后端 / 是否直 import 产品源码"两维自动分类（脚本 `/tmp/tiers.mjs`）：

| 层 | 文件数 | 说明 |
| --- | --- | --- |
| **boot-only**（启动器 + HTTP，不 import 源码） | **46** | 真后端 + 模型替身，最厚的一层 |
| **unit**（直 import `backend/*/dist/*.js`） | **27** | 纯函数/窄接口 |
| **mixed**（两者都有） | **10** | 同一文件里既有单元也有整机 |
| **other**（纯脚本/文档/结构检查） | **18** | `docs`、`story-coverage`、`precommit`、`android-source` 等 |
| **live-llm**（真模型，在 `npm test` 内） | **0** | —— |

### 5.1 缺的那层：live-llm 完全在门禁之外

`npm test` 一条都不调真模型（这是**对的设计**——README 明确写"不联网、不调用真实模型"）。但 live-llm 也只有 4 个手动入口：

```
npm run acceptance:real     scripts/real-acceptance.ts
npm run acceptance:memory   scripts/memory-acceptance.ts
npm run acceptance:skill    scripts/skill-acceptance.ts
（未合入）                   ticket/302-persona-249 分支的 scripts/persona-acceptance.ts
```

CI（`.github/workflows/check.yml`）**一条都不跑**。所以"真模型下的质量"在整个自动化门禁里是零覆盖，只有人记得手动跑时才有。

**我原稿说"README 没写这件事"是错的，已撤回。** `docs-keeper` 指出并附了原文，我复核确认：

```
README.md:105  `acceptance:real` 是操作者显式发起的真实服务验收，**不属于 `npm test` 或 CI**。
README.md:118  `acceptance:memory` 是记忆增量的真实轻量模型质量样本，同样**不属于 `npm test` 或 CI**。
```

两句都在，且加粗。**这一层的边界是有文档的**，我此前只读了「跑测试」节、没读到下面的「真实服务验收」节。

**但顺着这条核下去，发现一个真实的缺口**（归 `docs-keeper` 清单 §6.3，我复核成立）：

```
$ grep -n "acceptance:skill" README.md     → 无命中
$ node -e "…scripts…" | grep acceptance    → real / memory / skill
```

`package.json` 有 **`acceptance:skill`**（`scripts/skill-acceptance.ts`），README 的真实服务验收节**只写了 `real` 与 `memory`**。属"环境里有、文档查不到"。这是文档缺口，不是我的测试质量轴，仅记录并交叉给 `docs-keeper`。

**我的判断不变：** 这一层不进门禁是**合理的设计**（个人项目、真模型有成本）。我不建议把它接进 CI。

### 5.2 过厚的地方：`skill-*` 一族

| 簇 | 文件 | 用例 | 行数 | 占全量行数 |
| --- | --- | --- | --- | --- |
| `skill-*` | **14** | **165** | **8,129** | **27.4%** |
| `memory-*` | 5 | 32 | 2,047 | 6.9% |
| `chat-*` | 8 | 30 | 1,563 | 5.3% |

`skill-*` 一个簇占了**超过四分之一**的测试代码（`skill-learning` 1,233 行、`skill-evolution` 1,213 行、`skill-creation` 856 行）。而 `docs/specs/fairy-skills.md` 只有 391 行规格。

这**不一定错**——技能系统确实是最大的一个增量。但结合 §3.1（其中 5 个最重的文件门禁选不中）来看，它同时也是**门禁覆盖最差的一簇**。所以这里的动作不是"删测试"，而是 §3.1 的补 `@covers`。

### 5.3 明确不建议做的事

用户已明确说「agent 相关测试不用测那么狠，dsh 上游已兜底」。据此我**不建议**：

- 给 `backend/chat/src/runtime.ts`、`backend/chat/src/persona.ts` 等 agent 层模块补"纯函数级测试面"（它们现在只有整机路径，这是对的）；
- 为 `backend/memory/src/material.ts`（34 个无直接 importer 的模块之一）单独建测试——`arch-review` 提到它与 `skill-creator/src/material.ts` 逐字节相同、且只有后者有直接测试面。**我的口径是：不要给 memory 那份补测试**。正确做法是 `arch-review` 提的合并成单一 module，届时测试面自动合一；在合并之前补测试等于把即将删除的副本固定在测试里。

---

## 6. 门禁可重复性（本节最重要）

**一条只在干净机器上才绿的测试套件，等于没有门禁。**

本次审查期间，同一套代码出现了三份彼此矛盾的基线：

| 基线 | 环境 | 结果 |
| --- | --- | --- |
| `/tmp/baseline-fulltest.log` | 前台 `npm run build` 与 `npm test` 并行 | 707 绿 / **上百红** |
| 我的并发压测 | 7 个重套件并行 + 后台构建 | 6 个套件红，全是 `start exited 1` |
| `/tmp/baseline-clean.log` | 串行 | 663 绿 / **2 红** |

### 6.1 根因一：`--fresh` 构建会删掉别的进程正在用的产物（已实测复现）

`scripts/tsc.ts:59-63` 的 `cleanProducts()` 直接 `rmSync(join(backend, pkg, 'dist'), { recursive: true })`。`npm run build` = `tsc.ts --fresh`，而 `npm test` 的 `pretest` 也跑 `npm run build`。**两个构建互相删对方的产物**，正在跑的测试立刻收到：

```
ourfairy-backend: backend/probe (@ourfairy/dsh-baseline-probe) declares the files entry
"dist/**/*.js", which publishes no file; the profile install would copy a package
without its build output. Run 'npm run build' to produce it.
```

我自己在压测时**无意中复现了**这条（一次后台 build 撞上 6 个套件）。

**好消息：** 这条错误信息本身写得很好——`scripts/ourfairy-composition.ts:351` 的 `productSources()` 已经把"缺产物"翻译成了人话并给出修法。**坏消息：** 它只在**产物为空**时触发；当 `rmSync` 与 `tsc -b` 交错、`dist` 刚好只写了一半时，测试收到的是 `ERR_MODULE_NOT_FOUND`，几十个套件各自以"缺模块"崩掉，读者看不出根因。

**建议：** 在 `tests/helpers/backend.mjs` 的 `startedPort()` 附近，或 `scripts/ourfairy-backend.ts` 的 `start` 前置一次 `backend/*/dist` 非空检查，缺了就**一次**响亮报 `run 'npm run build'`，而不是让每个套件各自崩。这属于"把已有检查提前到更早的接缝"，不是新机制，符合「规模校准」。

**关于「把 `pretest` 改成 `npm run typecheck`」——我实测后撤回这条建议。**

先澄清一个事实（我原稿没说清，Lead 也问过）：本仓库的 `typecheck` **不是** `--noEmit`，它同样是 `tsc -b`，**会产出 `.js`**。`scripts/tsc.ts:8-10` 的注释写明了原因：「`-b` is both the build and the type check; `--noEmit` is not a second mode (it injects noEmit into referenced projects and fails with TS6310)」。实测：

```
$ rm -rf backend/search/dist && npm run typecheck
exit=0  after: index.d.ts index.js     ← 产物被完整重建
```

所以"`typecheck` 不产出 `.js`、会让干净检出跑不了测试"这个担心**不成立**。

**但这条建议仍然要撤回，理由是我随后实测出的另一个更强的问题——增量构建修不好"部分缺失"的 `dist`：**

```
$ rm backend/probe/dist/index.js      # 只删 .js，保留 .tsbuildinfo
$ npm run typecheck
exit=0                                 # ← 报成功
after: index.d.ts                      # ← index.js 没有重建！
```

原因：`tsBuildInfoFile` 是 `dist/.tsbuildinfo`（14 个包全一致），`tsc -b` 认为"这个项目的输出是最新的"，于是跳过 emit。而**`--fresh` 恰好能修**（它先 `rmSync` 整个 `dist`、连 `.tsbuildinfo` 一起删，所以增量状态失效、必然重新 emit）：

```
$ rm -rf backend/probe/dist && npm run build     # --fresh
exit=0  after: index.d.ts index.js               ← 修复
```

**结论：`pretest` 现在这条 `--fresh` 链路，是"部分产物缺失"的唯一自愈路径。** 把它换成增量构建，会让 `dist` 半损的工作区永远修不回来（而且是以"构建成功"的方式静默失败）。这比原来的并发问题更难查。

因此本条的修法收窄为一条：**只解决"两个构建并发"，不改 `--fresh`**。

- **推荐：给 `scripts/tsc.ts` 加构建锁**（`.tsbuildinfo` 旁的 lockfile，第二个构建等待或响亮失败）。既消除并发互删，又完全不动语义与自愈能力。`cleanProducts()` 删 `dist` 时会把锁一起删掉，所以锁文件要放在 `dist` 之外（例如仓库根的 `.build.lock`），否则锁自己会被清掉。
- 备用：`cleanProducts()` 保留，但 `pretest` 改为在 `npm test` 前检查 `backend/*/dist/*.js` 非空、缺失才触发 `--fresh`。这条更省构建时间，但引入"什么时候算缺"的判断，不如构建锁直接。

**Lead 裁决：本条本轮不做**（改构建脚本需独立验证），列入下一批。

### 6.2 根因二：孤儿后端进程

Lead 清理了 6 个 `ppid=1`、cwd 指向**已被删除的 worktree** 的后端进程（最老存活 23 小时）。它们占着端口且工作目录已不存在。

**这不是测试的 bug，是清理机制的缺口**：`scripts/ourfairy-backend.ts:502` 的 `leakScan()` 按 `DSH_HOME=<isolated home>` 匹配 `/proc/*/environ`，而测试的 home 在 `mkdtemp` 下、被中断时不会被清理。`/tmp` 因此积了 **81 个 `ourfairy-*` home、共 744 M**。

**建议：** `leakScan()` 之外加一个"启动时扫描所有 `ourfairy-backend.ts start` 的进程，cwd 不存在则报告"的诊断——但按「规模校准」，这条只在**已观测到**（Lead 已观测到 6 个）的前提下加。最小版本：在 `backend:doctor` 里加一行"orphaned backends: N"，不做自动清理。

### 6.3 明确不是问题的部分

- **没有共享端口**：全部测试用 `OURFAIRY_PORT=0`（`tests/helpers/backend.mjs:72` 的 `EPHEMERAL_PORT`，注释解释了原因——3080 会被 `dsh web` 占用）。
- **没有写入仓库的测试**：`grep` 实测无 `writeFileSync(join(repoRoot…))`。
- **`/tmp` 固定路径只有 4 处**，都是纯字符串输入（`sandbox-network-profile.test.mjs` 和 `skill-evolution-display.test.mjs` 的假环境描述），不产生冲突。
- **改 `dist` 之后 3 个"疑似抖动"的用例全绿**（`owned-sessions` 的 2 个、`memory-maintenance` 的 predicate、`native-compaction` 的 cold restore）。它们此前在脏环境下红，属 §6.1 的下游症状。

**特别澄清 `memory-maintenance` 的 predicate 用例**：我一度怀疑它 `setImmediate` 三次就断言是无屏障竞态，并写了一个"慢 `list()`"的复现（`/tmp/repro-tick2.mjs`）——让 `sessionPersistence.list()` 延迟 40 ms，断言确实变成 `[]`（红）。**但真实测试里 `list()` 是内存数组、实测 200 轮无抖动**，所以它**当前不是缺陷**。记录在此是因为它是同一形状的隐患：`await flush(); await flush(); await flush()` 是对"异步链恰好 3 跳"的隐性假设，将来 `#bootstrap()` 里多一个 `await` 就会变成真的竞态。**建议**：把三次 `flush()` 换成一个"等到 `observed` 满足条件"的轮询（`until()` 在本仓库已有 12 份实现，属既有模式），一行改动消除隐性假设。

---

## 7. 可执行清单

按"改什么 / 为什么 / 怎么改 / 省多少 / 风险"排列。**P0 = 真缺陷，会弄红门禁或让门禁漏测。**

**分批状态（按 Lead 裁决）：**
- ✅ **本轮不改代码** —— 本轮是审查，所有条目都只登记建议。修 `tests/`、`scripts/`、源码需独立验证。
- 🔜 **下一批 A（P0 #1–#4）**：都是小改动、可独立验证、收益明确，建议紧接着做。
- 🔜 **下一批 B（P0 #5、P1、P2）**：涉及构建脚本或较大重构，需独立验证后再动。

### P0（🔜 下一批 A，除 #5）

| # | 文件 | 问题 | 建议改法 | 收益 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | `tests/docs.test.mjs:16-27` | 扫未跟踪的 `work/tmp/`，任何人放 scratch md 就能弄红全量 | `markdownFiles()` 改为 `git ls-files -z '*.md'` + 保留点目录排除（实测 641 文件、0 坏链） | 门禁不再被临时文件左右 | 低；需与 #2 同批 |
| 2 | `tests/docs.test.mjs:31` | 链接正则把代码块里的 `](` + 数字 当链接 | 匹配前剥掉三反引号围栏块 | #1 才能安全落地 | 低 |
| 3 | `tests/projection-units-real.test.mjs:96-113` + `tests/fixtures/projection-real-expected.json` | 冻结绝对 seq，被 `backfillTitle` 的 fire-and-forget 竞态左右（实测延迟 50 ms 即翻转） | 断言相对结构（工具行紧跟其请求的用户消息、seq 严格单调），或加"等标题落定"屏障 | 消除 1 个真缺陷、1 类未来复发 | 中；需重生成 fixture 的 seq 字段 |
| 4 | `tests/skill-creation.test.mjs`、`skill-evolution.test.mjs`、`skill-install-product.test.mjs`、`skill-review-entry.test.mjs`、`skill-sharing.test.mjs` | 5 个最重整机套件（合计 ~164 s）门禁选不中 | 各加一行 `@covers backend/skill-creator` | 源码改动时找回 164 s 的真实验证 | 极低（纯注释）；**需跑 `precommit.test.mjs` 验证真的选中了** |

### P0（🔜 下一批 B）

| # | 文件 | 问题 | 建议改法 | 收益 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 5 | `scripts/tsc.ts`（**不是** `package.json pretest`） | 两个构建并发时 `cleanProducts()` 互相 `rmSync` 产物 | **加构建锁**（仓库根 `.build.lock`，放 `dist` 之外）。**不要**把 `pretest` 改成增量构建——实测增量构建修不好"部分缺失的 dist"（见 §6.1） | 消除整类"缺模块"假红 | 中；改构建脚本需独立验证 |

### P1（🔜 下一批 B）

| # | 文件 | 问题 | 建议改法 | 收益 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 6 | ~~`tests/groups-row.test.mjs`~~ | ~~与 `row-addressability.test.mjs:408` 重复~~ | ❌ **已撤回，保留该文件**。逐条比对后二者**不等价**：`groups-row` 独有 3 个观测点——管理员调 `group_create` 被拒（`:125`）、`bash` 在 group 根被拒（`:121`，走的是 script 通道而非文件通道）、拒绝后私有空间仍可用（`:129`）。详见 §4.1 | 不删 | —— |
| 7 | `tests/precommit.test.mjs:229-238` | 用 `scripts/real-acceptance.ts` 当"无测试引用"样例，但 `real-acceptance.test.mjs` 就在引用它 | 样例换成 `scripts/pdf-flash-smoke.ts`（实测无测试提及） | 用例恢复为真 | 低 |
| 8 | `tests/real-acceptance.test.mjs:150` | 用 `['scripts','real-acceptance.ts'].join('/')` 躲选择器，副作用是自己永远选不中 | 改字面量，让 related-gate 能选中本套件 | 4 个用例纳入门禁 | 低；需同步改 #7 |
| 9 | `tests/identity-interfaces.test.mjs:104-114`（整个用例） | 读源码再正则，充当结构检查（违反 `CODING_STANDARDS.md:7`）；等价改写即可绕过 | 删除该用例；`:38-45` 的运行时断言已覆盖同一事实 | 去掉 1 个假通过用例 | 低 |
| 10 | 6 个文件共 38 处自由文本择一断言（见 §2.1 分布表）；先做断言"成功"的 7 处 | `/create\|wrote\|write\|success/i` 对成功写入近乎恒真 | 改断言工具结果结构（照 `row-addressability.test.mjs:398` 的 `unknown tool "X"` 范例） | 7 条断言变成真验证 | 低 |

### P2（🔜 下一批 B）

| # | 位置 | 建议 | 收益 |
| --- | --- | --- | --- |
| 11 | `tests/helpers/backend.mjs`、`dsh-peers.mjs`、`title-aware.mjs`、`fake-corepack.mjs`、`tar-archive.mjs` 共 11 处 | 去掉仅内部使用的 `export` | 减少误用面 |
| 12 | 7 份逐字相同的 `signIn(port)` | 合并进 `helpers/backend.mjs` 导出 `signInPhaethon` | ~50 行 |
| 13 | `tests/memory-maintenance.test.mjs:696` 三次 `flush()` | 换成一个轮询 `until()` | 消除隐性 3 跳假设 |
| 14 | `tests/precommit.test.mjs:16-26` 注释 | 说"命令不跑"，但 `:298-330` 实际跑了 | 一句话修正 |
| 15 | `README.md`「跑测试」节 | 补一句"live-llm 层不在 `npm test` 与 CI 内，交付前手动跑 `acceptance:*`" | 消除"三层都跑了"的误解 |
| 16 | `scripts/ourfairy-backend.ts` `leakScan()` | `backend:doctor` 加一行 "orphaned backends: N"（不自动清理） | 让 6 个孤儿进程这类问题可见 |

### 不建议做（明确列入本轮范围外）

- 给 agent 层（`chat/src/runtime.ts`、`persona.ts`）补纯函数测试面 —— 用户已明确 dsh 上游兜底。
- 给 `backend/memory/src/material.ts` 补测试 —— 等 `arch-review` 把它与 `skill-creator` 的副本合并后，测试面会自动合一。
- 为 §3.3 那 17 个文件逐个补 `@covers` 并新建选择器告警机制 —— 当前只观测到 §3.1 这一处真实漏测，先就地修。

### 时间估算

| 项 | 当前 | 改后 |
| --- | --- | --- |
| 全量套件（串行） | 458.6 s | 不变（**没有删除任何用例**：唯一拟删项 `groups-row` 已撤回） |
| 门禁"选不中"的真实验证 | 漏 ~164 s（skill-creator 5 个整机套件） | **补回 164 s 的真实验证**（不缩短耗时，是把漏掉的验证找回来） |
| 假红造成的返工 | 本次审查中 3 份互相矛盾的基线、≥2 小时 | 消除（修 §6.1 的构建并发） |

**关于"能省多少时间"的诚实回答：几乎省不了，也不该靠删测试来省。** 这套 458.6 s 的构成是：665 个用例里最慢的 12 个占了绝大部分（`session-titles` 52 s、`owned-sessions` 49 s、`gateway` 的 shared-selection 46 s、`session-rename` 40 s、`growth confirmation` 38 s……），而它们全都在做真实启停——**这正是这一层存在的价值**。要提速只能靠把 `npm test` 拆成快/慢两组（快组进门禁、慢组进交付），但那会改变 `AGENTS.md`「验证节奏」的现有约定，超出本次审查的授权范围，仅作为观察记录在此。

全量耗时的量级问题**不在用例数量**：665 个用例里，慢的 12 个占了绝大部分时间（`session-titles` 52 s、`owned-sessions` 49 s、`gateway` 的 shared-selection 46 s、`session-rename` 40 s、`growth confirmation` 38 s……），它们都在做真实启停。**这些不该优化**——它们是这一层的价值所在。要提速只能靠分层（把 `npm test` 拆成快/慢两组，快组进门禁、慢组进交付），但那会改变 `AGENTS.md`「验证节奏」的现有约定，超出本次审查的授权范围，仅作为观察记录在此。
