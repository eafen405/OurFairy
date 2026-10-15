# Owned conversation search

`conversation_search(query, limit=5)` searches messages in the executing
session owner's other conversations (at most 10 results). It returns session ID,
original event `seq`, type, time, and an excerpt of up to 80 Unicode characters
around the match. Short messages stop at their own boundary. A fresh list of
native owned headers restricts the SQL results before ranking and truncation;
the derived index is never an ownership authority. Administrators have the same
personal scope. There is no user parameter.

`conversation_read(sessionId, fromSeq, toSeq)` independently authorizes the
target. Endpoints are inclusive, nonnegative, ascending, and span at most 100
original event positions. Results preserve those positions and contain only
native semantic text from user, assistant and delivery messages. System messages,
tool calls/results, reasoning, images and attachment bytes are omitted. The total
message-text budget is 8000 Unicode characters; a final message may be shortened
and `truncated` reports omitted text. Empty or beyond-log intervals return no
messages. Historical text is labelled as conversation material in tool output;
it is never injected as a deployment prompt.

The product enables the existing `session-query-sqlite` provider at first search,
under `$DSH_HOME/query/sessions.sqlite`, with `literalSubstring: true`. This mode
scans the existing derived semantic documents, preserving source casing and
supporting Chinese short words without a segmentation dependency or another
index. Ranking remains match count, shortest message, newest message, then the
stable native tie breakers. The default upstream token search remains available
for other profiles. A scan is sufficient for this small personal deployment.

To rebuild: stop the backend, remove only the dedicated
`$DSH_HOME/query/sessions.sqlite` and its `-wal`/`-shm` sidecars, then restart.
The next search rebuilds from native logs; identity data and logs are untouched.
No business table, ownership copy, HTTP entry, or Android screen is added.
