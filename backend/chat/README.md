# Remote chat wire contract (T5 + T6, 2026-10-15)

All routes are POST, JSON object body, Authorization: Bearer <identity credential>, same endpoint/fence as /sessions/*. Body never selects owner. Errors before streaming: HTTP 400/401/404/409/500 with {ok:false,error:{code,message}}. Foreign/missing session: same 404 sessions/unknown-session; unauthenticated:401 chat/unauthorized. Host/Origin fence applies. No local model execution.

- /chat/send body {sessionId,requestId,text}. requestId: stable nonempty client-generated string (max128); text nonempty string. Return {ok:true,receipt:{sessionId,requestId,messageId,acceptedSeq}} only after writer flush. Exact same session/requestId/text returns same receipt (including after process restart), changed text returns409 chat/request-conflict. Network/500 means acceptance unknown: retain same requestId/text, retry identical or call receipt, never silently new request.
- /chat/receipt body {sessionId,requestId}. Return {ok:true,receipt:<same shape>|null}. null means no durable acceptance currently observed; send can retry same request identity.
- /chat/read body {sessionId,maxEvents?}. Return {ok:true,projection:<below>}, with a bounded opening event range (default64, max256).
- /chat/stop body {sessionId}. Return {ok:true}. Calls native cancel current reply, keeps queued input for a later waking send (native semantics); eventual projection settles stopped/error. Closing observer never stops work.
- /chat/observe body {sessionId,maxEvents?}. HTTP200 text/event-stream; each `event: projection\ndata: <JSON projection>\n\n` carries a complete cumulative snapshot of this connection’s opening bounded range plus its live tail. JSON has no ok wrapper. Initial snapshot then every changed state; `: keepalive\n\n` comments allowed. End/IO disconnect = disconnected, never finished. Replace the prior connection snapshot, merge separately backfilled history by identity, and never concatenate snapshot text. No Last-Event-ID replay guarantee; reconnect uses the fixed-cut pages below.

Projection:
{sessionId,generation,version,cursor,durableThroughSeq,throughSeq,fromSeq,beforeSeq,hasMore,events:[...],messages:[...],attempt:<object|null>,replyStatus,error:<string|null>}
- generation:string server Agent lifetime UUID (not permanent identity); version:monotone integer within generation. Reject stale callbacks by credential/connection/session epoch on Android. cursor:last observed native event seq, -1 empty; durableThroughSeq:only writer-barrier-confirmed prefix, -1 if unknown. Does NOT mean the client applied that prefix.
- messages:[{messageId:string,seq:number,requestId:string|null,role:number,status:number,text:string}]. role1=user,2=Fairy. status1=accepted/pending user,2=complete,3=interrupted,4=failed. All text exact original text, including whitespace/Markdown. Stable user messageId from native inbox; accepted pending input remains visible before user/message. Assistant settlement without a native message uses deterministic `attempt:<sessionId>:<seq>` identity and exact saved text; status3 for cancelled turns,4 for failed turns. No runtime-context/system/tool bubbles.
- attempt:{attemptId:string,revision:number,text:string}|null. Native attemptId only unique within generation; text cumulative exact original visible text. Final durable message replaces attempt. revision monotone within generation. While active plain text; terminal messages use existing complete rich-text renderer including interrupted/failed.
- replyStatus numeric:0 idle,1 running,2 stopping. error:string|null last execution failure; do not treat transient connection loss as model error.

## Fixed-cut reconnect (T6)

`maxEvents` is a raw-event count, integer1..256 (default64). It is not a message count: system/context/tool/inbox/boundary events may produce no bubbles. A message count cannot prove complete event consumption.

An opening read/follow freezes inclusive cut `throughSeq=C=cursor`, includes exact native events `fromSeq=L=max(0,C-maxEvents+1)` through `cursor`, and sets `hasMore=L>0`, `beforeSeq=L` if more history exists (null otherwise). Every later SSE snapshot on **that connection** retains C/L and includes all formal events L..current cursor, including every event after C. The Agent-owned attempt accumulator always supplies the full active prefix, even when its start predates L or no phone was connected. Closing the observer releases only that observer.

`events` are native immutable Session events, identity `(sessionId,seq)`. Their type/source vocabulary remains native; business role/status in messages remain numeric. An overlapping seq must have the same payload. A snapshot can replace an older snapshot only within its connection range; it must not erase independently backfilled older history. Messages are derived from the current formal transcript, restricted to rows whose authoritative seq is in the range. Merge same messageId using newer seq; do not let an old history page overwrite a newer live settlement. Current attempt/reply state belongs to the newest live snapshot.

- `/chat/page` body `{sessionId,throughSeq:C,beforeSeq:L,maxEvents?}` → `{ok:true,page:{sessionId,throughSeq:C,fromSeq:K,beforeSeq:K|null,hasMore,events,messages}}`. `throughSeq` is mandatory inclusive frozen opening cut; `beforeSeq` is mandatory exclusive backward offset0..C+1. C cannot exceed the current native cursor. `end=min(C+1,beforeSeq)`, K=max(0,end-maxEvents); returned events are exactly K..end-1. More history exists iff K>0, then next beforeSeq=K. At beforeSeq0 the terminal page is empty with K0/hasMorefalse/beforeSeqnull. Invalid windows/limits return400 `chat/invalid-page`. Same C/before produces the same page while newer tail grows; page response loss retries the same window. Pages contain no attempt or reply state.
- `/chat/checkpoint` body `{sessionId}` → `{ok:true,sessionId,durableThroughSeq:P}` only after the owned live Agent writer flush succeeds. P is captured before awaiting the barrier; concurrent later tail is not acknowledged by that barrier. Failure returns500 and leaves the confirmed prefix unchanged. `/page` does not grant a new ACK.

The client keeps three positions distinct: observed native cursor, writer-confirmed durableThrough, and its completely applied **and locally committed** consumption prefix W. Backfill fixed C while merging seq>C separately. Only after required coverage is contiguous and writer ACK covers it may an awaited preference commit advance W. A failed page/ACK/local commit leaves W unchanged and retains readable content. Attempt revisions, message receipt, and a rich-text row are not event coverage.

A restored cursor without cached body rows cannot skip missing history: this client must refill its projection after process restart. Missing/corrupt records establish a fresh initialization baseline; the record/batch is input for future notifications, not a notification policy. Backend does not keep another client receipt/consumption database. Cold access authorizes before native resume, and uses the resumed writer so query-only synthetic closers are never acknowledged without being saved.

No new DB/table/authoritative receipt ledger: native Session events incl inbox inserted are sole acceptance/history authority. Transient generation/attempt accumulators and serialization queues are derived runtime state only.

## Cross-user text delivery (T11)

The session-scoped `deliver_message({recipientShortId,text})` tool saves only the
specified text into the recipient's fixed primary session. It returns
`{deliveryId,sessionId,messageId,acceptedSeq}` after the native writer's durability
barrier. It returns no recipient history and starts no recipient inference.

The delivery identity is derived from the sender's permanent Session id and the
native tool call id. The business SQLite `deliveries` table (schema v5) fixes the
recipient and text before the append, with status 0 pending coordination and
1 durably delivered. The native `delivery/message` event is the delivery fact:
it carries the same delivery identity and the real sender Session/owner, and
contains an assistant-role message with source `delivered-message`. It has no
fabricated model turn, step, or stream. Pending rows are reconciled against that
identity on startup; an exact retry finds the same message after a log-success /
business-update failure. A changed recipient or text under the same identity is
refused. Failed startup reconciliation leaves the row retryable.

Live delivery appends to the existing Agent's Session and flushes its writer.
Cold delivery takes the native exclusive write handle, validates/restores a
detached Session, appends and flushes, then closes the handle. Opening remote
chat and delivery share the existing per-session queue. No Agent is created for
a cold delivery, and a recipient's active attempt remains independent of the
delivered bubble.

Existing read/page/observe projections expose the event as `role:2,status:2`
with the native message id and exact text. They add no transfer label or new wire
fields. The durable business row is recoverable notification input; a failed
`ourfairy/delivery` outlet cannot retract the message or turn a successful
confirmation into failure. System notification policy belongs to its later ticket.
This ticket adds no file delivery, outbox, or second history store.

## File delivery (T12)

The existing `deliver_message` tool additionally accepts optional ordered `files`, up to the shared attachment limits: 8 files, 32 MiB per original, 64 MiB total. Each item is either `{path:string}` in the sender's current authorized file world, or `{messageId:string,index:integer}` for an admitted original in the current sender session. Text and recipient remain explicit. The same native call ID derives the same delivery identity; changed target/text/ordered selectors conflict rather than silently changing the delivery.

The existing business row's one `attachments_json` column keeps ordered `{selector,prepared}` entries. Numeric delivery status 2 means files still being prepared. Each immutable snapshot is committed to the checklist before preparing the next; a same-ID retry skips committed entries and continues null entries. A CAS write whose checklist update failed has not committed that item and may be repeated. Only a complete checklist becomes status 0 (ready for the existing writer/flush coordination); status 1 means durably delivered. Startup reconciles ready rows and never sends preparing rows as plain text. This is the same delivery flow and table used for text, with no additional outbox.

The formal receiving `delivery/message` retains only the explicitly selected text and original attachment manifest. It contains no private source selector path and no copied conversation context. Ordinary Fairy role-2 rows use the existing public `{index,type,name,mime,bytes}` attachment metadata and `/attachments/download` session/message/index original route. Files become native readable text handles for later model requests, including delivered images; assistant image blocks and model provider/turn/replay facts are not fabricated. The recipient can use authorized `read`/`read_image` without gaining source workspace access. Delivery itself never starts recipient inference.
