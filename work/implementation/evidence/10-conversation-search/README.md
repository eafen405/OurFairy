# T10 / #33 — owned conversation search

## Delivered scope

`backend/search` is a small product adapter over the native `sessionQuery`.
It registers `conversation_search` and `conversation_read` on the existing chat
Agent, without an HTTP route, new Android UI, business table or owner copy.
The executing native session owner is the only caller identity; its active
business identity must exist. Neither tool has a model-supplied current-user
parameter. Search obtains the current formal owned headers, removes the current
execution session, and passes their IDs to native SQL before ranking/limit.
Administrator status does not widen this set. Read authorizes its target afresh.

The existing dedicated `query/sessions.sqlite` is explicitly enabled at first
search with 80-character snippets. The dsh provider adds `literalSubstring`
(default false for other profiles): one case-insensitive literal matcher scans
existing semantic documents and supplies the existing ranking/snippet markers.
No schema, extra index, tokenizer dependency or persisted owner column is added.
A scan suits the personal deployment's small corpus. Native header compatibility
now also compares immutable `owner`, rather than accepting conflicting source
observations. Ownership does not come from reconstructed index headers.

Read uses inclusive original event positions, at most 100 positions, and a shared
8000-Unicode-character message-text budget. It returns original seq and native
semantic text for user/assistant/delivery messages; standalone tool events and
system/reasoning/attachment bytes are omitted. Native embedded assistant
`tool-call` blocks retain their name/arguments projection. Out-of-log intervals
are empty. Truncation is explicit. Tool outputs retain the conversation-history
source label and never become deployment prompts. See `backend/search/README.md`.

## Commits and repositories

OurFairy branch: `ticket/10-conversation-search`; development base
`20144666d97becf82af3a3c24553ec28c639adda`, merged current integration
`489d76f4e57fa86cf26b4f07cf4244e1b9e915bb` (includes T11).
Red tool entry: `f1edf2e`; implementation: `645418b`; runtime/schema correction and
scope/budget/rebuild checks: `c3665f3`; T11 merge: `49f167c`.
The final ticket commit adds the actual delivered-body retrieval case and this
record; the Lead/merger records that final SHA.

dsh branch: `ticket/10-conversation-search`; base
`d3fe98f969c3963c6d193e74c776692e33c1eb64`; Chinese red `1be74c1f8e`, owner-conflict
red `2cb0d69e94`, implementation `164b1a56e4`, owning documentation/case-insensitive
literal punctuation evidence `e55843252b`. No Android changes.

## Executed verification

All product commands ran from the isolated T10 OurFairy worktree through the
real launcher, profile/Loader, HTTP identity and chat paths, actual SQLite,
JSONL and the real native Agent tool registry. The model endpoint was a
controlled local HTTP double, not an official-cloud inference call.

- Red: `node --test tests/conversation-search.test.mjs` → tool unknown before
  implementation (`product-red.log`). Initial native
  `corepack pnpm@11.28.5 exec vitest run packages/session-query/session-query-sqlite/tests/sqlite.spec.ts -t 'literal Chinese'`
  → no result for Chinese substrings (`native-red.log`). The owner source
  conflict test also failed before its compatibility check (`owner-red.log`).
- Green: `OURFAIRY_DSH_DIR=/home/eafen405/projects/deepseek-harness/.worktrees/10-conversation-search node --test tests/conversation-search.test.mjs`
  → **5/5** (`product-final.log`). The ticket test deliberately passes the
  launcher's documented `--allow-drift` while the merger still owns the final
  `combo.json` pin. Tests cover Chinese 1/2/3-character queries; actual 80-character
  excerpts and short-message boundaries; original seq readback; owner filtering
  before limit; known foreign IDs and administrator refusal; inclusive ranges,
  actual standalone tool-result exclusion, Unicode text budget; real stop/delete
  dedicated query DB/restart/rebuild; and T11 formal delivery text search/read
  by the recipient while the sender cannot read that recipient session.
- Native:
  `corepack pnpm@11.28.5 exec vitest run packages/session-query/session-query-sqlite/tests/sqlite.spec.ts packages/session-query/session-query-sqlite/tests/query.spec.ts packages/session-query/session-query/tests/session-query.spec.ts packages/session-query/session-query/tests/delivery-extraction.spec.ts`
  → **116/116** (`native-green.log`), including literal punctuation and
  case-insensitive substring behavior and existing default-token regressions.
- dsh `corepack pnpm@11.28.5 run build:lib:host`, `build:lib:client`,
  `build:native-system` → passed, logs beside this file. Final
  `corepack pnpm@11.28.5 exec tsc -b tsconfig.host.json tsconfig.client.json`
  produced no errors (`dsh-typecheck.log`). The fresh worktree
  dependencies used the existing lockfile/cache (`install --offline --frozen-lockfile`).
- The paired native README and T10 generated config fields were updated;
  `verify-translation-pairing <package README>` and normal pre-commit hooks passed.
  `git diff --check` passed in both worktrees.

## Recorded limitations and failed checks

- A broader product baseline attempt used the new dsh worktree while old
  `combo.json` still pinned its parent; existing baseline tests do not pass
  `--allow-drift`, so the launcher correctly refused the mismatch. This was
  not a baseline behavior result (`baseline-old-combo-refusal.log`). Merger
  should run its bounded profile checks after locking the exact native commit.
- Native `test:docs` finished **20 passed / 1 failed**, the pre-existing
  type-equivalence mismatch in persistence documentation (earlier owner fields
  missing from copied `SessionHeader` / `CreateSessionOptions` declarations).
  No persistence type is changed by T10; this was not expanded into a doc repair.
- `gen-config-catalog` initially produced the desired query fields plus the
  pre-existing `client-connection` source line 92→97 drift. That unrelated hunk
  was deliberately removed from both languages. The final full catalog freshness
  check therefore reports that known baseline line only (`config-final-baseline.log`).
  Its T10 query section is current. These two catalog paths overlap the Lead's
  recorded dirty paths; the root checkout was never edited by this ticket.
- Initial new test setup needed a fresh native addon build; the first broad
  native run consequently failed two real-JSONL tests before that build. The
  final 116-test run used the real built addon and passed. An unsupported
  `minimum` JSON-schema DSL key was exposed by real Agent creation and removed;
  the tool validates its simple numeric limits directly.
- No official cloud/model semantics, phone/emulator/Android lifecycle, or
  production deployment acceptance is claimed. Missing execution context is
  refused directly by the tool's owner guard; remote chat always supplies an
  authenticated Agent, so this impossible HTTP input was not manufactured by
  adding another production entry.
- `harness.md` records the bounded mcode startup/automatic approval refusal.
  No bypass or external retry occurred and no mcode edit was integrated.
