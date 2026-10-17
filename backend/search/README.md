# Owned conversation search

`conversation_search(query, limit=5)` searches messages in the executing session
owner's other conversations (at most 10 results). It returns session id, original
event `seq`, type, time and an excerpt of up to 80 Unicode characters around the
match. A fresh list of native owned headers restricts the SQL results before
ranking and truncation. Administrators have the same personal scope, and the
query has no user parameter.

`conversation_read(sessionId, fromSeq, toSeq)` authorizes the target again.
Endpoints are inclusive, nonnegative, ascending and span at most 100 original
event positions. Results preserve those positions and contain the native
semantic text of user, assistant and delivery messages; system messages,
standalone tool calls and results, reasoning, images and attachment bytes are
omitted. Embedded assistant tool-call blocks keep their native name and
arguments. The total message-text budget is 8000 Unicode characters; a shortened
final message is reported through `truncated`. Historical text is labelled as
conversation material in tool output.

The `session-query-sqlite` provider opens at first search under
`$DSH_HOME/query/sessions.sqlite` with `literalSubstring: true`. It scans the
derived semantic documents, preserving source casing and supporting Chinese short
words without a segmentation dependency. Ranking is match count, shortest
message, newest message, then the native tie breakers.

To rebuild: stop the backend, remove only the dedicated
`$DSH_HOME/query/sessions.sqlite` and its `-wal`/`-shm` sidecars, then restart.
The next search rebuilds from native logs; identity data and logs are untouched.
The index holds no ownership data; every query is restricted by the caller's own session headers first.
