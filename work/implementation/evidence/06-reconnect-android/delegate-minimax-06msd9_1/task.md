You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Bounded T6 Android preference adapter task. Read AGENTS.md in workspace and /home/eafen405/projects/OurFairy/AGENTS.md; preserve all unrelated work. Do not delegate/commit/push.
Allowed writes only:
app/src/main/java/me/rerere/rikkahub/data/remote/ChatSyncStore.kt (new)
app/src/main/java/me/rerere/rikkahub/data/remote/AndroidChatSyncStore.kt (new)
Goal: small app-private SharedPreferences adapter (not DB/cache/outbox). Coordinator will implement sync state.
Define public data class ChatSyncKey(val endpoint:String,val userShortId:Int,val sessionId:String).
@Serializable data class StoredChatSend(val requestId:String,val text:String).
@Serializable data class ChatSyncRecord(val consumedThrough:Long=-1,val initialized:Boolean=false,val pending:StoredChatSend?=null).
interface ChatSyncStore { suspend fun load(key:ChatSyncKey):ChatSyncRecord; suspend fun save(key:ChatSyncKey,record:ChatSyncRecord) }.
AndroidChatSyncStore(context:Context):ChatSyncStore uses context.applicationContext.getSharedPreferences("ourfairy.chat-sync",MODE_PRIVATE); use awaited withContext(IO) commit() checked, never apply(). Key a deterministic JSON array/list [endpoint normalized trimEnd('/'),userShortId,sessionId] or SHA256 of canonical JSON tuple (avoid separator collision). Keep token out. Encode record using kotlinx.serialization.Json. Missing or malformed entry => ChatSyncRecord() (first-sync baseline). Do not log text/keys/credentials. No account-clear API; keys isolate users/deployments. Save failure throws so caller cannot advance consumed prefix or submit pending command as saved. Simple 70ish lines, no generic preference abstractions.
No Android runtime test is required here (public state tests coordinator). Compile can be coordinator. Return changed paths and actual checks; no fake claims.
