# T10–T12 reviewed stage handoff

Authorized scope: #33/T10, #34/T11, #35/T12, one staged review and closeout.
Stop after this stage; do not start #36/T13 or later work without instruction.

## Resolved source combination

- OurFairy source merge: `cc1350e25603dc63687f4300a35ab702f9a72272`;
  later stage commits contain review, verification and closeout evidence only.
- dsh `product/ourfairy-v1`: `173e155a85305db378dd92b1fa057ac6e6dea86e`.
- rikkahub `product/ourfairy-v1`: `b0911d34bdbe6ee8f559167ede41da95a9f082f8`.

`combo.json` pins external source commits and OurFairy's integration branch.
The next review baseline must be the final published OurFairy closeout tip
and these external tips, not the pre-stage or pre-closeout review head.

T10 exposes scoped native conversation search/read, using the existing
disposable query index with configurable literal substrings for Chinese and
bounded excerpts/read positions. T11 appends durable formal cross-user text
delivery to the recipient primary without recipient inference, sharing native
writers and stable retry identity. T12 extends that same flow with ordered
qualified originals, per-item immutable preparation, and recipient exact-file
qualification. The existing identity SQLite gains only deliveries (v5) and one
attachments checklist column (v6). Native transcripts remain authoritative.
Android production already supports the existing DTOs; only compatibility
regressions changed. No new UI/provider/outbox or generic transfer framework.

## Review, evidence and limits

Single independent review: Standards **0**, Spec **0**, no correction required.
Fixed reviewed ranges/reports: `evidence/review-t10-t12/`.

Owner evidence: native query **116/116**, clean host/client/native builds and
typecheck; T10 profile **5/5**, T11 related backend **32/32**, T12 related backend
**39/39**, Android T11 **41/41** and T12 **38/38**. Merger independently ran merged
profile/query **10/10**, text delivery **6/6**, files **8/8**, combo and doctor.
Raw logs and exact commands: `evidence/stage-t10-t12/` plus ticket evidence.

Main dsh full-host build remains blocked by two pre-existing dirty test type
errors. The two changed production query projects were normally typechecked
and bundled successfully; original dirty files stayed untouched. Required
clean doc-sync completed **39/43**: four established generated/type-doc baseline
drifts are recorded; no documentation gate is claimed as passing in full.
Clean owner full typecheck evidence remains distinct from dirty root failure.

Actual backend tests use native profile/Loader, SQLite, compressed JSONL, CAS,
files and local HTTP/SSE; model/Files endpoints and injected flush failure are
controlled doubles. No official cloud inference/image semantics, device/Compose,
actual SAF, APK-to-backend, signed release or performance acceptance was run.

## Preserved state

Keep all 16 pre-existing dsh dirty paths. Fourteen remain byte-identical to the
initial stage snapshot. Two catalogs correctly gain committed T10 fields while
their original source-line 92→97 diff hunks remain exact and unstaged. Current
hashes and preserved patches are in stage evidence. Managed root hooks were
normally reinstalled so they no longer depend on the T10 worktree. Older
worktrees and branches remain outside cleanup scope.

Publication, tracker closure and exact stage worktree cleanup status are recorded
in the stage evidence during final closeout. Read that final record on resumption.
