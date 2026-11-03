# 多会话组合负载（#268）：5 个带历史会话 + 1 个持续流式会话并发
#
# 本文件只声明**组合负载**，与 #74 的单会话五档（`workload.md` 的
# history / single / format / stream / burst）分开命名与比较；两边的结果不混入同一张基线表。
# 这里任何一行改动都会产生新基线：`RemotePresentationBaselineTest` 会因此失败，直到新数值被记录下来。
# 正文取自同目录 `workload.md`，按 #74 的构造规则重复 64 次后截断到 `replyChars`。

sessions = 6
historySessions = 5
historyMessages = 200
streamingSessions = 1
replyChars = 232703
chunkChars = 128
intervalMillis = 20
