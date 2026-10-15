# Stage review pinned ranges

Read-only. No new implementation; report actionable findings with file/line, trigger, effect, and smallest fix. Findings from unexecuted device/cloud acceptance are limits, not proof of a bug. Do not invent general-purpose frameworks or require speculative defenses.

## ourfairy
Repo: /home/eafen405/projects/OurFairy
Diff: git -C /home/eafen405/projects/OurFairy diff f8bb706...fca2f61
Commits:
fca2f61 build: pin verified T6 recovery combination for staged review
74e149d docs: record integrated T6 backend verification
5bf5597 merge: integrate T6 bounded reconnect backend
fbad2dc test(chat): prove reconnect ACKs follow real writer durability
0d95671 feat(chat): recover bounded history at a fixed native event cut
ee18102 build: pin verified T5 Android remote chat combination
09ceb18 docs: record integrated T5 backend verification
9383e86 merge: integrate T5 native remote chat backend
b50a2c5 fix(chat): settle streamed and stopped replies from native event facts
a1d518c feat(chat): durably accept stable remote sends through native sessions
c2b5fce docs(handoff): record published stage and requested stop point
86c561f docs(agents): record design review and database rules
9feb689 docs(sessions): lock and measure the owned-session combination
f82a433 Merge empty-session handoff correction for issue 27
f677cca fix(sessions): release empty sessions for agent resume
315b377 Merge backend owned sessions for issue 27
0585ff6 docs(sessions): record final backend product validation
01dd084 feat(sessions): expose the existing ownership service to consumers
de06e7b fix(sessions): publish only durable sessions and verify cold refusal
c1f1b3e docs(evidence): record the integration merge doctor required
296def5 Merge branch 'integration/ourfairy-v1' into ticket/04-owned-sessions
18a12ef fix(sessions): read the persisted snapshot's header and serialize per-owner work
4c1e445 docs(evidence): correct the #27 blocker claim
377111a feat(sessions): owned sessions and a fixed primary, not yet green
ffff103 Merge branch 'integration/ourfairy-v1' into ticket/04-owned-sessions
1e61752 test(sessions): failing acceptance tests for owned sessions and a fixed primary

## android
Repo: /home/eafen405/projects/rikkahub
Diff: git -C /home/eafen405/projects/rikkahub diff f84e6c5a...34cabaad
Commits:
34cabaad merge: integrate T6 Android bounded recovery
ebcb5536 fix(android): preserve recovery across commit and account races
69ea1afd feat(android): recover fixed cut history and durable consumption
07c0df40 merge: integrate T5 Android remote chat
aedbf7e3 feat(android): render remote chat in owned sessions
76167268 feat(android): share account scoped remote chat projection
9c53a259 feat(android): add authenticated remote chat transport
fd04aab7 Merge owned-session Android client
c4b00046 fix(sessions): match the backend's own session wire contract
4865b285 fix(sessions): make the sessions page actually reactive to its own account
c95f84fe feat(sessions): list, create, choose and return to your own remote sessions

dsh exact product d3fe98f969c3963c6d193e74c776692e33c1eb64 has no increment; original 16 dirty files not review target.
Spec: OurFairy docs/specs/ourfairy-v1.md and work/tickets/ourfairy-v1/{04-owned-sessions,05-remote-chat,06-reconnect}.md; GitHub #23/#27/#28/#29. #24-26 findings already resolved; do not re-review main baseline.
Standards: OurFairy AGENTS.md and work/implementation/CONVENTIONS.md; rikkahub AGENTS.md. Read closest applicable AGENTS under touched dirs. User wants a personal project: reuse, small readable implementation, necessary auth/isolation/durability/concurrency retained.
Evidence: OurFairy work/implementation/evidence/{04-owned-sessions-backend,04-owned-sessions-android,05-remote-chat-backend,05-remote-chat-android,06-reconnect-backend,06-reconnect-android,stage-t5-t6}/README.md. Logs are evidence, not source to exhaustively review.
User approved Fairybot role/personality excluding old workspace/process policies, shortId1 only called 主人. Pending command and consumption prefs structure was explicitly told to user; no business DB or formal log change.
