# T5–T6 integration evidence

## T5 backend merge

- OurFairy integration base: `c2b5fceb2275f631070843b2883eed11160452b9`.
- Reviewed incoming branch `ticket/05-remote-chat` at `b50a2c5a893090c4a7d8c42168ef868f5ebeb9e4`: the 19 changed paths are the product chat module, existing HTTP carrier/profile/launcher adaptation, remote-chat tests and ticket evidence. No fork source or unrelated changes were included.
- Merged without conflicts as `9383e86e0a7ef1ba641f434dcc94c2a93dbf4051`.
- On that integration tree, `node --test 'tests/**/*.test.mjs'` exited 0: **48 tests passed, 0 failed/skipped**. Raw output: `t5-integrated-product-suite.log`. Tests used normal loopback access through the escalated tool, real local product boot/persistence and an external-model double; no official model request is claimed.
- `git diff --check` passed.

## T5 Android and combination

- Reviewed the seven incoming Kotlin paths from `fd04aab78919a7816e6eb962949a6eaf13a41532` to `aedbf7e348099844e46257550f5db644a4b7d1d5`; no unrelated source changes. Literal route names, POST/Bearer documents, SSE `projection` event, message/attempt/projection/receipt fields and numeric role/status values match `backend/chat/README.md` and the backend source.
- Normal no-conflict merge into rikkahub `product/ourfairy-v1`: `07c0df403a54aa0532840244adec63a6a91a81b4`. `git diff --exit-code aedbf7e348099844e46257550f5db644a4b7d1d5 HEAD` passed, confirming the worker's tested source tree was preserved exactly. Root's pre-existing untracked `.worktrees/` remains untouched.
- Worker evidence copied to `../05-remote-chat-android/`, including raw red/green/build logs, per-suite results (**68 passed, 0 failed/errors/skipped**), APK metadata and the two bounded mcode run/task summaries. Harness stdout/stderr were omitted. A secret-pattern scan of the copied files found no suspect files. Independently rehashed all three APKs; sizes and SHA-256 match `apk.json`.
- `combo.json` pins the actual Android integration merge commit and records the T5 behavior and runtime limits. dsh remains `d3fe98f969c3963c6d193e74c776692e33c1eb64`; its 16 pre-existing dirty-file hashes all match the saved baseline (`t5-dsh-dirty-preservation.json`).
- `node scripts/combo.mjs verify` passed (`t5-combo-verify.log`). `node scripts/ourfairy-backend.mjs doctor` passed all checks (`t5-combination-doctor.log`). `git diff --check` passed for both incoming Android range and final OurFairy edits. Full product suite was not repeated because these subsequent OurFairy changes only collect evidence and pin the Android combination.

This evidence does not claim a device/emulator run, cross-end runtime acceptance, official cloud service acceptance, signed release, or CI. No issue closure performed by this merger. Publication status is recorded separately after checking remote refs.

## T6 backend merge

- Reviewed incoming `ticket/06-reconnect` at `fbad2dc1621bd2bdb9e521343fbc45a505f367ed` against integration `ee181023b2ff893ef676e6720fa3822e5ef2ce1d`. Its 11 paths only change the existing chat routes/service/wire contract, add reconnect behavior tests, and retain raw ticket evidence. No database, fork source, or unrelated source changes were included.
- Normal conflict-free merge: `5bf559751de535da61d932c5320bf857e5b6fce5`.
- On this integration tree, `node --test 'tests/**/*.test.mjs'` exited 0: **54 tests passed, 0 failed/skipped**. Raw output: `t6-integrated-product-suite.log`. The suite used real local HTTP/SSE, native persistence and restarts; the external model was a loopback double.
- `git diff --check` passed. All 16 saved dsh dirty-file SHA-256 values remained unchanged.
- Android T6 integration and the two-axis staged review are pending. No T6 publication or issue closure was performed at this checkpoint.
