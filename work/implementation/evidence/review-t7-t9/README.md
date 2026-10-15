# T7–T9 staged code review

Independent subagents reviewed two axes once after T7–T9 integration.
The original reports are preserved without rewriting their findings:

| Axis | Result | Original report |
| --- | --- | --- |
| Standards | 1 P2, awaiting bounded correction | [standards.md](standards.md) |
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

The owning implementer is correcting only download cancellation/cleanup
in a separate fix worktree. No transfer framework or extra speculative
hardening was requested. Correction and merger's bounded verification
will be recorded after delivery; a second full stage review is not needed
for this local finding. No source changes or test reruns were made while
archiving these original reports.
