# 136-closeout — 规格 #136 证据

> 父票 [#136](https://github.com/eafen405/OurFairy/issues/136)；票面副本
> `work/tickets/136/`；分支 `integration/spec-136`（基于 `origin/integration/ourfairy-v1`
> 的 `fc5ea92`）；最终合并提交 `b051cd3`。任务图三票互不阻塞：
> [#148](https://github.com/eafen405/OurFairy/issues/148)、
> [#149](https://github.com/eafen405/OurFairy/issues/149)、
> [#150](https://github.com/eafen405/OurFairy/issues/150)。

## 变更内容

清单只写真实存在的东西；不新增源码文本扫描。

| 票 | 提交 | 内容 |
| --- | --- | --- |
| #148 | `9122000` | 删除 `groups` 对 `@ourfairy/dsh-identity`、`@ourfairy/dsh-spaces` 的 peer 与 `gateway` 对 `@ourfairy/dsh-chat` 的 peer（三者都只经 `inject` 读服务）；`probe` 补 `@ourfairy/dsh-identity: ^0.1.0`（`src/index.mjs` 真实 import `/owner`） |
| #149 | `a0b9cfb` | `search`、`spaces` 补 `"license": "UNLICENSED"` |
| #150 | `416f364` | 新增 `backend/identity/README.md`、`backend/sessions/README.md`；`tests/bundle-packages.test.mjs` 新增 `files` 条目必须发布真实文件的用例 |
| 评审修复 | `4faf34f` | 见下节 |

三处被删 peer 与 spec 原文的差异：spec 只点名 `groups` → identity，源码核对发现 `groups` → spaces
与 `gateway` → chat 是同一类幽灵声明，按用户故事 1 一并删除。spec 说 `search` 是唯一缺 `license`
的包，实际 `spaces` 也缺，一并补齐。

`@deepseek-ai/*` peer 未动：它们是 #98/#73 声明的 dsh 兼容线，由
`evaluatePluginCompatibility` 判定，即使没有直接 import 也保留。本次的规则只约束
`@ourfairy/*` 产品 peer。

## 两轴评审与修复

范围 `fc5ea92...HEAD`，Standards 与 Spec 各一个子代理并行。发现与修复：

| 发现 | 处理 |
| --- | --- |
| `scripts/combo.mjs` 注释仍说 bundle 与 probe 都不声明 peer，#148 后失真 | 改为 bundle 无 peer、probe 的一个 `@ourfairy/*` peer 不参与判定 |
| 两份新 README 有无法执行的结构性声称（「没有第二张归属表」「不写任何 session 行」「没有第二份实现」「不 inject sessions」） | 改为现在时描述代码行为，按 `CODING_STANDARDS.md`「声称须可执行」删除无法指认失败检查的措辞 |
| sessions README 把 ownerless header 一律写成 403 | 按源码分开：`/sessions/read`、`/sessions/select` 为 403 `sessions/unowned-session`；`/sessions/primary`、`/sessions/create` 为 409 `sessions/unowned-primary` |
| `#148` 提交说明把规则写成「peer 只描述 import」，对 `@deepseek-ai/*` peer 不成立 | 修复提交正文写明规则只约束 `@ourfairy/*`；dsh peer 是兼容线 |
| probe 说明称 doctor「像其余包一样判定」 | 修复提交正文写明 `@ourfairy/*` peer 被排除在兼容性判定之外，声明服务读者与 pnpm |
| 新用例名 `every file … exists` 与断言（每条 `files` 至少发布一个真实文件）不符；注释声称守护安装副本 | 改名为 `every files entry a product package declares publishes a real file`，注释改为实际读取的清单与检出文件系统 |
| 三个测试文件各有一份 `backend/` 包目录遍历 | 提取 `tests/helpers/backend.mjs` 的 `productPackageDirs({ exclude })`，三处共用 |

## 实际执行

本机没有可用的 dsh 构建（`combo.json` 指向的检出只剩残缺 `.git`，另一份检出停在
`d743267` 而非锁定的 `5b8ec0f`），且内存 4G，因此**没有**运行 `npm test`、
`npm run combo:verify` 与 `doctor`。执行的是不依赖 dsh 的定向检查，均在
`integration/spec-136` 的最终状态（`b051cd3`）上：

```
$ node --test --test-name-pattern="every files entry a product package declares publishes a real file" tests/bundle-packages.test.mjs
ℹ pass 1  ℹ fail 0

$ node --test tests/docs.test.mjs
ℹ pass 1  ℹ fail 0

$ node --test --test-name-pattern="every product package declares an explicit semver peer range" tests/plugin-compatibility.test.mjs
ℹ pass 1  ℹ fail 0

$ node --check scripts/combo.mjs
（无输出，退出 0）
```

红绿证据（#150）：新用例在补 README 之前失败，且只报两个内核包：

```
✖ every files entry a product package declares publishes a real file
AssertionError: every files entry must publish at least one real file; these do not:
backend/identity: README.md
backend/sessions: README.md
```

清单审计（最终状态）：`backend/` 下 12 个带 `package.json` 的包全部 `license: UNLICENSED`；
不存在声明了却无对应 `@ourfairy/*` import 的 peer。

## 未完成项

- **全量门禁未执行**：`npm test`、`npm run combo:verify`、`doctor --json` 需要按
  `combo.json` 构建过的 dsh 检出。这四项留待具备该环境时在 `b051cd3` 上执行；
  本增量的改动是清单字段、两份 README 与不依赖 dsh 的测试，运行时代码零改动。
- **`files` 检查的边界**：它要求每条 `files` 至少发布一个真实文件，不逐一枚举目录下的
  每个文件（npm 的 `files` 语义本就是目录级）。新增一个从未被任何文件命中的 glob 会失败；
  目录内个别文件缺失不会被它发现。
