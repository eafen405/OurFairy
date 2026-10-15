# Owned file spaces and execution

T7/#30 mounts existing dsh file, directory and shell tools over product providers. Authority is the native `SessionHeader.owner`, never cwd, a caller-supplied user number, or sandbox escalation. Missing identity fails closed. No business tables or formal Session format changes are introduced.

Disk layout under `DSH_HOME`:

- `spaces/private/<shortId>`: that owner's private files and initial/recovery cwd.
- `spaces/public`: directly shared files, with no file approval workflow.
- `env`: one shared writable dependency tree (`env/python` in PYTHONPATH; `env/node/node_modules` in NODE_PATH; shared executable directories in PATH).

`ctx.ourfairySpaces` derives roots on each operation. `extraRoots(session)` defaults to `[]` and lets the groups module contribute current canonical member roots. `readonlyFiles(session)` defaults to `[]` and lets attachments contribute exact canonical files qualified by the session's formal references. Neither callback may grant the data/attachments directory itself. There is no cached membership authority. `run(session, action)` carries a native Session through a bounded operation; tool dispatch and directory ensure/set already use it. Async generators need each iterator advance wrapped, rather than only generator creation.

FS operations adapt Fairybot's fd-bound opening and atomic publication: canonical allowed roots are checked against the actual opened object through Linux `/proc/self/fd`. Concurrent script symlink replacement cannot turn a resolved in-scope path into an unchecked foreign read or write. Text/version/edit behavior remains the existing local Interface. The small target grant cache is derived bookkeeping; every read and write recomputes the caller's allowed roots.

Scripts reuse native bash-sandbox/subprocess timeout, output and cancellation. A narrow bubblewrap namespace binds only runtime libraries/configuration, the caller's allowed spaces, shared environment and qualified read-only files. It has private `/proc`, `/dev`, `/tmp`, clears inherited environment and permits networking (`--share-net`). Host credentials, business SQLite, session logs, other users' private roots and host home are absent. `danger-full-access` is refused before the native executor's bypass branch. No usable bwrap/user namespace means `SANDBOX_UNAVAILABLE`, without an unconfined fallback.

Native persisted working-directory changes remain effective, but do not grant rights. Disappearing cwd recovers to the owner private root. Detached job/controller integration belongs to T13/#36; `run_in_background` and timeout promotion are explicitly disabled until then. Real shell child processes, including `(...) & wait`, already inherit the same restricted namespace.

Validation uses the real Loader/profile and authenticated HTTP chat with a Messages-protocol model double, actual files, SQLite/JSONL and bwrap subprocesses. See `work/implementation/evidence/07-space-execution/README.md`. This does not constitute real cloud, device or production-deployment acceptance.
