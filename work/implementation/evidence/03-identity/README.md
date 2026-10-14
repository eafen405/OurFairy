# 票 #26 证据：邀请码注册、登录与单 APK 身份入口

票面：<https://github.com/eafen405/OurFairy/issues/26>（本地副本 `work/tickets/ourfairy-v1/03-identity.md`）
父规格：<https://github.com/eafen405/OurFairy/issues/23>（本地 `docs/specs/ourfairy-v1.md`，用户故事 1/2/3/4/5/7/10）
依据：[用户作用域最终决议](https://github.com/eafen405/OurFairy/issues/7#issuecomment-6162548547)、[前端最终决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)

本目录原始日志：`identity-http-acceptance.log`、`android-build-identity.log`、`unit-tests-full.log`、`android-build-baseline.log`、`dsh-build.log`、`dsh-build-host.log`、`run-android-build.sh`。
（`android-build-baseline.log` 是落地身份入口**之前**的基线构建，只作对照，不能当作本票的构建结果。）

## 0. 组合与提交

| 仓库 | 分支 | 提交 | 内容 |
| --- | --- | --- | --- |
| OurFairy | `ticket/03-identity` | `2fd96a2` | 身份模块（用户/短编号/邀请/会话，业务 SQLite）+ 装配（bundle 四行、launcher 链接产品包） |
| OurFairy | `ticket/03-identity` | `a02bfde` | Lead：`http.mjs` 的无 body 已认证请求修复（`carriesBody()`）、验收测试收敛、原始日志入库 |
| dsh fork | `ticket/03-identity` | `b08b9caf6b` | admission 接受第二种凭据，按 principal 产出 `PeerScope` |
| dsh fork | `ticket/03-identity` | `8c1633abef` | 被准入的 principal Peer 传进 `/api` 处理器 |
| dsh fork | `ticket/03-identity` | `97060eb624` | 吊销与 authenticator 生命周期测试 + 目录再生成 |
| dsh fork | `ticket/03-identity` | `5a7615a128` | 让 principal Peer 在 host 工程里可编译（stray emit 一并清除） |
| rikkahub fork | `ticket/03-identity` | `f1f23ddc` | 认证核心（IdentityApi/AccountSession/CredentialStore+SealedSecret）与身份访问策略 |
| rikkahub fork | `ticket/03-identity` | `0d238805` | AndroidKeyStore 凭据存储 + Koin 接线 |
| rikkahub fork | `ticket/03-identity` | `af65606d` | 导航门 + 身份页面 + 中英文字符串 |

基线：OurFairy `integration/ourfairy-v1` @ `50d70e0`、dsh `product/ourfairy-v1` @ `d743267388641bc76f17c45ce8b4c231aed1d32c`、rikkahub `product/ourfairy-v1` @ `0966502c4d65c1ee4b2a3e49a19703bb1978016c`。

## 1. 逐条验收

### 1.1 持久化法厄同初始身份、编号 1、邀请与注册关系；其他短编号按注册顺序分配；并发/失败注册不造成重复身份或部分成功

**实现**（`backend/identity/src/store.mjs`）：

- `PHAETHON_SHORT_ID = 1`；`seedPhaethon()` 幂等——已存在则保留原身份与编号，且只在账户尚无密码时写入密码（换环境变量重启不会静默改凭据）。
- `register()` 在**单个 `BEGIN IMMEDIATE` 事务**内完成「校验邀请未用 → 校验用户名未占用 → 分配 `MAX(short_id)+1` → 建用户 → 标记邀请已兑换 → 建会话」；任一步失败整体回滚，因此失败注册不落任何身份、不消耗编号。
- 第二道防线是库级约束：`users.short_id UNIQUE`、`users.name UNIQUE`、`invites.code PRIMARY KEY`。
- 业务库是身份模块自己的 SQLite（`dshHomePath('identity/identity.sqlite')`），与 dsh 会话日志分开。

**证据**（`identity-http-acceptance.log`，真实 HTTP）：

| 用例 | 断言的可观察结果 |
| --- | --- |
| `invited agents take the next short numbers in registration order` | 第一个受邀代理人 2、第二个 3 |
| `refused registrations leave no identity and consume no short number` | 未知邀请 403 `identity/unknown-invite`；已用邀请 409 `identity/invite-used`；重名 409 `identity/name-taken`；随后一次成功注册拿到 `allocated + 1`（证明三次失败都没占号） |
| `concurrent registrations never share a short number and never half-succeed` | 5 个不同邀请并发 → 5 个唯一且连号的编号；**同一个**邀请并发提交 5 次 → 恰好 1 次成功 + 4×409，胜者凭据可用，随后注册拿到 `winner + 1` |

**一条口径说明**：并发请求谁先提交是不确定的，票面只要求「不产生重复身份或部分成功」，**不要求编号按请求发出顺序递增**。测试因此断言「唯一 + 连号 + 无失败造成的空洞」，不断言提交顺序。

### 1.2 完成邀请生成、注册、登录和会话凭据验证的真实后端请求路径及 Android UI；邀请码注册不被当成跳过登录认证的公开访问

**后端真实请求路径**：`/identity/invite`、`/identity/register`、`/identity/sign-in`、`/identity/session`、`/identity/sign-out`。

这些路由挂在**真实 webServer 载体**上（`backend/v1-bundle/cordis.patch.yml` 追加 `credentials` / `webserver` / `connection` / `identity` 四行），并刻意放在 `/api` **前缀之外**：`/api` 是整条前缀先 `admit` 再进 bridge，未认证请求根本到不了任何 handler，所以登录端点不可能存在于 `/api` 之下。产品自有路由同样先过 Host/Origin 栅栏（`connection.fence`），再自己校验凭据。

**8/8 原始日志**：同目录 `identity-http-acceptance.log`（Lead 提交）。

```
▶ OurFairy identity over real HTTP
  ✔ the provisioned Phaethon signs in as short number 1
  ✔ invited agents take the next short numbers in registration order
  ✔ refused registrations leave no identity and consume no short number
  ✔ an ordinary agent is refused the administrator invite operation
  ✔ the credential names its own holder with no user field in the request
  ✔ signing out ends the credential it was presented with
  ✔ a session credential admits dsh /api while an anonymous request is refused at the door
  ✔ concurrent registrations never share a short number and never half-succeed
ℹ tests 8  pass 8  fail 0  cancelled 0  skipped 0  todo 0
```

它跑的是**真实后端**：`scripts/ourfairy-backend.mjs start` 以隔离 `OURFAIRY_HOME` 启动真实 dsh CLI 与该 profile，`OURFAIRY_DSH_DIR` 指向 dsh 的 `ticket/03-identity` worktree 并加 `--allow-drift`（该 worktree 含本票的 admission 提交），`OURFAIRY_PORT=0` 由系统分配端口，`OURFAIRY_PHAETHON_PASSWORD` 提供初始凭据，测试进程内**已清代理**（请求走 `node:http`，不经全局 fetch 的代理采样）。没有任何插件是被手工拼起来的，也没有请求被伪造。

**Android UI**：`rikkahub` 侧 `data/remote/IdentityApi.kt` 实现同样五个端点（复用注入的 `OkHttpClient` 单例，未新增网络栈）；`ui/identity/IdentityPages.kt` 提供登录、注册与身份区页面。三个「只有凭据、没有载荷」的操作（`invite`/`session`/`sign-out`）**不发 body、不设 content-type**，由 `IdentityApiTest` 的 `credential-only operations send no document and no media type` 锁死。

**邀请码不是跳过认证的公开访问**：`register` 只用邀请码换取一次会话凭据；此后每个请求都必须带 `Authorization: Bearer <token>`，匿名访问 `/api` 一律 401（见 1.2 最后一条用例的 401-vs-404 断言）。

### 1.3 后端从认证得出请求者，不接受客户端自选用户/管理身份；普通代理人调用邀请/管理操作被拒绝，不只隐藏界面

**实现**：请求者只由凭据派生。dsh admission 泛化后，Bearer token 被 identity 模块的 authenticator 解析成 principal（`user:<shortId>`），再作为 `PeerScope` 落到 `invocation.peer`；身份模块自己的路由用 `callerOf(request)` 从未认证就 401，`createInvite` 在 store 与 service 两层核对 `isAdmin`。

**证据**（真实 HTTP）：

| 用例 | 断言 |
| --- | --- |
| `an ordinary agent is refused the administrator invite operation` | 普通代理人 → **403 `identity/forbidden`**，且响应里**没有** `invite` 字段（真拒绝，不是隐藏按钮）；匿名调用 → 401 |
| `the credential names its own holder with no user field in the request` | `/identity/session` 的身份完全来自凭据；同一服务下法厄同与代理人各自被认成自己；伪造 token → 401 |
| `a session credential admits dsh /api while an anonymous request is refused at the door` | 匿名 `/api/*` → **401**；带凭据 → **404**（通过了准入、只是尚无端点） |

Android 侧 `IdentityAccessPolicy.mayCompose(INVITES)` 仅对 `isAdmin` 为真，界面与后端**同时**拒绝。

**范围声明**：本票不交付会话内容，因此「法厄同的管理身份不授予他人个人内容访问」在此体现为「身份模块只暴露自己的身份与邀请操作，不提供任何读写他人内容的入口」；按 principal 的会话归属过滤属票 #28。

### 1.4 一 APK 在同一导航组织中按身份进入可用区域；尚未交付功能显示明确未就绪且不可触发旧本地执行或系统管理路径

**身份分入口**（同一导航、同一 APK）：

| 身份 | 可组合区域 |
| --- | --- |
| 未登录 | `SIGN_IN`、`REGISTER`（登录/注册页） |
| 代理人（`isAdmin=false`） | `ACCOUNT`（身份区：我是谁、我的身份允许的操作） |
| 法厄同（`isAdmin=true`） | `ACCOUNT` + `INVITES`（生成邀请码） |

**未交付功能**：`CONVERSATION`（对话）与 `GATEWAY`（网关）**不在** `DELIVERED` 里，对所有身份（含法厄同）都路由到 `IdentityNotReadyPage`，页面上写明「本版本未交付」，并且**不组合**任何原页面。

**「旧本地执行/系统管理路径为什么走不通」——三条机制，全部指到代码：**

1. **门在 `NavDisplay` 之前**（`app/src/main/java/me/rerere/rikkahub/RouteActivity.kt`）：

   ```kotlin
   // :343-350
   // The gate sits in front of the whole destination table, not
   // inside individual entries: a screen whose area this release
   // does not deliver — including every legacy rikkahub screen,
   // which maps to no destination at all — never composes. That
   // is what makes the old local-execution and system-management
   // paths impassable instead of merely unlisted.
   val gated = (backStack.lastOrNull() as? Screen)?.toIdentityDestination()
   if (IdentityAccessPolicy.mayCompose(gated, identityScope)) {
       NavDisplay(                                  // :351
   ```

   ```kotlin
   // :642-652  —— 被拒时走这里，NavDisplay 根本不会执行
   } else {
       IdentityNotReadyPage(
           identity = identityScope,
           onSignIn = { backStack.clear(); backStack.add(Screen.SignIn) },
       )
   }
   ```

   因此被拒的目的地是**根本不组合**，不是「渲染出来再藏起来」——旧页面里的 `ChatPage`（本地模型执行）与任何系统管理页都不会被实例化。

2. **既有页面一律映射为 `null`**（同文件 `Screen.toIdentityDestination()`）：

   ```kotlin
   // :711-714
   is Screen.SignIn   -> IdentityDestination.SIGN_IN
   is Screen.Register -> IdentityDestination.REGISTER
   is Screen.Account  -> IdentityDestination.ACCOUNT
   else -> null
   ```

   provider/模型配置、扩展、本地工具执行、系统管理……**全部落到 `else -> null`**；而 `mayCompose(null, …)` 对所有身份返回 false。**新增页面不会意外可达**：只有人**故意**在映射里加一行，它才会重新变得可达——这正是「不可达」的机制，而不是维护一份黑名单。

3. **未交付区域对所有人拒绝**（`ui/identity/IdentityAccessPolicy.kt`）：

   ```kotlin
   // :70-74
   private val DELIVERED = setOf(
       IdentityDestination.SIGN_IN,
       IdentityDestination.REGISTER,
       IdentityDestination.ACCOUNT,
       IdentityDestination.INVITES,
   )
   ```

   `mayCompose` 的第一句就是 `if (destination == null || !isDelivered(destination)) return false`（`:87`）。**未交付的票意味着对所有身份都不可组合（含管理员）**：只用身份去 gate，等于把页面藏在开关后面，那是隐藏而不是关闭。

4. **`ChatPage` 是「故意未交付」**：它就是**本地模型执行**路径，`CONVERSATION` 因此不在 `DELIVERED` 里，由测试 `the conversation is refused while it would still run models locally` 锁住；等票 #28 把它远程化之后才可组合。

**证据**：`IdentityAccessPolicyTest` 6 条（`while signed out only the sign-in areas may be composed`、`an agent lands on the account area and never on the invite operation`、`phaethon reaches the invite operation and the same account area`、`an undelivered area is refused for every identity`、`the conversation is refused while it would still run models locally`、`a legacy destination stays impassable even for the administrator`）。

### 1.5 账号切换/退出清理旧登录归属，迟到认证回调不得覆盖新账号；云模型/ASR 凭据不进入 APK

**会话状态机**（`data/remote/AccountSession.kt`）：每次登录/注册/恢复都取一个**单调递增 generation**；异步结果回来时比对 generation，不匹配就抛 `StaleAccountAnswer` 并**不采纳**（也不写库）。`signOut()` **先无条件清掉本地账号与凭据**（并通知观察者丢弃旧归属），再尽力撤销后端会话——网络不配合也不让设备继续持有凭据。

**证据**（`AccountSessionTest` 7 条，全部为确定性挂起，不靠 `delay` 碰运气）：

- `an answer that lands after the account changed is not believed`（迟到的成功回答被丢弃）
- `signing out while a sign-in is in flight leaves nobody signed in`（登出作废在途登录，旧身份不复活）
- `a refused sign-in leaves the current account untouched`
- `changing the account tells observers to drop what belonged to the old one`
- `a sign-in records the account and its credential`、`a stored credential is re-established on start-up`、`a rejected stored credential is dropped rather than kept`

**UI 真的走这条路径**：`ui/identity/IdentityPages.kt:396` 调用 `session.signOut()`；登录/注册页调用 `session.signIn/register`。

**凭据落盘不落明文**：`CredentialStore`（`save`/`load`/`clear`）+ `SealedSecret`（纯 `javax.crypto` 的 AES-GCM 信封，`base64(nonce):base64(ct+tag)`，128-bit tag）+ `AndroidKeystoreCredentialStore`（AndroidKeyStore 生成/取回 AES 密钥，SharedPreferences 只存密文串）。`CredentialStoreTest` 6 条锁住：`the stored text never contains the credential`、`sealing the same credential twice produces different text`、`a tampered secret does not open`、`a secret sealed under another key does not open`、`a sealed secret opens back to its plaintext`、`the in-memory store returns what it saved and forgets on clear`。

**云凭据不在 APK**：模型与 ASR key 留在后端（`DEEPSEEK_API_KEY` 由 dsh 行按请求解析；APK 端只与 `/identity/*` 和 dsh `/api` 打交道，不携带任何云凭据）。扫描方法与结论见 §4。

### 1.6 完成首次 Android 构建，以及真实应用组合下合法/非法邀请、越权、重复提交和身份切换的可观察验证；无需等待会话格式票即可验收本身份闭环

**首次 Android 构建（本票验收）**：`app/build/outputs/apk/debug/` 三个产物，`GRADLE_EXIT=0`。

| 产物（绝对路径） | 字节数 |
| --- | --- |
| `/home/eafen405/projects/rikkahub/.worktrees/03-identity/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk` | 89,573,784 |
| `/home/eafen405/projects/rikkahub/.worktrees/03-identity/app/build/outputs/apk/debug/app-universal-debug.apk` | 100,997,424 |
| `/home/eafen405/projects/rikkahub/.worktrees/03-identity/app/build/outputs/apk/debug/app-x86_64-debug.apk` | 90,429,728 |

构建耗时 **55 秒**（`2026-10-14T23:37:19+08:00` → `23:38:14+08:00`），日志 `android-build-identity.log` 尾部为 `BUILD SUCCESSFUL in 54s`、`284 actionable tasks: 12 executed, 272 up-to-date`、`Configuration cache entry reused.`、`GRADLE_EXIT=0`。耗时之所以远小于首次全量（约 7 分钟，见 `00-android-recon/`），是因为配置缓存复用 + 大多数任务已被基线构建预热；**它就是增量后的真实构建结果，不是估算**。

实际执行（`setsid nohup` 脱离 agent turn；`ANDROID_HOME` 与 pnpm shim 由外层脚本给出，shim 是把 `pnpm` 指向 `corepack pnpm@11.28.5`，因为 PATH 上的 pnpm 是 Windows 版）：

```bash
cd /home/eafen405/projects/rikkahub/.worktrees/03-identity
export ANDROID_HOME=/home/eafen405/Android/Sdk
setsid nohup ./gradlew :app:assembleDebug \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8 \
    -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 \
    -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 \
    -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]" \
  --max-workers=8 --parallel --console=plain > /tmp/rk-apk.log 2>&1 < /dev/null &
```

**可观察验证**：合法邀请（2、3 号）、非法邀请（403）、已用邀请（409）、重复提交（同一邀请 5 并发 → 1 成功 4 拒绝）、越权（代理人 403 且响应无 `invite`）、身份切换/登出（出 401、重登可用）全部在 `identity-http-acceptance.log` 中逐条可读。**本票不依赖会话格式票**。

**单测**：identity 相关 25 条（见 §3）；全量 387 条通过。

**声明**：以上为**构建**与**逻辑/HTTP 层**证据；**真机与真实 Firebase 未执行**（见 §5），因此本票不代表首版端到端真机验收完成。

## 2. 原始日志清单（本目录）

| 文件 | 内容 |
| --- | --- |
| `identity-http-acceptance.log` | 真实后端 + 真实 HTTP 的 8/8 验收（node:test TAP 输出） |
| `android-build-identity.log` | 本票 APK 构建原始日志（含 `GRADLE_EXIT=0` 与结束时间戳） |
| `unit-tests-full.log` | 全量 `:app:testDebugUnitTest` 原始日志 |
| `dsh-build.log` / `dsh-build-host.log` | dsh worktree 的 install / `build:lib:host` / `build:native-system` 日志 |
| `android-build-baseline.log` | 身份入口落地**之前**的基线 APK 构建（对照用，非本票结果） |
| `run-android-build.sh` | 基线构建脚本（构建参数与 §1.6 相同） |

## 3. 单元测试数字（真实统计，来自 `app/build/test-results/testDebugUnitTest/*.xml`）

```
files=49  tests=387  failures=0  errors=0  skipped=0
```

identity 相关共 **25** 条：

| 测试类 | 条数 |
| --- | --- |
| `data.remote.IdentityApiTest` | 6 |
| `data.remote.AccountSessionTest` | 7 |
| `data.remote.CredentialStoreTest` | 6 |
| `ui.identity.IdentityAccessPolicyTest` | 6 |

命令（`GRADLE_EXIT=0`，日志 `unit-tests-full.log`）：

```bash
cd /home/eafen405/projects/rikkahub/.worktrees/03-identity
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  -Dorg.gradle.jvmargs="-Xmx10g -Dfile.encoding=UTF-8 \
    -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 \
    -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 \
    -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]" \
  --max-workers=8 --parallel --console=plain
```

数字是**从 XML 数出来的**，不是只看 `BUILD SUCCESSFUL`（过滤器命中 0 个用例同样会成功）。

## 4. 云凭据扫描：方法、结论与局限

方法：用 Python `zipfile` 遍历 `app-universal-debug.apk` 的每个条目（跳过 >40 MB 的条目），对内容做正则匹配：`DEEPSEEK[A-Z_]*`、`VOICE[A-Z_]*|SILICONFLOW|siliconflow`、`sk-[A-Za-z0-9_\-]{16,}`、`AIza[0-9A-Za-z_\-]{20,}`。

结论：

- **没有** `DEEPSEEK_API_KEY` / `VOICE_API_KEY` 之类的凭据变量名，也没有真实的 `sk-…` 形式的 API key。
- `sk-` 的命中全是**打包进去的 web 资源里的 CSS 类名**（如 `sk-image-x-from-pos`、`sk-prompt-state-selector`），不是密钥。
- `DEEPSEEK*` 的命中是模型 id（`DEEPSEEK_CHAT`、`DEEPSEEK_FLASH` 等）；`siliconflow` 是 provider id。
- `AIza…` 的命中只有 **`app/google-services.json` 桩文件里的假 key**：`AIzaSyDSTUBKEYNOTREAL0000000000000000`（另有 WASM 资源里的一个字节序列，不是凭据）。

**局限（必须如实声明）**：这是**字符串级**扫描，能证明「已知形态的云凭据没有被打进包」，不能证明「任何形式的秘密都不在包里」；而且 `app/google-services.json` 是**假 key 桩**，Firebase/Crashlytics 运行时不可用。模型与 ASR 密钥按设计留在后端（dsh 行按请求解析凭据，APK 只与 `/identity/*` 及 dsh `/api` 通信）。

## 5. 未执行 / 未完成项（单列）

1. **真机 / 模拟器：未执行。** 未连接任何设备、未安装 APK、未跑 instrumentation 测试；本票的 Android 证据止于单元测试与真实 APK 构建产物。
2. **真实 Firebase：未执行。** `app/google-services.json` 是假 key 桩文件（`project_number 000000000000`、`current_key AIzaSyDSTUBKEYNOTREAL…`），只够让 Google Services 插件完成构建；Firebase Analytics / Crashlytics 运行时不可用。任何崩溃上报/分析结论都不能基于它。
3. **release 变体与签名：未构建。** 本次只构建 debug；release 需要签名配置与 `app/app.key`，本机没有。
4. **真实云模型 / 硅基流动 ASR 调用：不在本票范围**（按规格由后续票与集成票验收）。
5. **`CONVERSATION` / `GATEWAY` 区域：本票未交付。** 二者不在 `DELIVERED` 中，对所有身份显示未就绪；对话远程化属票 #28、网关属票 #43。
6. **法厄同管理身份越权的会话内容面：本票不覆盖。** 「管理身份不读取他人个人内容」需在 #28 按 principal 过滤会话时验收。
7. **偏差记录**：身份端点没有使用 `bindTypertRemote`/`@Remote`。原因：该类装饰器需要类方法装饰器语法，纯 JS 产品包无法表达；手写其私有 descriptor key 等于猜内部协议。改用产品自有 exact route（真实 HTTP 请求路径），已获 Lead 认可。
8. **共享文件改动（Lead 批准，供合并时重点查看）**：
   - `backend/v1-bundle/cordis.patch.yml`：追加 `credentials`、`webserver`、`connection`、`identity` 四行（累加，未改既有行）。
   - `scripts/ourfairy-backend.mjs`：新增 `IDENTITY_PACKAGE`、把身份模块五个文件加入 `PRODUCT_SOURCES` 哈希、在 `profileManifest().dependencies` 中把 `backend/identity` 以 `file:` 链接进 profile（链接包只有同时是 profile 依赖，dsh peer 才能解析）。
   - `backend/identity/src/http.mjs`：`carriesBody()`（Lead 提交 `a02bfde`）——没有 body 的已认证 POST 不再被误判 415。
   - `combo.json` 由 Lead 维护（补入 `build:lib:client`），本票未改动。
