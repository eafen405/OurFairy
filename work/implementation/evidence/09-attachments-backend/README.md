# T9/#32 backend evidence

Branch `ticket/09-attachments`, OurFairy only. Based on T7 `d26dbe6`; merged T8's frozen foundation `e55ded0`, then the formally published integration `742c192` with normal merge `09e3c8d`. dsh/Android sources were not edited by this implementer. Android delivery belongs to its separate worktree.

## Behavior and scope

Native attachment-local CAS remains original/normalized byte authority. One additive `uploads` table joins the existing business SQLite connection (schema v4, supports v1/v2/v3 upgrades); numeric lifecycle status, logical deletion, people and create/update metadata, no foreign keys or unique secondary indexes. No new database/outbox/message ledger. Native admitted user source records original reference, optional normalized image reference and ordered upload IDs. Original native request identity and actual session writer barrier still decide accepted sends; same request retries bypass upload expiry only when already admitted.

Authenticated propose → bounded binary chunk → complete routes, chat upload IDs, public attachment metadata, and session/message/index original downloads are mounted in the actual product profile. Chunk retries verify matching already acknowledged bytes. Incomplete, expired, foreign-user and foreign-session uploads fail. Account-independent CAS hashes never grant access. Precise readonly file leaves are rebuilt from actual session manifests before model/tool work and consumed by the existing filesystem and real bwrap sandbox. File→handle and image→official Messages serialization reuse dsh. Global CAS roots remain inaccessible.

## Actual verification

Commands run in this ticket worktree, using the real launcher/profile/Loader, temporary product homes, real SQLite and compressed JSONL/CAS; only the external model HTTP service is a double:

- `node --test tests/attachments.test.mjs` — initial `01-red.log` proves missing propose route (404); `02-green-original.log` **1/1**, upload → concurrent accepted send → original download → native restart → same receipt/bytes.
- Next authorization slice: `03-red-authorization.log` showed owned-session errors incorrectly surfaced as 500; `04-green-authorization.log` **2/2** after using the shared SessionScopeError boundary. Includes unfinished inputs, same hash different owners, foreign owned session/admin denial and changed request attachments conflict.
- `06-green-expiry-image.log` **4/4** adds lost chunk ACK repeat, conflicting bytes, explicit expiry fault setup in the real SQLite DB, admitted retry after expiry/restart, actual official provider image base64 request and original PNG download, plus malformed-image rejection. `05-expiry-image.log` is a fixture failure: the initially borrowed PNG was invalid; switching to the native store's known-valid PNG required no product code change. No cloud inference occurred.
- `07-real-file-sandbox.log` **5/5**, including model-projected handle used by actual native read/write and bwrap `bash`, cross-user/same-owner-other-session guessed-path denials, actual readonly mutation refusal and cold-restart grant reconstruction.
- `node --test 'tests/**/*.test.mjs'` — `08-product-suite.log` **71/71**, after normal merge of the formally published T8 tip.
- Final bounded additions, `node --test tests/attachments.test.mjs tests/identity-store.test.mjs` — `10-final-related.log` **23/23**. Asserts shell readonly failure AND original download bytes unchanged, frozen v3 credentials/group membership survive v4, and upload-table timestamps/person/deletion/no-FK/no-unique-secondary-index rules. No production behavior changed after the full suite apart from comment wording.
- `node scripts/combo.mjs verify` — `11-combo.log`, passed.
- `node scripts/ourfairy-backend.mjs doctor --home /tmp/ourfairy-t9-doctor --json` — `12-doctor.log`, passed.
- `git diff --check` passed.

An additional host-level CAS tampering test was proposed, then excluded by Lead as outside this personal project's required scope. It was removed and caused no implementation change; it is not an unresolved acceptance defect. The permission tests retain real script/tool mutation refusal and unchanged original downloads.

## Limits

No real cloud DeepSeek request, phone/emulator, Android runtime/APK-to-backend test, receiver delivery (T12), signed release or performance acceptance was run here. These remain later integration/device gates, not claims inferred from test/build success. Upload TTL expiry is deterministic test setup via SQLite at the clock boundary, not a 24-hour wall-clock wait. The model-double tests prove actual serialization and native file/script execution, not image semantic accuracy.
