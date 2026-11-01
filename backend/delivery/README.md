# @ourfairy/dsh-delivery

Peer delivery as its own product row: `deliver_message`, the durable delivery
coordination rows behind it, and their recovery at boot.

The tool delivers selected text and optional files to the recipient's
conversation: the caller's own current session when delivering to themselves,
otherwise the recipient's fixed primary chat. Chat owns the session write
protocol; the delivery row supplies the delivery event's shape and its duplicate
check. The business `deliveries` rows in the identity store only coordinate
crash recovery, so a durable row survives an outlet failure. The message
identity, receipt, recovery and the `ourfairy/delivery` notification outlet are
unchanged by this row split.

## Where a delivery lands

`src/target.ts` is that rule's only home and has no imports: the caller has
already resolved the facts, so the decision is one function over the two short
numbers, the origin session id and one boolean. `src/index.ts` asks the
owned-session service whether the origin may host the delivery
(`canHostDelivery`: the header exists, it belongs to the sender and it is not
archived), decides once, and records the decided session id on the delivery row
before any file is prepared. The receipt, the settled `delivery/message` event
and boot recovery read that recorded id; a retry reuses the existing row and
therefore its first landing. A missing origin session — a caller that has no
conversation, as a future background delivery may not — also falls back to the
primary. The primary session is resolved, and created on first use, only when it
is the landing, so a self delivery into an existing conversation does not create
one as a side effect.

## What it may reach in chat

Nothing from a chat module. Chat exposes one narrow service,
`ourfairyChatRuntime`, and this row uses exactly its two methods:

| Method | Use here |
| --- | --- |
| `appendOnce(sessionId, match, build)` | append the delivery event at most once and resolve only once it is durable; chat owns the live/cold branch, the target session's queue, the cold write handle, the restored Session's construction, the header clone and the barrier |
| `runDelivery(deliveryId, work)` | serialize one outgoing delivery's preparation, apart from the target session's queue |

The delivery queue and the session queue are separate key spaces, so settling a
delivery can take the target session's queue from inside the delivery queue
without aliasing. See [`backend/chat/README.md`](../chat/README.md) for the chat
routes that keep working without this row.

## Disabling it

The row id is `delivery`. A profile overlay that disables it removes the
`deliver_message` tool from the model catalog and stops boot recovery of pending
deliveries; chat still sends, reads, paginates, stops and observes. A model that
asks for the absent tool receives an explicit `unknown tool "deliver_message"`
result. There is no fallback copy of the delivery logic in another row.

## Identity and storage

The row requires the identity module's `deliveries` face and its user directory,
the owned-session service for the recipient's primary session and for the
landing read, and the native tool registry. It adds no table or file of its own.
