You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Implement one bounded Android T13 wire adapter task in /home/eafen405/projects/rikkahub/.worktrees/13-jobs only. Personal project: reuse adjacent RemoteAttachmentApi/RemoteChatApi idioms, no new infrastructure. Read repo AGENTS and OurFairy AGENTS/CODING_STANDARDS at /home/eafen405/projects/OurFairy. No commits, no pushes. Allowed edits ONLY app/src/main/java/me/rerere/rikkahub/data/remote/RemoteJobApi.kt and one additive `tasks: List<RemoteTask> = emptyList()` property to RemoteChatProjection in RemoteChatApi.kt. Do not change any other file. Owner handles tests/state/UI/build.
Wire agreed with backend:
RemoteTask serializable DTO fields taskId:String,kind:String,label:String,status:Int (0 unknown,1 running,2 stopping,3 completed,4 killed,5 failed),availability:Int (0 unavailable,1 available),startedAt:Long,finishedAt:Long?=null,detail:String?=null,progress:String?=null, output:RemoteTaskOutputWindow {earliest:Long,total:Long},report:RemoteTaskReport {status:Int [0 none,1 pending,2 running,3 completed,4 canceled,5 failed,6 unknown],messageId:String?=null,turn:Int?=null}.
RemoteJobOutput serializable DTO fields taskId:String,availability:Int,chunks:List<RemoteJobChunk>,next:Long,earliest:Long,total:Long,lossy:Boolean,status:Int. RemoteJobChunk fields at:Long,text:String,channel:String?=null,gapBefore:Boolean=false.
RemoteJobBackend public interface two suspend methods output(token:String,sessionId:String,taskId:String,from:Long):RemoteJobOutput and stop(token:String,sessionId:String,taskId:String):Int.
RemoteJobApi(baseUrl:String,client:OkHttpClient,json:Json=Json {ignoreUnknownKeys=true}) implements interface using existing authenticated JSON POST style: POST /chat/jobs/output body {sessionId,taskId,from}; response {ok:true,output:{...}}. POST /chat/jobs/stop body {sessionId,taskId}; response {ok:true,outcome:1}. outcome 0 unavailable,1 requested,2 already-finished. Refusal envelope {ok:false,error:{code,message}}. Reuse IdentityRefused/IdentityUnreachable behavior from adjacent API, no new error hierarchy. IO HTTP work on Dispatchers.IO. Keep concise and readable. Fields in output use availability:Int, NOT available:Boolean.
Return changed-file and diff summary. Do not run Gradle; owner does actual validation. If contracts ambiguous report it rather than inventing extras.
