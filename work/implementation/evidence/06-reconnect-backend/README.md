# T6 / #29 backend bounded reconnect

Branch `ticket/06-reconnect`, based on integration `ee18102`. This ticket changes only OurFairy’s existing chat adapter, public wire documentation and product-level tests. No dsh fork source, database table or formal Session event schema was changed. Android persistence/merge behavior is companion work.

## Delivered behavior

The agreed wire contract is `backend/chat/README.md` (T5 + T6). Read and opening follow now return a bounded native-event tail: default64, maximum256 raw events. Each observer freezes its opening inclusive C and earliest L. Later cumulative snapshots retain L/C and every formal event through the new cursor, alongside the Agent-owned full attempt prefix. Closing an observer never changes the Agent lifetime.

`/chat/page` uses mandatory fixed inclusive `throughSeq=C` and exclusive backward `beforeSeq` and returns contiguous bounded native events, plus visible message rows derived at C. It includes non-message events, and an empty visible-message list does not mean empty event coverage. Repeating a page is deterministic despite later tail growth. Pages have no attempt/reply state to overwrite newer live state. Messages retain native stable identities and original text; a later authoritative message sequence supersedes an earlier acceptance of the same ID.

`/chat/checkpoint` reuses the actual native Agent-owned writer barrier. The adapter captures P before the awaited flush and advances only that known confirmed prefix. `cursor`, backend `durableThroughSeq`, and Android’s completely applied/committed consumption prefix remain separate. Page reads do not acknowledge new persistence. Ownership is checked through the existing service before live access or cold resume; no administrator bypass.

No second log, receipt table, sync authority, controller stack, search engine or notification policy was introduced. The only additional per-observer state is its numeric opening range. Existing query leases and Agent lifetime maps are reused. Backend can materialize its current native log internally; it does not send entire old history to hide missing pagination. Live snapshots cumulatively retain only the initial bounded tail and subsequent events of that observer connection; reconnection opens a fresh bounded range.

## Actual verification

Commands were run from this ticket worktree using pinned dsh `d3fe98f` and the existing built runtime. A temporary untracked `.corepack` symlink reused the product tool cache and was removed before handoff.

- `node --test tests/reconnect.test.mjs` before implementation: **failed** because the old projection had no native-event range, `01-bounded-red.log`.
- Same command after the first slice: **1/1 passed**, `02-bounded-green.log`.
- Bounded recovery with live concurrency and actual socket response loss: **3/3 passed**, `03-follow-network.log`.
- Actual file-permission writer failure, retry/cold recovery and authorization: **5/5 passed**, `04-storage-failure.log`.
- Abrupt process crash and saved recovery closer: **6/6 passed**, `05-cold-closer.log`.
- `node --test 'tests/**/*.test.mjs'`: **54/54 passed**, `06-product-suite.log`; includes original identity/session/lifecycle tests, T5 remote tests and T6 reconnect tests.
- `git diff --check`: passed.

All tests boot the shipped profile through the real CLI/Loader and exercise public authenticated HTTP/SSE. SQLite identity, native Agents, formal events, JSONL compression/write barriers, query observations and restarts are real. Only the cloud model is replaced by a real loopback HTTP/SSE server via deployment `DEEPSEEK_BASE_URL`, with fake credentials; production remains `deepseek-official/deepseek-flash`.

### Observed failure/recovery cases

- Eight offline turns exceed the default64-event tail. A small5-event opening/page window forces multiple history pages; their union is exactly seq0..C with no missing/duplicated event. A new live send after C cannot alter the prior page or appear inside frozen history.
- Six inputs accepted without a phone produce an active attempt prefix. Follow with a3-event opening tail restores that complete prefix, pages older coverage while the model continues, then includes every formal event after C and the exact final Unicode/Markdown body. Page objects contain no stale attempt/status fields.
- An actual `/chat/page` TCP response is destroyed after the server answers but before the client consumes its body. Retrying the identical C/before window returns the same page.
- The real session artifact is chmod0400 (still readable, unwritable), making native append/flush fail with EACCES. Send and checkpoint return500. SSE can observe newer formal events, but `durableThroughSeq` stays at the prior confirmed prefix and the compressed artifact SHA-256 is unchanged. Restoring0600 allows the same native writer barrier to succeed; identical send/receipt identity remains unchanged and survives restart. No fake persistence callback or product fault switch is used.
- The isolated backend process group is SIGKILLed during an open native turn. After cold ownership authorization, native resume reconstructs the session and the real writer saves its interrupted closer before follow acknowledges it. A second stop/start reads the exact same closer, proving it was not merely a query-only synthetic event being ACKed.
- New page/checkpoint endpoints reject anonymous and foreign users, including the administrator, for cold and live sessions. Invalid fixed cuts/exclusive offsets/limits return400; beforeSeq0 gives an empty terminal page.

## Limits

No real cloud, Android-to-live-backend runtime, emulator/phone, release signing, notification policy or frame/performance acceptance was run here. Companion Android work must independently prove local consumption commit, epoch rejection and message merging. The full specification remains open; this slice supplies synchronization/consumption facts for later notifications without implementing their trigger rules.
