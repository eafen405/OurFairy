# T7–T9 staged code review

Independent subagents reviewed two axes once after T7–T9 integration.
The original reports are preserved without rewriting their findings:

| Axis | Result | Original report |
| --- | --- | --- |
| Standards | 1 P2, corrected and verified | [standards.md](standards.md) |
| Spec | 0 findings | [spec.md](spec.md) |

The fixed comparison ranges are OurFairy
`97b776fac2eca207b308884b890748ce51f308ed...98ee42d601e1ff54a19de226f3a56bc43939d757`
and Android
`d8567891533e6bc725f48382c43b2096de4e422b...e58352f202ae1add0e9c4bd08b14807f4c84a9bb`.
dsh has no increment. [fixed-ranges.md](fixed-ranges.md) contains the
original range/commit/file record, and [github-issues.json](github-issues.json)
preserves the actual GitHub #23/#30/#31/#32 source used by review. Archiving
these reports and later fixes does not change that original review range.

The Standards finding is a concrete interrupted-download resource leak:
a response waiting for `drain` can close without waking the responder, so
the source generator is never returned. The original loopback HTTP
reproduction is [download-abort-probe.mjs](download-abort-probe.mjs), with
raw result [download-abort-result.json](download-abort-result.json): the
response closed while handler/source remained open. It runs the actual
new responder with an instrumented attachment source; it does not claim a
full real-profile or device test.

The owning implementer corrected only download cancellation/cleanup in
`fix/review-t7-t9` at `028f10cfdc05cc77c2d150b09524fef2056cd074`, merged
normally as `fcd4502c45ca8e36cbded529a4cd8d8f5e00dd59`. The existing
response-close event now aborts the native source stream and drain wait;
the existing iterator cleanup runs. No transfer framework or extra
speculative hardening was introduced. [Fix evidence](fixes/README.md)
records actual real-HTTP/file-descriptor red/green checks.

Merger independently ran `node --test
tests/attachment-download-abort.test.mjs tests/attachments.test.mjs` on
the merged tree: **6/6**, zero skipped, with both handler settlement and
file-source closure verified. Normal full-profile attachment upload,
download/restart, permissions, retries, image serialization and readonly
tool/script behavior also passed.
Combo and doctor passed; `git diff --check` was clean. No full product
suite or redundant stage review was rerun for this bounded correction.
Spec remains **0 findings**, and the original axis reports/ranges above
remain unchanged.
