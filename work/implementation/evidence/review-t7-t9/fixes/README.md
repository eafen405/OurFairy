# T7–T9 review correction

The stage review completed once with Spec **0 findings**, Standards **one P2** (`../standards.md`). This branch fixes that single finding; Android/dsh and the stage scope are unchanged.

Branch `fix/review-t7-t9`, created from published OurFairy `98ee42d601e1ff54a19de226f3a56bc43939d757`. Latest published review-archive integration `26810c3d6ae820e6221f1064714f639b0d9c4357` was normally merged after verification; it only adds review evidence.

## Correction

`backend/attachments/src/index.mjs` now attaches one response-close listener and uses the same native AbortController signal for the original byte stream and Node's drain wait. Client close interrupts pending I/O/backpressure, then the existing iterator cleanup runs and the listener is removed. Initial source failures still pass to the existing HTTP error path before headers are written. No new storage, wire shape, transfer abstraction, hash pass or recovery mechanism was introduced.

Small commits: `33deb53` red regression; `630d98b` green local fix. Production change is confined to the existing download responder (17 added / 8 removed lines).

## Actual validation

- `node --test tests/attachment-download-abort.test.mjs` before the fix: **0/1**. The actual registered responder was executed against a real loopback HTTP connection and a real temporary file stream. Closing the client after its first data left the handler unsettled; test failure is the reviewed drain wait, not a synthetic denial.
- The same command after the fix: **1/1**. Both handler settlement and the original file descriptor's close event are asserted. The attachment byte-stream boundary is instrumented to observe cleanup; no product authorization or internal service is mocked.
- `node --test tests/attachments.test.mjs tests/attachment-download-abort.test.mjs`: **6/6**. Existing five full-profile attachment tests retain normal upload/send/download/restart, ownership and same-hash isolation, TTL/retry identity, official model-double image serialization, and real readonly file/script behavior.
- `git diff --check` passed.

The full 71-test stage suite was not rerun for this local correction; it passed on the delivered stage and the relevant six regressions pass here. No new cloud/device/runtime acceptance is claimed. The review reports themselves remain in the parent evidence directory; there was no redundant stage review.
