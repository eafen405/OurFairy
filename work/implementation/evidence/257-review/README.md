# spec #257 收口评审与修复

日期：2026-10-30。父规格 [`#257`](../../../tickets/257/257.md)。评审范围 `main...integration/spec-257`
（`716c20d2bf..3042ec6adc` 起，含 #263、#264 与评审修复）。两轴评审按
`work/implementation/CONVENTIONS.md` §8 跑：Standards + Spec，各自独立子代理，结论分别记录。

## Standards 轴

| 发现 | 判定 | 处理 |
| --- | --- | --- |
| 文档与术语表声称「新增 `Screen` 在编译期强制登记」，但 `routeOf` 持有穷尽 `when`、`destinationOf` 再按 route 回查 `entries`：漏登记只会在运行期抛 `NoSuchElementException` | 硬违反（声称须可执行） | `destinationOf` 改为直接持有穷尽 `when` 并返回目的地对象；目的地构造时三项策略都是必填参数，保障变成构造期 |
| route → 目的地两处查找（`firstOrNull` 与 `first`） | 判断项 | 收敛为私有 `destinationByRoute`；`entries` 只做枚举 |
| `FairyDestinationsTest` 两条自证断言：`routeOf(x) == routeOf(x)`、以及「从 `entries` 取出的对象在 `entries` 里」 | 硬违反（测试不承载声称） | 删除；换成「每个 `Screen` 样本解析到的目的地确实被 `entries` 枚举」——`destinationOf` 改成 `when` 之后这条才有意义 |
| `FairyLastLocationTest` 用被测函数（`restingPlaceOf` + `resumedStack`）算期望 | 硬违反（自证） | 期望改为写死的表；另加一条断言「catalog 认为可恢复的目的地集合 = 表里列出的集合」 |
| `CatalogColdStartTest` 用例名声称「home then settings」，断言只有设置页文案 | 判断项 | 改名 `a stored settings location reopens the settings page`（Activity 不暴露返回栈，只能断言落点） |
| 设计记录漂移：`page` 签名、`ResumeConversation`、`entryOf`/`contentKeyOf` 未写回 `notes/257-destination-catalog.md` | 硬违反（记录是设计权威） | 修订 §2/§3 并把评审修正补成 §9 |
| `FairyPagesTest` 两处自建 `var target` 导航器 | 判断项（规格要求页面测试不维护路由副本） | 改为走 catalog 的 `destination(...)`；仍直接渲染 `FairySettingsPage` 的用例保留——它们注入 `updateContent`/`onOpenImpression` 这类页面自有参数，不承担路由职责 |

## Spec 轴

| 规格要求 | 判定 | 处理 |
| --- | --- | --- |
| 所有目的地由生产 catalog 提供装配、准入、恢复 | 满足 | 八个目的地一处声明；`entryProvider` 只剩 `entryOf` |
| 每个目的地显式声明恢复策略，无未处理 `else` | 满足 | `DestinationRestore` 三个分支穷尽 |
| 新增目的地缺策略时完整性测试失败 | 满足（构造期） | 三项策略为必填构造参数；`destinationOf` 的 `when` 穷尽 |
| 页面测试不再维护手抄路由 | 部分 → 已补齐 | 三块 `when` + 两个 helper + 两个自建导航器全部改走 catalog |
| 通知定位不绕过准入 | 满足 | `openRemoteNotification` 校验端点/用户/会话后，落点取 `resumedStack(CONVERSATION_ROUTE, id)`；闸门仍判栈顶 |
| Activity 层验证通知定位确实用生产 catalog | **未满足** | 未加 Activity 级用例；`handleIntent` 是私有方法，证据只到「唯一调用点 + 目录测试」。记入未执行项 |
| 会话列表本票保留并显式恢复 | 满足 | `sessions` route 与 `[Home, Sessions]` |
| 不改页面内容、返回语义、后端权限、通知记账 | 满足 | 无后端改动；页面文件未改 |

## 评审后的验证

在集成分支 worktree（`.worktrees/spec-257`）上，`ANDROID_HOME=/home/eafen405/Android/Sdk`：

| 命令 | 结果 |
| --- | --- |
| `./gradlew test lintDebug` | BUILD SUCCESSFUL 2m10s；**52 套件 / 364 用例 / 0 失败 / 0 错误**；lint `severity="Error"` 计数 0 |
| `npm run combo:verify` | 组合校验通过（本仓库、dsh、客户端来源三行全 ok） |
| `npm test`（后端全量） | **通过**：430 通过 / 0 失败（见下方「后端全量」一节的时间线） |

## 后端全量：先红后绿

同一台机器上，`npm test` 在收口期间三次失败、一次通过，失败面每次都相同：

| 时刻 | 结果 | 失败面 |
| --- | --- | --- |
| 修复前（#263 提交门禁） | 41 失败 | profile 安装阶段 `corepack` 取 pnpm 超时 |
| 修复前（重试） | 9 失败 | 同上，`ConnectTimeoutError` 到 npm registry |
| 修复后（重启前） | 9 失败 | 同上 |
| **重启后** | **430 通过 / 0 失败** | —— |

失败的原因是「测试复制出的仓库没有 `.corepack` 缓存 → corepack 现取 pnpm → 到 npm registry 的连接
10s 超时」，属本机网络状况；`tests/bundle-packages.test.mjs` 在 `main`（`716c20d2bf`）检出上以完全
相同的方式挂起（7 分钟 0 用例、进程用户态时间 0.09s），所以它不是本 spec 引入的。重启后网络恢复，
全量通过。结论：后端面与本 spec 无关，且最终集成状态是绿的。

## 未执行项


- **Activity 级通知定位用例未写**（见 Spec 轴）。
- **真机未验收**：结论止于 Robolectric（SDK 35）与 `lintDebug`。
- **saved-state 行为未做 UI 级验证**：`contentKey` 的实例区分只有取值断言。
- **`Gateway`/`Impression` 页仍从 Koin 取 backend**，所以「八个目的地都能在无容器环境装配」不成立。
