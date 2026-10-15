# T5–T6 handoff and stop point

T5/#28 is closed. T6/#29 implementation, integration and the two distinct P1 staged-review corrections are complete locally; Lead will close #29 after final publication and update parent #23. T7/#30 has not been started. Stop after this stage's final publication, tracker update and explicitly assigned worktree cleanup; do not proceed to later tickets without the user resuming work.

## Current combination

- OurFairy: `integration/ourfairy-v1`; this handoff and updated `combo.json` are committed on its integration tip.
- rikkahub: `product/ourfairy-v1` at `d8567891533e6bc725f48382c43b2096de4e422b` (normal merge of fix `8b2eaf0dc85b33dbb1dc7dd7ebf513a493c8b2c9`).
- dsh: `product/ourfairy-v1` remains `d3fe98f969c3963c6d193e74c776692e33c1eb64`; no increment. Its 16 pre-existing dirty files were preserved byte-for-byte.

Evidence: `work/implementation/evidence/stage-t5-t6/README.md`, `06-reconnect-{backend,android}/README.md`, and `review-t5-t6/README.md` with original independent reports, reproductions and fixes. Product suite **54/54**, Android related suite **85/85** plus debug APKs; merger independently ran **19/19** actual navigation/recovery regression tests and verified APK hashes. Combo and doctor passed. No device/emulator, APK-to-real-backend, actual cloud, Android preference disk-fault runtime, signed-release or performance acceptance was run. Fake-key Firebase build stub remains a build aid.

The staged review covered OurFairy `f8bb706...fca2f61` and Android `f84e6c5a...34cabaad`, with no dsh increment. Standards reported one P1, Spec reported two P1; navigation overlapped, leaving two distinct issues. Both were fixed in one Android implementer branch and checked through their public regressions. Do not rerun the entire prior review for these bounded fixes. The next future stage review should start from this resolved published combination, not the pre-fix review head.

## Recovery authority and seams

Formal native Session events remain message/receipt/history authority and SessionHeader.owner remains ownership authority. T6 pages fixed inclusive C with exclusive backward offsets; raw event coverage includes non-message events. Live attempts remain cumulative and separate from older pages. Consumption W advances only after contiguous applied coverage, the native writer checkpoint and awaited local commit. Small app-private preferences store W/initialization and unresolved request identity/text, not chat history; process restart must refill body rows. A new Agent generation rebuilds derived caches and rejects old synchronization callbacks while keeping pending/W; same-generation conflicting events still fail.

Review/worktree cleanup is a separate explicitly assigned final step. Preserve prior worktrees and dsh dirty work; this task has not removed any worktree. T5's publication is recorded in `evidence/stage-t5-t6/t5-publication.md`; final T6 publication results are supplied to Lead for tracker closure.
