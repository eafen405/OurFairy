# T7 / #30 — owned private/public files and constrained network execution

Implemented in OurFairy only, branch `ticket/07-space-execution`, from published `97b776f`; behavior commits `468d28f`, `9a857c0`, catalog/evidence `de149da`, then merged current integration `8bd4d8d` as `d413a78`. dsh remains `d3fe98f969c3963c6d193e74c776692e33c1eb64`; no sister-repository source changes or dirty-file cleanup.

## Delivered and reused

- Existing native file tools (`read`, `write`, `edit`, `read_image`), persisted working-directory Interface and tools, observation/stale guards, bash-sandbox, subprocess timeout/cancellation/output remain in use.
- Product file/sandbox/directory providers derive rights from immutable native Session owner, with no fallback user. cwd cannot widen roots; `danger-full-access` cannot reach the native unconfined branch. No business DB, header or formal event-format changes.
- New directories disclosed before implementation: `DSH_HOME/spaces/private/<shortId>`, `spaces/public`, one shared `env`. Small ephemeral scope/target records are derived, with roots recomputed at operations.
- Adapted only Fairybot's narrow bubblewrap runtime mounts and fd-bound file opening/atomic publishing. Removed old registry, attachment, skill and installer frameworks. This low-level code is needed because dsh default FS permits host reads and scripts can concurrently replace symlinks; a string-prefix check alone is insufficient.
- Private `/proc`, `/dev`, `/tmp`, credential-free explicit environment and narrow runtime mounts; networking enabled. Shared env supports actual dependency installs, without a per-user dependency environment.
- `extraRoots(session)` and exact `readonlyFiles(session)` are narrow dynamic contributions for the dependent T8/T9 modules. They default empty. No group/member or attachment ledger is implemented in this ticket.
- T13/#36 owns detached jobs/controllers. Until it adapts them, `run_in_background` and timeout promotion are explicitly disabled. Actual shell background descendants still run inside this ticket's namespace and are tested.

## Actual validation

Commands run in `/home/eafen405/projects/OurFairy/.worktrees/07-space-execution` with normal approval escalation for local HTTP listeners/user namespaces:

1. Real capability probe: `bwrap --unshare-all --share-net --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp -- /bin/sh -c 'printf probe-ok'` → `probe-ok`.
2. `node --check backend/spaces/src/bwrap.mjs`, `node --check backend/spaces/src/fs.mjs`, `node --check backend/spaces/src/index.mjs` → exit 0.
3. `node --test tests/spaces.test.mjs` → final `green-space-runtime.log`, **7/7**.
4. `node --test 'tests/**/*.test.mjs'` after current integration merge → `product-suite.log`, **61/61**, no skipped tests; includes real-profile boot, doctor/combo, model, identity, session, chat/reconnect plus T7 behavior.
5. `git diff --check` → clean.

The new tests go through real Loader/profile, authenticated HTTP `/sessions/*` + `/chat/*`, native Agent, real identity SQLite/JSONL, and an external local Messages-protocol model double. File/tool results return into the originating session. They observe actual file contents and real bwrap child processes:

- two ordinary users and administrator; own private write/read succeeds, other private read denied even for administrator; public files directly shared;
- scripts write own/public files, cannot read another user or management SQLite, and cannot see inherited model credentials;
- changing command cwd, persisted directory changes, relative read/write/edit, `read_image`, and symlink attempts keep the same boundary;
- direct FS/shell Interface calls made by the existing probe without session identity really reject with `FS_PERMISSION_DENIED`;
- `danger-full-access` through chat has no approval route and no foreign content; provider also rejects the mode before native bypass;
- actual shell background child (`(...) & wait`) cannot read another private root; the not-yet-adapted detached tool entry actually rejects;
- actual HTTP request succeeds inside namespace, then `npm install --prefix <shared-env>/node --ignore-scripts --no-audit --no-fund http://127.0.0.1:<port>/fixture.tgz` installs a real test package. Both users' subsequent node processes import `shared-dependency-ok`;
- deleted persisted cwd recovers to that owner's private root and relative reads work again.

## Red/intermediate evidence, without overstating it

`red-files.log` is the corrected Messages-protocol test run against the prior profile (new capability rows temporarily omitted and then restored): no file was created, giving real ENOENT. Initial exploratory mock attempts used the wrong wire protocol and are not counted as behavior evidence. The red was recaptured with the corrected mock; it was not an untouched first-run test artifact.

`red-directory-recovery.log` reproduces missing-cwd recovery failure before the local correction. It also records the earlier attempt to use native detached jobs without their future controller; the final implementation explicitly disables that separate entry.

`owned-policy.log` is an intermediate invalid agentless probe: Cordis refused property access because the probe had no `inject`, rather than reaching the providers. The probe was corrected to its existing public `ctx.get(...)` access. Only final green logs establish actual provider refusal.

`network-background.log` preserves the intermediate missing detached controller failure while the real shared dependency install already passed. `directory-image.log` and `green-processes.log` are earlier passing subsets.

`product-suite-first.log`: 59/61; obsolete baseline tool-catalog assertion and doctor correctly refused the branch until the newer integration-plan commit was merged. Updated catalog expectation + integration merge produced final 61/61.

`harness-approval.md` records the automatic approval rejection of the proposed mcode source-transfer task. It never executed; no model/CLI failure or bypass is claimed.

## Limits

This is real Linux process/file/network behavior with a cloud model substitute and an HTTP fixture package, not actual official cloud inference or an external package-registry acceptance run. No Android device/emulator/build change, production deployment, resource/performance acceptance, attachment admission, group membership or detached-job UI/notifications are claimed. Missing bwrap/user namespaces fails closed; the current machine supports the required real isolation.
