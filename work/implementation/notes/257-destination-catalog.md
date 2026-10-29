# spec #257 目的地 catalog 设计决议

跨 #263 / #264 一致的实现决议。改动需先报 Lead。事实依据见
`/home/eafen405/projects/spec-notes/257/exploration.md`（探索笔记，不入库）。

## 1. 位置与形状

新包 `android/app/src/main/java/me/rerere/rikkahub/ui/destination/`，两个文件：

- `FairyDestination.kt` —— 目的地词汇：`FairyDestination`、`DestinationAccess`、`DestinationRestore`、
  `DestinationRestingPlace`、`DestinationActions`、`DestinationPageScope`。
- `FairyDestinations.kt` —— 静态表：`object FairyDestinations`，含 `entries`、`destinationOf(Screen)`、
  `restingPlaceOf(Screen)`、`resumedStack(route, conversation)`、`mayCompose(Screen?, IdentityScope)`。

catalog 是**进程内静态表**，不依赖 Compose 渲染即可被测试枚举；页面装配是其中一条属性。

## 2. 三个策略，每个目的地一处声明

```kotlin
class FairyDestination(
    /** 持久化用的稳定名字；同一份存储里必须唯一。 */
    val route: String,
    /** 谁能组成它。 */
    val access: DestinationAccess,
    /** 冷启动是否回到它、回到哪个栈；`Never` 必须写出，不允许省略。 */
    val restore: DestinationRestore,
    /** 页面装配。 */
    val page: @Composable DestinationPageScope.() -> Unit,
)

sealed interface DestinationAccess {
    /** 只有未登录者可以组成（登录、注册）。 */
    data object Visitors : DestinationAccess
    data object SignedIn : DestinationAccess
    data object Admin : DestinationAccess
}

sealed interface DestinationRestore {
    /** 不作为已登录后的冷启动位置。 */
    data object Never : DestinationRestore
    /** 冷启动恢复到的栈，末项是本目的地。 */
    data class Resume(val stack: List<Screen>) : DestinationRestore
}
```

`DestinationPageScope` 是 receiver，携带页面需要的东西，不含 Koin 单例：

```kotlin
class DestinationPageScope(
    val actions: DestinationActions,
    val session: AccountSession,
    val receive: RemoteReceiveState,
    val identityBackend: IdentityBackend,
)

class DestinationActions(
    val push: (Screen) -> Unit,
    /** 替换栈顶（会话内切换）。与 push 语义不同，不要合并。 */
    val replace: (Screen) -> Unit,
    val pop: () -> Unit,
    /** 整体替换栈（退出登录、回首页）。 */
    val reset: (List<Screen>) -> Unit,
    /** 凭据流程结束；宿主播放登录收拢动画，不是导航。 */
    val identityCompleted: () -> Unit,
)
```

生产侧由 `RouteActivity` 用真实 `backStack` 构造 `DestinationActions`；页面测试不启动 Koin，直接传自己的
fake `session` / `receive` / `identityBackend`（就是 `FairyPagesTest` 已有的那三个）。

## 3. 完整性与显式策略

- `destinationOf(screen: Screen)` 对 `sealed interface Screen` 写**无 `else`** 的 `when`。
  新增 `Screen` 子类型 → **编译失败**。这是「登记一次」的执行机制（本机无 `kotlin-reflect`，
  `sealedSubclasses` 不可用，不要引入该依赖）。
- `DestinationRestore` / `DestinationAccess` 都是密封类型且无 `null`：少写一个策略编译不过。
- 表驱动测试断言编译器管不到的三条：`route` 两两不同；`Resume.stack` 非空且**末项等于该目的地**；
  一个 `Resume` 目的地的栈里不允许出现 `Never` 目的地（登录、注册不能出现在恢复栈里）。

## 4. 恢复策略（本 spec 的产品决定）

| 目的地 | route | access | restore |
| --- | --- | --- | --- |
| 登录 `SignIn` | `sign_in` | `Visitors` | `Never` |
| 注册 `Register` | `register` | `Visitors` | `Never` |
| 首页 `Home` | `home`（沿用旧键） | `SignedIn` | `Resume([Home])` |
| 设置 `Settings` | `settings`（沿用旧键） | `SignedIn` | `Resume([Home, Settings])` |
| 会话列表 `Sessions` | `sessions`（沿用旧键） | `SignedIn` | `Resume([Home, Sessions])` |
| 会话 `Conversation(id)` | `conversation`（沿用旧键） | `SignedIn` | `Resume([Home, Conversation(id)])` |
| 网关 `Gateway` | `gateway`（沿用旧键） | `Admin` | `Resume([Home, Settings, Gateway])` |
| 印象 `Impression` | `impression`（新） | `SignedIn` | `Resume([Home, Settings, Impression])` |

- **沿用旧 `route` 字符串**：升级用户已存的恢复位置继续有效，不得改名。
- `FairyLastLocation` 的 prefs 文件名与 `conversation` 键保持不变；它只保留读写 I/O，
  「哪些页面记、记成什么、恢复到哪个栈」全部来自 catalog。
- **印象页的恢复是本次唯一新增可见行为**（今天它落入 `else -> return`，从不被记录）。
- 会话 route 但 `conversation` 缺失或空白 → 落到 `UNKNOWN_LANDING = listOf(Screen.Home)`，
  作为**具名常量**声明，不是 `else` 兜底。未知 route 同样落到它。
- 恢复只在已登录时发生（`restoreIdentitySession` 的既有分支）；未登录仍只进登录页。
  这是「未登录冷启动只进入登录或注册流程」的实现方式，不要另建分支。

## 5. 准入

- `mayCompose(screen: Screen?, identity: IdentityScope)`：`null` → `false`；否则读该目的地的 `access`。
  `DestinationAccess.Visitors` → `!signedIn`；`SignedIn` → `signedIn`；`Admin` → `signedIn && isAdmin`。
- `IdentityScope` 留在 `ui/identity`，catalog 引用它（不复制一份身份事实）。
- `IdentityAccessPolicy` / `IdentityDestination` / `Screen.toIdentityDestination()` 在 #264 删除；
  #263 期间它们继续服务未迁移目的地，**不新增转发层**。

## 6. nav3 装配（实测约束）

- `NavEntry(key, contentKey, metadata, content)` 可直接构造；`entryProvider` 形参就是普通函数类型
  `(Screen) -> NavEntry<Screen>`，`entryProvider {}` 只是它的一个构造器。
- **`contentKey` 必须是能进 Bundle 的 String**，且要区分实例（`Conversation("a")` 与 `Conversation("b")`
  不能共用）。用 `route + ":" + key.toString()` 一类稳定值；**不要**传 `Screen` 实例（运行期抛
  `IllegalArgumentException`）。
- entry 工厂必须是**普通函数**（不是 `@Composable`）；composable 内容放进 `content` 参数。

## 7. 与 spec #256 的边界

- 不修改 `FairyConsolePage.kt` / `FairyConversationPage.kt` / `FairyPresence.kt` / 新增互动 module 的内部实现。
- `android/GLOSSARY.md` 只追加本 spec 的词条；`GLOSSARY-MAP.md` 不改（#256 已改过那一行）。
- `FairyPagesTest.kt` 只改手抄 `when (destination)` 那几块与两个装配 helper，不动测试方法体的断言。

## 8. 两票的分界

- **#263**：新增 catalog + 迁移首页、设置、网关、印象四条。`RouteActivity` 的 `entryProvider` 里，
  已迁移目的地改由 catalog 装配，其余保持原样；`mayCompose` 与 `restoredStack` 对已迁移目的地改读 catalog，
  未迁移仍走旧路径（临时共存，注释写明由 #264 收口）。补 Activity 级冷启动测试（设置页恢复）。
- **#264**：迁移登录、注册、会话、会话列表、通知定位；删除 `entryProvider {}` 的其余分支与
  `IdentityAccessPolicy` / `IdentityDestination` / `toIdentityDestination`；`FairyPagesTest` 的手抄路由
  改为用 catalog 装配；表驱动测试枚举全部目的地与三种身份。

### 8.1 #264 的落地决定（#263 合并后补记）

- `FairyDestination.page` 变成**非空**：迁移完成后每个目的地都必须有页面装配，`assembles()` 与
  `RouteActivity.navigationEntry` 的第二条分支一起删除，`entryProvider` 只剩
  `destinationOf(screen).Content(scope)`。
- `IdentityAccessPolicy`、`IdentityDestination`、`Screen.toIdentityDestination()` 删除；
  `IdentityScope` 留在 `ui/identity`（它是身份事实，不是导航词汇）。`ScreenIdentityDestinationTest`
  随之删除，它的断言并入 catalog 的表驱动测试。
- **通知落点复用 catalog 的会话栈**：`handleIntent` 在端点、用户编号、会话坐标都通过之后，
  用 `resumedStack(CONVERSATION_ROUTE, sessionId)` 重置返回栈，而不是再写一遍
  `[Home, Conversation(id)]`。通知语义仍由 `openRemoteNotification` 拥有，catalog 只回答
  「会话这个目的地占哪个栈」。
- `FairyPagesTest` 用一个**单槽**导航模型接 catalog：`push`/`replace` 都写同一个 `destination`
  状态，`pop` 与 `reset` 落到它们的目标页。测试方法体里的断言一律不改，只把三块手抄
  `when (destination)` 与两个装配 helper 换成「用 catalog 装配当前 `destination`」。
- 完整性测试补齐：八个目的地 × 三种身份的表驱动准入、八条恢复策略、以及「`entries` 覆盖
  `Screen` 的全部子类型」——最后一条由 `destinationOf` 的穷尽 `when` 编译期保证，测试只断言
  `entries` 的 route 集合与「每个样本都能解析回自己」。
