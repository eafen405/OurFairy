# T7–T9 fixed staged review ranges

Review source: /tmp/ourfairy-stage789-review-issues.json (actual GitHub #23/#30/#31/#32); docs/specs/ourfairy-v1.md and local work/tickets copies; stage plan and evidence. dsh product tip unchanged, no increment.

## /home/eafen405/projects/OurFairy
Diff: `git -C /home/eafen405/projects/OurFairy diff 97b776fac2eca207b308884b890748ce51f308ed...98ee42d601e1ff54a19de226f3a56bc43939d757`
Commits: `git -C /home/eafen405/projects/OurFairy log 97b776fac2eca207b308884b890748ce51f308ed..98ee42d601e1ff54a19de226f3a56bc43939d757 --oneline`

```text
98ee42d build: lock integrated T7-T9 combination and verification evidence
6b4f989 Merge T9 authenticated attachments and session-qualified originals
d84c9d7 test: verify upload migration and unchanged originals after readonly operations
09e3c8d Merge branch 'integration/ourfairy-v1' into ticket/09-attachments
b5fb65d test: prove attachment handles through real file tools and readonly sandbox
742c192 docs: record merged T8 group and migration verification
6083cc1 Merge T8 durable groups and current membership file scope
3391066 test: cover attachment expiry retry identity and official image serialization
2dbe49a fix(groups): revoke live file scope without stranding chat cwd
d1cdf6d fix: preserve session authorization failures on attachment routes
cabe1ee feat: admit session-qualified uploads and preserve original attachment downloads
c396b31 Merge commit 'e55ded0' into ticket/09-attachments
15a83ab test: expose missing attachment upload and qualified download route
e55ded0 feat(groups): create durable groups through scoped chat tools
d26dbe6 docs: record merged T7 integration verification
bc089a8 Merge T7 owned file spaces and confined scripts
606101a docs: capture T7 final runtime and regression evidence
d413a78 Merge branch 'integration/ourfairy-v1' into ticket/07-space-execution
de149da test: record real space runtime and update adapted tool catalog
9a857c0 feat: confine scripts and recover cwd within owner file scope
468d28f feat: scope chat file tools to native session owner spaces
8bd4d8d docs: record T7-T9 stage baseline and preparation evidence
```

Changed files:
```text
backend/attachments/README.md
backend/attachments/package.json
backend/attachments/src/index.mjs
backend/attachments/src/service.mjs
backend/chat/src/index.mjs
backend/chat/src/projection.mjs
backend/chat/src/service.mjs
backend/identity/src/store.mjs
backend/probe/src/index.mjs
backend/spaces/README.md
backend/spaces/package.json
backend/spaces/src/bwrap.mjs
backend/spaces/src/fs.mjs
backend/spaces/src/groups.mjs
backend/spaces/src/index.mjs
backend/spaces/src/policy.mjs
backend/spaces/src/scope.mjs
backend/v1-bundle/cordis.patch.yml
combo.json
scripts/ourfairy-backend.mjs
tests/attachments.test.mjs
tests/baseline-boot.test.mjs
tests/groups.test.mjs
tests/identity-store.test.mjs
tests/model-double.test.mjs
tests/spaces.test.mjs
work/implementation/evidence/07-space-execution/README.md
work/implementation/evidence/07-space-execution/directory-image.log
work/implementation/evidence/07-space-execution/green-files.log
work/implementation/evidence/07-space-execution/green-processes.log
work/implementation/evidence/07-space-execution/green-space-runtime.log
work/implementation/evidence/07-space-execution/harness-approval.md
work/implementation/evidence/07-space-execution/network-background.log
work/implementation/evidence/07-space-execution/owned-policy.log
work/implementation/evidence/07-space-execution/product-suite-first.log
work/implementation/evidence/07-space-execution/product-suite.log
work/implementation/evidence/07-space-execution/red-directory-recovery.log
work/implementation/evidence/07-space-execution/red-files.log
work/implementation/evidence/08-group-spaces/01-red-chat-create.log
work/implementation/evidence/08-group-spaces/02-green-chat-create.log
work/implementation/evidence/08-group-spaces/03-group-permissions.log
work/implementation/evidence/08-group-spaces/04-fixture-message-id-error.log
work/implementation/evidence/08-group-spaces/05-red-revoked-cwd.log
work/implementation/evidence/08-group-spaces/06-green-permissions-recovery.log
work/implementation/evidence/08-group-spaces/07-related-tests.log
work/implementation/evidence/08-group-spaces/08-product-suite.log
work/implementation/evidence/08-group-spaces/09-product-suite-green.log
work/implementation/evidence/08-group-spaces/10-combo.log
work/implementation/evidence/08-group-spaces/11-doctor.log
work/implementation/evidence/08-group-spaces/README.md
work/implementation/evidence/08-group-spaces/mcode-schema/run.json
work/implementation/evidence/08-group-spaces/mcode-schema/stderr.txt
work/implementation/evidence/08-group-spaces/mcode-schema/stdout.txt
work/implementation/evidence/08-group-spaces/mcode-schema/task.md
work/implementation/evidence/09-attachments-android/README.md
work/implementation/evidence/09-attachments-android/apk.json
work/implementation/evidence/09-attachments-android/final-build-tests.log
work/implementation/evidence/09-attachments-android/first-integrated.log
work/implementation/evidence/09-attachments-android/integrated-behavior-red.log
work/implementation/evidence/09-attachments-android/mcode-api-original/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApi.kt
work/implementation/evidence/09-attachments-android/mcode-api-original/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApiTest.kt
work/implementation/evidence/09-attachments-android/mcode-api-tracked.diff
work/implementation/evidence/09-attachments-android/mcode-api/run.json
work/implementation/evidence/09-attachments-android/mcode-api/stderr.txt
work/implementation/evidence/09-attachments-android/mcode-api/stdout.txt
work/implementation/evidence/09-attachments-android/mcode-api/task.md
work/implementation/evidence/09-attachments-android/mcode-ui-original/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteAttachmentFiles.kt
work/implementation/evidence/09-attachments-android/mcode-ui-tracked.diff
work/implementation/evidence/09-attachments-android/mcode-ui/run.json
work/implementation/evidence/09-attachments-android/mcode-ui/stderr.txt
work/implementation/evidence/09-attachments-android/mcode-ui/stdout.txt
work/implementation/evidence/09-attachments-android/mcode-ui/task.md
work/implementation/evidence/09-attachments-android/pending-restore-green.log
work/implementation/evidence/09-attachments-android/pending-restore-red.log
work/implementation/evidence/09-attachments-android/run-checks.sh
work/implementation/evidence/09-attachments-android/state-red.log
work/implementation/evidence/09-attachments-android/test-summary.json
work/implementation/evidence/09-attachments-backend/01-red.log
work/implementation/evidence/09-attachments-backend/02-green-original.log
work/implementation/evidence/09-attachments-backend/03-red-authorization.log
work/implementation/evidence/09-attachments-backend/04-green-authorization.log
work/implementation/evidence/09-attachments-backend/05-expiry-image.log
work/implementation/evidence/09-attachments-backend/06-green-expiry-image.log
work/implementation/evidence/09-attachments-backend/07-real-file-sandbox.log
work/implementation/evidence/09-attachments-backend/08-product-suite.log
work/implementation/evidence/09-attachments-backend/10-final-related.log
work/implementation/evidence/09-attachments-backend/11-combo.log
work/implementation/evidence/09-attachments-backend/12-doctor.log
work/implementation/evidence/09-attachments-backend/README.md
work/implementation/evidence/stage-t7-t9/README.md
work/implementation/evidence/stage-t7-t9/dsh-preexisting-dirty-sha256.json
work/implementation/evidence/stage-t7-t9/issues-at-start.json
work/implementation/evidence/stage-t7-t9/mcode-readonly-run.json
work/implementation/evidence/stage-t7-t9/t7-merged-combo.log
work/implementation/evidence/stage-t7-t9/t7-merged-doctor.log
work/implementation/evidence/stage-t7-t9/t7-merged-runtime.log
work/implementation/evidence/stage-t7-t9/t8-merged-combo.log
work/implementation/evidence/stage-t7-t9/t8-merged-doctor.log
work/implementation/evidence/stage-t7-t9/t8-merged-runtime.log
work/implementation/evidence/stage-t7-t9/t9-apk-verification.json
work/implementation/evidence/stage-t7-t9/t9-merged-android-tests.json
work/implementation/evidence/stage-t7-t9/t9-merged-android.log
work/implementation/evidence/stage-t7-t9/t9-merged-backend.log
work/implementation/evidence/stage-t7-t9/t9-merged-combo.log
work/implementation/evidence/stage-t7-t9/t9-merged-doctor.log
work/implementation/notes/stage-t7-t9-plan.md
```

## /home/eafen405/projects/rikkahub
Diff: `git -C /home/eafen405/projects/rikkahub diff d8567891533e6bc725f48382c43b2096de4e422b...e58352f202ae1add0e9c4bd08b14807f4c84a9bb`
Commits: `git -C /home/eafen405/projects/rikkahub log d8567891533e6bc725f48382c43b2096de4e422b..e58352f202ae1add0e9c4bd08b14807f4c84a9bb --oneline`

```text
e58352f2 Merge T9 remote attachment upload and original downloads
bf4db2d6 fix: await pending restoration before uploading attachments
231cf4a1 feat: send and download owned remote chat attachments
```

Changed files:
```text
app/src/main/java/me/rerere/rikkahub/data/remote/ChatSyncStore.kt
app/src/main/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApi.kt
app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt
app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt
app/src/main/java/me/rerere/rikkahub/di/IdentityModule.kt
app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteAttachmentFiles.kt
app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteChatPanel.kt
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApiTest.kt
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAttachmentStateTest.kt
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatApiTest.kt
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatRecoveryTest.kt
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatStateTest.kt
```

