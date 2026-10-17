# T5/T6 stage review fixes — Android

Base: rikkahub product/ourfairy-v1 `34cabaad38ac15b81f5f10ac501a24248fea6ec8`.
Branch/worktree: `fix/review-t5-t6`, `/home/eafen405/projects/rikkahub/.worktrees/review-t5-t6`.
Fix commit: `8b2eaf0dc85b33dbb1dc7dd7ebf513a493c8b2c9`.
Final `git merge product/ourfairy-v1`: Already up to date. Worktree clean. No push/issue-close/worktree removal.

Review reports: `/tmp/ourfairy-stage-standards.md` and `/tmp/ourfairy-stage-spec.md`. Standards1 and Spec1 overlap on navigation; Spec2 is generation recovery. Both distinct P1 findings fixed by the same implementer. Read applicable AGENTS and tdd skill. No harness run for these complex, tightly bounded fixes.

## Fixes

1. `Screen.Sessions` now has the same `@Serializable` annotation as adjacent destinations. The new public navigation regression uses the actual installed Navigation3 `NavBackStackSerializer(NavKeySerializer())` to serialize and deserialize a back stack containing Account and Sessions, then checks restored destinations. It does not merely inspect an annotation or serializer existence.

2. A different backend Agent `generation` rebuilds only the derived raw-event/message/attempt projection. The previous observed but unflushed tail can therefore be replaced by the authoritative recovered closer at the same seq, or disappear when the recovered baseline is shorter. Outstanding synchronization is cancelled and old-generation page/checkpoint callbacks are gated. Persisted consumption W and pending request ID/text remain unchanged; the new body is fully refilled rather than skipped on the strength of W. Same-generation seq/payload conflicts remain strict failures. Normal transport reconnection to the same backend generation keeps its progress. No W rollback, new initialization policy, new DB/prefs fields, or generalized recovery mechanism was added.

## Red → green and final checks

Commands ran in the review worktree with `ANDROID_HOME=/home/eafen405/Android/Sdk` and `-Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel`.

- `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.IdentityNavigationTest'` failed the new real serializer roundtrip with `SerializationException: Serializer for class 'Sessions' is not found` (5tests,1failure).
- `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatRecoveryTest' --tests 'me.rerere.rikkahub.ui.identity.IdentityNavigationTest'` failed the two new public recovery cases plus navigation (19tests,3failures). Cases: saved W0 and pending retained while observed unflushed seq1 is replaced by a recovered interrupted closer; and recovered cursor0 removes old orphan bubble3, refills saved body, preserves W0, then still rejects a conflicting same-generation seq0.
- exact same targeted command passed all19 after the fixes.
- `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.*' :app:assembleDebug` => BUILD SUCCESSFUL in30s.
- `test-summary.json`:85/85 tests,0failures/errors/skips (previous82 plus navigation1 and recovery2).
- `apk.json`: generated debug arm64/x86_64/universal APK paths,size,SHA256.
- `git diff --check` passed.

Build prerequisites reused existing ignored local.properties/fake-key google-services.json, material-color-utilities source and installed root web-ui node_modules via temporary link (removed after build). Shared Gradle user config and unrelated worktrees were untouched.

Evidence boundaries: navigation JVM test exercises actual Navigation3 serialization; recovery tests exercise the public shared state with controlled backend/storage adapters. No emulator/Activity lifecycle, Compose device runtime, real SharedPreferences disk fault, APK-to-real-backend, signed release or real model call was executed. Backend actual writer/crash behavior is supported by its separately recorded real-profile tests; these Android results are not phone/cloud runtime acceptance.
