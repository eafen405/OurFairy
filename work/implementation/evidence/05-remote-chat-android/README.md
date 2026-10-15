# T5 Android remote chat evidence

Repository: `/home/eafen405/projects/rikkahub`, ticket branch `ticket/05-remote-chat`, base `fd04aab78919a7816e6eb962949a6eaf13a41532`, final `aedbf7e348099844e46257550f5db644a4b7d1d5`. Before handoff `git merge product/ourfairy-v1` reported Already up to date.

Commits:
- `9c53a259`: authenticated remote chat DTO/HTTP/SSE adapter and public adapter tests.
- `76167268`: shared account/session projection, stable unresolved request identities, durable receipt reconciliation, public state tests.
- `aedbf7e3`: existing identity sessions entry + shared endpoint/client DI + remote panel using existing MarkdownBlock for terminal Fairy messages.

## Changes

No Room history, new DB/table, local ChatService/GenerationLoop, model credentials or local model execution. RemoteChatState is one shared StateFlow. Its pending-by-session map contains only current account unresolved client commands and is not history/receipt authority. Binding another credential clears it; late observers/results cannot contaminate the new account. T5 does not persist/replay pending commands across process termination and never automatically creates a replacement request identity. T6 handles further recovery.

Complete SSE snapshots replace older ones and preserve exact raw text; attempt text is shown plain, terminal Fairy messages (including interrupted/failed) go through the existing MarkdownBlock implementation with code, table and formula adapters. Closing an observer never calls stop. Explicit stop uses `/chat/stop`. A disconnected observer leaves the last projection/attempt intact, rather than declaring the reply complete. T5 manual reconnect only.

The app uses the existing BuildConfig endpoint, credential and shared OkHttp settings. The SSE client is derived only to remove read timeout. Stable requestId/text survives unknown acceptance and same-account session switches; only explicit retry resubmits the identical command, and receipt queries or writer-confirmed projected messages can reconcile it.

## Delegation

Applied delegate-harness and tdd skills. mcode transport attempt is `delegate-minimax-pp5vpwou/`: bounded DTO/API/test task, 40-step limit, exit 7 after partial output. The coordinator inspected and completed it. API tests initially included contradictory fixture expectations; corrected to the actual literal wire values. A public slow-consumer test reproduced dropped terminal snapshots (version118 rather than200); replacing trySend with suspending send fixed it. The refusal code from an SSE handshake is preserved.

mcode single-file UI task is `delegate-minimax-_hgmckrj/`: exit0, coordinator inspected actual file, compiled it, trimmed redundant prose and made user/Fairy and interrupted/failed states visible. No repeated blind retry or paid dsh invocation.

## Actual verification

All commands ran in the ticket worktree with `ANDROID_HOME=/home/eafen405/Android/Sdk` and existing Gradle wrapper.

Initial red:
`./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel`
`state-red.log`: failed expected compilation before new API/state existed.

Transport regression red:
`./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel`
`api-backpressure-red.log`: 2 failures, terminal snapshot dropped and refusal code lost.

State lifecycle red:
`./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel`
`state-lifecycle-red.log`: 2 failures, observer reopen orphaned send result and unflushed message incorrectly settled unknown acceptance.

Final command:
`./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.*' :app:assembleDebug -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel`
`final-build-tests.log`: BUILD SUCCESSFUL, 26s. `test-summary.json`: 68/68 tests, zero failures/errors/skips; remote API12 + state8 plus related identity/session regression tests. Debug arm64, x86_64 and universal APKs built; paths/size/hash in `apk.json`.

Transport tests use actual loopback HTTP/SSE with JDK HttpServer as network/backend substitute. State tests use controlled public backend Flow/operations. These do not substitute for APK runtime acceptance.

Build prep copied existing ignored local.properties/google-services.json, copied existing checked-out material-color-utilities content, and temporarily linked the root existing web-ui node_modules. The temporary link was removed after build and is not committed. No shared Gradle user config was changed. Firebase file is the existing fake-key build stub; no Firebase runtime claim.

Not executed: Compose/device/emulator runtime, APK connected to real backend, actual cloud model, signed release, rendering performance/scroll continuity on vivo S50. Existing Markdown code path and the final rendering mode are compiled/tested, not screenshot or device-render validated. T6 paging/recovery, notifications, and future rendering-performance ticket are outside T5.
