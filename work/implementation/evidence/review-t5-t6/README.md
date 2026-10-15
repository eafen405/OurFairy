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
