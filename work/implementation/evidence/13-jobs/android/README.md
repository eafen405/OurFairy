# T13 Android

Android implementation commit `bb29c98b` (normal commit; current product tip merged, already up-to-date). Ticket branch `ticket/13-jobs` in rikkahub, based on `product/ourfairy-v1` `b0911d34bdbe6ee8f559167ede41da95a9f082f8`. No root dirty file edited. Implementation reuses `RemoteChatState`, existing authenticated OkHttp adapters, and native Compose panel; no database, activity log, task notification policy, or transplanted TypeScript UI.

Task cards show projected native lifecycle/report facts. Details poll output while open with stable generation/task identity. Absolute UTF-8 byte cursors trim whole-chunk overlap and follow server retention; loss remains explicit even when terminal. Unavailable output does not change known terminal outcome or claim complete output. Closing details/detaching cancels observation only. Task stop and reply stop use distinct public commands. Account/binding changes retire late output. `RemoteChatProjection.tasks` is appended to preserve existing positional constructors.

## Actual checks

`run-checks.sh` records the actual final command. `final-checks.log`: **BUILD SUCCESSFUL**, 52 tests, 0 failures/errors (new Job API 5, new Job State 6, existing Chat API 18/State 9/Recovery 14), and `:app:assembleDebug`. APK sizes/hashes: `apk.json`; files remain in ticket worktree build outputs, not committed.

TDD: `red-state.log` includes missing public task-detail operations before implementation (also caught positional DTO fixture compatibility, corrected by moving additive field to tail). `green-state.log` first tracer passed. `red-retention.log` demonstrates a concrete public UTF-8 retention-window trim failure, corrected before final suite. Initial preparation exposed incomplete pinned submodule checkout and file transport refusal; final checkout uses same pinned `5b3618b16fdc3825e21d5679bafd144662088ea1` via existing local submodule clone with per-command local file permission, no shared Git config change.

mcode bounded task (`mcode-task.md`) changed only DTO/HTTP adapter and additive projection field; completed normally, child exit 0, ~81s. Owner inspected all tracked/untracked diff, made required fields explicit, corrected a misleading chunk comment and positional field placement. `mcode-run.json`/stdout preserve result. Completion notification failed because the default thread was a multi-agent subagent, which app-server rejects (`mcode-notify.txt`); foreground managed session collected completion. Root supplied explicit root thread for subsequent harness calls; no skill modification or repeat task.

## Boundaries and limits

Network tests use actual loopback JDK HTTP server and real OkHttp/serialization with controlled responses. State tests use the agreed public session-state interface, deterministic network/persistence boundaries and coroutine time. These do not prove real backend/process execution (backend owner covers that separately). Android build uses existing ignored Google-services fake-key stub; Firebase/Crashlytics runtime unavailable. No phone/emulator/Compose instrumentation/SAF, actual cloud model, APK-to-real-backend, signed release, performance or final product acceptance was run.

No staging of `web-ui/node_modules` symlink; its existing target was only reused for build. Shared Gradle user configuration untouched. Kotlin upstream deprecation/experimental marker warnings remain.

Contract cross-check: `actual-backend-wire-sample.json` came from backend owner actual profile API after Host restart, not the Android network double. Actual fields/types match Android DTOs; known completed status 3 remains separate from availability 0, original report status/messageId/turn retained, stop outcome 0. Backend unavailable `next=total` is deliberately not treated by the client as bytes actually observed. This is a source/JSON contract check, not APK-to-backend execution.

Actual sample parse executed with compiled production Kotlin serializers (`RemoteTask.Companion.serializer()` and `RemoteJobOutput.Companion.serializer()`) using cached serialization 1.11.0 and Kotlin 2.4.20 jars; Java harness `ActualJobSample.java` and `actual-sample-parse.log` record PASS. This is an actual decode check of backend sample without another Gradle build, not just source inspection.
