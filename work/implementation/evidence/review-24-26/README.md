# #24–#26 阶段性 code-review

本轮使用 `code-review` skill，由独立 Standards / Spec 两轴子代理并行完成。按用户指定的个人项目尺度审查：优先复用、当前需求足够、易读，保留必要的权限、隔离、事务与恢复保障。

固定范围（已提交改动；已有未提交文件不纳入）：

| 仓库 | 比较基点 | 审查提交 |
| --- | --- | --- |
| OurFairy | c3d45c60edd778479f84f08cdc8bff992d47148d | de2ded1afa13a6a42816fbdd3682bdcc7be10760 |
| dsh | d743267388641bc76f17c45ce8b4c231aed1d32c | 2f084be06e75cd56c2a7ac9a31e155db9f4deee0 |
| rikkahub | 0966502c4d65c1ee4b2a3e49a19703bb1978016c | ffc88e306b0f55cf52c3592ac93151be0492b864 |

OurFairy 基点由用户明确确认。各仓使用 `git diff <base>...<tip>`；fork 范围对应本次 `combo.json` 锁定的产品提交。规格来源为 GitHub #23–#26 实时票面与本地规格；进度评论仅作证据指针。审查未将 #27 及后续功能缺失列作本批缺陷。

以下是修复前的独立发现，修复状态须以末尾的后续验证记录为准。

## Standards

审查固定为 scope.md 中的三仓提交，仅审查已提交改动；未修改仓库，也未把已有未提交文件纳入结论。

1. **P2 · 文档规则违反：数据库加入了明确禁止的约束。** OurFairy `de2ded1:backend/identity/src/store.mjs:39`（同文件 40、47、49、54、122）定义 `short_id/name... UNIQUE`、三个 `REFERENCES users(id)`，并启用外键。违反 OurFairy `AGENTS.md`「禁止数据库外键与唯一键索引」。最小修复：移除这些约束，复用已有 `BEGIN IMMEDIATE` 事务完成用户名、短编号及关联存在性检查；不要为此新增通用仓储层。已有数据库需在本模块内做一次小迁移，不能只修改 `CREATE TABLE IF NOT EXISTS`。

2. **P2 · 文档规则违反：业务表缺少删除与更新元数据。** OurFairy `de2ded1:backend/identity/src/store.mjs:37`（三表定义到 58）中的 `users`、`invites`、`sessions` 都没有逻辑删除字段和更新时间。违反 OurFairy `AGENTS.md`「业务表必须包含逻辑删除字段，并记录必要的关联人员、创建及更新时间」。`revoked_at` 只表示凭据撤销，不能替代所有业务表的删除语义。最小修复：给三张现有表补充字段和对应读写处理，保留事务及现有人员关联；无需新增表或删除管理界面。

3. **P3 · 判断性气味：Speculative Generality。** OurFairy `de2ded1:backend/probe/src/index.mjs:135` 的 `for (const method of ['names', 'list', 'specs', 'describe', 'snapshot', 'all', 'entries'])` 逐个猜测工具服务接口并吞掉异常。固定 dsh `2f084be06e:packages/core/tools/src/index.ts` 的 `ToolRuntime` 没有这些方法，因此整段只会返回 `not-enumerable`；维护了没有消费者的兼容分支，也不符合 `CONVENTIONS.md`「不要猜」。最小修复：删除探测循环，直接报告不能枚举，保留已有外部模型替身捕获的真实工具目录证据。

共 3 项：2 项明确规则违反，1 项判断性复杂度问题。最高严重度 P2。以上基于固定源码检查，未声称运行测试通过。

## Spec

1. **P1 — 恢复登录后导航停在不可操作页。** rikkahub `app/src/main/java/me/rerere/rikkahub/RouteActivity.kt:304`（关联 `:312`）：冷启动先以空身份建立 SignIn back stack，`restore()` 成功只刷新身份；rememberNavBackStack 不随新的 startScreen 重建。随后 SIGN_IN 被已登录策略拒绝，显示没有返回账号按钮的 NotReady，无法邀请或退出。违反 #26「一 APK 在同一导航组织中按身份进入可用区域」。最小修复：恢复完成后明确归一到 Account/SignIn，或等待恢复完成再建立导航；补恢复登录的导航测试。

2. **P1 — APK 只能连接模拟器专用地址。** rikkahub `app/src/main/java/me/rerere/rikkahub/di/IdentityModule.kt:20`：唯一地址硬编码为 `http://10.0.2.2:3080`，没有部署或用户配置入口。安装到 vivo/普通手机后，即使后端 LAN 地址可达，登录、注册、生成邀请码仍访问错误主机。违反 #26「完成邀请生成、注册、登录和会话凭据验证的真实后端请求路径及 Android UI」。最小修复：用 Gradle 属性生成 BuildConfig 地址并让部署构建明确提供；不必新增配置页面。

3. **P2 — 会话导出消费者未同步新格式。** dsh `packages/session-query/session-log-export/src/archive.ts:131`、`:252`：导出 header 白名单漏掉 owner；附件扫描不识别 delivery/message。对已归属、含投递文件的正式事件调用现有 serializeSessionLog/sessionLogZipEntries，实测输出 owner 丢失、ZIP 只有日志、附件读取次数为 0；相同 content 的既有 assistant/message 会带文件。违反 #25「同步必要的 surface、消息、查询及协议消费者」及「保留全部必要字段」。最小修复：导出 owner，扫描投递消息的附件引用，加入导出回归用例。

未发现需单列的额外产品行为或范围扩张。未将 #27 及后续票的未交付能力当作本阶段缺陷；未执行真机 UI。

## 基线验证

`node scripts/combo.mjs verify`：三个仓库的版本组合通过。

`node --test 'tests/**/*.test.mjs'`：宿主环境 18 passed / 0 failed，原文。沙箱内因 `listen EPERM 127.0.0.1` 无法执行真实组合测试，未将其当成产品失败或通过；按相同测试命令在宿主重跑。模型场景使用外部 loopback 替身，不是真实云服务。

Android 登录恢复缺陷为已核对导航库行为的静态控制流发现，未执行真机 UI；导出遗漏已通过公开导出函数复现。

两轴摘要：Standards 3 项，最高 P2（数据库约束与元数据规则）；Spec 3 项，最高 P1（登录恢复导航与部署地址）。

## 修复与集成结果

六项发现均在所属模块修复并集成，没有新增数据库或通用权限/导航框架。

| 轴/发现 | 最终处理 | 集成提交 |
| --- | --- | --- |
| Standards：外键/唯一约束、删除/更新时间 | 身份库本地 v1→v2 原子迁移，保留旧身份/邀请/凭据；事务内检查替代禁用约束；不新增删除管理接口 | OurFairy `ea7fdd1944a657dacd76c54fa0194e4fc7cb0a83` |
| Standards：猜测工具接口 | 删除无消费者的七种接口探测，保留真实模型请求工具目录证据 | 同上 |
| Spec：登录恢复导航 | 仅在启动恢复完成时按当前可信身份替换初始导航栈；不持续重定向未交付页面 | rikkahub `f84e6c5abecfb65d5f0c12a1423b055edb3acc9a` |
| Spec：模拟器地址不可部署 | Gradle 属性注入 BuildConfig；debug 可用模拟器默认，实际 release 生成任务缺地址明确失败，含配置缓存复用 | 同上 |
| Spec：导出缺 owner/投递附件 | 原导出器保留可选 owner；投递加入既有附件收集分支，保持去重 | dsh `d3fe98f969c3963c6d193e74c776692e33c1eb64` |

OurFairy 修复后完整产品套件 34 passed / 0 failed（含16个持久库行为/迁移测试和原有18个产品组合测试），见相邻。dsh 导出包80 passed，干净独立 worktree完整 `build:lib:host` 通过，包含根 host 测试类型程序；根目录的相关运行包来自同树的已验证产物，见 `export-compiler-fix/`。Android最终仅运行五个身份相关测试类29 passed，debug APK构建完成；显式地址进入debug/release BuildConfig，release缺配置实际失败及配置缓存存储/复用均已测，见 `android-fix-evidence/`。

执行过程中的真实失败没有抹去：原mcode报告的局部dsh类型门槛未覆盖测试，完整构建发现fixture缺MessageId，已补齐并在干净树重跑通过；dsh根原有16个未提交文件未改动，其两处类型问题不冒充已修复或根脏树构建通过。Android外部harness沙箱构建受限后，由实现子代理用现有宿主工具链完成最终检查。

证据不包含真机/模拟器/Compose运行、APK到真实后端连接、签名release、真实云模型或ASR调用。Firebase假key桩仍不可用于运行验收。#27后续功能和#23总规格没有被本次审查提前判定完成。

用户未提交AGENTS.md保留；各merger前后快照核对了已有脏文件。当前combo.json锁定上述dsh/rikkahub集成提交。
