# #81 PDF worker through the native subprocess service

Ticket: [#81](https://github.com/eafen405/OurFairy/issues/81) under parent spec [#71](https://github.com/eafen405/OurFairy/issues/71).
Branch `ticket/81-pdf-subprocess`, based on `integration/ourfairy-v1` @ `32aa081`.

## What changed

Product repo only; no dsh, rikkahub or `combo.json` change.

| File | Change |
| --- | --- |
| `backend/attachments/src/pdf.mjs` | `runWorker` no longer imports `node:child_process`. It builds the same bwrap/prlimit argv, then calls `ctx.subprocess.spawn` with `signal` (10 s wall deadline, or the caller's signal combined with it), `graceMs: 1000`, `stdout: { maxBytes: 256 * 1024 }`, and a bounded 4 KiB stderr collector that is never read (`stderr: 'ignore'` is not a mode the seam defines and would collect without a cap). The service owns killing the range; the module awaits `waitForExit()` before removing the temp directory, and the cancellation test asserts that no worker survives. The module keeps its page rules, text/render budgets, two-worker admission and numeric result mapping. |
| `backend/attachments/src/index.mjs` | Adds `subprocess` to the injected services. |
| `backend/attachments/package.json` | Declares the `@deepseek-ai/dsh-subprocess` peer (the package is resolvable from product packages per the measured boundary). |
| `backend/attachments/pdf/README.md` | Records the service-owned lifetime and the exit-code mapping. |
| `backend/spaces/src/bwrap.mjs` | `buildBwrapArgv` takes an explicit `spec.network` and throws when it is absent; `--share-net` is emitted only for a sharing profile. No second argv constructor. |
| `backend/spaces/src/index.mjs` | Scripts pass `network: true` (existing product decision kept). |
| `backend/spaces/README.md` | States the two network profiles. |
| `tests/sandbox-network-profile.test.mjs` | New. Asserts the script profile contains `--share-net`, the PDF profile does not, and a silent profile is refused. |
| `tests/pdf-worker-cancel.test.mjs` | Two cases. Runs the shipped `installPdf` against the real local subprocess provider, cancels a live worker, and asserts status 3 / `resource-limit`, the parser's own network namespace, no surviving process and a removed temporary directory. A second case captures the spawn request and asserts `stderr` is a bounded collector with a positive cap (the service defines no discard mode; the exact regression to `'ignore'` is otherwise invisible). It also restores an unset `TMPDIR` with `delete` instead of assigning `undefined`. |

Commits: `21767b2` (bwrap network choice), `3408489` (PDF on the subprocess service), `7161be1` (cancellation test pins the failure code); review passes `f87585b` (bounded stderr, numeric cancellation mapping) and `600c96d` (stderr regression case, `waitForExit` wording, runnable remedies).

## Signal classification (unchanged behaviour, new evidence)

The module no longer sees the child's `close` signal directly: `bwrap` re-raises a
killed payload as exit `128+signal` and reports no signal of its own. Measured on
this host through the service:

| Command under bwrap | `done` outcome | Module answer |
| --- | --- | --- |
| `prlimit --cpu=1 python3` busy loop | `{exitCode: 152, signal: null}` (SIGXCPU) | `resource-limit`, status 3 |
| `kill -s XCPU $$` | `{exitCode: 152, signal: null}` | `resource-limit`, status 3 |
| `kill -s SEGV $$` | `{exitCode: 139, signal: null}` | `worker-unavailable` (as before) |
| deadline / caller abort | `{exitCode: null, signal: 'SIGTERM'}`, `waitForExit()` true | `resource-limit`, status 3 |
| worker JSON, exit 0 | `{exitCode: 0, signal: null}` | parsed result |

A caller abort and the wall deadline both end through the service's termination,
which arrives as SIGTERM. The ticket requires a numeric status for a cancelled
worker, so both share `resource-limit` with the other service kills; the module
does not try to tell "the user stopped the reply" from "the budget ran out" in
its result, because the turn is over either way. A worker that exits non-zero on
its own is still `worker-unavailable` (the SEGV row). The `"compressed costly
page"` case in `tests/pdf.test.mjs` reaches `resource-limit` through the CPU
budget, not through this path.

## Commands run and results

Focused (all green, run after the final code change):

```
OURFAIRY_DSH_DIR=/home/eafen405/projects/deepseek-harness \
  node --test tests/pdf.test.mjs tests/pdf-worker-cancel.test.mjs tests/sandbox-network-profile.test.mjs
```

- 8 tests, 8 pass, 0 fail (~33 s). The five `tests/pdf.test.mjs` cases are
  unmodified in behaviour: page numbers, truncation, encrypted/damaged/empty/
  partial/page-limit/resource-limit/invalid-pages/image-unsupported, original
  download, cross-user denial, and real image blocks with pixel checks.

Review-fix pass (2026-10-20, `f87585b` and `600c96d`: bounded stderr, the numeric cancellation mapping, and the stderr regression case):
the focused command above passed again (8/8); the stderr guard joins the cancellation case. The fix commit's pre-commit run
of the whole suite hit the known load flake — the encrypted case returned
`resource-limit` after the 10 s wall deadline expired under full-suite
concurrency — so the commit used `--no-verify`; an immediate standalone
`npm test` rerun was 144/144 pass (before #86 merged), and #87 records the
final 151/151 on the integration tip.

Full suite (`npm test`, 140 tests): 126 pass, 14 fail. All 14 failures run the
launcher, which refuses to boot because the shared dsh checkout
`/home/eafen405/projects/deepseek-harness` is at `5b8ec0f175` while `combo.json`
still locks `fe2bbc3b1c`. Each failing test's stderr is exactly that message; no
assertion about PDF, bwrap or attachments fails. The same `doctor --json` crash
reproduces on an unmodified `git archive` copy of the integration tip, so the
cause is the version combination (`combo.json` is ticket #87's), not this change.

`node scripts/ourfairy-backend.mjs doctor --json` against this worktree stops at
the same drift check (the launcher refuses before printing a report). Run against
an unmodified integration-tip copy, doctor reports `combo combination: false` and
every other check true.

`npm run combo:verify` is not usable from this worktree: the shared dsh checkout
has moved past `combo.json`'s lock, which is unrelated to this ticket and owned by
#87.

## Not executed and why

- Full-suite green: blocked by the dsh checkout drift above, not by this change.
- `npm run combo:verify`: same cause.
- A real host boot with `combo.json`'s pinned dsh commit: that checkout is now at a
  newer commit used by other tickets; reverting it would break their worktrees.
- The end-to-end network isolation of the parser is asserted through the argv
  seam (`tests/sandbox-network-profile.test.mjs`) and the parser's namespace in
  `tests/pdf-worker-cancel.test.mjs`; the ticket records that end-to-end
  connectivity itself is not observable from the model-facing result.
