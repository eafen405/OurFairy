# #245 印象：本人读写、注入与客户端页面

> 2026-10-28 后续：#249 已把用户侧改为只读——`/impression/edit` 路由与客户端编辑页已移除，印象只经 Fairy 工具修改。本文记录 #245 交付当时的状态，其中「本人读写」「两条用户路由」不再描述当前实现；现状见 [`../249-fairy-persona/README.md`](../249-fairy-persona/README.md)。

日期：2026-10-27。票面：[`work/tickets/fairy-memory/05-impression.md`](../../../tickets/fairy-memory/05-impression.md)。
分支 `ticket/245-impression`，worktree `.worktrees/245-impression`，基线 `40d8a190ef`
（`integration/spec-240`）。规格：[`docs/specs/fairy-memory.md`](../../../../docs/specs/fairy-memory.md)
Implementation Decisions §2、§4、§7 与 User Stories 14–21；术语：[`docs/glossary/memory.md`](../../../../docs/glossary/memory.md)。

本票只做印象本身：本人读写、系统提示注入、Fairy 的读/整份编辑工具、客户端页面与入口。
维护触发、维护子会话（#246）、维护与压缩设置（#247）、真实模型质量验收（#248）未做；
同包内的记忆 CRUD 与检索门禁来自 #244，证据见 [`../244-memory-crud/README.md`](../244-memory-crud/README.md)。

## 改动

后端 `@ourfairy/dsh-memory`：

| 文件 | 职责 |
| --- | --- |
| [`src/impression.ts`](../../../../backend/memory/src/impression.ts) | 印象本身：`ImpressionService`（按凭据/会话的先读后写门禁）、`impression_read`/`impression_edit` 工具、`ourfairy:impression` 系统提示 section、`/impression/read` 与 `/impression/edit` 两条用户路由 |
| [`src/store.ts`](../../../../backend/memory/src/store.ts) | 使用 #244 已建的 `impressions` 表：按 `short_id` 读当前行、整份 upsert；无时间条件、无定时清理 |
| [`src/index.ts`](../../../../backend/memory/src/index.ts) | 装配印象服务与路由；`agent/created`/`agents.list()` 时给**有 owner** 的 Agent 注册 section 与两个工具；`agent/disposed` 清门禁 |
| [`package.json`](../../../../backend/memory/package.json) / [`tsconfig.json`](../../../../backend/memory/tsconfig.json) | 新增 `@ourfairy/dsh-http` peer 与 `../http` project reference |
| [`README.md`](../../../../backend/memory/README.md) / [`locale/en.json`](../../../../backend/memory/locale/en.json) | 印象行为、线协议、错误码与表用途 |

Android：

| 文件 | 职责 |
| --- | --- |
| [`ImpressionApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/ImpressionApi.kt) | `/impression/read`、`/impression/edit` 的 POST 线协议；Bearer；只发正文，无 owner 选择字段；拒绝码原样抛 `IdentityRefused` |
| [`ImpressionState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/ImpressionState.kt) | 读成功才发布 `Impression`；串行保存；写后重读；拒绝保留已读正文与错误 |
| [`ImpressionPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/ImpressionPage.kt) | 多行纯文本整份编辑页；读取成功前不渲染输入框与保存按钮；字符计数、超长红字、后端错误横幅 |
| [`FairySettingsPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairySettingsPage.kt) | 普通设置新增「印象」组与「本人印象」入口（默认参数，原调用点不变） |
| [`RouteActivity.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt) / [`IdentityAccessPolicy.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentityAccessPolicy.kt) | `Screen.Impression` / `IMPRESSION` 目的地；`signedIn` 即可进入，不要求 admin，不经过网关 |
| [`IdentityModule.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/di/IdentityModule.kt) | 注册 `ImpressionBackend` |
| `values/strings_identity.xml` + `values-zh/strings_identity.xml` | 页面文案两语言同步 |

测试：

- 后端 [`tests/memory-impression.test.mjs`](../../../../tests/memory-impression.test.mjs)：真实 v1 profile + Loader + 模型替身 + 认证产品会话。
- [`tests/model-double.test.mjs`](../../../../tests/model-double.test.mjs)：精确工具目录加 `impression_read` / `impression_edit`。
- Android `ImpressionApiTest`、`ImpressionStateTest`、`ImpressionPageTest`、`FairyPagesTest` 的设置入口用例，以及导航/门禁测试的 `IMPRESSION` 分支。

## 关键决定

- **注入接缝**：在 `agent/created` 时用 `agent.ctx.systemPrompt.section({ name: 'ourfairy:impression',
  order: 2, text: () => service.promptText(shortId) })`。`text` 是每次装配都求值的函数，所以编辑后
  下一轮立即生效；没有印象时不产生 section。没有使用 `systemPrompt.context`（它会写持久 user 快照）。
- **归属唯一**：HTTP 从 Bearer 解出的 `publicUser.shortId` 决定行；工具从
  `agent.session.header.owner` 派生。路由 body 没有 owner/shortId 字段；塞进去的值也不是选择器。
  管理员只读写自己那一行。
- **先读后写，两套门禁**：HTTP 以凭证为键（同一用户第二个登录也要先读），工具以调用会话
  `agent.session.id` 为键；`agent/disposed` 清会话门禁。读失败不开门；写失败不开门。
- **整份替换**：`impression_edit` 只收 `content`，无段落补丁、版本号或合并；空正文允许（用于清空），
  空正文不再注入 section。
- **长度**：8000 个 Unicode 码点，`[...content].length` 计数；超过即 `impression/too-long` 400，
  消息同时给出实际值与上限；没有任何截断路径。Android 计数器用 `codePointCount`，草稿不裁剪。
- **无定时失效**：`impressions` 只有 `created_at` / `updated_at`，读写都没有时间条件或 TTL；
  测试把时间戳改到 1 并重启后端，正文仍是当前正文。
- **维护边界**：`registerImpressions` 对 `shortIdOf(...) === undefined` 的 Agent 直接返回，
  即没有 section、没有两个工具；#246 的维护子会话按规格没有用户 owner，因此不能借维护读写印象。
- **用户入口与网关分离**：路由挂在 `webServer`（`/impression/*`，与 identity/sessions 同层），
  依赖 `identity`、`connection`、`webServer`，不经过 `/gateway/*`，也不要求管理员。
- **客户端先读后编辑**：`ImpressionSnapshot.impression` 在成功读取前为 null；页面据此不渲染
  `impression_field` / `impression_save`，而不是只把按钮置灰。保存成功后重新读取后端存储值。
- **不新增 UI 依赖**：只用现有 Material 3、Fairy 主题/窗口与 `FairySettingsGroup`；没有长期记忆浏览器。

## TDD 红绿

先加载 `tdd` skill，先写失败用例再实现（每轮 `npm run build` 后跑真实后端）：

1. 路由与实现都不存在时：
   ```text
   ✖ each user reads and edits only their own impression, and must read before editing (8583ms)
     AssertionError: POST /impression/edit: 404 !== 409
   ✖ an over-length impression is refused loudly and never truncated (37ms)
     AssertionError: POST /impression/read: 404 !== 200
   ```
   实现 `ImpressionService`、store 读写、两条路由与 index 装配后：
   ```text
   ✔ each user reads and edits only their own impression, and must read before editing (4574ms)
   ✔ an over-length impression is refused loudly and never truncated (45ms)
   ℹ tests 2  ℹ pass 2  ℹ fail 0
   ```
2. 加入注入用例后先红：断言的替身读错了字段（`system` 在 Messages 线上是 text block 数组，
   当时只读了字符串/`messages` 里的 system 角色）：
   ```text
   ✖ the impression is injected only into its owner's system prompt, fresh on every assembly
     AssertionError: the owner receives their impression without a search
     actual: '[]'  expected: /ALICE-OWN-MARKER/
   ```
   `systemOf` 改成按 block 数组收文本后转绿；实现本身未改。最终注入/工具/持久化 5 条全绿：
   ```text
   ✔ the impression is injected only into its owner's system prompt, fresh on every assembly
   ✔ the Fairy reads first, then replaces the whole impression, and memory work never rewrites it
   ✔ the impression persists with its old timestamps and never expires
   ℹ tests 5  ℹ pass 5  ℹ fail 0
   ```
3. Android 先红于接口/导航未接上：
   ```text
   e: RouteActivity.kt:253:33 Unresolved reference 'ImpressionPage'.
   ```
   接上 import 后，页面/状态测试暴露了断言问题：JUnit 三参 `assertEquals` 的消息位置、
   `assertTextContains` 默认整值匹配、以及输入后未推进 Compose 时钟导致计数器未重组。
   修正测试（不是放宽实现）后目标用例 16/16：
   ```text
   ImpressionStateTest > 4 tests, ImpressionPageTest > 3 tests,
   ImpressionApiTest > 4 tests, 导航/门禁 > 5 tests — 16 tests completed, 0 failed
   ```

## 验证（实际运行）

```sh
npm run build
# 通过（scripts/tsc.ts --fresh，无输出即成功）

node --test tests/memory-impression.test.mjs
# tests 5 / pass 5 / fail 0

node --test tests/memory-crud.test.mjs tests/model-double.test.mjs \
  tests/bundle-packages.test.mjs tests/bundle-groups.test.mjs \
  tests/baseline-boot.test.mjs tests/docs.test.mjs
# tests 33 / pass 33 / fail 0（与上一条合计 38）

cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug
# BUILD SUCCESSFUL in 2m 57s（134 tasks；app/highlight/ui 的 test 与 lintDebug 全过）

# 目标 Android 用例（调试迭代时）
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.ImpressionApiTest' \
  --tests 'me.rerere.rikkahub.data.remote.ImpressionStateTest' \
  --tests 'me.rerere.rikkahub.ui.identity.ImpressionPageTest' \
  --tests 'me.rerere.rikkahub.ui.identity.ScreenIdentityDestinationTest' \
  --tests 'me.rerere.rikkahub.ui.identity.IdentityAccessPolicyTest'
# 16 tests completed, 0 failed
```

提交钩子还在完整代码树上跑过 `npm test` 与 `npm run combo:verify`：

```text
ℹ tests 356 / suites 7 / pass 356 / fail 0
row             branch               result
ourfairy        main                 ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1  ok
android source  -                    ok (declaration matches)
combo: combination verified
```

真机、截图与真实模型未执行；这里只有 Robolectric/Compose 与模型替身证据。

## 验收对照

| 票面条目 | 证据 |
| --- | --- |
| 只注入对应用户，其他用户和管理员不能读写 | `memory-impression.test.mjs`：注入、HTTP 隔离、工具隔离三条用例 |
| 读写由登录身份确定，无他人选择参数 | 同一文件：body 里传入 `shortId` 不改变目标；工具 schema 只有 `content` |
| 有意识编辑，不随维护发生，不因时间失效 | 工具只注册给有 owner 的 Agent；记忆 CRUD 后印象不变；时间戳改到 1 + 重启后正文不变 |
| 用户与 Fairy 都先读后写 | HTTP 409 `impression/not-read`；工具同码；第二个凭证/第二个会话各自先读 |
| 客户端多行纯文本、读成功前不能提交 | `ImpressionPageTest`：读取未完成时 field/save 节点不存在；`FairyPagesTest` 设置入口 |
| 长度上限与错误反馈，不静默截断 | 8001 字符拒绝、8000 emoji 原样存储；`ImpressionStateTest` 拒绝保留正文；页面横幅显示后端 code |
| 与长期记忆/skill 归属区分，无全库编辑器 | 独立 `impressions` 表与工具名；客户端只有印象页；记忆编辑用例证明互不影响 |

## 未完成与风险

- **#246 的维护子会话**：本票只保证“无 owner 的 Agent 不注册印象 section/工具”。“维护子会话确实
  无 owner、且不会调用印象工具”要由 #246 的真实子会话测试证明；本票没有创建无 owner Agent 的产品面。
- **门禁在进程内**：HTTP 门禁按凭证、工具门禁按会话，重启后都要重新读。规格只要求“先成功读取”，
  没有要求持久登记；这是有意的最小实现。
- **未做真实设备**：Android 只跑 Robolectric/Compose；没有截图、真机或无障碍实机检查。
- **未做真实模型质量验收**：印象该写什么、维护是否误写属于 #248 的语义验收；本票只有模型替身。
- **路由命名**：采用 `/impression/read`、`/impression/edit`；未改 `/gateway/*`，也没有给印象做
  部署级配置（上限固定 8000）。
- **并行改动**：#246 与 #247 会改同一插件的 `index.ts`、`store.ts`、`Config`；本票新增集中在
  `impression.ts` 与少量装配行，合入时以追加为主，冲突按两边都保留处理。
