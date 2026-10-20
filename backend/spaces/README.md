# Owned file spaces and execution

The spaces module mounts the existing dsh file, directory and shell tools over product providers.
It owns the scope and the contributor seam; the scoped providers are independent rows of the bundle
listed in `backend/v1-bundle/cordis.patch.yml`, so any one of them can be disabled or replaced
without taking the scope — or the other providers — away. Authority is the native `SessionHeader.owner`; cwd, a caller-supplied user number and sandbox escalation do not grant access. Durable groups extend the same space capability from the existing business SQLite; formal Session formats are unchanged.

Disk layout under `DSH_HOME`:

- `spaces/private/<shortId>`: that owner's private files and initial/recovery cwd.
- `spaces/public`: directly shared files, with no file approval workflow.
- `spaces/groups/<groupId>`: shared files for current members of that group.
- `env`: one shared writable dependency tree (`env/python` in PYTHONPATH; `env/node/node_modules` in NODE_PATH; shared executable directories in PATH).

`ctx.ourfairySpaces` derives roots on each operation. Independent modules register narrow contributions instead of assigning a field: `contributeExtraRoots(session => roots)` adds writable roots (groups contribute their current member roots) and `contributeReadonlyFiles(session => files)` adds exact read-only files (attachments contribute the files qualified by the session's formal references). Each registration returns its own disposer, wired through `ctx.effect`, so unloading one contributor removes only its own contribution. Every operation evaluates all live contributions. Neither contribution can grant the data/attachments directory itself. `run(session, action)` carries a native Session through a bounded operation; async generators need each iterator advance wrapped, not only the generator creation.

FS operations adapt Fairybot's fd-bound opening and atomic publication: canonical allowed roots are checked against the actual opened object through Linux `/proc/self/fd`, so concurrent symlink replacement cannot turn an in-scope path into a foreign read or write. Text/version/edit behavior remains the existing local Interface; every read and write recomputes the caller's allowed roots.

Scripts reuse native bash-sandbox/subprocess timeout, output and cancellation. A narrow bubblewrap namespace binds only runtime libraries and configuration, the caller's allowed spaces, the shared environment and qualified read-only files. It has private `/proc`, `/dev`, `/tmp` and a cleared environment; `buildBwrapArgv` takes an explicit `network` choice, which scripts pass as `true` (`--share-net`) and the PDF worker passes as `false`. `danger-full-access` is refused before the native executor's bypass branch; without a usable bwrap namespace the call fails with `SANDBOX_UNAVAILABLE`.

Native persisted working-directory changes remain effective, but do not grant rights. Disappearing cwd recovers to the owner private root. Detached job/controller integration belongs to T13/#36; `run_in_background` and timeout promotion are explicitly disabled until then. Real shell child processes, including `(...) & wait`, already inherit the same restricted namespace.

Validation runs the real profile with authenticated HTTP chat against a model double, using actual files, SQLite/JSONL and bwrap subprocesses.

## Groups through chat

`groups` stores the designated owner and creation actor; `group_members` stores membership with creation/update actors. Both carry creation/update timestamps and logical deletion, with ordinary lookup indexes only. Opening an older file adds the tables and keeps credentials and invites.

Every known session owner gets `groups`, which lists their current group IDs, owner/member short numbers and file roots. Only Phaethon gets `group_create(name, ownerShortId)`. Creation joins the designated owner, without granting Phaethon membership automatically. Current group owners get `group_members(groupId, userShortId, action)`, where the numeric action is 1 (add) or 2 (remove). Assigning a new group to an already-live owner makes that tool visible in their live sessions immediately. Group names need not be unique; tools address stable numeric group IDs.

Membership changes recheck the exact target group's current owner and active identities inside the same immediate transaction as the write. Duplicate add/remove is harmless and re-add revives the same member record. The designated owner remains a member; owner transfer and group deletion are out of scope. Errors return readable native tool failures.

The group contribution reads current SQLite membership at every new file or process operation, and private/public/group files and script mounts use the same roots. Removing a member blocks subsequent group operations even in an existing live session; if its cwd was in that group, the next prompt restores the private root. Already-running processes keep their granted OS mounts until they end.
