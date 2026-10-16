# T17 integration / #40

T17 owner branch `ticket/17-pdf-text` was clean and contained the current
integration tip `7687485c58f8db607d1ad2c4fbde982b92305bd0` before merging.
`git merge --ff-only ticket/17-pdf-text` advanced the existing integration branch
to `a2782e794abda3c8df31dcaf77ef0b560402d69e`; raw output: `01-merge.log`.
No dsh, Android, database or combination-lock changes were necessary.

Actual checks on that integration state:

- `npm test`: 105/105 passed (`02-npm-test.log`).
- `npm run combo:verify`: passed (`03-combo-verify.log`).
- `git diff --check`: passed.
- Python SHA256 comparison of the 16 original dirty dsh files against the stage
  `baseline.json`: all identical (`04-protected-dsh-sha256.log`). No protected
  files were staged or modified.

The normal `.githooks/pre-commit` remains enabled. A fast-forward does not create
its own commit; committing this integration evidence runs that normal hook.
No hook was bypassed.

Tracker commands: `gh issue comment 40 --body-file /tmp/ourfairy-t17-close.md`,
`gh issue close 40`, then the minimal `gh api repos/eafen405/OurFairy/issues/{40,41}
--jq '{number, state, blocked: .issue_dependencies_summary.blocked_by}'` queries.
Raw output: `05-issue-close.log`. #40 is closed and #41 is open with blocked=0.
Comment: <https://github.com/eafen405/OurFairy/issues/40#issuecomment-6216341294>.

Only T17 is complete. T18 PDF page images remain pending. The external model is a
substitute in these real-profile checks; no actual cloud inference, Android
phone or full v1 acceptance is claimed. Owner evidence and dependency details:
`work/implementation/evidence/17-pdf-text/README.md`.
