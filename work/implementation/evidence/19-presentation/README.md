# T19 / #42 — Fairy visuals and complete reply presentation

Android branch: `ticket/19-presentation`, final SHA `1d3edb4d9009322b3dd1693a49c5a51fcbdf912a`; OurFairy branch: `ticket/19-presentation`. Baseline Android `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6`, OurFairy worktree first merged `7687485c58f8db607d1ad2c4fbde982b92305bd0`. No database/schema change.

## Delivered

- The Fairy drawing/motion source and title/HUD fonts are copied from fixed Fairybot `095efdd84fd7ab2215a0b5b03369aac4f1303108`. `visual-copy-check.log` records nine source files identical except package/import changes and byte-identical fonts. The source license and a port map are included. Only the visual enum is retained from the old presence model; no second activity aggregation is introduced.
- Reuses existing receive `StateFlow`/whole projection snapshots and rikkahub's Markdown/code/table/LaTeX parser/renderer. The small presentation flow keeps complete raw content visible, parses terminal documents off the main thread, and prevents old results publishing over newer content. End/stop/error/history all use the existing terminal-message rule, including status-only changes. `RemoteTranscript` owns presentation/scroll work; the page handles existing commands.
- List and read-only detail use the same body entry and existing device-local font family/size preferences. Existing color-mode storage is reused. Stable message keys and message/offset anchors preserve the viewport; user drag/fling is prioritized over tail following.
- Five fixed offline workloads and a release Activity use that same transcript/body path. OurFairy `scripts/measure-presentation.py` launches cases, optionally swipes during the stream, and captures only its own synthetic result plus frame/memory dumps. See `measurements.md` for exact workload/metric boundaries and the host regression guard.

## Actual validation

Commands run in Android worktree, with `ANDROID_HOME=/home/eafen405/Android/Sdk`:

```bash
./gradlew :app:testDebugUnitTest --tests '*RemotePresentationTest*' :app:compileReleaseKotlin -Pourfairy.identityEndpoint=https://example.invalid -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel
./gradlew :app:testDebugUnitTest --tests '*RemotePresentation*' :app:assembleRelease -Pourfairy.identityEndpoint=https://example.invalid -Dorg.gradle.jvmargs='-Xmx8g -Dfile.encoding=UTF-8' --max-workers=4 --parallel
```

First three presentation tests + release Kotlin compile passed (`android-test-build.log`). Four final behavioral tests and one fixed-source host-baseline measurement are preserved as XML. They cover terminal-only full Markdown/code/table/math/reference resolution, stale parse suppression with no empty intermediate body, reconnect burst superseding obsolete snapshots, and anchored/user-priority scroll targets.

Release packaging first failed because this worktree had no release signing key (`android-release-missing-signing.log`). Its ignored local.properties now uses the existing local Android test keystore solely for this demo measurement build. The existing fake Firebase configuration is unchanged. A later module extraction exposed one missing Compose `key` import (`android-2259ccaa-final.log`); the one-line fix is committed and later verification is recorded separately. No failed log is represented as a pass. The initial test execution was green after implementation; there is no claimed red-run evidence for those first presentation slices.

The broken worktree-local material-color-utilities gitdir was repaired using the already cached exact submodule commit `5b3618b16fdc3825e21d5679bafd144662088ea1` and a separate `/tmp/t19-material-color-utilities/.git`. Other worktree/main submodule configuration was not changed. Existing node_modules linkage remains untracked and excluded from commits.

OurFairy checks: Python AST syntax parse and `python3 scripts/measure-presentation.py --help`; both succeeded. Full product `npm test` and `npm run combo:verify` are Lead's final integration gates, not replaced by these local checks.

## Delegation and limits

mcode generated the independent synthetic workload in `/tmp/t19-synthetic`; task/run/result logs are retained. Only the reviewed Markdown template is used as product input, with deterministic workload expansion in the Activity. The initial visual-repository mcode task was cancelled (exit 130) after Lead requested a narrower scope; it produced no stdout and no file changes. Later explicit outside-sandbox authorization was retained; no extra delegation was needed.

No physical device or emulator result is claimed. Device discovery did not complete and WSL has no `/dev/kvm`. The release measurement Activity has not been run here: this delivery proves JVM behavior, parser CPU baseline, source/resource reuse and release buildability only. vivo S50 receive-to-display latency, actual frames/jank, memory and visual/reading continuity remain T22. Device gates must derive from its measured baseline; no old 16 ms constant or cold-start score is substituted.

## Final committed-source verification

`android-1d3edb4d-final.log`: `BUILD SUCCESSFUL in 2m 58s`, 725 actionable tasks, on the exact final Android commit above. Four presentation tests + one host-baseline measurement pass (zero failures/errors), and release lint/package/assemble complete. `release-apk-signature.log` verifies the test-signed APK; `release-measurement-entry.log` proves the exported offline measurement Activity is in the actual APK manifest. Hashes are in `release-apk-sha256.log`. The arm64 APK is also copied to `/tmp/ourfairy-t19-release/app-arm64-v8a-release.apk` before worktree cleanup.

Before reporting, both ticket worktrees merged their corresponding current integration branch: `Already up to date` for Android `product/ourfairy-v1` at `3ee4bc26...` and OurFairy `integration/ourfairy-v1` at `7687485...`. No GitHub write, integration merge, combo edit, or T20 work was performed.

## Product pre-commit checks

The first evidence commit attempt ran the repository pre-commit hook's complete `npm test`: 89/102 passed; 13 tests failed after three backend/model-double startup paths timed out at 300 seconds, with dependent tests sharing those failures. No T19 JavaScript business code was changed. A subsequent isolated run of `node --test tests/model-double.test.mjs tests/reconnect.test.mjs tests/text-delivery.test.mjs` passed all 14 in 21.3 seconds (`backend-hook-retry.log`), and `npm run combo:verify` passed (`combo-check.log`). The cause of the first concurrent startup timeout is not established; it is not represented as a product pass. The evidence commit hook is rerun normally.

## Sync after T16 integration

Merged Android `product/ourfairy-v1` `3426401c10379dfcbef819a7a299a60c0d0d23eb` into the T19 branch as `af9491ecc7437c454c372d924b5769a386e88d9b`; merged OurFairy `integration/ourfairy-v1` `4b2d23e3e9f62deaee4bf3eff2787b886cd52ee7` as `174e17b5e9c3d61fccdeb41c1ec393b04d4af5bc`. Both merges completed without conflicts. RemoteChatPanel retains RemoteSpeechInput draft ownership/callback wiring and RemoteTranscript/local preferences/Fairy visuals; IdentityModule retains RemoteSpeechBackend injection.

`android-after-t16-merge.log`: `:app:testDebugUnitTest --tests '*RemotePresentation*' --tests '*RemoteSpeech*' :app:compileReleaseKotlin` passed in 1m 3s with the documented SDK/Gradle arguments. Product full test run recorded in `npm-after-t16-merge.log` passed 106/107; the compressed costly PDF page returned `worker-unavailable` instead of expected `resource-limit` under concurrent load. Isolated `node --test tests/pdf.test.mjs` passed 3/3 (`pdf-after-t16-retry.log`); cause of the first worker result is not established. `combo-after-t16-merge.log` verifies the latest integration combination. No T19 backend business code was changed to mask that failure.
