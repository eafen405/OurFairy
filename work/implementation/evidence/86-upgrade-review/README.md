# 86-upgrade-review — ticket #86 evidence

Ticket: OurFairy#86 under spec #71. Branch `ticket/86-upgrade-review`, based on
`integration/spec-71` @ `70ab394` (worktree `.worktrees/86-upgrade-review`).
Fixed combination: dsh `5b8ec0f175` (`combo.json`), rikkahub `2d97ed14`.

## What changed

| File | Change |
| --- | --- |
| `docs/decisions/native-capability-dependencies.md` (new) | The upgrade record: for PDF (`ctx.subprocess`), retry (`llm-retry` + provider `retryPolicy`), spill (`spill-local`/`spill-policy`) and history (`@deepseek-ai/dsh-agent/session-history`), the dependency, the behavior relied on, the executable tests, and the upstream-change rule. Also records the two retained product implementations (attachment upload, job output/stop) with the tests that would reveal drift. Points at `backend/v1-bundle/cordis.patch.yml` as the only row inventory. |
| `scripts/combo.mjs` | Adds `nativeCapabilityFailures(rows, resolveExport)` (the four required rows + the public history export) and `verifyInstalledNativeCapabilities({...})`, which loads the **installed** profile through dsh's own `@deepseek-ai/dsh-app-boot` (`loadProfileDirectory` / `composeEntries`) and resolves the export from the CLI install anchor. `combo.mjs` is import-safe (`import.meta.main` guard), so the check is testable without running the launcher. A loader/profile error is returned as a named failure instead of escaping as a raw loader message. |
| `scripts/ourfairy-backend.mjs` | One new doctor check, `native capabilities`, after `profile project linked`: it reports every missing/disabled/drifted required row or unresolved export and fails naming it and the remedy. |
| `backend/v1-bundle/README.md` | Points at the record; explicitly says the record does not repeat the row inventory. |
| `backend/attachments/README.md` | Points at the retained-upload rationale/test set. |
| `backend/attachments/pdf/README.md` | Points at the `ctx.subprocess` dependency record. |
| `backend/chat/README.md` | Points at the retained jobs adapter rationale/test set. |
| `tests/native-capabilities.test.mjs` (new) | Five checks on the composed bundle (missing row, wrong package, disabled row, missing export; shipped composition green) and one real-doctor test: passes on the installed shipped profile, then fails by name after `llm-retry` is removed from the installed bundle copy. |

No dsh, rikkahub, `combo.json` or bundle row change. No change to
`backend/chat/src/runtime.mjs`, `service.mjs`, `projection.mjs`, `history.mjs` or
projection-performance code.

## Why the doctor check reads the installed profile

It uses `@deepseek-ai/dsh-app-boot` — the loader a boot uses — from the dsh
checkout, not a second YAML parse in the launcher. The composed row list includes
the profile's user layer, so a local override that disables one of the four rows
is caught as well. Doctor's existing `profile project linked` check runs first,
so the installation the check reads is the one the launcher just installed or
reused. This is a check run by the `doctor` command before a boot; `start` is
not changed (a missing service already fails the boot itself, and this ticket
adds the named pre-boot diagnosis).

The failure text names the item and the fix, e.g.:

```
required native capability missing: the llm-retry row is not mounted; add
@deepseek-ai/dsh-llm-retry to backend/v1-bundle/cordis.patch.yml and run
'ourfairy-backend start --reinstall'
```

and for the export:

```
required native capability missing: @deepseek-ai/dsh-agent/session-history does
not resolve from the dsh installation (...); check out the dsh commit combo.json
locks and run 'build:lib:host' in that checkout
```

## Red / green

Red (before either implementation) — the test cannot import the check:

```
$ node --test tests/native-capabilities.test.mjs
SyntaxError: The requested module '../scripts/combo.mjs' does not provide an export
named 'nativeCapabilityFailures'
tests 1 / pass 0 / fail 1
```

Green after the helper + doctor check:

```
$ node --test tests/docs.test.mjs tests/native-capabilities.test.mjs
✔ every relative link in the repository Markdown resolves
✔ the shipped composition satisfies every required native capability
✔ a missing required row fails by row id, package, and remedy
✔ a required row mounting a different package names both packages
✔ a disabled required row is not treated as mounted
✔ a missing public export is named with its remedy
✔ doctor passes on the shipped composition and fails when a required row is removed
ℹ tests 7 / pass 7 / fail 0 (~2.0 s)
```

The doctor test installs a real isolated profile (first run ~25 s cold, ~6 s
warm), then edits only the **installed** bundle copy
(`<home>/dsh-home/profiles/ourfairy/node_modules/@ourfairy/dsh-v1-bundle/cordis.patch.yml`),
so the second doctor run reads a profile that a boot would mount. The source hash
still matches, which is what makes the launcher reuse that installation rather
than reinstalling over the mutation.

## Commands and results

Required compatibility suites (all green, run on the ticket branch before the
final merge):

```
$ node --test tests/native-rows.test.mjs tests/spill-read.test.mjs tests/reconnect.test.mjs tests/pdf-worker-cancel.test.mjs
ℹ tests 15 / pass 15 / fail 0 (48.2 s)
```

```
$ npm run backend:doctor
ok    native capabilities: llm-retry:@deepseek-ai/dsh-llm-retry, spill-local:@deepseek-ai/dsh-spill-local,
      spill-policy:@deepseek-ai/dsh-spill-policy, subprocess:@deepseek-ai/dsh-subprocess-local,
      @deepseek-ai/dsh-agent/session-history
doctor: all checks passed
```

```
$ npm run combo:verify
ourfairy  ... ok (worktree is based on the integration tip)
dsh       ... 5b8ec0f175d3d7ba 5b8ec0f175d3d7ba ok
rikkahub  ... 2d97ed143e7a6487 2d97ed143e7a6487 ok
combo: combination verified
```

Full suite (`npm test`, the repository entry point, on this ticket branch):

```
$ npm test
ℹ tests 150
ℹ suites 7
ℹ pass 150
ℹ fail 0
ℹ duration_ms 74921.363196
```

The final state after merging `integration/spec-71` is re-run by #87 on the
integration branch; that evidence records the final numbers. This ticket changed
no behavior the pre-existing suites exercise; the suite is cited as the required
complete check, not as a new behavioral test.

## Review corrections folded into this ticket

The mid-flight two-axis review found that the first draft's evidence promised a
"Full suite" section it did not have, that the record said doctor runs "before a
boot" (doctor is a command the operator runs before a boot), that the record
repeated two bundle config values (`maxInlineTokens`, the `retryPolicy` object)
beside the single authority it points at, and that the new test imported an
unused `after`. This version adds the measured section, rewrites the boot
sentence, leaves the budget/policy values to the bundle and #82's evidence, wraps
a profile loader error as a named failure, and drops the unused import.

## One ticket-text correction (measured, not copied)

The ticket says native `fileUploads` binds `/api/Typert`. At dsh `5b8ec0f175`
the package serves a raw streaming route `POST /api/session/uploadFileBinary`
(`packages/client/file-upload/src/protocol.ts`) and its generated Remote
methods under the Connection's `/api/<namespace>/<method>` carrier; no
`/api/Typert` path exists in the checkout (grep over `packages/` and `docs/`).
The record therefore states the measured transport and the reasons the product
protocol is retained (no resumability, no upload expiry, no original-byte
download in `fileUploads`). The pinned dsh README itself documents "Uploads are
not resumable".

## Mock vs. real boundary

- **Real:** the launcher, the installed profile and dsh's own profile loader,
  the pinned dsh checkout and its built `session-history` export, a real isolated
  `DSH_HOME`, and the real doctor process.
- **Test double:** no model is called by this ticket's tests. The four
  compatibility suites named in the record use their existing doubles; this
  ticket did not add or change any model double.
- **Docs:** `tests/docs.test.mjs` checks that every relative link resolves; it
  does not prove the prose.

## Not executed

- No real model provider (MiniMax/DeepSeek) call; the upgrade record cites the
  behavior measured by #82/#83/#85 and the tests above, not a new cloud run.
- The dsh-side seam contract specs are run and recorded in the spec-71
  evidence directory `84-history-seam` (added on the integration branch), not by
  this repository's `npm test`; this ticket did not change dsh.
- No Android change or device run; no response shape changed.
