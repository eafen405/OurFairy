# Long-term memory

The memory row owns the product's long-term memories: one SQLite file, the
`memory_*` tools the Fairy uses, the query gate those tools enforce, and the
per-source-session maintenance engine. It stores memories, not impressions and
not session logs; session search keeps answering "what was said", this row
answers "what should be remembered".

## What the row contributes

One `MemoryService` (context name `ourfairyMemory`) owns the store, and every
live Agent gets five tools registered on its own agent context. Registration
follows the product's usual shape: a global `agent/created` listener plus a
replay of `ctx.agents.list()`, so a resumed session gets the same tools. The
row then clears that agent's bookkeeping on `agent/disposed`.

`MaintenanceEngine` (a module, not a second public service) watches owned source
sessions, recomputes their pending interval, and creates the native child
described below. It starts on the same `agent/created` signal, on a one-second
tick for persisted time, and on a boot scan of `sessionPersistence.list()` plus
the `maintenance_state` rows, so a restart recomputes from durable state.

| Tool | Inputs | Success |
| --- | --- | --- |
| `memory_add` | `content`; optional `is_private` (default normal) | `{ ok, id }` |
| `memory_search` | `query`; optional `start_at`, `end_at`, optional `is_private` (default normal) | memories plus budget metadata |
| `memory_edit` | `id`, `old_string`, `new_string`; optional `is_private` (default normal) | `{ ok, id }` |
| `memory_delete` | `id`; optional `is_private` (default normal) | `{ ok }` |
| `memory_switch` | `id` only | `{ ok, id, is_private }` |

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
`truncated` reports that something was left out. A single memory whose own
content exceeds the character budget is omitted like any other, so no
over-budget body reaches the model. The model therefore cannot act on an id it
has not seen.

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
  and contributes only the maintenance instruction; the memory row registers
  the five memory tools on it, and every other product row skips this preset
  (the four tool rows, the spaces prompt context, the attachments stream/refresh
  hooks, and the spaces working-directory/sandbox-policy prompt providers);
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
not a second authority. Ticket #247 binds the first two to the gateway's
“记忆 → 维护” tree under the settings namespace `memory` (the row id), reading
and writing the same volatile fields.

## Errors

Failures are native tool failures whose message starts with the code:

| Code | Meaning |
| --- | --- |
| `memory/invalid-content` | the content to store is empty |
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
- `impressions` — one row per user (`short_id`), content and timestamps, with
  the repository's logical-delete column. Ticket #245 owns its behaviour.
- `maintenance_state` — one row per source session: `watermark_seq`,
  `cut_seq`, `last_closed_at`, `child_session`, `status` (0 idle, 1 running,
  2 failed) and `updated_at`.

Deletion of an invalid memory is the repository's one exception to logical
deletion ([ADR-0002](../../docs/adr/0002-physical-memory-deletion.md)).

## What this row does not do

No impression tools or endpoints, no gateway or Android settings page, and no
compaction. Those are separate tickets: #245 for impressions, #247 for the
settings surface, and the compaction tickets for the native context path.
