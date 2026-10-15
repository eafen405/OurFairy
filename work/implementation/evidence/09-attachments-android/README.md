# T9 Android attachment evidence (in progress)

Repository /home/eafen405/projects/rikkahub, branch ticket/09-attachments; isolated worktree .worktrees/09-attachments starts at product/ourfairy-v1 d8567891533e6bc725f48382c43b2096de4e422b.

State/persistence scope: extend existing pending record with ordered uploadIds, preserving requestId + exact text across unknown acceptance/restart. Existing ChatSyncStore remains the derived preferences record; no Room/history/outbox. Draft imports are temporary original-byte Files; upload receipts are scoped to current account/session binding, discarded on switch. Download gets authenticated parent message/index original bytes privately, checks binding, then writes selected SAF target. Message history remains server authority. No preview/cache framework.

Delegation: mcode API/DTO/raw original upload/download in separate .worktrees/09-attachments-api, run /tmp/delegate-minimax-pofb6dgn. mcode picker/SAF/chips in separate .worktrees/09-attachments-ui, run /tmp/delegate-minimax-tfl1zwey. Coordinator owns state/pending/races and validates actual diff/checks before integration.

Initial TDD public-state tests written before implementation: attachment-only UNKNOWN/restart identical ordered references; local pending-save refusal prevents send; delayed old-account upload/picker drop; delayed old-session download does not export. state-red.log records compile failure for missing RemoteAttachmentBackend before API task finished (this is a dependency compile red, not a runtime behavioral failing assertion).

Build preparation reuses ignored root local.properties and fake-key google-services.json, initializes same pinned material-color-utilities submodule, symlinks already installed web-ui/node_modules; no shared Gradle configuration modified. Future successful builds do not prove Firebase or device runtime.

Not run: phone/emulator/Compose/activity-result lifecycle, Android actual preferences disk failures, APK-to-real-backend, official cloud model/image runtime, signed release or vivo performance acceptance. Public state tests use controlled backend/persistence adapters; API tests use actual loopback HTTP network double. These are not device/cloud evidence.

## Completed checks

- first-integrated.log: debug APK built, JVM tests did not compile because mcode test omitted OkHttpClient import. Corrected import.
- integrated-behavior-red.log: 97 tests, 2 failures. Both were incorrect mcode test expectations: complete request body was JSON {uploadId} but expected a bare ID; uploadIds default empty is validly omitted by Kotlin serialization but test required the key. Public state tests (4/4) passed in this run. Corrected fixture assertions to check decoded ID and default-empty semantics.
- final-build-tests.log: run-checks.sh executes :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.*' :app:assembleDebug, ANDROID_HOME explicit, --max-workers=4 --parallel with -Xmx8g. BUILD SUCCESSFUL in 13s, CHECK_EXIT=0. 97 tests, zero failures/errors/skips; test-summary.json records suite counts. Three arm64/x86_64/universal debug APKs and SHA256s in apk.json.
- git diff --check passed.

mcode corrections at integration: UI missing kotlin.coroutines.coroutineContext import; remember keys moved from sessionId to account/session attachmentEpoch; delayed import errors no longer update another binding; import temp cleanup surrounds dispatcher return cancellation. API/test missing OkHttp import; two observed fixture fixes above; explicit HTTP retryOnConnectionFailure(false) makes the bounded chunk/complete retry policy real; proposal always begins at status0/offset0, so no extra resume helper. Trimmed repetitive comments. No second model review per small chunk; final staged review belongs to Lead.

Original mcode tasks, stdout/stderr/run metadata are archived in mcode-api/ and mcode-ui/. Their original tracked diffs and untracked Kotlin sources are archived for traceability. API intern modified two old test doubles outside assigned list only to add the send uploadIds argument; coordinator had already made the identical required changes. UI intern reported build setup failures; final integrated checks used the fully prepared ticket worktree with the normal GoogleServices task and fake-key stub.

## Final pending-restore slice (supersedes the 97-test result)

A concrete lifecycle window remained: on bind, Android preferences restore is asynchronous; while storageReady=false the picker/state could start a fresh draft upload before discovering an unresolved persisted command. Public state test added first. pending-restore-red.log: 5 attachment state tests, 1 assertion failure showing upload started before restoration. Minimal fix: existing state addAttachment and UI frozen condition now require storageReady. No new state machine/mechanism.

pending-restore-green.log: same run-checks.sh command, BUILD SUCCESSFUL in10s, CHECK_EXIT=0. Final relevant suite 98/98, failures/errors/skips all0; final APK build succeeds. test-summary.json and apk.json regenerated for this final source. The 5 attachment state tests cover the four behaviors above plus restoration-window admission. Final worktree clean after commit and product tip merged Already up to date.
