# 02: 组合文件分成 kernel 与 plugins 两个 group

**What to build:** 在 `backend/v1-bundle/cordis.patch.yml` 的顶层 `insert` 里用 loader 原生的 group 行把 46 行切成 `kernel`（19 行）与 `plugins`（27 行）两段。打开组合文件的人一眼能看出哪一段停掉之后基本功能就不再成立；把 `plugins` 整组停掉，后端仍能启动并跑通一轮模型。

分段依据是「停掉之后基本功能是否还成立」，不是包名前缀：`tool-todo`、`jobs-local`、`attachment-local`、`config-editor`、`settings` 与各工具行虽是原生包，但停掉后内核仍能启动，归入 `plugins`。每行的 `config` 一字不改——这次改动不改变任何一行的实际配置。

**Blocked by:** #159（原生能力检查与行删除测试不再假设扁平行表）。分组前必须先让检查展开 group，否则 doctor 会对已挂载的必选行报 missing。

**Status:** ready-for-agent

- [ ] `cordis.patch.yml` 的顶层 `insert` 只含两个 group 行（`kernel`、`plugins`），每行 `name: cordis:group`、`group: true`、`config` 为嵌套行列表；`package.json` 不新增任何依赖
- [ ] 46 行按下列归属各就各位，合计仍为 46，id 与 `config` 与改动前逐字节一致：`kernel` = agent, session, llm, system-prompt, session-projection, tools, agent-loop, agent-default-model, llm-deepseek-api-key, llm-retry, spill-local, spill-policy, session-persistence-jsonl, session-checkpoint-policy, session-query-sqlite, credentials, llm-pi-ai, webserver, connection；`plugins` = 其余 27 行
- [ ] 文件头注释说明两段的判据与「新增产品行时必须决定它属于哪一段」，并删掉不再成立的「分组只为读者」一类说法
- [ ] 用 dsh 自己的加载器（`loadOverlayPatches` + `composeEntries`）比较改动前后的行集合：除两个 group 行外，每行的 id/name/config 深度相等
- [ ] `npm test` 全绿；`npm run backend:doctor` 全绿（尤其 `native capabilities`、`bundle packages`）
- [ ] 真实启动证明分段可单独停用：以 `plugins` 整组停用的 overlay 启动，probe 通过且内核服务 live；断言看子行状态，因为 group 行自身始终报告 `disabled: false`
- [ ] `tests/row-addressability.test.mjs` 原样通过——overlay 按 id 寻址 group 内行（`delivery`、`groups`、`scoped-*`）的行为没有变化
