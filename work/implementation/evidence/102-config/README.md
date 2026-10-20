# 102-config — 票 #102 证据

> 父票 [#73](https://github.com/eafen405/OurFairy/issues/73)；票面
> `work/tickets/73/06-config-contracts-and-row-liveness.md`；落点
> `work/implementation/notes/73-row-plan.md` 的「#102 Config 与启动期失败」。
> 分支 `ticket/102-config`；基线 `integration/spec-73`（开工 `c90af54`，收尾前合入
> `fd162cf`，含 #99 投递行）。

## 改了什么

1. 三个产品行导出 schemastery `Config`，加载期校验、错误路径带字段名：
   - `backend/identity/src/index.mjs`：`{ path: required string, sessionTtlDays: 正整数 }`；
     仍由 `resolveConfig` 填 `phaethonName`/`phaethonPassword`/`sessionTtlDays` 默认值。
   - `backend/spaces/src/index.mjs`：`{ root: required string }`；`SpaceScope` 接收已校验 config。
   - `backend/attachments/src/index.mjs`：`{ root: required string }`。
   - 三个包增加 `@deepseek-ai/schemastery` peer（`^3.18.5-alpha.1`，保持 #98 的明确 semver）。
2. `backend/probe/src/index.mjs` 新增 `collectInactiveProductRows`：遍历 `loader.entries()`，
   凡 `@ourfairy/*` 行（排除探针自身）在**非刻意禁用**时 `fiberState !== 'active'`，就记一条
   `bundle product row "<id>" (<name>) is not active (fiber <state>)`，使 `probe`/`start` 在非法
   config 下直接失败并命名行与包。用 overlay 刻意 `disabled` 的行被跳过：那是操作者的选择，
   #105 要求 disable 后仍能启动；它不算激活失败。`SERVICE_ROWS` 的服务 liveness 断言保持不变。

## 新增测试

`tests/config-contracts.test.mjs`（4 条，全部通过）：

1. 合法组合：probe 退出 0、`report.ok`、identity/spaces/attachments 行 active 且服务 live、
   `expectedRow` 指向各自行。
2. `spaces.root` 为数字（overlay 覆盖 config）：boot 非零退出、`report.ok=false`、行 `spaces`
   fiber `failed`、失败信息命名行与包，stderr 含字段路径 `$.root`。
3. `identity` 缺 `path`：同上，命名 `identity` 与 `$.path`。
4. `attachments` 缺 `root`：同上，命名 `attachments` 与 `$.root`。
三条非法用例都断言失败发生在加载期（probe 非零退出，没有请求被服务）。

## 实际执行与结果

```
$ node --test tests/config-contracts.test.mjs
ℹ tests 4  pass 4  fail 0
```

```
$ node --test tests/config-contracts.test.mjs tests/delivery-row.test.mjs tests/groups-row.test.mjs tests/scoped-provider-rows.test.mjs tests/baseline-boot.test.mjs tests/attachments.test.mjs tests/identity-http.test.mjs tests/bundle-packages.test.mjs
ℹ tests 38  pass 38  fail 0
```

```
$ npm test
ℹ tests 169  pass 169  fail 0  duration_ms 75598
```

`npm run combo:verify`：ourfairy 项 ok；rikkahub 项按 `73-execution.md` 预期 MISMATCH
（外部归档提交 `2d97ed14` ≠ `combo.json` 锁定 `460109d1`）。本票未改 `combo.json`。

## 评审修复补记（2026-10-20，分支 `fix/73-review`）

- identity 的 `Config` 补上 bundle 实际写入、`resolveConfig` 读取的 `phaethonName`/`phaethonPassword`
  两个可选字符串；`resolveConfig` 只保留默认值（`sessionTtlDays` 30、`phaethonName` `phaethon`、
  空/缺失密码为 `undefined`）。`tests/config-contracts.test.mjs` 增加一条 `$.phaethonName` 类型
  用例，现为 5 条。详见 `work/implementation/notes/73-review-findings.md`。
- 行 liveness 的保证范围明确为「每个**未被刻意禁用**的 bundle 产品行」：经 overlay
  `disabled` 的行是操作者的明确缺席，不在该保证内——#105 要求禁用任一行后仍能启动，不能把它
  记成激活失败。探针自身的包名改为从 `backend/probe/package.json` 读取。

## 未执行项与原因

- 未在真实模型服务/真机上验证；本票只改配置契约与加载期检查，测试走真实 launcher/CLI。
- 未跑 Android 构建（不在本票范围）。
- 未修 `conversation-search`/`pdf-worker-cancel` 在并发全量下的偶发抖动（单独重跑通过）。
