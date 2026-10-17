# T15 / #38 — account-wide reception and durable notification consumption

## Delivery

Android ticket branch `ticket/15-notifications`, final `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6` (production wiring `ea04fa37`, final commit adds actual captured SSE test/resource only). OurFairy contains evidence and executable vivo acceptance only. No dsh or backend production changes, no new server endpoint/table, no Room/outbox/broker/alarm/boot receiver.

One `RemoteReceiveState` holds owned session runtimes at account/application lifetime. Selected page shares the exact per-session `RemoteChatState`, so navigating away no longer owns/tears down observation. AccountSession publishes one StateFlow identity; old getters derive from it. Per-session existing epoch/generation guards remain, and account replacement removes old runtimes. Receiver observation/service teardown never invokes backend stop-reply/stop-task.

Existing SharedPreferences ChatSyncRecord gains nullable notificationThrough and notificationEpisodeId. The same serialized owner writes sync consumption, notification consumption and pending send; notification consumption is independent of read. Missing/new/legacy notification state baselines complete history without old alerts. Existing valid state catches up before one merged reminder per session, using T14 authoritative activity summaries. Unknown is not quiet. Delivery and the same activity completion share episode deduplication; later episodes remain eligible. Foreground is checked after awaited local write at actual publication, across every app page.

Consumption commits **before** Android notify attempt. A crash/rejection between commit and publication can miss one episode's sound; durable body remains readable and no consumed sound is retried after restart. A crash after notify also does not repeat it. This is not strict exactly-once notification delivery and intentionally avoids a second notification queue.

Dedicated user-enabled specialUse FGS keeps live reception, with exact manifest subtype and explicit start-failure status. First enable requests notification permission only via explicit action; rejection preserves entry/status. Stable complete tuple URI/tag gives independent session tray positions. Cold notification intent waits for restore, compares current deployment/account, then authenticated receiver read authorizes and selects the target; late/account-switched answers do not navigate.

## Actual validation

All commands and raw logs are under `runtime/`; app helper Account red/green and bounded mcode task/result are under `android-app/`.

- First notification slice failed as expected before implementation, then passed.
- Successive baseline, episode/catch-up, crash/foreground checks passed; combined receiver/activity/recovery **33/33** passed.
- Actual merged Android all `data.remote.*` + `ui.identity.*` **135/135** and `:app:assembleDebug` passed. Production unchanged after that APK.
- Real product profile/native JSONL delivery + authenticated HTTP/SSE capture **1/1** passed （`capture-backend.mjs`）. External model is deterministic local network double; session persistence, account ownership and delivery are actual product/native paths. Isolated backend was stopped and home cleaned.
- Captured actual SSE was served over local HTTP through production `RemoteChatApi` decoder, coverage/checkpoint synchronization, awaited store and notification platform boundary: **1/1** passed. This validates real wire content against shipped client; replay server/platform are doubles, not APK-to-live-backend device evidence.
- Final complete affected JVM suite including that wire test **136/136**, **0 failures/errors**, 19 suites passed.
- `apk.json` records all three actual debug APK paths/sizes/SHA-256. Firebase config is a fake build-time stub, so Firebase/Crashlytics runtime is unavailable.
- AOSP FGS source selection justification: `platform-source/README.md`; actual official webpage timed out, primary AOSP Java source was retrieved via GitHub API and archived.

Runtime tests use network/store/clock/platform boundaries. Covered: first/legacy/missing notification baseline, ordinary valid-record backlog, full catch-up + writer ACK, unknown status, activity delivery then completion once, later activity, publication-time foreground, disabled-to-enable no replay, commit failure recovery, crash before/after notify, account retirement during awaited commit, two sessions independently, shared selected runtime, account switch and delayed owned list, cold target authorization, restore navigation qualifiers.

## Remaining physical/platform limits

Not run: vivo/phone/emulator, APK connected to actual backend, real lockscreen/Doze/process kill/force-stop/OEM settings, signed release, official cloud model/voice/image service, performance/final whole-product acceptance. Build and doubles cannot establish those. `vivo-acceptance.md` is executable preparation, **not executed acceptance**; genuine device gate remains #45. No guaranteed live connection under those conditions is claimed. Root/merger owns final integration npm test/combo/doctor, staged independent review, publication and ticket closure.
