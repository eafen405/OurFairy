# Long-term memory and impressions

The memory row owns the product's long-term memories, every user's impression,
and the per-source-session maintenance engine: one SQLite file, the `memory_*`
tools the Fairy uses, the query gate those tools enforce, the user's own
impression endpoints and injected section, and the native child that distills
each session's closed turns. It stores memories and impressions, not session
logs; session search keeps answering "what was said", this row answers "what
should be remembered" and "who is this user".

## What the row contributes

`MemoryService` owns the memory tools and `ImpressionService` owns the
per-user impression; both share the store. Neither is published on `ctx`: the
row exposes tools, prompt sections and the two impression routes, and nothing
else reads the memory domain through the context. Every
live Agent gets the five memory tools on its own agent context, and an owned
Agent additionally gets the two impression tools and the impression prompt
section. Registration follows the product's usual shape: a global
`agent/created` listener plus a replay of `ctx.agents.list()`, so a resumed
session gets the same tools. The row then clears both gates on
`agent/disposed`.

`MaintenanceEngine` (a module, not a second public service) watches owned source
sessions, recomputes their pending interval, and creates the native child
described below. It starts on the same `agent/created` signal, on a one-second
tick for persisted time, and on a boot scan of `sessionPersistence.list()` plus
the `maintenance_state` rows, so a restart recomputes from durable state.

| Tool | Inputs | Success |
| --- | --- | --- |
| `memory_add` | `content`; optional `is_private` (default normal) | `{ ok }` |
| `memory_search` | `query`; optional `start_at`, `end_at`, optional `is_private` (default normal) | memories plus budget metadata |
| `memory_edit` | `id`, `old_string`, `new_string`; optional `is_private` (default normal) | `{ ok }` |
| `memory_delete` | `id`; optional `is_private` (default normal) | `{ ok }` |
| `memory_switch` | `id` only | `{ ok }` |
| `impression_read` | none | `{ content, updated_at, max_characters }` |
| `impression_edit` | `content` | `{ ok }` |

The impression tools and the `ourfairy:impression` prompt section exist only on
an owned Agent. A session without an owner receives neither, so the later
maintenance child — which has no user owner — cannot read or rewrite an
impression as part of memory work.

## What the Fairy writes

Long-term memory is not a transcript summary. An owned Agent's prompt carries the
`ourfairy:memory-policy` section, and the maintenance child carries the same rule
in its own instruction: only a user's explicit request to remember, or a stable
long-term attribute, repeated habit or shared experience the user stated, is
stored. Session summaries, user profiles, personality guesses,
location/IP/device/weather/time inferences, one-off moods, time-bound
observations, todos, and memories about memory operations or maintenance results
are excluded. When nothing qualifies, the default is to write nothing. The same
rule is in `memory_add`'s description. It is model guidance, not a semantic
filter; the real-model sample in [ticket #248's evidence](../../work/implementation/evidence/248-memory-integration-acceptance/README.md)
is what checks the resulting quality.

The maintenance child receives this rule through its own
`ourfairy:memory-maintenance` section, not through the owned prompt's policy, so
an ownerless child does not inherit the main session's prompt.

The query gate still decides what a session may change: the policy explains when
a write is appropriate, while the gate proves the number was returned to this
session. Neither replaces the other.

`memory_add` takes no owner or source: the source session is the calling
session, and the owner is derived from that session's immutable
`SessionHeader.owner`. A maintenance child has no owner; its durable
`parentSession` names the owned source session, and that session is both the
source and the owner of a child write. The model has no field for either value.

`memory_search` matches `query` as a literal substring — no embeddings, no
semantic expansion, no wildcard interpretation, no reordering beyond the
order below. Dates are millisecond timestamps forming one closed interval over
the content-update time; both bounds must be present together, the start must
not be later than the end, and either bound alone is an error. Omitting both
searches every date. `is_private` selects the layer; the normal layer is the
default for every tool.

Result shape:

```json
{
  "memories": [{ "id": 7, "content": "...", "owner_short_id": 2, "content_updated_at": 1761600000000 }],
  "limit": 20,
  "character_budget": 8000,
  "matched": 24,
  "returned": 20,
  "characters": 5321,
  "truncated": true
}
```

`matched` counts every memory in the queried layer that matches; `returned` and
`characters` describe this result. Results are ordered by content-update time
(newest first), then by number. The row returns at most 20 memories and at most
8000 Unicode characters of content. A memory that does not fit is omitted whole
— its content is never clipped and its number is never returned — and
`truncated` reports that something was left out. The model therefore cannot act
on an id it has not seen.

The 8000-character budget is also the largest memory a write may store:
`memory_add` and `memory_edit` refuse longer content with
`memory/invalid-content`, before any row is written (an edit checks the
post-edit content). Without that limit a row larger than the whole budget would
be stored but omitted by every search, so no session could ever see its number
and edit, delete or switch it. Exactly 8000 Unicode characters is accepted and
returned whole.

`memory_edit` requires `old_string` to occur exactly once in the target
content; zero or several occurrences are errors, and there is no `replace_all`.
Passing the complete current content as `old_string` is how a whole-memory
rewrite is expressed. A successful edit updates the content, the content time
and the source session (the editing session, or the owned source session of a
maintenance child); the number and layer do not change. `memory_switch` flips
the layer and changes nothing else: no content, no source, no content time.
`memory_delete` removes the row physically — no tombstone — and the number is
never reused, so an old result cannot point at a new memory. Session logs are
not touched.

## Impressions

An impression is one body per user: the overall understanding needed at every
interaction, distinct from the long-term memories that are recalled on demand.
The row owns it; nothing in the memory tools, the maintenance material or the
session log can rewrite it.

The system prompt assembly reads the body through a provider evaluated on every
assembly, so an edit applies to the next turn without restarting the Agent, and
an empty impression contributes no section. The section is registered on the
user's own Agent only, so no other user's prompt — and not the administrator's —
sees it. There is no time-based expiry and no periodic rewrite: a stored body
is the current body until someone edits it.

`impression_read` returns the current body (an empty body for a user without
one) and opens the edit for that calling session. `impression_edit` replaces the
whole body; it refuses with `impression/not-read` before the read, and with
`impression/too-long` when the body exceeds 8000 Unicode characters. A refused
write changes nothing; accepted text is stored exactly, never clipped. A
session's read authorization is cleared on `agent/disposed`, so a restarted
Agent must read again.

### The user's own endpoints

The ordinary client reads and edits the impression through two authenticated
POST routes on the same carrier as the identity paths; it never goes through the
administrator gateway.

| Route | Body | Success |
| --- | --- | --- |
| `/impression/read` | `{}` | `{ ok, impression: { content, updatedAt, maxCharacters } }` |
| `/impression/edit` | `{ content }` | `{ ok }` |

Both derive `short_id` from the presented Bearer credential. The body has no
owner or short-number field; a value put there is not a selector, so no caller
can name another user's impression. The administrator is subject to the same
rule and reads and writes only its own row.

A read opens the edit for that *credential*, and an edit without a successful
read answers `409 impression/not-read`. A second live credential of the same
user must read for itself. Over-length answers `400 impression/too-long` with
both the actual count and the limit in the message. A missing credential answers
`401 impression/unauthorized`. The routes use the product's JSON envelope:
`{ ok: true, ... }` or `{ ok: false, error: { code, message } }`.

## The query gate

Every search that returns a memory records its number against the session that
called the tool (`agent.session.id`). `memory_edit`, `memory_delete` and
`memory_switch` only accept numbers in that session's recorded set, so an id
must have been returned to *this* session before it can be changed. `memory_add`
is not gated, but an added memory must still be found by a search in the same
session before it can be changed. A query in another session never authorizes
this one; the set is keyed by session id, so a maintenance child gets its own
set and must search for itself. The set lives in process memory and is cleared
when its agent is disposed, so a restart requires searching again.

## Per-source-session maintenance

Each source session has one row in `maintenance_state`. Its watermark is the
last event position a completed interval covered. Its `cut_seq` is the frozen
last closed-turn position of the interval now running (and, while idle, the
latest observed closed turn). Its `child_session` is the child that owns that
interval, and `status` is `0` idle, `1` running or `2` failed.

The engine counts closed **user** turns after the watermark: a `turn/end` only
counts when a real human `user/message` opened that turn, so a repair-only turn
cannot make an empty interval look busy. The current threshold is
`maintenanceTurns - floor((now - last_closed_at) / maintenanceDecayHours)`,
clamped to at least 1; `last_closed_at` is the newest counted closed turn. A
source with no closed user turn has no threshold. The newest closed turn is
recorded from the observed log while the row is idle; a newer closed turn moves
`cut_seq`/`last_closed_at`, while an older or equal position leaves the stored
time alone, so a deliberate time correction is not overwritten by the next tick.

Maintenance starts only when the pending count reaches the threshold **and**
the source has no running turn. A cold source counts as quiet. On start the
engine reads one observation, takes its last counted closed turn as the cut,
claims the interval in one transaction, and only then creates the child:
anything appended after the cut belongs to the next interval, and the source
keeps running in parallel. A claimed interval is never claimed again, so one
source has at most one maintenance child.

The child is a native dsh Agent (`ctx.agents.create`) with:

- a fresh persistent session id, no owner, `origin: 'subagent'`,
  `agentPreset: 'ourfairy:memory-maintenance'` and `parentSession` set to the
  source session;
- no inherited parent history, seed or prompt;
- a scoped setup that removes every inherited tool (`tools.restrict({ allow: [] })`)
  and contributes only the maintenance instruction. The memory row registers the
  five memory tools on it and every other product tool row skips this preset, so
  the child's whole tool catalog is exactly those five. The spaces prompt context
  contributes nothing for it either, so the maintenance instruction is the only
  product instruction the child carries. `tests/memory-maintenance.test.mjs`
  asserts the tool catalog and `tests/memory-policy.test.mjs` asserts the
  assembled prompt;
- the configured light-model route, read again when the child starts, with
  `MiniMax-M3.1-Flash` as the default. The main session's shared model
  selection is never read or written for this child.

It is ownerless, so it does not appear in `/sessions/list`, cannot be read
through `/sessions/read`, and is excluded from `conversation_search`; its source
is resolved only through `parentSession`.

### Material

The material is one user message assembled from the frozen interval, and only
these rows enter it:

- human `user/message` text and the **names** of its admitted attachments;
- `assistant/message` text (Fairy replies);
- `tool/call` arguments for `memory_add`, `memory_edit`, `memory_delete` and
  `memory_switch`.

Attachment bodies, every other tool's input and output, `memory_search` calls,
impression text, the source system prompt and compaction replacement copies are
excluded. Append-origin predicates exclude a replacement copy; the original
conversation is what a human transcript would contain.

### Completion, failure, restart

The child's own durable `turn/end` is the only completion authority:
`whenIdle()` resolves after a failed driver too. `completed` advances the
watermark to the frozen cut, including a turn that wrote nothing. `error`,
`blocked`, `aborted`, `interrupted` and `max-tokens`, or no ending at all, keep
the watermark and mark the row failed while keeping the child session. The next
evaluation resumes the same child: its log is the seed, so the model sees the
frozen material and its earlier tool calls, and the continuation asks it to
finish. A restart finds the idle/running/failed row and the persisted cut and
recomputes the same way; an interval is never reconstructed from an in-process
timer alone.

A create failure before the child session materializes releases the claim so a
later tick can claim a fresh child; the completed watermark never moves on such
a failure. A resume that finds the child session gone does the same.

## Configuration

The row config is the database `path` plus four volatile fields. The loader
hands every volatile field over as a live reference; the engine reads each
value again on every evaluation and again when it starts a child. Nothing is
cached at construction, so a saved value applies to the next judgement.

| Key | Default | Range / rule |
| --- | --- | --- |
| `maintenanceTurns` | 15 | integer 5–50 |
| `maintenanceDecayHours` | 6 | integer 3–24 |
| `maintenanceModel` | `MiniMax-M3.1-Flash` | non-empty string |
| `maintenanceProvider` | `minimax-cn` | non-empty string |

The loader rejects an out-of-range value at load. The bundle row seeds these
from `OURFAIRY_MEMORY_MAINTENANCE_TURNS`,
`OURFAIRY_MEMORY_MAINTENANCE_DECAY_HOURS`,
`OURFAIRY_MEMORY_MAINTENANCE_MODEL` and
`OURFAIRY_MEMORY_MAINTENANCE_PROVIDER`; an environment value is only the seed,
not a second authority. The gateway's `/gateway/maintenance` route reads and
writes the first two through the settings row whose namespace is `memory` (the
row id); see the gateway README for the wire fields and error code.

## Errors

Failures are native tool failures whose message starts with the code:

| Code | Meaning |
| --- | --- |
| `memory/invalid-content` | the content to store is empty, or longer than the 8000-character search budget (also checked on the post-edit content) |
| `memory/invalid-query` | the search query is empty |
| `memory/invalid-range` | one date bound is missing, or the bounds are not a valid closed interval |
| `memory/missing-owner` | the calling session carries no owner (or a maintenance child has no owned source session) |
| `memory/not-queried` | the number has not been returned by a search in this session |
| `memory/unknown-memory` | no memory with that number exists in the selected layer |
| `memory/no-match` | `old_string` does not occur in the target content |
| `memory/ambiguous-match` | `old_string` occurs more than once in the target content |
| `memory/invalid-patch` | `old_string` is empty |
| `memory/misconfigured` | the row has no database path or a maintenance setting is out of range |
| `memory/schema-too-new` | the database file was written by a newer schema |
| `impression/unauthorized` | the route request carries no live credential |
| `impression/not-read` | no successful read has opened this credential's or session's edit |
| `impression/too-long` | the body exceeds 8000 Unicode characters |
| `impression/invalid-content` | the edit body is not a string |
| `impression/missing-owner` | a tool call came from a session with no owner |

A deleted number answers `memory/unknown-memory` even to a session that had
queried it, because the row no longer exists.

## Storage

The row owns `memory.sqlite` under the deployment home
(`memory/memory.sqlite`), separate from the identity store: `node:sqlite` with
one synchronous connection, WAL, a versioned `meta.schema_version` and
`BEGIN IMMEDIATE` transactions. Schema version 2 adds `maintenance_state.cut_seq`
to the version 1 file; the migration preserves existing rows and leaves the new
column empty for them.

- `memories` — `id` (`INTEGER PRIMARY KEY AUTOINCREMENT`, never reused),
  `content`, `is_private` (0 normal, 1 private), `source_session`,
  `created_at`, `content_updated_at`.
- `impressions` — one current body per user (`short_id`), content, creation and
  update times, with the repository's logical-delete column. The first write
  creates the row, a later write replaces the body and moves only `updated_at`;
  reads ignore a logically deleted row.
- `maintenance_state` — one row per source session: `watermark_seq`, `cut_seq`,
  `last_closed_at`, `child_session`, `status` (0 idle, 1 running, 2 failed) and
  `updated_at`.

Deletion of an invalid memory is the repository's one exception to logical
deletion ([ADR-0002](../../docs/adr/0002-physical-memory-deletion.md)).

## What this row does not do

No compaction. The impression page is
the ordinary user's own surface; there is no long-term-memory browser or editor.
The maintenance numbers are edited through the gateway's “记忆 → 维护” section,
not by this row. Those remaining pieces are separate tickets: #247's settings
surface (delivered) and the compaction tickets for the native context path.
