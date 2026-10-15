# Android #26 review fix — final follow-up evidence

Worktree: `/home/eafen405/projects/rikkahub/.worktrees/review-24-26-identity`
Branch: `fix/review-24-26-identity`; final commit `6a58446e889de9a56e0bcdc9af8ded6f2ef76af6` on original implementation `68b4d3d1`, based on product tip `ffc88e306b0f55cf52c3592ac93151be0492b864`.

## Final behavior

- `RouteActivity` calls `restoreIdentitySession` once in its startup `LaunchedEffect`. It keeps the loading indicator until restoration finishes, then refreshes the session view. The real operation restores `AccountSession` and replaces the provisional SignIn stack with Account or SignIn using the current session user. No recurring redirect SideEffect remains. Existing sign-in/register/sign-out callbacks still replace the stack.
- Four navigation regressions exercise that same startup operation with a real session: delayed valid credential leaves provisional navigation untouched until the answer and then replaces it with Account; absent/rejected credentials land on SignIn; a restore answering after a newer sign-in preserves the newer user and selects Account. Existing AccountSession generation protection is unchanged (seven additional tests).
- The pending-intent `SideEffect` remains. The existing `IdentityAccessPolicy.mayCompose` branch remains before `NavDisplay`; blocked destinations still take `IdentityNotReadyPage` and cannot compose legacy pages. This is source inspection plus the existing six policy tests, **not a device/Compose interaction test**.
- One property `ourfairy.identityEndpoint` feeds BuildConfig and the existing injected IdentityApi. Debug retains the emulator default. `generateReleaseBuildConfig` has a property-presence guard, so indirect task aliases cannot bypass it. Its action captures endpoint and property name as immutable locals; no task-name sniffing or duplicate runtime URL parser remains. The parser's five redundant tests were removed. README documents deployment commands.

## Environment and exact commands

Installed Temurin 21 (`/home/eafen405/.local/share/jdks/temurin-21.0.12.1+1`), `ANDROID_HOME=/home/eafen405/Android/Sdk`, normal existing host `~/.gradle` cache and cached wrapper; no toolchain install or shared Gradle properties changes. The pre-existing ignored `local.properties`, Firebase stub and initialized submodule were retained. A `/tmp` pnpm shim calls `corepack pnpm@11.28.5`; no repository package-manager changes.

`run-final-check.sh` is the exact runner, copied here. It sets those environment variables and prepends the temporary pnpm shim, then runs:

```bash
./gradlew "$@" \
  '-Dorg.gradle.jvmargs=-Xmx10g -Dfile.encoding=UTF-8 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890 -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]' \
  --max-workers=8 --parallel --console=plain
```

Actual runner invocations:

```bash
# Expected failure, a REAL action execution (not dry-run), then same command again:
/tmp/ourfairy-stage-review/run-android-final-check.sh :app:generateReleaseBuildConfig
/tmp/ourfairy-stage-review/run-android-final-check.sh :app:generateReleaseBuildConfig
# Explicit release value:
/tmp/ourfairy-stage-review/run-android-final-check.sh :app:generateReleaseBuildConfig \
  -Pourfairy.identityEndpoint=http://192.168.1.20:3080
# Narrow existing identity suite + build:
/tmp/ourfairy-stage-review/run-android-final-check.sh :app:testDebugUnitTest \
  --tests me.rerere.rikkahub.ui.identity.IdentityNavigationTest \
  --tests me.rerere.rikkahub.ui.identity.IdentityAccessPolicyTest \
  --tests me.rerere.rikkahub.data.remote.AccountSessionTest \
  --tests me.rerere.rikkahub.data.remote.IdentityApiTest \
  --tests me.rerere.rikkahub.data.remote.CredentialStoreTest \
  :app:assembleDebug -Pourfairy.identityEndpoint=http://192.168.1.20:3080
```

## Actual results and raw logs

- `logs/release-missing-before.log`: existing dsh edits first reproduced a useful red condition: expected missing-address failure **and** an unwanted configuration-cache serialization error because the action captured the script's property-name field. The final fix captures the name locally as well.
- `logs/release-missing-final.log`: exit 1, `:app:generateReleaseBuildConfig FAILED`, clear command including `-Pourfairy.identityEndpoint=https://<host>`, **configuration cache entry stored**, no cache error.
- `logs/release-missing-cache-reuse.log`: exit 1 with the same expected guard, **configuration cache entry reused**.
- `logs/release-explicit-final.log`: exit 0, **BUILD SUCCESSFUL in 1s**, release BuildConfig generation executed, cache stored.
- `logs/targeted-tests-debug-final.log`: exit 0, **BUILD SUCCESSFUL in 25s**, 306 tasks (17 executed), cache stored.

JUnit XML counted after the final targeted run (five result files; no entire app suite rerun):

| Class | Tests | Failures/errors/skipped |
|---|---:|---|
| IdentityNavigationTest | 4 | 0/0/0 |
| IdentityAccessPolicyTest | 6 | 0/0/0 |
| AccountSessionTest | 7 | 0/0/0 |
| IdentityApiTest | 6 | 0/0/0 |
| CredentialStoreTest | 6 | 0/0/0 |
| Total | **29** | **0/0/0** |

Both actual generated `app/build/generated/source/buildConfig/{debug,release}/me/rerere/rikkahub/BuildConfig.java` contain:

```java
public static final String IDENTITY_ENDPOINT = "http://192.168.1.20:3080";
```

Final debug APK sizes: arm64-v8a 86,122,132 bytes; universal 97,545,772 bytes; x86_64 86,978,076 bytes.

`git diff --check` passed. Latest product tip is unchanged at `ffc88e30`; merge result and final SHA recorded in `logs/final-git.log`.

## Preserved earlier evidence and limits

`README-before-followup.md`, `android-build-test.log`, and `release-guard.log` describe the earlier implementation and are historical, superseded by this final README. The original external dsh's generated `.gradle-user-home` and `.review-evidence` were confirmed from timestamps/log contents and moved intact to `dsh.gradle-user-home/` and `dsh.review-evidence/` here. They are not committed or used for the final host checks. Its nested sandbox failed on a read-only Kotlin daemon path; the luo model route worked. Final checks above used the normal installed host tools via escalation.

No device/emulator or Compose runtime test, no app-to-real-backend request, no signed release or full release APK build, and no cloud model/ASR calls were performed. `app/google-services.json` remains a fake-key stub; Firebase/Crashlytics runtime functionality is unverified/unusable with it. Build/JVM test success is not claimed as UI or real deployment acceptance. Compiler warnings about existing opt-in markers/srcDirs were observed; no unrelated fixes were made.
