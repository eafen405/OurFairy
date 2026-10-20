# Remote attachments

`pdf_info`, `pdf_read_pages` and `pdf_render_pages` use the admitted original file
handle already projected to the model, qualified through that agent's owned
session. They return numeric status (1 success, 2 partial page failure,
3 failure), page count, 1-based page numbers, bounded text, truncation and
image-reading hints, and report damaged, encrypted, invalid-page, page-limit and
resource-limit results explicitly. `pdf_info` samples the first page only.
`pdf_render_pages` renders 1–3 explicitly requested pages, bounded to 1600 pixels
on the longest side, and returns the original handle, name and page numbers next
to native image references. The tool-result image blocks use the same native
attachment store and provider serialization as `read_image`. The calling model
route must accept images before rendering starts. Renderer temporary files are
removed after every call. See [the PDF dependency and runtime budgets](pdf/README.md).

The native immutable attachment store owns bytes; the business `uploads` table
owns only upload lifetime (numeric status: 0 uploading, 1 complete, 2 expired). A
completed upload is scoped to its authenticated owner and target session. Native
message source metadata preserves the admitted original reference and the
optional normalized image reference.

Authenticated POST routes:

- `/attachments/propose`: `{sessionId,name,mime,size,sha256}` → `{ok:true,upload}`.
- `/attachments/chunk`: binary body, `x-upload-id` and decimal `x-upload-offset` → `{ok:true,upload}`. Exact already acknowledged bytes can be repeated after a lost response; conflicting offsets/bytes fail.
- `/attachments/complete`: `{uploadId}` → `{ok:true,upload}`. Original hash/size and optional image decoding must finish before complete is committed. Repeat completion returns the same valid receipt.
- `/attachments/download`: `{sessionId,messageId,index}` → original binary bytes. Qualification comes from an admitted native message in the owned session.

The receipt is `{uploadId,name,mime,size,sha256,status,offset,expiresAt}`. Maximum
8 files, 32 MiB per original, 64 MiB per message and 256 KiB per chunk; images
also obey the native 20 MiB/decoded-pixel limits. Uploads expire 24 hours after
proposal, while admitted inputs stay downloadable. New sends recheck complete
status, owner/session, expiry and the shared model's image capability. A retry of
an admitted request resolves its native request identity first.

The upload protocol is deliberately product-owned: resumable chunks, expiry and
original-byte download are not offered by native `fileUploads`. The rationale and
the tests that would reveal a change are in the
[native capability dependency record](../../docs/decisions/native-capability-dependencies.md#attachment-upload).

`/chat/send` accepts ordered `uploadIds` (default empty). Request conflict compares both text and ordered IDs; pending client storage must retain both. Empty text is valid with an attachment. Public transcript attachment rows are `{index,type,name,mime,bytes}` (type 1 file, 2 image).

Generic files project through the native text-handle path; images use provider
serialization with normalized bytes. Originals stay separate and downloads are
byte preserving. Exact-file grants are rebuilt from native message manifests
before model/tool execution, belong to the actual Session object and disappear
with it. The product filesystem and the shell sandbox consume the same read-only
leaves.

For file delivery the sender selects an authorized execution-world `{path}` or
an admitted original `{messageId,index}` from that sender session. Paths go
through the same fd-bound filesystem provider and cwd as tools, then snapshot
bytes into the native store. The receiving delivery message's manifest grants
only its exact files.
