# arch-62 — interface 宽于 implementation（read/select 同体、单行转发、常量收集器）

- 票：#62（地图 #69 架构收口）
- 仓库：OurFairy（后端）
- 分支：`arch/62-interface-width`
- worktree：`/home/eafen405/projects/OurFairy/.worktrees/arch-62-interface-width`
- 实现提交：`f96e389`（`refactor(backend): stop publishing interface a caller cannot observe`）
- 合并提交：`b01c746`（第二父 `704a1a9`）、`11039ee`（第二父 `ce225bb`，收尾时集成分支再次前进）
- 证据提交：本 README 所在提交（含本目录与全部日志），即**分支 tip / FINAL_SHA**；具体 SHA 见实现者报告与 merger 前置核对（票分支 HEAD == FINAL_SHA）
- 验证状态：合并后在当前代码树跑 `npm test` 120/120、`combo:verify` 3 仓 ok；证据提交再由 pre-commit hook 复跑同样两条命令并通过

> **证据重建说明（如实）**：首轮证据原写在 `/tmp/ourfairy-arch/evidence/arch-62-interface-width/`，该目录随后被系统清空丢失。本目录是**在当前合并后状态按相同命令重跑重建**的： 与  通过临时换回 `f96e389^` 的 7 个源文件重放得到（跑完已逐字节还原，`git diff f96e389` 为空），其余为当前状态实跑。首轮原始日志已不可恢复。

## 前提核对（先复核再动手）

票面行号来自评审基线 `d189d85bd`，逐条在当前 tip 复核：

| 票面说法 | 复核结果 | 证据 |
| --- | --- | --- |
| `sessions/src/service.mjs:273` `read` 与 `:287` `select` 函数体逐字相同 | **成立**，两者都是 `return await this._ownedHeader(owner, sessionId)` | `grep -n "_ownedHeader" backend/sessions/src/service.mjs` → 定义 1 处 + 委托 2 处 |
| `sessions/src/http.mjs:68`/`:75` 两条 handler 逐字相同 | **成立**，仅 `service.select` / `service.read` 不同 | 见 diff |
| `attachments/src/service.mjs:41` `validateIds` 唯一调用点是 `chat/src/service.mjs:115` | **成立** | `grep -rn "validateIds" backend/ tests/ scripts/` → 仅定义 + 1 处调用 |
| `identity/src/index.mjs:58`-`:71` `createInvite`/`register`/`signIn` 单行转发 | **部分成立**：`register`/`signIn` 是纯转发；`createInvite` **不是**（含管理员判断 `:58`-`:60`） | 见下「逐条判断」 |
| `probe` 的 `collectTools` 永远返回常量 `not-enumerable`，`report.tools` 无测试消费者 | **成立**：只有 `not-enumerable` / `service-absent` 两个常量返回；`report.tools` 无任何消费者 | `grep -rn "not-enumerable\|report\.tools\|collectTools" tests/ scripts/ docs/ backend/` |

`_ownedHeader` 保持私有：`tests/conversation-search.test.mjs` 断言 search 源码**不得**出现 `_ownedHeader`（#49 的成果），本票不改它的可见性。

## 逐条判断与改动

### 1. `read` / `select` —— 保留语义别名，共享实现

- `select` 改为 `return await this.read(owner, sessionId)`，不再重复 `_ownedHeader` 调用。别名保留：「当前会话」是真实产品概念，客户端契约有独立路径；若将来 select 真要持久化绑定，只有这一个方法变。KDoc 写明「delegates to read」「moves no persistent binding」「future effect goes here」。
- `http.mjs` 抽出 `oneSession(resolve)` 工厂，`/sessions/select` 与 `/sessions/read` 共用；**两条路由都保留注册**（`SESSION_PATHS` 未动），客户端契约不变。
- 未把 `_ownedHeader` 改成公开（#49 已把 search 改走 `read`；改公开会扩大接口，与票面方向相反）。

### 2. 单行转发 —— 删除纯转发，保留自有规则

- **`validateIds` 删除**。`uploadIdsOf` 从 `@ourfairy/dsh-attachments` 包入口导出，`chat/src/service.mjs:116` 直接 `uploadIds = uploadIdsOf(uploadIds)`。规则仍只有一份实现（`attachments/src/service.mjs:20`），只是少了一个转手名字。
- **`identity.register` / `identity.signIn` 删除**，`identity/http.mjs` 的 `/identity/register`、`/identity/sign-in` 直接调 `service.store.register(body)` / `service.store.signIn(body)`。**`createInvite` 保留**：它不是纯转发，管理员判断是 `IdentityService` 唯一的自有规则。KDoc 补了这句区分。

### 3. `collectTools` / `report.tools` —— 按删除处理

删除前确认无消费者：`tests/` 无任何 `report.tools` 断言；`scripts/ourfairy-backend.mjs` 的 `status` 只透传 `{ ok, failures, mode }`，`doctor` 完全不读 probe report 的 `tools`；`docs/`、`work/` 无引用；`backend/probe/README.md` 是唯一记载（已删）。

故删除 `collectTools`、`report.tools` 初始化与赋值，并从 README 的 report 表删掉 `tools` 行。工具目录的权威证据仍是外部模型替身捕获的 model request（`tests/model-double.test.mjs`、`tests/groups.test.mjs`），本票未削弱该证据。

## 测试（TDD，公开入口）

| 测试 | 位置 | 覆盖 | 日志 |
| --- | --- | --- | --- |
| `the probe must not report a tool section it cannot populate` | `tests/baseline-boot.test.mjs` | `collectTools`/`report.tools` 删除后的 probe 契约 | **red**：（`report.tools={"available":true,"discovery":"not-enumerable"...}`，1 fail / 5 pass） |
| `select answers exactly as read does, because switching moves no persistent binding` | `tests/owned-sessions.test.mjs` | read/select 行为等价（JSON 逐字段相等、`/sessions/list` 前后不变、durable artifact 哈希+mtime 不变） | 特征化：改动前 40/40 绿、合并后 13/13 绿 |
| `a malformed upload ID list is refused as a bad request before any session is opened` | `tests/attachments.test.mjs` | `validateIds` 删除后 chat 仍用同一 `uploadIdsOf` 规则（6 种畸形形态 → 400 `attachments/invalid-request`；良构但不存在的 id → 404，证明拒绝的是形状不是存在性） | 同上两份日志 |
| identity 转发删除 | 复用现有 `tests/identity-http.test.mjs` + `tests/identity-store.test.mjs` | register/sign-in 经 HTTP 的行为 | 同上 |

**为什么 2/3/4 是特征化测试而非 red**：这三项是行为保持的重构（删掉的转发本身不产生行为）。先把要保住的行为钉住并在**改动前**跑绿，再确认改动后仍绿。只有 probe 那条是真正的行为变更（report 少一个字段），所以有 red。

`read`/`select` 等价性与 6 种畸形 `uploadIds` 此前**没有**任何现有测试覆盖，这两条是新覆盖，不是重复造。

## 合并集成分支（`704a1a9`）

- `git merge integration/ourfairy-v1` → 唯一冲突 `backend/attachments/src/index.mjs`：#57 新增 `createDownloadResponder` 导出、本票新增 `uploadIdsOf` 导出，同一位置。**两者都保留**，未回退任一方语义（见 `b01c746`）。
- 合并后定向：#62 相关 13/13 + 33/33 绿。

### 关于合并提交用了 `--no-verify`（按 CONTEXT.md 要求写明原因与消解）

pre-commit hook 跑 `npm test`，其中 `doctor` 的 `combo combination` 检查要求「worktree HEAD 基于 integration/ourfairy-v1」。**merge 提交在 hook 运行时 HEAD 仍是合并前的票 tip `f96e389`，因此该检查在 merge 提交上必然失败**——这是检查时机与 merge 语义的固有矛盾，不是真实漂移（#57 的 `643b1c7` 同样如此）。

消解与证据：合并提交 `b01c746` 落地后，立刻在同一状态复跑 `npm run combo:verify` → **3 仓 ok / combination verified**（ 明确显示 `ourfairy … b01c746 … ok (worktree is based on the integration tip)`），并复跑 `npm test` → **120/120**。紧随其后的证据提交走**真实 hook** 并通过，证明绕过只针对 merge 提交的时机问题。

## 实际命令与结果

```bash
# 合并集成分支
git merge integration/ourfairy-v1        # 冲突 1 处，取双方并集后提交为 b01c746

# 合并后定向
node --test tests/owned-sessions.test.mjs tests/baseline-boot.test.mjs
                                          # → 13/13 pass            (green-merged-sessions-probe.log)
node --test tests/attachments.test.mjs tests/identity-http.test.mjs tests/identity-store.test.mjs
                                          # → 33/33 pass            (green-merged-attachments-identity.log)

# 验收（合并后状态）
npm test                                  # → 120/120 pass, 6 suites, 0 fail  (full-after-merge-704a1a9.log)
npm run combo:verify                      # → combination verified (3 repos ok) (combo-verify.log)
# 集成分支第二次前进到 ce225bb 后，在合并状态再跑：npm test → 120/120、combo:verify → ok
#（full-after-merge-ce225bb.log、combo-verify-ce225bb.log）

# 证据重建（换回 f96e389^ 的 7 个源文件后跑，跑完逐字节还原）
node --test tests/baseline-boot.test.mjs  # → 1 fail / 5 pass, red    (red-probe-tools.log)
node --test tests/owned-sessions.test.mjs tests/attachments.test.mjs \
            tests/identity-http.test.mjs tests/identity-store.test.mjs
                                          # → 40/40 pass, 改动前特征化 (characterization-before-change.log)
```

基线（首轮，已随 /tmp 丢失）：合并 `bd7359c` 后 `npm test` → 115/115 pass。条数变化 115 → 120 = 本票 +3（probe 1、read/select 1、uploadIds 1）+ 集成分支并入的 #47 `tests/bundle-readme.test.mjs` 1 条 + #57 相关增量。

## 未完成项 / 偏差

1. **证据目录迁移**：原 `/tmp/ourfairy-arch/evidence/arch-62-interface-width/` 被清空，本目录按当前命令重建；首轮原始日志不可恢复， 与  是重放重建（方法见文首说明）。已同时留存于 `/home/eafen405/ourfairy-evidence/arch-62-interface-width/` 与票分支 `work/implementation/evidence/arch-62-interface-width/`。
2. **merge 提交使用 `--no-verify`**：原因与消解见上节；随后 `combo:verify` + `npm test` 在同一状态全绿，证据提交走真实 hook 通过。
3. **未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue**，按纪律。
4. **范围外发现（未顺手改）**：`backend/identity/src/http.mjs` 的 `/identity/register`、`/identity/sign-in` 现在直接读 `service.store`。`store` 本就是 `IdentityService` 的公开字段，且 `search`/`delivery`/`groups`/`attachments` 已在跨包读 `ctx.identity.store`，不是新开的口子；但「路由绕过 service 读 store」与「服务只暴露业务规则」两种风格在同一文件并存。若将来 `register`/`signIn` 需要加规则（如注册审计），改回 service 方法会更自然 —— 留给后续评审判断。
5. 未做真机/模拟器、真实云服务或性能验收；本票是后端整理项，验收口径是 `npm test` + `combo:verify`。
