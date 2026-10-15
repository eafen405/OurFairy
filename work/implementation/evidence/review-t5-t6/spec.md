# Stage T5/T6 — independent Spec review

Pinned ranges: OurFairy `f8bb706...fca2f61`; rikkahub `f84e6c5a...34cabaad`; dsh product `d3fe98f9` has no increment. Source and public native Agent/Inbox/assistant-stream semantics read; pre-existing dsh dirty files not treated as changes. GitHub #23/#27/#28/#29 bodies and comments fetched using `gh issue view N --comments --json number,title,body,comments` after plain `gh issue view` hit deprecated `projectCards`. Local ticket/spec source agrees. No implementation files changed.

## Finding 1 — P1: Sessions navigation key cannot survive state saving

- File: `/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt:755`.
- Spec: `work/tickets/ourfairy-v1/06-reconnect.md:22`: “长于尾窗的断线、重复/乱代连接、部分分页失败、保存失败、账号/会话切换及迟到事件均有明确状态与可恢复行为。” Parent `docs/specs/ourfairy-v1.md:47,49`: app backgrounding/network changes do not cancel work, reconnect restores readable saved history.
- New `Screen.Sessions` is the sole new destination without `@Serializable`; `rememberNavBackStack(Screen.SignIn)` at line309 saves runtime keys. Actual navigation3-runtime1.2.0 NavKeySerializer `serialize` invokes `SerializersKt.serializer(runtime KClass)`; corresponding bytecode inspected with javap.
- Trigger: enter Sessions, then Activity state saved (background/recreation). Saving this key throws SerializationException, crashing Activity state save instead of normal recoverable lifecycle.
- Actual JVM repro against exact T6 compiled classes under `.worktrees/06-reconnect/.../compileDebugKotlin/classes` and exact cached navigation runtime. `/tmp/OurFairyNavKeyProbe.java` looks up the same runtime serializer used by NavKeySerializer. Output:
  - `Account: me.rerere.rikkahub.Screen.Account`
  - `Sessions: kotlinx.serialization.SerializationException: Serializer for class 'Sessions' is not found.`
- Minimal fix: annotate Sessions, add navigation-key serialization/save regression. No emulator result claimed.

## Finding 2 — P1: New backend generation cannot reconcile previously observed unsaved tail

- File: `/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt:100-110` (related cache retention lines74-86 and strict equality line220).
- Spec `work/tickets/ourfairy-v1/06-reconnect.md:19,22`: “明确已观察事件、后端已保存截点和客户端完整消费前缀”, “保存失败…均有明确状态与可恢复行为”.
- Existing real product test in `tests/reconnect.test.mjs` proves formal events may be observed through SSE while actual chmod0400 writer append/flush fails and persisted bytes/confirmed prefix remain unchanged. A subsequent backend crash can remove that unsaved tail; native restore writes an interrupted closer at the now-reused seq (already separately tested via actual abrupt crash).
- Android keeps both events and message rows on same-key detach/reconnect. A changed projection.generation is accepted at line103 but has no cache reset/reconciliation. At line220 any replacement event at that seq permanently rejects the new baseline. Every automatic reconnect repeats the same failure and old messages remain visible. If new baseline ends before the orphan seq, stale rows remain and later tail eventually collides.
- Actual JVM public-state repro `/tmp/OurFairyRecoveryProbe.kt`, compiled externally against exact T6 app classes; `RemoteChatState.bind`, `detach`, bind same account/session after backend generation change; first unacknowledged event at seq0, then recovered event at same seq. Result:
  - `before: connected=true, consumed=-1, generation=old-agent`
  - `after reconnects: connected=false, failure=相同位置的事件内容不一致, generation=old-agent`
- Minimal fix: on new backend generation rebuild/replace cached observed projection from new authoritative baseline/pages (or drop tail beyond last confirmed prefix plus affected message rows); retain pending request and consumption records. Keep strict equality within same generation. Regression should observe unconfirmed tail, reconnect to repaired generation and prove messages/coverage converge.

## Other reviewed behavior

No extra scope finding. Existing owned-session header authority/cold pre-authorization, stable rpc receipt after actual flush, fixed-cut backward raw-event pages, cumulative attempt prefix, explicit stop and observer/Agent lifetime separation appear aligned for tested paths. Cloud/device/APK-to-backend acceptance remains explicitly deferred and is not called an implementation defect. Two confirmed Spec findings, worst P1.
