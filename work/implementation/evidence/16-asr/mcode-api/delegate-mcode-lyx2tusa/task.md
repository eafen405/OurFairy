You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
T16/#39 bounded task: finish and check RemoteSpeechApi HTTP adapter in /home/eafen405/projects/rikkahub/.worktrees/16-asr. Read /home/eafen405/projects/OurFairy/CODING_STANDARDS.md and work/tickets/ourfairy-v1/16-asr.md. Preserve all other current dirty code. Allowed edit scope ONLY app/src/main/java/me/rerere/rikkahub/data/remote/RemoteSpeechApi.kt and app/src/test/java/me/rerere/rikkahub/data/remote/RemoteSpeechApiTest.kt. Format like neighboring RemoteAttachmentApi.kt. Keep backend-only cloud credentials; availability GET /speech returns {ok:true,available,maxDurationMs,maxAudioBytes}; POST /speech/transcriptions audio/wav returns editable text, errors follow existing IdentityRefused string codes. Do not send chat. Use existing OkHttp callbacks/cancellation (cancel Call when coroutine cancelled). Check adjacent API tests and add 1-2 meaningful HTTP adapter tests via existing MockWebServer for authenticated availability, raw WAV -> returned text or error. Do not create helpers/frameworks, budgets/options, cloud provider enum. No Gradle heavy build, no git commit/push. Return concise diff/check findings. Coordinator edits lifecycle/UI separately.
