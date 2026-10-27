# Long-term memory and impressions

The memory row owns the product's long-term memories and every user's
impression: one SQLite file, the `memory_*` tools the Fairy uses, the query gate
those tools enforce, the user's own impression endpoints, and the impression
section injected into that user's system prompt. It stores memories and
impressions, not session logs; session search keeps answering "what was said",
this row answers "what should be remembered" and "who is this user".

## What the row contributes

One `MemoryService` (context name `ourfairyMemory`) owns the store, and every
live Agent gets five tools registered on its own agent context. Registration
follows the product's usual shape: a global `agent/created` listener plus a
replay of `ctx.agents.list()`, so a resumed session gets the same tools. The
row then clears that agent's bookkeeping on `agent/disposed`.

| Tool | Inputs | Success |
| --- | --- | --- |
| `memory_add` | `content`; optional `is_private` (default normal) | `{ ok, id }` |
| `memory_search` | `query`; optional `start_at`, `end_at`, optional `is_private` (default normal) | memories plus budget metadata |
| `memory_edit` | `id`, `old_string`, `new_string`; optional `is_private` (default normal) | `{ ok, id }` |
| `memory_delete` | `id`; optional `is_private` (default normal) | `{ ok }` |
| `memory_switch` | `id` only | `{ ok, id, is_private }` |
| `impression_read` | none | `{ content, updated_at, max_characters }` |
| `impression_edit` | `content` | `{ ok }` |

The impression tools and the `ourfairy:impression` prompt section exist only on
an owned Agent. A session without an owner receives neither, so the later
maintenance child — which has no user owner — cannot read or rewrite an
impression as part of memory work.

`memory_add` takes no owner or source: the source session is the calling
session, and the owner is derived from that session's immutable
`SessionHeader.owner`. A session without an owner (a maintenance child, later)
cannot add; a missing owner is refused before any write.

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
and the source session (the editing session); the number and layer do not
change. `memory_switch` flips the layer and changes nothing else: no content,
no source, no content time. `memory_delete` removes the row physically — no
tombstone — and the number is never reused, so an old result cannot point at a
new memory. Session logs are not touched.

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
this one; the set is keyed by session id, so a later maintenance child gets its
own set with no borrowing. The set lives in process memory and is cleared when
its agent is disposed, so a restart requires searching again.

## Errors

Failures are native tool failures whose message starts with the code:

| Code | Meaning |
| --- | --- |
| `memory/invalid-content` | the content to store is empty |
| `memory/invalid-query` | the search query is empty |
| `memory/invalid-range` | one date bound is missing, or the bounds are not a valid closed interval |
| `memory/missing-owner` | the calling session carries no owner |
| `memory/not-queried` | the number has not been returned by a search in this session |
| `memory/unknown-memory` | no memory with that number exists in the selected layer |
| `memory/no-match` | `old_string` does not occur in the target content |
| `memory/ambiguous-match` | `old_string` occurs more than once in the target content |
| `memory/invalid-patch` | `old_string` is empty |
| `memory/misconfigured` | the row has no database path |
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
`BEGIN IMMEDIATE` transactions. The file carries all three tables this
capability needs, so the later impression and maintenance tickets add behaviour
rather than migrations:

- `memories` — `id` (`INTEGER PRIMARY KEY AUTOINCREMENT`, never reused),
  `content`, `is_private` (0 normal, 1 private), `source_session`,
  `created_at`, `content_updated_at`.
- `impressions` — one current body per user (`short_id`), content, creation and
  update times, with the repository's logical-delete column. The first write
  creates the row, a later write replaces the body and moves only `updated_at`;
  reads ignore a logically deleted row.
- `maintenance_state` — one row per source session: watermark, last closed
  time, maintenance child session, status. Nothing drives it yet.

Deletion of an invalid memory is the repository's one exception to logical
deletion ([ADR-0002](../../docs/adr/0002-physical-memory-deletion.md)).

## What this row does not do

No maintenance state machine or child session, no maintenance/compaction
settings, and no client or gateway surface for them. The impression page is the
ordinary user's own surface; there is no long-term-memory browser or editor.
Those remaining pieces are separate tickets.
