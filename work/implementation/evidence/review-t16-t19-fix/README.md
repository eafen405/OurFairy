# T16–T19 stage review fix: preserve an active reader through terminal formatting

Finding: Spec P2, ticket T19 acceptance #5 / story 75 / spec §7. Stable message ID plus an unchanged pixel offset cannot preserve the source reading point when a long raw body changes into a different-height Markdown layout. The initial T19 implementation did not provide that guarantee.

Scope: one local presentation correction plus the exact native settlement relation it needs. No database/schema, activity authority, visual drawing code, Markdown parser/renderer, or global layout architecture changes.

## Reuse facts and choice

Rikkahub's `MarkdownDocument` retains complete `source`; table nodes additionally retain their source, but general blocks have no source ranges or stable source identities. `MarkdownBlocks` uses normal Compose layout, with no existing character-to-rich-layout anchor map. The fix therefore keeps an already-reading user's raw layout until they leave that row or return to the tail. The terminal full source is still parsed in the background immediately. The cached complete document becomes eligible when the hold is released, and release is permanent; an initially rendered historical terminal message never waits.

`RemoteTranscript` now uses one heading/body structure for the live and formal row, and the native end relation gives that row the same visual key. Terminal footer controls remain after the body. `MessageBody` directly consumes the tested row's `documentToShow` gate; it continues showing the exact complete raw source while held, never an empty placeholder or a replay. No text offset is claimed to map to Markdown geometry. The guarantee is instead that the reader's layout is unchanged during that transition; full formatting follows their departure or return to the tail. Device pixel/gesture verification remains T22, as before.

## Deterministic association and lifetime

The native dsh `packages/core/agent-loop/src/assistant-stream.ts` `settle()` publishes an end outcome with `{kind:'committed', eventType, seq}` after the formal event append. The original OurFairy handler discarded that relation. The backend now copies just `{attemptId,seq}` into optional `projection.settledAttempt`. It is the most recent native end relation in the current projection generation, starts null on a new process generation, is cleared on abandonment, and is not persisted. A current active attempt can coexist with the previous completed relation; clients join the full generation-scoped identity and exact formal sequence, never infer a current attempt is done from the presence of an unrelated prior relation.

The Android presenter retains only the latest observed live identity plus visual aliases for displayed formal messages. It aliases a message only when an observed live key matches this generation's explicit relation and the formal message seq matches. Cold history does not have an observed live row and therefore does not alias or defer. Same-text delivery, empty streams, and a new active attempt remain independent. The early implementation experiment using `startsWith` was removed completely; it was not committed or shipped. The new optional Kotlin projection property is at the data class end, preserving existing positional call sites; old serialized projections default to null and old clients ignore the added JSON field.

## Actual red/green and validation

- new shared presentation seam is absent, so compilation fails before implementation. This is retained as compilation-red evidence, not a runtime layout assertion.
- first new reading transition + existing presentation tests pass.
- a real ordering shape (formal message before stream end) fails the initial content-based experiment;  passes after its immediate local correction. That experiment was subsequently replaced by native association.
- real authenticated backend/SSE and stop paths fail because `settledAttempt` is absent (`undefined`); : all eight real remote-chat tests pass after copying the native end relation.
-  actually fails compilation because the first optional property position shifted older positional callers. It is not a pass despite its filename. Moving the property to the end fixes compatibility;  passes the reading/presentation/speech tests and release Kotlin compile.
- full `:app:testDebugUnitTest :app:assembleRelease` succeeds in 3m17. : 69 suites, 515 tests, zero failures/errors. Uses the pre-existing local Android test keystore and fake Firebase configuration; no production-signing or Firebase-runtime claim.
- The new five reading tests use the production presentation input and actual existing Markdown parser, checking unchanged key/raw body while reading, code/table/formula document after leaving, return-to-tail release, history immediate eligibility, exact final increment for interrupted/failed terminal states, formal/stream-end overlap, and independent equal-text delivery/new live/history. Existing latest-snapshot/no-empty/stale-parse tests remain.
- full product run passes 108/109; the only failure is the already-observed costly-PDF resource classification (`worker-unavailable` instead of `resource-limit`) while concurrent builds run. It is not masked or modified by this presentation fix.  validates the current integration combination. A normal pre-commit full check is run again after heavy Android work ends; its output is recorded separately by the delivery agent.

Commands used the fixed SDK and existing tooling, for example:

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
./gradlew :app:testDebugUnitTest :app:assembleRelease -Pourfairy.identityEndpoint=https://example.invalid -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel
node --test tests/remote-chat.test.mjs
npm test
npm run combo:verify
```

No new physical-device result is claimed. Review fix APK preserved at `/tmp/ourfairy-t19-release/app-arm64-v8a-review-fixed.apk`. Source test-first history from original T19 is retained unchanged; no retrospective red evidence was fabricated.
