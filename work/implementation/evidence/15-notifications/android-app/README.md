# T15 Android app/platform slice

Worktree `rikkahub/.worktrees/15-notifications-platform`, branch `ticket/15-notifications-platform`, based on published T14 `fa83e9ce`. App commits: `a6747d76` (one observable account authority), `793ab4d3` (app/platform). Merged T15 owner receiver/runtime `0494830e` before delivery; product integration tip merged (already up-to-date). Owner integrates and runs the final combined affected JVM/build checks; this slice does not claim those before the actual result.

Scope: AccountSession exposes one `identity:StateFlow<SignedIn?>`; getters derive from it, restore publishes accepted identity. Existing AppScope owns account receiver; selected session page shares the same RemoteChatState and never binds/detaches a separate connection. Page checks receiver binding before showing old state. Notification cold clicks wait until restore settles, match current endpoint/account, query existing backend-authorized receiver read, then recheck identity before navigating.

Android publication adapter uses complete deployment/account/session URI as PendingIntent identity and notification tag with fixed message id, preserving independent positions. ProcessLifecycleOwner provides app-wide foreground state. Permission/channel rejection remains visible; explicit setup card retains manual permission/notification/battery settings. One existing SharedPreferences file holds one `enabled` boolean default false. Runtime notification algorithm and durable cursors belong to the T15 owner, not this adapter.

Dedicated non-exported specialUse foreground service maintains observation only, START_NOT_STICKY. App/controller/service timeout or teardown calls receiver observation controls, never reply/task stop. Queued starts check current enabled/account state. Foreground app may observe without enabled background service; background observation requires running service. Start rejection is reported; no boot alarms/push/framework or guarantee through process death/Doze/force-stop. AOSP specialUse source evidence and vivo acceptance are in sibling evidence directories.

## Actual checks so far

`red-account.log`: missing AccountSession.identity public interface before implementation. `green-account.log`: BUILD SUCCESSFUL; AccountSessionTest8 + IdentityNavigationTest6 = **14/14**. No later parallel Gradle from this slice: owner serializes runtime and final combined build to avoid resource waste. New RemoteNotificationNavigationTest3 covers cold restore, wrong account/deployment without query, ownership refusal and late account change; final execution is owned by combined checks.

mcode bounded task (`mcode-task.md`) edited only Compose callback-only setup card and exact manifest service declaration. Child exit0 (~52s), notification-to-root exit0. Owner inspected full actual tracked/untracked diff; no runtime, prefs, permission request or account logic delegated. No mcode commits/builds/pushes.

No phone/emulator/instrumentation, actual locked-screen/Doze/process-kill/force-stop, real official model or APK-to-backend run is claimed. Android builds use ignored fake Google services key; Firebase runtime unavailable. Shared Gradle configuration untouched, pinned local submodule/dependency symlink reused; root repositories preserved.

Combined owner verification: T15 owner reports merged Android `ea04fa37`, full remote + identity JVM **135/135** and debug APK successful; app/platform scope compiled and its navigation tests executed in that combined run. Final raw logs/XML/APK evidence belong to sibling owner runtime evidence, rather than a duplicate build from this worktree. Actual backend SSE/sync notification consumption evidence is being collected by the owner separately.
