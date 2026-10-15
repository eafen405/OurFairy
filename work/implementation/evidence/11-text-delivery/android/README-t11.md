# T11 Android consumer compatibility

Baseline: rikkahub e58352f202ae1add0e9c4bd08b14807f4c84a9bb, branch ticket/11-text-delivery.

The existing production path already handles a committed ordinary Fairy message independently from an active attempt: RemoteChatApi.kt projects messages and attempt separately; RemoteChatState.kt merges stable message IDs and preserves the latest projection attempt; RemoteChatPanel.kt uses messageId versus (generation,attemptId) Compose keys. No production code or data structure changed.

Two bounded regressions were drafted by mcode M3.1-Flash-Preview effort max, exit 0. Agent task/run originals: /tmp/ourfairy-stage1012-android-harness/delegate-minimax-3qg4v90u. Owner inspected actual diff and corrected a misleading test name/comment implying the concurrent attempt was composing the delivery. No other changes to harness output.

- Loopback HTTP /chat/read decodes exact Markdown body/status/identity and an independent current attempt.
- Public state consumes the new committed message while the same active attempt advances; repeated delivery ID appears once, exact body is retained, and consumption reaches writer-acknowledged seq 8.
- Existing recovery suite covers ordinary role=2,status=2 messages in fixed-cut backward pages, retained newest live tail, process/reconnect/account boundaries, and raw fact coverage.

Executed run-checks.sh, with explicit Android SDK, pinned pnpm wrapper, xmx8g/max-workers4. Exact output in t11-tests.log: BUILD SUCCESSFUL in 1m38s, CHECK_EXIT=0. Tests: API 18, State 9, Recovery 14; 41 total, zero failures/errors/skips. XML originals and summary are adjacent.

These are existing-compatible behavior verification, green against the baseline production code; no manufactured red. No feature production change was required. Android setup reused ignored local.properties, fake-key Firebase build stub, pinned material-color-utilities submodule, and a local symlink to existing web-ui/node_modules. Shared Gradle config untouched.

Not run: device/emulator/Compose runtime, cloud inference, APK-to-real-backend, signed release. No notification feature, Room/outbox, provenance DTO or generic mapping layer was added. T12 is not implemented while blocked.
