# T6 Android reconnect evidence

Repository: `/home/eafen405/projects/rikkahub`. Branch `ticket/06-reconnect`, isolated worktree `.worktrees/06-reconnect`, base `07c0df403a54aa0532840244adec63a6a91a81b4`, final `ebcb5536a95292c64764aab020d820a7c09926e1`. Final `git merge product/ourfairy-v1` reported Already up to date; worktree clean. No push/issue-close action.

Commits: `69ea1afd` public fixed-cut page/checkpoint transport, raw coverage recovery, preference adapter and pending commands; `ebcb5536` tested commit/live/account lifecycle fixes.

## Behavior and authority

The shared RemoteChatState keeps raw events by native seq and visible rows by stable messageId. Opening follow freezes C; pages always use `{throughSeq:C,beforeSeq:L}` backward and validate every raw event in the returned range, including events with no message. Backfill merges rows without replacing the latest live attempt/status. SSE observers retain the complete active prefix; a lost stream leaves the latest readable projection, reconnects after 1 second, and never calls stop.

Observed cursor, backend writer ACK and locally consumed W remain separate. A local batch is published only after complete contiguous 0..target raw coverage, explicit writer checkpoint and successful awaited local commit. The small preference record is keyed by endpoint + stable user shortId + sessionId (not token); it stores W/initialized and optional pending `{requestId,text}` only. It is not a chat cache: process recreation still backfills all historical rows to 0. The batch exposes key/generation/fromExclusive/throughSeq/initialization for future notification use without notification policy.

Pending identity/text is saved before network send. Save failure prevents network side effects and preserves text for explicit retry. Process recreation loads the same pending request identity, marked unknown; no automatic send. Explicit retry persists and sends identical ID/text, or the user queries receipt. Durable projected acceptance can clear pending; failed local clearing preserves recoverable identity. Changing accounts while pending save is in flight prevents the old send. Each connection/page result is gated by account/session/connection epoch; late old noncancellable pages are ignored.

No DB/table or Room history, no authoritative local receipt ledger, no generic outbox/sync framework, no model execution on the phone, and no notification strategy. The app-private SharedPreferences implementation is compiled; its Android runtime/disk behavior is not exercised by JVM state tests.

## Delegation

Applied delegate-harness and tdd. The single mcode task `delegate-minimax-06msd9_1/` produced the bounded ChatSyncStore + AndroidChatSyncStore files then reached its 15-step limit (exit7). Coordinator inspected both files, removed redundant/inaccurate commentary and verified compilation. No blind repeated attempt and no paid dsh invocation. Complex recovery remained with coordinator.

## Actual checks

Commands were run in the ticket worktree with `ANDROID_HOME=/home/eafen405/Android/Sdk`, Gradle wrapper and `-Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel`.

- `api-red.log`: `:app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest'` failed before the page/checkpoint/recovery APIs existed. Public tests and exact fixed-cut transport literals were written before adopting implementation.
- `recovery-first-green.log`: `:app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChat*'` passed 27 tests (API14, old state8, initial recovery5).
- `lifecycle-red.log`: public recovery tests caught old-account send after pending commit and lost unsaved text (10 tests,2 failed).
- `lifecycle-green.log`: all remote tests passed after the two fixes.
- `live-commit-red.log`: public tests caught W remaining1 when live tail3 arrived during local commit, and lost send response resurrecting already reconciled pending (12 recovery tests,2 failed).
- `live-commit-green.log`: all remote tests passed after the two fixes.
- `final-build-tests.log`: final `:app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.*' :app:assembleDebug` => BUILD SUCCESSFUL in35s. `test-summary.json` records 82/82, zero failures/errors/skips (API14 + recovery12 + old state8 + related identity/session tests). `apk.json` records generated arm64/x86_64/universal APK paths,size,SHA256.
- `git diff --check` passed before final commits.

Tests use actual loopback HTTP/SSE with JDK HttpServer for transport; controlled backend Flow/network/persistence adapters for public recovery state. Recovery cases include fixed-cut multipage plus concurrent live terminal, page failure/retry, writer ACK failure, local commit failure, same-user rotated token/process recreation without content cache, persisted pending before send, failed pending save, automatic reconnect/prefix, late noncancellable old-session page, account switch during local commit, and live-tail/receipt races.

Build preparation reused existing ignored local.properties and fake-key google-services.json, existing material-color-utilities checkout and installed root web-ui dependencies via temporary link (removed after build). No shared Gradle settings or unrelated repository files were changed.

Not executed: real Android SharedPreferences runtime/failure, Compose/emulator/device runtime, APK-to-real-backend, signed release, official cloud model or vivo S50 long-text/performance acceptance. These JVM/build results are not phone/cloud evidence. The backend worker separately owns actual profile/JSONL/writer fault evidence; this directory does not claim it ran those checks.
