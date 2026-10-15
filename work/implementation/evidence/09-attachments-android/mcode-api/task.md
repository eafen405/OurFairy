You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Implement only bounded Android T9 attachment API transport/DTO. Read AGENTS.md, /home/eafen405/projects/OurFairy/AGENTS.md, /tmp/ourfairy-t9-wire.md and skill /home/eafen405/.agents/skills/tdd/SKILL.md. Approved seams: public RemoteChatBackend/RemoteAttachmentBackend API tested against HTTP network double. Personal project: readable minimum code, no new framework. Worktree is own subtask branch. Do NOT commit or merge.
Allowed edits ONLY:
app/src/main/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApi.kt (new)
app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteAttachmentApiTest.kt (new)
app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatApiTest.kt
API contract freeze:
@Serializable data class RemoteChatAttachment(val index:Int,val type:Int,val name:String,val mime:String,val bytes:Long)
RemoteChatMessage gets attachments:List<RemoteChatAttachment> = emptyList(). RemoteChatBackend.send existing signature add uploadIds:List<String> = emptyList(); override send passes ordered uploadIds in JSON.
@Serializable data class RemoteAttachmentUpload(val uploadId:String,val name:String,val mime:String,val size:Long,val sha256:String,val status:Int,val offset:Long,val expiresAt:Long)
interface RemoteAttachmentBackend {
 suspend fun upload(token:String,sessionId:String,file:java.io.File,name:String,mime:String):RemoteAttachmentUpload
 suspend fun download(token:String,sessionId:String,messageId:String,attachment:RemoteChatAttachment,destination:java.io.File)
}
class RemoteAttachmentApi(baseUrl:String,client:OkHttpClient,json:Json=Json{ignoreUnknownKeys=true}) : RemoteAttachmentBackend
Upload uses exact ORIGINAL local file sha256 and size, max32MiB; propose then sequential <=256KiB raw chunks then complete. Completion status1 plus offset/size original required before success. Retry one lost IOException chunk response with same bytes/offset (server idempotency); complete can retry same id once on IO. Do not silently restart/propose on authorization or deterministic failure. Validate receipt uploadId and fixed metadata/offset/name server sanitizer allowed; no local URI/paths sent. Reuse existing IdentityRefused/IdentityUnreachable patterns. HTTP client clone must followRedirects(false),followSslRedirects(false). Don't add discovery/general retry platform.
Download POST qualified parent JSON, write streaming to destination, require Content-Length and exact bytes equal attachment.bytes, EOF, close success; delete destination on failure. Original metadata byte count max32MiB. No previews, no cache manager, no URI adapter. No credential in logs. Don't modify state/DI/UI.
Use public HTTP seam tests red-before-green (network double pattern existing API tests), at least upload original bytes/chunk lost response retry/complete, original download exact bytes + truncation refusal; don't blanket edge-case suite. Run tests if existing build config available, otherwise report actual missing setup; never mutate shared config. Completion report actual changed files/tests/diff and remaining limits.
