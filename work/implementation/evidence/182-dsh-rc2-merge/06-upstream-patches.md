# 06 保留接缝的可上游补丁形态

票 [#190](https://github.com/eafen405/OurFairy/issues/190)。只要求**形状可提交**，不承诺合入上游。

## ① `@deepseek-ai/dsh-agent/session-history`

- **补丁面**：`packages/core/agent/src/session-history.ts` 一个文件，加 `package.json` 的
  `exports["./session-history"]` 与 `files` 两条。
- **形状**：一个工厂 `createSessionHistorySeam` + 一个具名错误 `SessionHistoryGapError`；
  入参只有 session id 与游标区间。
- **不含**：用户、邀请、群组、短号等产品词汇。
- **上游合入路径**：`dsh-agent` 是 host 面包，枚举子路径导出即可，无迁移。

## ② `SessionHeader.owner`

- **补丁面**：`packages/core/session/src/types.ts` 的 `SessionHeader` 加一个可选字段 +
  `SessionOwnerId` 品牌类型；格式编解码与持久化各加一条存取。
- **形状**：`readonly owner?: SessionOwnerId`，格式层只存取，不校验归属——「没有 owner 就拒绝」
  是授权层的决定，不是存储格式的。
- **向后兼容**：可选字段，旧日志照读。
- **上游合入路径**：`dsh-session` 的 header 是加法演进，需要一条 persistence-change 记录说明
  为什么是 same-version。

## ③ `connection.authenticators`（已改成上游基底之上的加法）

- **补丁面**：`rpc.ts` 的四个类型（`ConnectionCredential`、`ConnectionAuthenticator`、
  `ConnectionAuthenticatorRegistration`、`HostConnectionAuthenticators`）与
  `HostConnectionHandle` 的三个成员（`authenticators`、`fence`、`revokePrincipal`）；
  `rpc-host.ts` 的注册表实现（约 60 行）与 `admit()` 里的一个回退循环。
- **形状**：`identify(request)` 返回 `{ subject, principal }`；`subject` 不透明，Connection 只拿它
  做 Peer 缓存键与撤销键；`principal` 用上游可扩展的 `PrincipalMap`，不预设产品身份。
  `fence()` 只做 Host/Origin，`revokePrincipal(subject)` 按 subject 拆作用域。
- **没有**：`principalOf`（上游 `PeerScope.principal` 已经公开，多一层无信息增益）。
- **上游合入路径**：`client-connection` 的 host 面。上游若愿意在 `admit()` 上开口子，
  这是最小形状；若不愿意，本补丁可以只留在 fork。

## ④ job 事件

**没有补丁。** `jobs/lifecycle` 与 `jobs/report` 是产品呈现需要的事件，`job/registered` /
`job/settled` 是上游的注册表事实，两者载荷不同、都保留。把产品事件塞给上游不是本 spec 的目标。

## 未执行

- 没有真的向上游仓库发 PR 或 issue。
- 没有为 ① ② ③ 生成 `.patch` 文件：它们在集成分支上是正常提交，按文件与符号定位即可
  review；导出成补丁反而会与后续上游漂移脱节。
