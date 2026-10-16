# Crash fixture exit boundary

Scope: `tests/reconnect.test.mjs` only; no product behavior or state-file writer changed.

The prior full runs failed parsing `status --json` stdout, not a JSON state file.
At exact integration combination `a008e3fed4a63a007d5ea6a78ce268c605cddb59`, adding the existing `describeRun` exit assertion exposed the actual failure: `status` exited 1 with `EACCES` scanning the dying Host's `/proc/<pid>/fd` from `listeningPorts`. SIGKILL delivery did not mean process exit had completed.

Before changing fixture behavior, the competing explanations were a failed status subprocess (observable stderr/exit code), a successful but truncated pipe write (exit 0 with incomplete stdout), or subprocess termination (signal/negative result). The first was observed; there is no evidence of a state-file write race. An earlier attempt after a parallel native HEAD update failed at startup due combo drift; that is a separate failure and is not the cause of the reproduced status error.

The fixture now uses the same PID-exit check as the T13 hard-crash test, through its existing `eventually` helper, before asking the launcher for status. Only `ESRCH` confirms exit; other signal-probe errors still fail. Status errors are asserted before parsing and are never swallowed or retried as JSON errors.

Commands, run in `.worktrees/stage1315-fixture-fix`:

- `node --test --test-name-pattern='crash-orphaned turn' tests/reconnect.test.mjs` before the change: 1/1 passed, showing the original timing dependence (`crash-focused-initial.log`).
- `node --test tests/reconnect.test.mjs` with diagnostic assertion only, exact merged combo: 5/6, failed with the original symptom and exposed EACCES (`reconnect-red.log`).
- The same complete reconnect command after fixture exit synchronization: 6/6 (`reconnect-green.log`).
- `git diff --check`: passed.

## Cross-repository commit hook

A normal linked-worktree `git commit` separately exposed Git's exported repository-local environment leaking into the tests' companion-repository Git commands. The dsh HEAD probe returned OurFairy's `a008e3f` instead of the actual dsh `fc5c7ac022`, so startup correctly refused the apparent drift (`hook-red.log`). After the hook changes into its own repository, it now unsets precisely `git rev-parse --local-env-vars` before running the unchanged `npm test` and `npm run combo:verify` commands. This is isolated in commit `af5dd74`; it does not change launcher Git calls.

That ordinary commit hook passed **93/93** tests and exact combo verification (`hook-green.log`), including the locally fixed crash fixture. The fixture change is committed separately. No hooks were skipped or relaxed.

These tests use the actual product launcher, native session persistence and local HTTP, with a mock model server. No external model, phone or emulator validation was performed. No new test suite, product retry or general error handling was added. Required full tests and combo verification also run through the ordinary commit hook; the coordinator records that final command result.
