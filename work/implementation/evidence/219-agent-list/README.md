# #219 代理人互见：客户端用户名列表（最小暴露面）

日期：2026-10-25。票面见[工作副本](../../../tickets/219-agent-list.md)。开工基线为
`integration/fixes-219-221` 的 `08566185fe`（= `main` `db489e07ac` + 三票票面副本）。

## 结论与范围

- 新增唯一暴露面 `POST /identity/agents`（无 body，只认 Bearer）：成功
  `{"ok":true,"agents":[{"shortId":2,"name":"agent-one"}]}`，按 `shortId` 升序，只含 `deleted_at IS NULL` 的用户，
  因此自然包含调用者；未登录或凭据无效沿用 `401 identity/unauthorized`，不受信 Host 仍由既有 `postHandler` fence 给
  `403 identity/forbidden-authority`。
- 后端只在 `IdentityStore` 上新增窄方法 `listAgents()`：
  `SELECT short_id, name FROM users WHERE deleted_at IS NULL ORDER BY short_id`，返回新类型 `AgentSummary[]`
  （`{shortId, name}`）；不返回 `PublicUser`，所以 `isAdmin`/`createdAt` 不进入响应。`identityInterfaces` 的四个 face
  未扩宽（`users` 仍只有 `byShortId`），路由直接调用 store。
- 客户端 `IdentityApi` 新增 `AgentSummary(shortId, name)`、`IdentityEnvelope.agents` 与
  `IdentityBackend.agents(token)`；`agents()` 发无 body、无 media type 的 POST `/identity/agents`，取
  `envelope.agents.orEmpty()`；五个 `IdentityBackend` 测试假实现补 `emptyList()`。
- 设置页在「账号」之后新增默认收起的「代理人 / AGENTS」组，展开时用 `LaunchedEffect(session.token)` 拉取，
  一行一个只显示用户名；加载中与拿不到时用 muted 文案，不显示编号与权限。
- 未改会话归属、消息、投递、分组、认证语义与导航；未新增 Fairy 工具或「印象」数据。

## 行为验证与 red-green

### 后端（真实 launcher + 真实 HTTP）

`tests/identity-http.test.mjs` 新增两条用例，先跑出红（当时路由未挂载）：

```sh
npm run build && node --test tests/identity-http.test.mjs
# 12 tests, pass 10, fail 2
#   ✖ an agent reads every live agent, itself included, as only a number and a name — 404 !== 200
#   ✖ the roster stays unreachable without a live credential — 404 !== 401
```

实现 `store.listAgents()`、路由与 `IDENTITY_PATHS` 后转绿，并同步 `tests/identity-interfaces.test.mjs` 的
`IdentityStore.prototype` 清单（19 → 20，用例名与断言消息改为 “twenty methods spec 132 and #219 named”）：

```sh
npm run build && node --test tests/identity-http.test.mjs tests/identity-interfaces.test.mjs
# 18 tests, pass 18, fail 0
```

新用例断言：匿名与伪造 token 都 401 且响应不带 `agents`；登录后列表按 `shortId` 升序；每一项键恰好 `shortId`/`name`；
调用者自己与另一名代理人都能看到；管理员以普通代理人身份出现。

### 客户端（Robolectric + Compose 页面边界）

`IdentityApiTest` 用 JDK `HttpServer` 记录线上字节：`agents()` 发 `POST /identity/agents`、`Bearer token`、空 body、
无 `Content-Type`，并解码两个 `AgentSummary`；401 响应映射为 `IdentityRefused(401, "identity/unauthorized")`
而不是空列表。

`FairyPagesTest` 新增用例走可见行为：打开设置 → 收起「账号」组（它展开时的「权限」行也写着「代理人」，会与组标题同文本）
→ 点「代理人」组 → 断言假后端返回的 `agent-two`（自己）与 `agent-three` 都可见，且 `#2`/`#3` 不存在（名册不显示编号）。
第一版用例先失败在交互与替身上：暂停时钟下组头点击不生效（报 “found 2 nodes”），页面级 `koinInject` 在 Robolectric
下没有 Koin；分别改为让时钟自走、并给 `FairySettingsPage` 增加与 `GatewayPage` 同形的
`backend: IdentityBackend = koinInject()` 参数由测试注入替身。假身份默认名由「代理人」改为 `agent-two`，同步首页断言。

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.data.remote.IdentityApiTest" \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest"
# BUILD SUCCESSFUL；IdentityApiTest 8/8、FairyPagesTest 14/14（JUnit XML：0 failures/errors/skipped）
```

## 提交、合并与门禁

- `8f8f37bb4d` `feat(#219): 提供只读代理人名册接口，仅返回编号与用户名`
- `81214ff77c` `feat(#219): 客户端读取代理人名册，仅携带编号与用户名`
- `19061af765` `feat(#219): 设置页以折叠组显示代理人名册，只列用户名`
- `242c3e47c4` `Merge branch 'integration/fixes-219-221' into ticket/219-agent-list`（并入 #221 的 `230b623e81`；
  只有 `FairyPagesTest.kt` 自动合并，无冲突取舍）

三次功能提交的 pre-commit 门禁都通过；后两次改到 `android/`，按 `scripts/precommit.ts` 的 FULL 规则各跑了一次
`npm test` + `npm run combo:verify` 并通过（提交被门禁放行）。合并 #221 后在最终树上复跑：

```sh
node --test tests/identity-http.test.mjs tests/identity-interfaces.test.mjs   # 18/18
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.data.remote.IdentityApiTest" \
  --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest"                        # BUILD SUCCESSFUL，8/8 与 14/14
```

## 未执行项

- 未连接 Android 物理设备，未做真机验收；以上是真实后端 HTTP、Robolectric 页面测试与 JUnit XML 证据。
- 未调用真实模型或云服务。
- 全量 `npm test` 与 `npm run combo:verify` 在集成收口由 Lead 在最终集成状态复跑，结果见
  [219-221-closeout](../219-221-closeout/README.md)；本票只把 android 提交触发的 FULL 门禁结果记为通过。
