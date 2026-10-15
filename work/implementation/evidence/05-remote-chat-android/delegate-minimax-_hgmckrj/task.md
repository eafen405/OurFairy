You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
Bounded T5 UI task. Read applicable AGENTS.md and /home/eafen405/projects/OurFairy/AGENTS.md. Read /tmp/ourfairy-t5-wire.md; data/remote/RemoteChatState.kt + RemoteChatApi.kt. No delegation/commit/push.
Allowed writes ONLY new app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteChatPanel.kt.
Implement @Composable fun RemoteChatPanel(state: RemoteChatState, onReconnect: () -> Unit, modifier: Modifier = Modifier). The coordinator will bind identity/session and integrate into existing sessions page. Collect state.snapshot with collectAsStateWithLifecycle. No local ChatService/GenerationLoop/Room/model.
Minimal readable Material3 expressive panel inside parent's scroll Column: connection/loading state and manual reconnect action when disconnected; backend error/failure (SessionsSnapshot.UNREACHABLE => stringResource(identity_unreachable)); complete messages under stable key(messageId), user Text and all Fairy terminal messages MarkdownBlock existing renderer (supports code/table/formula). Use remoteMessageFormat(message), terminal failed/interrupted still Markdown. Active attempt under key(generation,attemptId) plain Text exact text, no markdown or concatenation; remoteAttemptFormat() supplies PLAIN. Don't invent status transformations.
Composer draft remember(snapshot.sessionId); preserve exact text including whitespace; send only text.isNotBlank && !snapshot.sending && snapshot.pending == null; action state.send(draft) then clear draft. Stop button calls state.stop(), enabled replyStatus 1/2; label stopping when2. Pending command should display original text and in-progress; when acceptanceUnknown show explanation '接纳结果尚未确认，请先查询或使用原请求重试' and separate explicit buttons state.reconcile() and state.retryPending(); do not auto resend. No local authoritative bubbles: pending is clearly a pending command, not a saved message. Add no paging/auto reconnect/background notification. Simple @Composable helpers welcome only as needed.
Use parent Column (no fillMaxSize or nested LazyColumn; rendering performance later ticket); messages should keep original text. Need not write UI tests for reversible layout. Compile check coordinator will run; report changed file and limitations.
