# T5/T6 stage Standards review

Read-only review; only this note and a /tmp Java probe were written.

## Pinned scope

- OurFairy: `git diff f8bb706...fca2f61`; commit list and scope copied from `/tmp/ourfairy-stage-t5-t6-review.md`.
- rikkahub: `git diff f84e6c5a...34cabaad`.
- dsh: no increment; its pre-existing dirty files excluded.
- Sources: OurFairy `AGENTS.md`, `work/implementation/CONVENTIONS.md`; rikkahub `AGENTS.md`. `rg --files -g AGENTS.md` found no closer AGENTS below touched paths in either repository.
- Reviewed source of backend owned sessions, shared HTTP wrapper, chat service/projection/routes/bundle/launcher; Android API/store/state/DI/navigation/pages/panel. Test/evidence source inspected for lifecycle and durability assumptions. No device/cloud absence is classified as a bug.

## Finding S1 — P1: New Sessions NavKey cannot be saved

Location: `/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt:755`.

Diff hunk adds `data object Sessions : Screen` without `@Serializable`, unlike all other adjacent Screen entries. `AppRoutes` uses `rememberNavBackStack(Screen.SignIn)` at line 309; navigating from the account pushes Screen.Sessions at line 424. Its save path therefore serializes this new entry when the Activity saves state (backgrounding/configuration change), and fails with `SerializationException` rather than preserving navigation.

Rule: user AGENTS design rule **精简不减保障** explicitly retains necessary **失败恢复**; this is an omission from the existing navigation save mechanism, not a request for a new abstraction. `CONVENTIONS.md` section 6 also requires checking actual APIs rather than guessing. This is a concrete correctness finding tied to that required recovery, not a Fowler smell or a formatting/tooling complaint.

Evidence:

1. Source lines 745/748/751 mark SignIn/Register/Account @Serializable; Sessions at 755 omits it.
2. `javap -c -p` of installed Navigation 3 `navigation3-runtime/jars/classes.jar` shows `RememberNavBackStackKt__RememberNavBackStack_androidKt.rememberNavBackStack` constructs `NavBackStackSerializer(new NavKeySerializer())` and calls rememberSerializable. `NavKeySerializer.serialize` calls `SerializersKt.serializer(value::class)`.
3. Actual T6 compiled classes at `.worktrees/06-reconnect/app/build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes` show Account exposes serializer(), Sessions does not (`javap -p`).
4. Executed `/tmp/OurFairyNavSerializerProbe.java` against the actual compiled T6 classes and installed Kotlin 2.4.20/serialization-core 1.11.0, invoking exactly that serializer lookup. Exit 0; output:

```
Account: kotlinx.serialization.internal.ObjectSerializer@6302bbb1
Sessions: kotlinx.serialization.SerializationException: Serializer for class 'Sessions' is not found.
Please ensure that class is marked as '@Serializable' and that the serialization compiler plugin is applied.
```

Smallest correction: add @Serializable to Screen.Sessions, consistent with the other destinations; verify it can round-trip through the NavKey/NavBackStack serializer. No device needed to prove serializer lookup, but full Activity/Compose lifecycle was not executed in this review.

## Heuristic assessment / suppressed suggestions

No separate actionable smell finding. Per-owner/session queues, transient attempt accumulator, fixed-cut projection and account/connection epoch each implement current required concurrency or recovery and are not treated as speculative generality. Native owner/header/events remain authoritative; no new business table or DB constraints. SharedPreferences bookkeeping is derived client consumption/pending command state, not a duplicate message-history authority. Numeric wire role/status remain documented; native event type strings are upstream protocol vocabulary. Small repetition in primary checks or the typed HTTP envelopes does not alone warrant introducing a framework for this personal project. No stylistic localization finding because rikkahub AGENTS explicitly prioritizes function without requesting localization.

## Limits

No repository edit, test-suite rerun, emulator/device execution, real cloud call or architecture approval inferred from existing test counts. The serializer probe is real execution of the installed library lookup against compiled ticket classes, not a device run.
