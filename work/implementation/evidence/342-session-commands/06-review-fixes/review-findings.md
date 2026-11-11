# #342 fixed-increment code-review findings

Review heads: OurFairy `02c6e6d0e29e7acb10d2032b63a5fda79cff2297`, native `8014fc775a27e7273300a68fcadb7e2980bb93f0`. Product diff `git diff 520e1b16a6002a22f641c4bf5174d0b20a834811...HEAD`; native diff `git diff ae2adffd8d67773e125b8048120cf9ad2ba7edf3...HEAD`. Heads remained clean and unchanged throughout read-only parallel reviews.

## Standards

Reviewer a203b47d-273e-4d98-9e6e-983e7ccae8a9: **1 hard P2**, no confirmed product-standard breaches or actionable Fowler smells.

Native lacks required recorded-session regression. Anchor native `packages/core/agent-loop/tests/system-prompt-admission.spec.ts:83`; production `packages/session/session-format-v3-to-v4/src/relationships.ts:124`. The increment changes user-visible cold restoration from rejection to acceptance for delivery→first human and delivery-containing prune/replacement spans. Added tests use in-process harness and JSON/catalog round trip; no recorded-session scenario in the six-file increment. Native `docs/testing.md:55` requires every non-trivial model/protocol/human-visible change to add/update a keyless recorded-session scenario in the same PR and explicitly says package/e2e/mock-only evidence does not replace assembled transcript; `AGENTS.md:158` repeats it. Add a focused existing recorded-session-harness scenario for affected restore history and run keyless replay.

Excluded from findings: four proven unchanged native documentation baseline failures; product hook deferral with final Node854/Android787/combo actually run; necessary existing-module reuse and small-project rules.

## Spec

Reviewer dba8d91f-0c64-4243-a11e-15f98b56e06e: **1 actionable P2**, no scope creep or other confirmed missing/wrong requirements.

Android status-query refusal wrongly terminates unknown operation and discards recovery identity. `RemoteChatState.kt:849` invokes same failure handler as execute; `889–903` classifies HTTP<500 as rejection, clears persisted pendingCommand, sets rejected=true; `retrySessionCommand:854–858` then allocates new UUID. Trigger: /clear accepted but execute response lost; credential expires before recovery query; legitimate status401 (expiry supported identity/src/store.ts:789–799) establishes no original command outcome. After reauth/restart client cannot restore original identity and retry can blindly clear again.

Spec `docs/specs/session-commands.md:144`: “结果不明时先恢复原操作结果，不以新的身份盲目重置”。Protocol `work/tickets/342/protocol.md:11`: “明确终态失败后用户显式重试可新建身份”。Preserve pending identity on status failures, distinguish query failure from definite execute refusal. Reauth/restart must query original ID before execution; no new ID without terminal fact or proven no admission.

## Root independent executable-claim check

Read root/01/02/03/04/05 evidence and current protocol; named boundary, durability, fixed-cut, retention and actual color/focus claims map to public HTTP/state/Compose/native checks. Root read confirmed commandResult.seq<=cut and Android masking terminal seq>durableThroughSeq. No separate doc-consistency finding. Review statuses are still PENDING in committed evidence; fix implementer should append these separate reports + resolution/tests after corrections, without combining/reranking axes.

All actual findings must be handled by ONE FRESH implementer in owned worktree(s); no broad refactor/new platform. No user approval needed for these mandatory corrections. Native tests must be keyless; do not call real model or record with API credentials. Native normal hooks/prepush policy remains; product final gates need cover final code, never claim old full for changed Android. No push until final fixes/review evidence/integration done.
