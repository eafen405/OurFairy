# #273 speech 字段词汇与规则收进随包发布的 policy

日期：2026-10-31。票面：[#273](https://github.com/eafen405/OurFairy/issues/273)。
分支 `ticket/273-speech-policy`，worktree `.worktrees/273-speech-policy`，基线 `9730d94aee`，
合入 main 的提交 `492f9b4179`。

本票把 speech 的字段名、上限名单、默认凭据引用与两条形状规则收进一个无依赖的
`@ourfairy/dsh-speech/policy` 子路径，`Config`、speech runtime 与 gateway 都读它。
沿用 `backend/memory/src/maintenance-policy.ts` 已经落地的模式，不新建 registry。

## 改动

| 文件 | 职责 |
| --- | --- |
| [`backend/speech/src/policy.ts`](../../../../backend/speech/src/policy.ts) | 新增，无 import：`SPEECH_FIELDS`(8)、`SPEECH_LIMIT_FIELDS`(5)、`DEFAULT_API_KEY_ENV`、`SPEECH_ENDPOINT_PATTERN`、`SPEECH_ENV_NAME_PATTERN`、`isPositiveInteger` |
| [`backend/speech/src/index.ts`](../../../../backend/speech/src/index.ts) | `Config` 默认读 policy；5 个 limit 由 `z.natural()` 收窄为 `.min(1)`；删除本地 `FIELDS`，`values()` 遍历 `SPEECH_FIELDS` |
| [`backend/speech/src/service.ts`](../../../../backend/speech/src/service.ts) | limit 循环与 endpoint / env-name 规则改读 policy，删除本地 `isSafeInteger` |
| [`backend/gateway/src/service.ts`](../../../../backend/gateway/src/service.ts) | `asrView` 由 `SPEECH_FIELDS` 投影、fallback 用 `DEFAULT_API_KEY_ENV`；`saveAsr` 的规则改读 policy。错误码与文案逐字未动 |
| [`backend/speech/package.json`](../../../../backend/speech/package.json) | 增加 `./policy` 导出 |
| [`backend/gateway/package.json`](../../../../backend/gateway/package.json) · [`tsconfig.json`](../../../../backend/gateway/tsconfig.json) | peer 依赖与项目引用 |
| [`backend/speech/README.md`](../../../../backend/speech/README.md) | policy 说明 |
| [`tests/speech-policy.test.mjs`](../../../../tests/speech-policy.test.mjs) | 新增：policy 边界、`Object.keys(Config.dict)` 一致性、Config 下限与 predicate 一致、bundle `!!js` 种子一致 |
| [`tests/gateway-service.test.mjs`](../../../../tests/gateway-service.test.mjs) | 增 4 个 ASR 视图/保存 seam 用例，合法与非法值均从 policy 派生 |

## 来源收敛（改前 → 改后）

| 事实 | 改前 | 改后 |
| --- | --- | --- |
| 8 个字段名 | 4 处运行期列表/投影 + 类型 + YAML 种子键 | 1 个权威 `SPEECH_FIELDS`；Config 与 YAML 两处无法 import，由测试钉住 |
| 5 个 limit 字段 | 5 处 | 1 个权威 `SPEECH_LIMIT_FIELDS` |
| `apiKeyEnv` 默认值 | 3 处 | 1 个权威 `DEFAULT_API_KEY_ENV`，YAML 由测试钉住 |
| endpoint / env-name 规则 | 各 2 处 | 各 1 份 RegExp，runtime 与 gateway 引用同一对象 |
| limit「合法值」 | 2 套答案（`natural()` 允许 0，gateway/runtime 拒 0） | 1 条 `isPositiveInteger`；Config 编码为 `.min(1)` |

## 实际命令与结果

```
$ npm run build                                     exit 0

$ node --test tests/gateway-service.test.mjs tests/speech-policy.test.mjs
ℹ tests 11  ℹ pass 11  ℹ fail 0

$ node --test tests/speech.test.mjs
ℹ tests 2   ℹ pass 2   ℹ fail 0   (3189ms)

$ node --test tests/gateway.test.mjs
ℹ tests 12  ℹ pass 12  ℹ fail 0   (59143ms)

$ node --test tests/bundle-packages.test.mjs
ℹ tests 11  ℹ pass 11  ℹ fail 0   (202595ms)

$ node --test tests/plugin-compatibility.test.mjs
ℹ tests 4   ℹ pass 4   ℹ fail 0

$ node --test tests/speech.test.mjs tests/gateway.test.mjs tests/gateway-service.test.mjs \
    tests/bundle-packages.test.mjs tests/plugin-compatibility.test.mjs tests/speech-policy.test.mjs
ℹ tests 40  ℹ pass 40  ℹ fail 0   (108364ms)
```

## wire 未改的证明

逐行核对 diff：`asrView` 输出的 8 个 key 与顺序与旧显式对象完全一致；`saveAsr` 只换校验来源，
`gateway/invalid-asr` 与三条文案逐字保留（新用例断言原文案）；路由、状态码、`saved` /
`editable` / `available` 语义未动；未改 Android 与任何 HTTP handler。未修改的
`tests/gateway.test.mjs` 12/12 通过。

唯一的内部变化：`settings.describe()` 里 speech limit 的 schema `minimum` 由 0 变 1。
这是 admin 表单元数据，不在 HTTP wire 上；依赖旧 schema 接受 0 的写会在写盘前被拒，
这正是票面要求的收敛。

## 没有执行

全量 `npm test`、`npm run combo:verify`、Android 门禁留给集成收口。compaction 的 policy 不抽
（`compaction-basic` 归 dsh 所有，范围只能留在 gateway）。YAML 种子值未搬进 policy——
YAML 不能 import TS，种子只由测试钉住。
