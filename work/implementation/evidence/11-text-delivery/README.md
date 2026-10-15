# T11 / #34 — cross-user text delivery

Branch: `ticket/11-text-delivery`, based on OurFairy `20144666`.
OurFairy is the only source repository changed; native dsh
`d3fe98f969c3963c6d193e74c776692e33c1eb64` already supports the required formal
event, surface, provider history, session-reference and query extraction.
Android wire remains the existing role/status/message projection; its owner has
separate compatibility regressions and evidence.

## Changes and boundaries

- `backend/chat/src/delivery.mjs` registers the scoped `deliver_message` tool,
  with recipient number and exact text only; no recipient history result.
- Native `delivery/message` and `delivered-message` source preserve sender
  Session/owner and a stable identity derived from sender Session + tool call id.
  No model turn/step/stream is fabricated.
- RemoteChat opening and delivery share its existing per-session queue. A live
  Agent retains its writer and active attempt. Cold delivery uses native
  exclusive persistence ownership and a detached Session, with no Agent creation.
  The one public `snapshotEvents` call copies only that detached Session's new
  suffix (including a possible native resume marker); no new reader abstraction.
- Existing business SQLite schema v5 adds only `deliveries`: identity/input,
  numeric coordination status 0/1, accepted native message/sequence and required
  actors/timestamps/logical deletion. There are no FK/unique secondary indexes.
  Startup retries pending rows against the formal native event identity. Failure
  stays retryable. No outbox or second conversation log.
- Notify after releasing the writer queue and after durable log + coordination;
  async notification errors are logged and do not undo sender confirmation.
- Transcript projects delivery as ordinary Fairy role 2/status 2, without a
  transfer label; native message identity and active attempt are independent.
- Launcher content hash includes the new module. File delivery is left to T12.

## Actual commands and results

Commands ran from this ticket worktree, with real profile/Loader, native JSONL,
business SQLite, local HTTP and a controlled external model HTTP server.

1. `node --test tests/text-delivery.test.mjs` → `01-red.log`: failed because
   `deliver_message` was absent. `02-green.log`: cold delivery passed, receiver
   inference count zero.
2. Same command → `03-live.log`: 2/2, independent live attempt and later model
   input includes delivered text. `04-recovery.log`: 4/4, concurrent primary
   creation and senders, stable retry and real SQLite update-failure window.
3. Same command → `05-recovery-red.log`: a pending startup update failure
   permanently rejected later calls. `06-recovery-green.log`: 4/4 after keeping
   individual pending rows retryable.
4. Same command → `07-flush.log`: 5/5. A test-only native `session/flush`
   listener rejects one durability barrier after the formal delivery append;
   sender gets no delivery receipt and the row stays pending. Exact retry
   confirms one message. This is an injected barrier failure, not a real disk EIO.
5. Same command → `08-notification-red.log`: async notification rejection exited
   the backend (subsequent HTTP ECONNREFUSED). The bounded fix awaits/catches the
   outlet after durable write; no notification framework is added.
6. `node --test tests/text-delivery.test.mjs tests/identity-store.test.mjs tests/remote-chat.test.mjs`
   → `09-final-targeted.log`: 32/32. `10-sse-targeted.log`: 32/32 after adding
   actual SSE receipt while the recipient attempt remains active and unchanged.
7. `git diff --check` → no output, success.

The recovery test uses an actual SQLite BEFORE UPDATE trigger to reject the
coordination write after the native message is durable, restarts with the fault
still present, removes the fault, and retries the same tool identity. It asserts
one native delivery, the original native message id, completed business state,
changed-body conflict and exact recipient transcript. It demonstrates this
crash window with failure + restart; it does not claim a precisely timed OS kill.

## Not performed

No real official cloud inference, phone/emulator/Compose runtime, actual OS
notification integration, full disconnect/back-page recovery, real disk EIO,
file delivery, signed APK/release or performance acceptance. Those remain their
own tickets/stage gates. The model server is a deterministic external substitute;
its captured request count proves no recipient inference in the covered cases.
