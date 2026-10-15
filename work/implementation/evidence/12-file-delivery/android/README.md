# T12 Android delivered attachment compatibility

Baseline: rikkahub d80dfcb9a3ded6e78d78da67edb33f4b88131332; branch ticket/12-file-delivery.

No production changes were required. Backend owner confirms a normal role=2,status=2 message carries existing attachment DTO {index,type,name,mime,bytes}; existing UI displays its attachment chips and calls download using recipient sessionId/messageId/index. No sender identity, sender upload receipt or new route is needed.

mcode M3.1-Flash-Preview effort max completed the one bounded test task with exit 0. Raw task/output/run: /tmp/ourfairy-stage1012-android-harness/delegate-minimax-jpqtam4d. Only RemoteAttachmentStateTest.kt changed. Owner inspected actual diff, fixed new fixture message seq=1 versus cursor=0 to seq=0, and added public no-failure/consumedThrough=0 assertions. The existing Chat fake now retains its observable flow and configurable ACK (same default); Files fake records download args and configurable bytes (same default).

Regression drives RemoteChatState's existing public boundary as recipient Bob shortId2: emits ordinary Fairy message plus attachment and an independent running attempt; derives messageId/attachment from public snapshot; downloads and saves exact original bytes using Bob's session credential; verifies temporary file cleanup, success notice, and no send/upload. Existing real loopback HTTP attachment tests verify transport request {sessionId,messageId,index} and exact binary download; existing text delivery regressions still pass.

Executed ../run-checks-t12.sh. Raw log ../t12-tests.log reports BUILD SUCCESSFUL in 1m51s, CHECK_EXIT=0. Attachment API 5, Attachment State 6, Chat API 18, Chat State 9: 38 total, zero failures/errors/skips. XML and summary are adjacent. diff --check passed. Existing production compatibility was verified green without manufactured red. No APK was rebuilt because no production code changed.

Preparation reused ignored local.properties/Firebase fake-key stub, fixed pinned submodule, existing local node_modules symlink; shared Gradle configuration untouched. Not run: phone/emulator/Compose, actual SAF platform, official cloud, APK-to-real-backend, signed release. Backend qualification/cross-user storage are backend owner's tests, not implied by these client/network doubles. No notification, Room/outbox or transfer framework added.
