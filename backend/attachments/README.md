# Remote attachments

The native immutable attachment store owns bytes. The business `uploads` table owns only upload lifetime (numeric status: 0 uploading, 1 complete, 2 expired). A completed upload is scoped to its authenticated owner and target session. Native message source metadata preserves the admitted original file reference and optional normalized image reference. SessionHeader.owner remains the sole ownership authority; no message/admission table duplicates the log.

Authenticated POST routes:

- `/attachments/propose`: `{sessionId,name,mime,size,sha256}` → `{ok:true,upload}`.
- `/attachments/chunk`: binary body, `x-upload-id` and decimal `x-upload-offset` → `{ok:true,upload}`. Exact already acknowledged bytes can be repeated after a lost response; conflicting offsets/bytes fail.
- `/attachments/complete`: `{uploadId}` → `{ok:true,upload}`. Original hash/size and optional image decoding must finish before complete is committed. Repeat completion returns the same valid receipt.
- `/attachments/download`: `{sessionId,messageId,index}` → original binary bytes. Qualification comes from an admitted native message in the owned session, never from a bare hash or upload ID.

The receipt is `{uploadId,name,mime,size,sha256,status,offset,expiresAt}`. Maximum 8 files, 32 MiB per original, 64 MiB per message and 256 KiB per chunk. Images also obey the native 20 MiB/decoded-pixel limits. Uploads expire 24 hours after proposal; formal admitted inputs remain downloadable independently of upload expiration. New sends recheck complete status, owner/session, expiry and actual shared-model image capability. Already admitted request retries resolve native request identity first, so expiry never converts an accepted request to a new send.

`/chat/send` accepts ordered `uploadIds` (default empty). Request conflict compares both text and ordered IDs; pending client storage must retain both. Empty text is valid with an attachment. Public transcript attachment rows are `{index,type,name,mime,bytes}` (type 1 file, 2 image).

Generic files project through the existing native text-handle path. Images use the existing official provider serialization and normalized image bytes. Originals remain separate and downloads are byte preserving. Derived exact-file grants are rebuilt from native message manifests before model/tool execution and belong to the actual Session object; they disappear with that object. Both the product filesystem and real shell sandbox consume the same precise readonly leaves. The global CAS root is never mounted for a user.
