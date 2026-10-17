# rikkahub — Standards 轴（只读评审）

**硬违规**
1. `RemoteReceiveState.kt:135-147`：135 行已 consume，142 行才 publish；`AndroidRemoteNotifications.kt:81` publish 异常会 rethrow，落 catch 时提醒已消费丢失，注释「Nothing was consumed…可重试」不成立，且该路径无测试 → `CODING_STANDARDS.md:7`「声称须可执行」。
2. `RemoteChatApi.kt:102-114`：新注释称 `/chat/read` 与 `observe` 同快照、同投影步骤；测试只各自解码（`RemoteChatApiTest.kt:236,307`），无两者一致断言；且自认无调用者仍保留 → 同上 + AGENTS「规模校准」（判断面 Speculative Generality）。

**判断项**
3. `RemoteReceivePlatform.kt:13-25` 重复声明 `RemoteNotificationPlatform.kt:4-8` 的 `isForeground`；enabled 又分 StateFlow 与 `IdentityModule.kt:84` lambda 两路 → AGENTS「权威唯一」。
4. 组合根/替身复制：`RemoteReceiveControllerTest.kt:133-140`（自称同 IdentityModule）、`RemoteNotificationBacklogTest.kt:81-83`、`RemoteNotificationStateTest.kt:88-91`、`RemoteActivityTrustTest.kt:69-73`；`Sessions` 替身另四份 → Duplicated Code，DI 漂移测不出。
5. `RemoteChatFixtures.kt:26-34` 固定 sessionId="s"，迫使 `RemoteNotificationBacklogTest.kt:66-72` 复制 activity 形状 → Duplicated Code。
6. `notifies`（`RemoteChatState.kt:115`）与 `settleReminders`（`RemoteReceiveState.kt:29`）同物异名 → Mysterious Name；`AndroidRemoteNotifications.kt:27`「publication only」与 :28 新职责矛盾；`RemoteChatState.kt:270` 返回 Pair 再包 Owed（`RemoteReceiveState.kt:130,154`）→ Data Clump。
7. `IdentitySessionsPage.kt:148-178` 仍 plain Card/titleSmall，未按 AGENTS.md:11-19 用 CardGroup/Emphasized（判断）。

**专项**：断言未弱化（`RemoteNotificationStateTest.kt:231→234` 同一事实；私有 map 改 `store.load` 更贴合「测试可见行为」；仅新增恒真空断言 :143/:252/:267 及 `RemoteNotificationWireTest.kt:75` 重复断言）；`ChatSyncRecord` 新字段置末、默认 false，旧 JSON/位置参数兼容；`RemoteReceiveState.kt:159` 缺末尾换行（无 ktlint/editorconfig 强制）。
