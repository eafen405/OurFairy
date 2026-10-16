# Remote attachments

`pdf_info`, `pdf_read_pages` and `pdf_render_pages` use the admitted original file handle already
projected to the model. Qualification comes from that agent's actual owned
session; knowing another user's path or a bare hash grants no access. The tools
return numeric status (1 success, 2 partial page failure, 3 failure), page count,
1-based page numbers, bounded text, truncation and no-text/image-reading hints.
They report damaged, encrypted, invalid-page, page-limit and resource-limit
results explicitly. `pdf_info` samples only the first page; unread pages are not
represented as understood. `pdf_render_pages` renders only 1–3 explicitly requested pages, bounded to
1600 pixels on their longest side, for scans, charts and complex layouts. It
returns the original handle/name and 1-based page numbers next to native image
references. The real tool-result image blocks use the same native attachment
store and official provider serialization as `read_image`; they never become
fabricated user/assistant history. The exact calling model route must accept
images before rendering starts. Derived images grant no extra filesystem paths
and do not enter upload receipts or replace original downloads. Temporary
renderer files are removed after every call; native image blocks persist with
their owning session's real tool result, as with `read_image`.
No schema changes or persistent derived index/cache are needed. See [the PDF dependency and runtime budgets](pdf/README.md).

The native immutable attachment store owns bytes. The business `uploads` table owns only upload lifetime (numeric status: 0 uploading, 1 complete, 2 expired). A completed upload is scoped to its authenticated owner and target session. Native message source metadata preserves the admitted original file reference and optional normalized image reference. SessionHeader.owner remains the sole ownership authority; no message/admission table duplicates the log.

Authenticated POST routes:

- `/attachments/propose`: `{sessionId,name,mime,size,sha256}` → `{ok:true,upload}`.
- `/attachments/chunk`: binary body, `x-upload-id` and decimal `x-upload-offset` → `{ok:true,upload}`. Exact already acknowledged bytes can be repeated after a lost response; conflicting offsets/bytes fail.
- `/attachments/complete`: `{uploadId}` → `{ok:true,upload}`. Original hash/size and optional image decoding must finish before complete is committed. Repeat completion returns the same valid receipt.
- `/attachments/download`: `{sessionId,messageId,index}` → original binary bytes. Qualification comes from an admitted native message in the owned session, never from a bare hash or upload ID.

The receipt is `{uploadId,name,mime,size,sha256,status,offset,expiresAt}`. Maximum 8 files, 32 MiB per original, 64 MiB per message and 256 KiB per chunk. Images also obey the native 20 MiB/decoded-pixel limits. Uploads expire 24 hours after proposal; formal admitted inputs remain downloadable independently of upload expiration. New sends recheck complete status, owner/session, expiry and actual shared-model image capability. Already admitted request retries resolve native request identity first, so expiry never converts an accepted request to a new send.

`/chat/send` accepts ordered `uploadIds` (default empty). Request conflict compares both text and ordered IDs; pending client storage must retain both. Empty text is valid with an attachment. Public transcript attachment rows are `{index,type,name,mime,bytes}` (type 1 file, 2 image).

Generic files project through the existing native text-handle path. Images use the existing official provider serialization and normalized image bytes. Originals remain separate and downloads are byte preserving. Derived exact-file grants are rebuilt from native message manifests before model/tool execution and belong to the actual Session object; they disappear with that object. Both the product filesystem and real shell sandbox consume the same precise readonly leaves. The global CAS root is never mounted for a user.

For file delivery, the current sender may explicitly select an authorized execution-world `{path}` or an admitted original `{messageId,index}` from that sender session. Paths use the same fd-bound filesystem provider and cwd as tools, then snapshot bytes into native CAS. Message selectors preserve the admitted original and optional normalized image reference. They do not use upload expiry or grant access from a bare hash. The receiving delivery message's manifest independently grants only its exact files; it contains no sender private path or neighboring directory grant.
