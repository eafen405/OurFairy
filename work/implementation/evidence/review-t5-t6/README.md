# T5–T6 staged review archive

Two independent subagents completed the Standards and Spec reviews after both ends of T6 were integrated. The original complete reports are retained byte-for-byte in `standards.md` and `spec.md`; pinned context/ranges are retained in `fixed-scope.md`.

| Axis | Reported findings | Highest priority |
| --- | --- | --- |
| Standards | 1 | P1 |
| Spec | 2 | P1 |

The missing Sessions navigation-key serializer is shared by both reports. There are **two distinct P1 issues**: navigation save failure and failure to reconcile an observed unsaved tail when a new backend generation replaces native event positions. Both are **awaiting fixes** at this archive checkpoint. A single Android implementer owns their corrections; this archive makes no claim that either has been fixed.

Review heads are OurFairy `fca2f61b40580a7fa36a40bf997706f3882d82db` from fixed base `f8bb706`, and Android `34cabaad38ac15b81f5f10ac501a24248fea6ec8` from `f84e6c5abecfb65d5f0c12a1423b055edb3acc9a`. dsh remains `d3fe98f969c3963c6d193e74c776692e33c1eb64` with no increment; its pre-existing dirty files were excluded.

The reviewers' public reproduction sources are preserved as `OurFairyRecoveryProbe.kt`, `OurFairyNavKeyProbe.java` and the separate Standards serializer probe `OurFairyNavSerializerProbe.java`. Their original reports describe the actual executions against compiled T6 classes and cached libraries. This archival step copied source and reports; it did not rerun probes, run the app on a device/emulator, or execute a cloud request. Probe binaries and unrelated temporary output are not archived.

No T6 publication or issue closure was performed by this archive task. Final integration, verification and delivery remain pending the corrections.

## Resolution after the archived review

Both distinct P1 findings are now fixed in Android `8b2eaf0dc85b33dbb1dc7dd7ebf513a493c8b2c9`, normally merged as `d8567891533e6bc725f48382c43b2096de4e422b`. The original reports above remain unchanged. The four-path correction adds the existing navigation serialization annotation and rebuilds derived event/message/attempt projection on backend generation change. Old-generation synchronization callbacks are rejected; persisted consumption W and pending identity/text survive. Same-generation event conflicts remain strict.

The implementer's real Navigation3 back-stack roundtrip and two new public recovery cases went from **19 tests / 3 failures** to **19/19 passing**; final related tests plus debug APK build passed **85/85**. Merger inspected those actual assertions and independently executed the same 19 public tests against the fix worktree: **19 passed, 0 failed/errors/skipped**, actual log and XML summary retained under `fixes/`. This uses the actual installed Navigation3 serializer instead of merely checking annotations. The original standalone probes were not rerun because the independently executed public tests cover their triggers and additionally assert roundtrip/recovery, pending/W retention and same-generation rejection.

`git diff --exit-code 8b2eaf0dc85b33dbb1dc7dd7ebf513a493c8b2c9 HEAD` on the Android integration tree passed, proving the merged tree equals the tested source. All three APK sizes/hashes were independently verified; dsh's 16 saved dirty-file hashes remain unchanged. Updated combo verification and backend doctor passed; and. OurFairy product source did not change after its recorded **54/54** run, so that suite was not repeated.

These results resolve the reported defects. They do not claim Activity/Compose/device runtime, Android preference disk-failure runtime, APK-to-real-backend, signed release or actual cloud acceptance. Publication and #29 closure are separate final steps; the original reports are retained as historical evidence, not rewritten as clean reviews.
