# T14 Android

Android ticket `ticket/14-activity`, commit `fa83e9ce`, based on published product `bb29c98b9a626e7c9781ac24b4fa185c092a6f4c`; current product tip merged before delivery (already up-to-date).

The existing shared session projection gains backend-owned numeric activity/episode/completion/delivery facts. The existing `RemoteChatSnapshot.activity` is the single effective state for UI and subsequent notification consumption: backend reasons/episode facts stay intact; disconnected observation or incomplete recovery/writer acknowledgement yields unknown, never quiet. Pages do not inspect native events or infer activity from attempt/job presence. The native Compose card only displays that shared state. No new DB, table, activity log, execution policy or notification policy.

## Actual verification

`run-checks.sh` is the exact final command; `final-checks.log`: BUILD SUCCESSFUL, **57/57** JVM tests (new Activity State 5 + prior Chat API 18/State 9/Recovery 14/Job API 5/State 6), zero failures/errors, plus `:app:assembleDebug`. APK hashes/sizes in `apk.json`, binaries remain build artifacts rather than committed. Final post-check modification was KDoc wording only (clarifies backend authority versus observation unknown).

New public-state behaviors: Agent-idle job remains active; job-to-report retains same episode; quiet waits for recovery writer ACK; disconnect remains unknown while retaining facts; restart generation replaces stale activity; two sessions remain independent; quiet delivery has output fact without fake running/attempt; settled report becomes authoritative quiet. The network source is a controlled public `RemoteChatBackend`, storage a controlled `ChatSyncStore`, coroutine time deterministic. Backend tests separately cover the actual activity fold/native facts. `red-state.log.gz` captures missing public activity operations/DTO before implementation; `green-state.log` the first passing tracer.

mcode performed only bounded DTO/additive projection tail/pure display card. `mcode-task.md` declares exact scope. Child exit 0 (~168s), root `--notify-thread` completion notification exit 0; owner inspected actual diff and clarified one KDoc. No mcode build/commit/push. Lifecycle/recovery tests and state remained owner's work.

Build reused ignored local.properties/Firebase fake-key stub, pinned local submodule `5b3618b16fdc3825e21d5679bafd144662088ea1`, existing dependency symlink; no shared Gradle config change. Upstream Kotlin experimental marker/deprecation warnings remain. No phone/emulator/Compose instrumentation, real cloud model, APK-to-real-backend, signed release, performance or final product acceptance. Fake Google services key means Firebase/Crashlytics runtime unavailable. No background/all-session receiver or notifications implemented here (belongs to subsequent T15).

Actual backend contract decode: backend owner provided real profile activity `actual-backend-activity-sample.json`. Ran `ActualActivitySample.java` against already-built production `RemoteActivity.Companion.serializer()` using cached serialization 1.11.0/Kotlin2.4.20 jars; `actual-sample-parse.log` PASS verifies quiet, same persistent episode, start 2/end 29/output 27, no invented delivery. No repeated Gradle build. This proves sample decoding, not APK-to-backend runtime.
