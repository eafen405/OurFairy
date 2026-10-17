# T13 — owned background jobs

Scope: #36 / `work/tickets/ourfairy-v1/13-jobs.md`, parent stories 16/17/45–48/52. Tests use the pre-approved real profile/HTTP and native jobs/file/process seams. No official cloud model or phone/emulator session is claimed.

## Implementation and repositories

- Native dsh `ticket/13-jobs`: `fc5c7ac0220cf48c404cda34d1584901387eea06`. Adds one process-generation identity, required owning-Session `jobs/lifecycle` and actual native reporter `jobs/report` facts, plus optional source correlation. Existing native controller and completion policy remain the executor/reporter. Persistence type acknowledgement and upgrade guidance accompany the new discriminators. No jobs database, copied owner, output journal, timer facility or second reporter.
- OurFairy `ticket/13-jobs`, behavior commit `37a35bbf8d1e37ca3e70263ac08e17a54f4bb6fe`: mounts the existing jobs controls and scoped background bash path; extends current chat projection and adds only `/chat/jobs/output` and `/chat/jobs/stop`. Numeric task/report statuses and exact-session checks stay at the product HTTP interface. Existing inbox/turn facts settle actual reporting, including a busy notice preserved by a user-canceled reply.
- Android owner commit `bb29c98b`: task DTO/API, byte-aware output reducer, activity card/detail and independent stop. Its raw logs, mcode handoff, actual backend JSON sample and production-serializer decode check are under `android/`.

Raw CLI output is archived losslessly as  (read with `gzip -cd`), preserving terminal whitespace without introducing whitespace errors into the Git diff. Android owner evidence keeps its supplied format.

## Actual verification

Native worktree `/home/eafen405/projects/deepseek-harness/.worktrees/13-jobs`:

```sh
corepack pnpm@11.28.5 exec vitest run packages/jobs/tool-jobs/tests/tool-jobs.spec.ts packages/jobs/jobs-local/tests packages/shell/tool-bash/tests
corepack pnpm@11.28.5 run build:lib:host
corepack pnpm@11.28.5 run build:lib:client
corepack pnpm@11.28.5 run doc-sync
```

301 native tests passed; clean complete host/client builds passed.  captures missing durable facts before implementation; native result files and normal commit-hook output are retained. The unchanged native addon binary was copied from the existing local checkout as a build artifact; source and host/client bundles came from this clean ticket worktree. Dependencies came from the existing offline pnpm cache, not the dirty integration source.

Doc-sync: 39/43. Four baseline drifts remain: event producer/consumer graphs, old delivered-message/owner type-equivalence docs, Cordis catalog, config catalog.  compares generation from exact baseline sources against exact T13 sources: event-graph delta is empty; only the new generation API entry and tool-jobs source location change belong to T13, and those are included. Required persistence catalogs/history, format references, language pairing, README layout, export docs, budgets and upgrade guides pass. Unrelated baseline generated changes are not bundled.

Product commands from this ticket worktree, using the built native ticket checkout:

```sh
OURFAIRY_DSH_DIR=/home/eafen405/projects/deepseek-harness/.worktrees/13-jobs npm test
OURFAIRY_DSH_DIR=/home/eafen405/projects/deepseek-harness/.worktrees/13-jobs node --test tests/jobs.test.mjs
npm run combo:verify
```

The first complete product run passed 98/98; combo verified against the then-current integration pins. Five real-profile job scenarios passed: phone observation cancellation without canceling work, concurrent dialogue and original-session result, independent reply/job stops plus principal/session denial, UTF-8 overlapping reads, producer gaps and ring eviction, actual confined detached file denial, and retained identities after restart. A separate report-cancel red test exposed a permanently pending preserved notice; the implementation now derives its cancellation from the existing scheduling turn ending.

The final fixture additionally kills the test-owned Host process group after a real restricted child has produced bytes, waits for the Host to exit, then verifies unknown/unavailable job state and nonaliasing new task ids.  passed. Its bounded orphan, if any, completes before fixture teardown; no product restart mechanism was added. Earlier attempts exposed fixture teardown races and are retained, rather than claimed as passing.

Subsequent complete runs are retained in : a pre-existing reconnect fixture raced a killed Host's `/proc/<pid>/fd` and then parsed the failed status command's empty stdout. Independent correction `4a031b7` waits for the Host to exit before inspecting it and retains exit diagnostics; it is merged into this ticket. Worktree hook correction `af5dd74` clears Git local environment before the original cross-repository checks. Both fixes stay outside business behavior.

Final normal commit command:

```sh
OURFAIRY_DSH_DIR=/home/eafen405/projects/deepseek-harness/.worktrees/13-jobs git commit -m 'Expose owned background tasks with native output and independent stops'
```

The unchanged hooks ran full `npm test`: **98/98 passed**, then `npm run combo:verify`: **passed**, against native `fc5c7ac0220cf48c404cda34d1584901387eea06` and Android `bb29c98b9a626e7c9781ac24b4fa185c092a6f4c`. No hook bypass or cloud/phone substitution. An earlier hook attempt omitted the native-worktree environment and selected stale root `lib/` despite updated source; its failure is retained in. Root merger is aligning the root production artifacts before its independent combined check. No root full-host-build claim is made.

## Limits

The model network is a deterministic local HTTP/SSE double; jobs use actual native Agent/Session JSONL, registry output, scoped filesystem and confined OS processes. No live official model semantics, device/emulator, APK connected to backend, performance or whole-product acceptance is established. Job output is intentionally retained only within native windows; source `gapBefore`, ring `earliest`, and unavailable output remain explicit. Known terminal facts survive restart, while lost live tasks do not claim success or continuation. T14 notification policy is outside this ticket.
