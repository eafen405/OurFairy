You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
T14 bounded Android task ONLY /home/eafen405/projects/rikkahub/.worktrees/14-activity. Read repo AGENTS and /home/eafen405/projects/OurFairy/{AGENTS.md,CODING_STANDARDS.md}. Personal project minimal clear reuse. Allowed edits ONLY: new data/remote/RemoteActivity.kt; additive property at END of RemoteChatProjection in data/remote/RemoteChatApi.kt; new ui/identity/RemoteActivityCard.kt. All under app/src/main/java/me/rerere/rikkahub. No other edits, no commits/pushes/Gradle. Owner handles lifecycle logic/tests/panel wiring.
Fixed backend contract approved root: @Serializable RemoteActivity {status:Int=0 [0unknown,1quiet,2active],reasons:List<Int>=emptyList [1execution,2jobs,3report,4delivery],episodeId:String?=null,startedSeq:Long?=null,throughSeq:Long=-1,completed:RemoteCompletedActivity?=null,delivery:RemoteActivityDelivery?=null}. RemoteCompletedActivity {episodeId:String,startedSeq:Long,finishedSeq:Long,outputSeq:Long?=null}; RemoteActivityDelivery {episodeId:String,seq:Long}. Put required schema docs compact. Add val activity:RemoteActivity=RemoteActivity() at END of RemoteChatProjection constructor (preserve all existing positional args).
RemoteActivityCard(activity:RemoteActivity,modifier:Modifier=Modifier) native Compose Material 3 expressive card showing status label unknown/quiet/active (in Chinese: 活动状态未知/会话静默/Fairy 正在工作), optional active reasons labels only when status==2 from numeric reasons. Unknown label must never imply quiet. Card solely displays passed state, no event scanning, no network, no local activity derivation, no notification behavior or setting. Quiet delivery may carry delivery fact and remain status1; do not fake running. Keep this small; owner will supply effective unknown state during disconnect/recovery.
Return actual changed files/diff summary.
