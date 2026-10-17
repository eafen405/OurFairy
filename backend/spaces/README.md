# Owned file spaces and execution

T7/#30 mounts existing dsh file, directory and shell tools over product providers. Authority is the native `SessionHeader.owner`, never cwd, a caller-supplied user number, or sandbox escalation. Missing identity fails closed. T8/#31 extends the same space capability with durable groups in the existing business SQLite; formal Session formats are unchanged.

Disk layout under `DSH_HOME`:

- `spaces/private/<shortId>`: that owner's private files and initial/recovery cwd.
- `spaces/public`: directly shared files, with no file approval workflow.
- `spaces/groups/<groupId>`: shared files for current members of that group.
- `env`: one shared writable dependency tree (`env/python` in PYTHONPATH; `env/node/node_modules` in NODE_PATH; shared executable directories in PATH).

`ctx.ourfairySpaces` derives roots on each operation. Independent modules register narrow contributions instead of assigning a field: `contributeExtraRoots(session => roots)` adds writable roots (the groups module contributes current canonical member roots) and `contributeReadonlyFiles(session => files)` adds exact canonical read-only files (attachments contribute the files qualified by the session's formal references). Each registration returns its own disposer, which the caller wires through `ctx.effect`, so unloading one contributor removes only its own contribution and never another's. Every operation evaluates all live contributions; there is no cached membership or contribution list. Neither contribution may grant the data/attachments directory itself. `run(session, action)` carries a native Session through a bounded operation; tool dispatch and directory ensure/set already use it. Async generators need each iterator advance wrapped, rather than only generator creation.

FS operations adapt Fairybot's fd-bound opening and atomic publication: canonical allowed roots are checked against the actual opened object through Linux `/proc/self/fd`. Concurrent script symlink replacement cannot turn a resolved in-scope path into an unchecked foreign read or write. Text/version/edit behavior remains the existing local Interface. The small target grant cache is derived bookkeeping; every read and write recomputes the caller's allowed roots.

Scripts reuse native bash-sandbox/subprocess timeout, output and cancellation. A narrow bubblewrap namespace binds only runtime libraries/configuration, the caller's allowed spaces, shared environment and qualified read-only files. It has private `/proc`, `/dev`, `/tmp`, clears inherited environment and permits networking (`--share-net`). Host credentials, business SQLite, session logs, other users' private roots and host home are absent. `danger-full-access` is refused before the native executor's bypass branch. No usable bwrap/user namespace means `SANDBOX_UNAVAILABLE`, without an unconfined fallback.

Native persisted working-directory changes remain effective, but do not grant rights. Disappearing cwd recovers to the owner private root. Detached job/controller integration belongs to T13/#36; `run_in_background` and timeout promotion are explicitly disabled until then. Real shell child processes, including `(...) & wait`, already inherit the same restricted namespace.

Validation uses the real Loader/profile and authenticated HTTP chat with a Messages-protocol model double, actual files, SQLite/JSONL and bwrap subprocesses. See `work/implementation/evidence/07-space-execution/README.md`. This does not constitute real cloud, device or production-deployment acceptance.

## Groups through chat

The existing identity store owns SQLite schema v3: `groups` stores the designated owner and creation actor, and `group_members` stores membership with creation/update actors. Both carry creation/update timestamps and logical deletion; only ordinary lookup indexes are added. Migrations from v1 and v2 retain credentials and invites. No second membership database, client group page or group chat is introduced.

Every known session owner gets `groups`, which lists their current group IDs, owner/member short numbers and file roots. Only Phaethon gets `group_create(name, ownerShortId)`. Creation joins the designated owner, without granting Phaethon membership automatically. Current group owners get `group_members(groupId, userShortId, action)`, where the numeric action is 1 (add) or 2 (remove). Assigning a new group to an already-live owner makes that tool visible in their live sessions immediately. Group names need not be unique; tools address stable numeric group IDs.

Membership changes recheck the exact target group's current owner and active identities inside the same immediate transaction as the write. Tool visibility grants no authority. Duplicate add/remove is harmless; re-add revives the same member record. The designated owner remains a member; owner transfer and group deletion are outside T8. Errors return readable native tool failures, including unknown user, invalid action, wrong owner and attempted owner removal.

The group contribution reads current SQLite membership at every new file or process operation. Private/public/group files and real script mounts use the same roots; administrative status grants no implicit group-file access. Removing a member blocks subsequent group operations even in an existing live session. If its cwd was in that group, the next prompt restores the private root, so the session can continue; absolute access to the removed group still fails. Already-running processes retain their originally granted OS mounts until they end; this slice does not promise live mount revocation.

T8 evidence: `work/implementation/evidence/08-group-spaces/README.md`.
