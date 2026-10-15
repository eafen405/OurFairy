You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Implement a bounded Android transport slice only for T5 remote chat.
Workspace: /home/eafen405/projects/rikkahub/.worktrees/05-remote-chat (ticket/05-remote-chat based fd04aab7).
Read AGENTS.md here and /home/eafen405/projects/OurFairy/AGENTS.md. Read /tmp/ourfairy-t5-wire.md (authoritative wire), existing data/remote/SessionApi.kt and its tests. Follow /home/eafen405/.agents/skills/tdd/SKILL.md: agreed test seam is public Android transport/projection. Write a failing public HTTP test before implementation; record attempted red and final checks.
Allowed writes only:
- app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt (new)
- app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatApiTest.kt (new)
No UI/state/DI edits. Do not commit/push. Do not delegate.
Goal: straightforward @Serializable DTOs matching wire and RemoteChatBackend interface with suspend read(token,sessionId):RemoteChatProjection, send(token,sessionId,requestId,text):ChatReceipt, receipt(...):ChatReceipt?, stop(...):Unit, observe(token,sessionId):Flow<RemoteChatProjection>. RemoteChatApi(baseUrl, shared OkHttpClient, json default ignoreUnknownKeys) implements. Use original shared client; for long-lived observe only derive client.newBuilder().readTimeout(0, MILLISECONDS).build() (same pool/settings). SSE parser handles event projection, multiline data, comments/keepalive, ignores other events, emits complete snapshot. Body POST JSON and Bearer; no local model. Reuse IdentityRefused/IdentityUnreachable. Cancellation must cancel OkHttp Call and never /chat/stop. Do not swallow CancellationException. No automatic send retry or reconnect. Tests public adapter via existing MockWebServer dependency: send exact stable request identity + bearer; receipt null; rejected status envelope; cumulative SSE snapshot exact whitespace and normal close. Keep implementation simple/readable; avoid generic frameworks/extra mechanisms.
Build environment will be prepared by coordinator. Gradle command if needed: ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel. If setup blocked, report exactly and leave tests; coordinator will run. Completion report: changed files, checks attempted/actual, unresolved issues.
