# T19 integration / #42

Owner ticket branches include their latest integration tips and have no tracked
changes. Android's preexisting `web-ui/node_modules` link is preserved untracked.
Normal fast-forwards advanced Android `3426401c` to
`af9491ecc7437c454c372d924b5769a386e88d9b`, then OurFairy `4b2d23e` to
`dcef4b9d5959a29c9d86139e20e4d0d7d51fba81`. Raw outputs are
`01-android-merge.log` and `02-product-merge.log`.

`combo.json` now records the actual Android T19 integration commit. The normal
combination commit hook runs complete `npm test` and `npm run combo:verify`;
raw output is `/tmp/ourfairy-t19-combo-commit.log` while running and retained for
stage closure. No hooks are overridden or bypassed.

Owner final normal hook passed 107/107 and combo; copied separately from
`/tmp/t19-post-t16-commit.log` for the stage close. Android presentation and
speech regressions plus release Kotlin compile passed. Earlier transient test
failures remain documented in the owner evidence, not reported as passes.

No actual device/frame/memory or visual-continuity measurement is claimed.
T22 owns device acceptance. Source/visual reuse and owner tests/build evidence:
`work/implementation/evidence/19-presentation/README.md`.
