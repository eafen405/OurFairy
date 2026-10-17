# T5 / #28 backend remote chat

Branch `ticket/05-remote-chat`, based on integration `c2b5fce`. Changes are confined to OurFairy; dsh/rikkahub source was not modified here. Android is a separate companion implementation.

## Result and structure

`@ourfairy/dsh-chat` supplies authenticated send, receipt, read, observation and current-reply stop routes. Its public contract is `backend/chat/README.md`. A small product module is needed because the upstream controller requires a working directory and exposes capabilities not present in this product. The module reuses the existing HTTP fence/body/error carrier, ownership service, native Agent registry, official default route, SessionQuery observation leases and writer barriers.

There is no new database/table/schema or Session event type. Ownership remains `SessionHeader.owner`. Native `agent/inbox/spliced.inserted` events are the only request-acceptance authority, including after the pending item has been claimed. Serialized acceptance checks return the same native message ID and insertion sequence for identical retries, reject changed text under the same ID, and confirm only after flushing. A failed/unknown response does not authorize a fresh request identity. This does not claim exactly-once model execution across crashes.

Agent handles belong to the plugin, never the HTTP connection. Transient runtime maps contain only resume/acceptance serialization, lifetime generation, attempt assembly and observers. Observers register before their first exact cut, and each SSE publication is a full cumulative snapshot. Streamed text uses native `BlockAssembler`; complete/interrupted messages and failed-attempt text derive from formal events. `cursor` is observed, while `durableThroughSeq` advances only to a cutoff captured **before** the owned live writer's successful barrier. Durability changes also advance projection version.

Deployment-only persona copies the approved Fairybot role/personality, removes old filesystem/background-process policies and binds authenticated short number 1 as the sole “主人”. User text stays a native user message; it does not update the deployment asset. This is source separation, not an added model-output review or learning system.

Native stop semantics are retained: cancel current execution with `keepInbox:true`; preexisting queued input remains accepted/pending until another waking send (or native resume), rather than being discarded. A stable retry reconciles its receipt and does not enqueue it again. A no-text stopped attempt is projected interrupted using formal `turn/end`, including after restart.

## Actual verification

Commands were run from this worktree, with the pinned dsh `d3fe98f` checkout and its existing built runtime. A temporary `.corepack` symlink reused the repository tool cache; it is not part of the change.

- `node --test tests/remote-chat.test.mjs` before implementation: **failed with route 404**.
- Same command after the first behavior slice: **1/1 passed**.
- Progressive public/model-boundary acceptance coverage: **5/5**, **6/6**.
- `node --test tests/identity-http.test.mjs`: **8/8 passed**、 covering the shared POST carrier change.
- Stop-before-output/queued-input check:  captured a real incorrect failed-state projection, plus a test assumption that native retained input wakes automatically. The projection was corrected from formal turn-end facts; the queue test was aligned with the documented native later-wake semantics, then verified through receipts and subsequent execution.
- `node --test tests/remote-chat.test.mjs`: **8/8 passed**.
- `node --test 'tests/**/*.test.mjs'`: **48/48 passed**. This includes original identity/session/lifecycle tests and all remote chat tests.
- `git diff --check`: passed.

The remote suite boots the shipped product profile through the real CLI/Loader and uses real HTTP, identity SQLite, native Agents, JSONL/compression, query observations and restarts. Only the external model is a loopback HTTP/SSE double selected through `DEEPSEEK_BASE_URL` and a fake key; the production route remains `deepseek-official/deepseek-flash`.

Covered: five concurrent identical sends; changed-text conflict; durable receipt and message identity across restart; exact Markdown/Unicode final text; both users' actual model input separation, including separate sessions of the same user; every route's anonymous/foreign/admin refusal for cold and live sessions; unchanged cold artifact hashes/mtime and no model calls on rejected access; SSE ordered cumulative prefixes, terminal state publication and active baseline on observer reconnect; observer close allowing completion; current stop with and without text; retained queued identity and later wake; failed partial text preserved and cold recovered; scoped owner identity and no chat-editable deployment persona.

## Limits

No official cloud request, Android-to-backend runtime, emulator/phone, signed release, notification or rendering-performance acceptance was run here. Android tests/build are companion evidence. T5 returns complete snapshots; bounded pagination, fixed-cut history recovery and persistent client consumption belong to T6/#29. This ticket alone does not complete the parent specification.
