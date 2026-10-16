# T18 / #41 — selected PDF page vision

Scope: OurFairy only, branch `ticket/18-pdf-vision`; based on integration
`4b2d23e3e9f62deaee4bf3eff2787b886cd52ee7` after synchronizing T16/T17.
No dsh, Android or database change. The commit containing this evidence records
the final implementation; the integration owner updates the combination after merge.

`pdf_render_pages` reuses admitted original qualification, the existing bounded
pypdf/bwrap worker, native `saveImage`, and the actual official provider's image
result serialization. It renders only 1–3 selected pages through installed
Poppler 26.01.0, max longest side 1600 px. Native tool result source/role and
page/original association are retained. No renderer library, OCR service,
persistent derived index, extra file grant or original replacement was added.
See `backend/attachments/pdf/README.md` for exact subprocess/output budgets.

Confirmed seams: real profile, authenticated upload/send/tool/read/download;
external HTTP model double only. Actual files, native attachment CAS, SQLite,
session logs, provider serialization, bwrap, Python and Poppler are used.

## Actual verification

- `node --test tests/pdf.test.mjs` → **5/5 passed** (`11-seams-final.log`).
  Covers selected readable text-page pixels, scan/mixed/vector-chart RGB pixels
  after official provider normalization, page numbers, unchanged original,
  cross-user/cross-session denial, invalid selections, encrypted/damaged/501-page
  rejection, real resource-budget failure and observable damaged-page warnings.
- `npm test` on the synchronized final code → **109/109 passed** (`13-npm-test.log`).
- `npm run combo:verify` → passed (`14-combo-verify.log`), dsh
  `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`, Android
  `3426401c10379dfc...` as recorded in the combination output.
- `node --check scripts/pdf-flash-smoke.mjs` → exit 0 (`15-smoke-check.log`).
  This is a handoff script; it has **not** been run against the real cloud.
- `python3 tests/fixtures/pdf/generate-vision.py` and `sha256sum` → deterministic
  synthetic fixtures (`12-fixtures.log`). mcode's scoped task/output/start and
  completion metadata are preserved in `mcode-fixtures/`; its actual diff was
  reviewed and the samples were validated again through the product seam.
- `git diff --check` → exit 0 before commit. Normal pre-commit hooks are retained.

## Red/green and diagnosis history

`06-baseline-red.log` is the genuine baseline red: with the ticket-before
`pdf.mjs`, the public model turn fails because `pdf_render_pages` does not exist.
The implemented behavior passes in logs 05/07/08/11; logs 09/10 exposed the fixture
issues below, then log 11 and the full suite passed after fixes.

`01-red.log` is **not** a feature red: new-worktree Corepack cache population
stalled before backend startup. `02-seam.log` was interrupted for the same cause.
The existing pinned pnpm cache was copied from the root checkout; no dependency
version was changed. Logs 03/04 record fixture assertion corrections: metadata
must select its actual text block, and the official provider normalizes rendered
PNGs to JPEG previews. Logs 09/10 exposed a bounded-transcript test helper that
counted messages after the projection window was full and a model double that
needlessly echoed image base64 into assistant text. The helper now follows reply
identity and the double returns text only; actual provider image requests remain
captured and pixel-checked. A readonly `/etc/fonts` runtime mount removes spurious
Fontconfig errors inside the renderer sandbox; actual damaged-page diagnostics
remain observable as numeric partial status and `renderer-warning`.

The older T17 `text.pdf` font resource is a stream (valid for its extraction
assertions but Poppler rejects its visual font). It was preserved; T18 uses the
independent correctly formed `mixed.pdf` text page and scan/chart samples for
visual assertions. This is a sample limitation, not a renderer product workaround.

## Limits / final integration handoff

No real official DeepSeek call, Android device or vivo validation was performed
by this ticket. The real local official-provider path is exercised with a model
HTTP double, including legal user `tool_result` JPEG image serialization. These
results prove the seam and pixels, not cloud comprehension. Run the authenticated
product script and manual expected-answer checks in `flash-smoke.md` during final
integration to capture actual Flash cloud tool-result acceptance and understanding.
Complex table/layout recovery is not promised; unread pages remain unread.
mcode completed successfully; its callback notification failed, so acceptance
used the actual files, diff and tool output rather than notification delivery.
